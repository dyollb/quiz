import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CsvImportError, parseQuizCsv } from '../src/lib/csv'

const SIMPLE = `question,answer1,answer2,answer3,answer4,correct,explanation
Capital of Switzerland?,Zurich,Bern,Geneva,Basel,2,Bern is the federal city
2 + 2?,3,4,5,6,2,2 + 2 equals 4.
`

const SIMPLE_MULTI = `question,answer1,answer2,answer3,correct,explanation
Pick the primes?,2,4,5,"1,3",2 and 5 are prime
`

const SIMPLE_NO_TIME = `question,answer1,answer2,correct
Hello?,Yes,No,1
`

describe('parseQuizCsv — simple format', () => {
  it('parses questions, correct answers and explanations', () => {
    const { quiz, format, warnings } = parseQuizCsv(SIMPLE, 'My quiz')
    expect(format).toBe('simple')
    expect(warnings).toEqual([])
    expect(quiz.title).toBe('My quiz')
    expect(quiz.questions).toHaveLength(2)
    const q0 = quiz.questions[0]
    expect(q0.prompt).toBe('Capital of Switzerland?')
    expect(q0.answers).toHaveLength(4)
    expect(q0.answers[1].text).toBe('Bern')
    expect(q0.answers.filter((a) => a.correct).map((a) => a.text)).toEqual(['Bern'])
    expect(q0.explanation).toBe('Bern is the federal city')
  })

  it('supports multiple correct answers', () => {
    const { quiz } = parseQuizCsv(SIMPLE_MULTI)
    const q = quiz.questions[0]
    expect(q.answers.filter((a) => a.correct).map((a) => a.text)).toEqual(['2', '5'])
    expect(q.type).toBe('multi') // legacy multi-correct normalises to multi-select
    expect(quiz.v).toBe(2)
  })

  it('falls back to the default timer when no time column', () => {
    const { quiz } = parseQuizCsv(SIMPLE_NO_TIME)
    expect(quiz.timer.defaultSeconds).toBe(20)
    expect(quiz.questions[0].timeLimit).toBeUndefined()
  })

  it('rejects out-of-range correct values', () => {
    const bad = `question,answer1,answer2,correct\nQ?,a,b,5\n`
    expect(() => parseQuizCsv(bad)).toThrow(CsvImportError)
  })

  it('rejects CSV without a question header', () => {
    expect(() => parseQuizCsv('a,b,c\n1,2,3\n')).toThrow(/header/i)
  })
})

describe('parseQuizCsv — question types', () => {
  const TYPED = `question,answer1,answer2,answer3,answer4,correct,type
Plain Q?,a,b,c,d,2,single
Pick the primes?,2,4,5,6,"2,4",multi
Put in order?,Dynasty B,Cosmos,Dynasty A,Solar System,"3,1,4,2",order
Legacy multi?,x,y,z,w,"1,3",
`

  it('parses the type column for all three types', () => {
    const { quiz, warnings } = parseQuizCsv(TYPED)
    expect(warnings).toEqual([])
    // single rows carry no explicit type field (absent = single)
    expect(quiz.questions.map((q) => q.type)).toEqual([undefined, 'multi', 'order', 'multi'])
    expect(quiz.v).toBe(2)
    const order = quiz.questions[2]
    // correct="3,1,4,2": the tap sequence, stored as correctOrder.
    expect(order.correctOrder).toEqual([3, 1, 4, 2])
    expect(order.answers.map((a) => a.text)).toEqual(['Dynasty B', 'Cosmos', 'Dynasty A', 'Solar System'])
    expect(order.answers.every((a) => a.correct)).toBe(true) // every option is placed
    expect(parseQuizCsv(SIMPLE).quiz.v).toBe(1)
  })

  it('rejects unknown type values', () => {
    const bad = `question,answer1,answer2,correct,type\nQ?,a,b,1,matching\n`
    expect(() => parseQuizCsv(bad)).toThrow(/unknown type/i)
  })

  it('rejects single questions with multiple correct', () => {
    const bad = `question,answer1,answer2,answer3,correct,type\nQ?,a,b,c,"1,2",single\n`
    expect(() => parseQuizCsv(bad)).toThrow(/exactly one correct/i)
  })

  it('rejects multi with fewer than two correct, and with all correct', () => {
    const one = `question,answer1,answer2,answer3,correct,type\nQ?,a,b,c,2,multi\n`
    expect(() => parseQuizCsv(one)).toThrow(/at least two correct/i)
    const all = `question,answer1,answer2,answer3,correct,type\nQ?,a,b,c,"1,2,3",multi\n`
    expect(() => parseQuizCsv(all)).toThrow(/at least one wrong/i)
  })

  it('rejects order rows whose correct is not a full sequence', () => {
    const bad = `question,answer1,answer2,answer3,correct,type\nQ?,a,b,c,"3,1",order\n`
    expect(() => parseQuizCsv(bad)).toThrow(/every answer once/i)
  })

  it('rejects order rows listed in the correct order (would leak the answer)', () => {
    const bad = `question,answer1,answer2,answer3,correct,type\nQ?,First,Second,Third,"1,2,3",order\n`
    expect(() => parseQuizCsv(bad)).toThrow(/correct order/i)
  })

  it('skips order rows with fewer than three answers', () => {
    const csv = `question,answer1,answer2,answer3,correct,type\nQ?,a,b,c,"3,1,2",order\nShort?,x,y,,"2,1",order\n`
    const { quiz, warnings } = parseQuizCsv(csv)
    expect(quiz.questions).toHaveLength(1)
    expect(quiz.questions[0].type).toBe('order')
    expect(warnings.join('\n')).toMatch(/at least three answers/i)
  })
})

describe('parseQuizCsv — Kahoot export', () => {
  const kahoot = readFileSync('example/Kahoot_Erdentstehung_Quiz.csv', 'utf-8')

  it('detects format, skips junk/trailing rows and finds all 25 questions', () => {
    const { quiz, format, warnings } = parseQuizCsv(kahoot, 'Erdentstehung')
    expect(format).toBe('kahoot')
    expect(quiz.questions).toHaveLength(25)
    expect(warnings).toEqual([])
    expect(quiz.title).toBe('Erdentstehung')
  })

  it('reads question text, answers and correct answer from the example', () => {
    const { quiz } = parseQuizCsv(kahoot)
    const q2 = quiz.questions[1]
    expect(q2.prompt).toContain('Jahren')
    expect(q2.answers).toHaveLength(4)
    expect(q2.answers[2].text).toBe('14 Milliarden Jahren')
    expect(q2.answers[2].correct).toBe(true)
    expect(q2.answers.filter((a) => a.correct)).toHaveLength(1)
  })

  it('takes the per-question time limit', () => {
    const { quiz } = parseQuizCsv(kahoot)
    expect(quiz.questions[0].timeLimit).toBe(30)
  })

  it('parses a small kahoot snippet with multiple correct answers', () => {
    const snippet = `,,,,,,,,
,,Quiz template,,,,,,
,,,,,,,,
,Question - 120 max length,Answer 1 - 75 max length,Answer 2 - 75 max length,Answer 3 - 75 max length,Answer 4 - 75 max length,Time limit,Correct answer(s),
1,Pick primes?,2,3,4,"6",20,"1,2",
,,,,,,,,
`
    const { quiz, format } = parseQuizCsv(snippet)
    expect(format).toBe('kahoot')
    expect(quiz.questions).toHaveLength(1)
    expect(quiz.questions[0].answers.filter((a) => a.correct).map((a) => a.text)).toEqual(['2', '3'])
    expect(quiz.questions[0].timeLimit).toBe(20)
    expect(quiz.questions[0].type).toBe('multi') // kahoot multi-correct -> multi-select
  })
})

describe('parseQuizCsv — shipped mixed-types example', () => {
  const mixed = readFileSync('example/Mixed_types_demo_quiz.csv', 'utf-8')

  it('parses all three question types with v: 2', () => {
    const { quiz, format, warnings } = parseQuizCsv(mixed)
    expect(format).toBe('simple')
    expect(warnings).toEqual([])
    expect(quiz.v).toBe(2)
    expect(quiz.title).toBe('Mixed types demo')
    expect(quiz.questions).toHaveLength(7)
    expect(quiz.questions.map((q) => q.type ?? 'single')).toEqual([
      'single', 'single', 'single', 'multi', 'multi', 'order', 'order',
    ])
    const primes = quiz.questions[3]
    expect(primes.answers.filter((a) => a.correct).map((a) => a.text)).toEqual(['7', '13'])
    const events = quiz.questions[5]
    expect(events.correctOrder).toEqual([4, 2, 1, 3])
    expect(events.explanation).toContain('1912')
  })
})
