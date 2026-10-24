import Papa from 'papaparse'
import { newId, quizVersionFor, type Question, type QuestionType, type Quiz } from './schema'

export interface CsvImportResult {
  quiz: Quiz
  format: 'simple' | 'kahoot'
  warnings: string[]
}

export class CsvImportError extends Error {}

const DEFAULT_TIME = 20

function makeQuiz(title: string, questions: Question[], format: string, timeLimitSec?: number): Quiz {
  return {
    v: quizVersionFor(questions),
    id: newId(),
    title: title.trim() || 'Untitled quiz',
    createdAt: new Date().toISOString(),
    timer: { enabled: true, defaultSeconds: timeLimitSec ?? DEFAULT_TIME },
    questions,
    source: `csv-${format}`,
  }
}

/** Parse a 1-based correct-answer cell like "2" or "2,4" (also tolerates "2;4"). */
function parseCorrect(cell: string | undefined, answerCount: number, qIndex: number): number[] {
  const raw = (cell ?? '').trim()
  if (!raw) throw new CsvImportError(`Question ${qIndex + 1}: missing "correct" answer`)
  const parts = raw.split(/[,;]+/).map((p) => p.trim()).filter(Boolean)
  const indices = parts.map((p) => {
    const n = Number(p)
    if (!Number.isInteger(n) || n < 1 || n > answerCount) {
      throw new CsvImportError(
        `Question ${qIndex + 1}: correct answer "${p}" is out of range (1-${answerCount})`,
      )
    }
    return n
  })
  return [...new Set(indices)]
}

/**
 * Parse the optional `type` column: blank = legacy (single, or multi when several
 * answers are correct), or explicitly 'single' | 'multi' | 'order'.
 */
function parseDeclaredType(cell: string | undefined, qIndex: number): QuestionType | '' {
  const raw = (cell ?? '').trim().toLowerCase()
  if (raw === '') return ''
  if (raw === 'single' || raw === 'multi' || raw === 'order') return raw
  throw new CsvImportError(
    `Question ${qIndex + 1}: unknown type "${raw}" (use single, multi or order)`,
  )
}

/**
 * Validate a `correct` cell against the declared question type.
 * - single: exactly one correct answer
 * - multi:  at least two correct, at least one wrong
 * - order:  a full sequence (every answer exactly once) that is NOT the listed order
 * Legacy rows (declared '') normalise: >1 correct flag becomes 'multi'.
 */
function resolveType(
  declared: QuestionType | '',
  correct: number[],
  answerCount: number,
  qIndex: number,
): QuestionType {
  const label = `Question ${qIndex + 1}`
  if (declared === 'single') {
    if (correct.length !== 1) {
      throw new CsvImportError(`${label}: a single question needs exactly one correct answer`)
    }
    return 'single'
  }
  if (declared === 'multi') {
    if (correct.length < 2) {
      throw new CsvImportError(`${label}: a multi question needs at least two correct answers`)
    }
    if (correct.length >= answerCount) {
      throw new CsvImportError(`${label}: a multi question needs at least one wrong answer`)
    }
    return 'multi'
  }
  if (declared === 'order') {
    if (correct.length !== answerCount) {
      throw new CsvImportError(
        `${label}: an order question's correct column must list every answer once, in the right sequence`,
      )
    }
    if (correct.every((v, i) => v === i + 1)) {
      throw new CsvImportError(
        `${label}: an order question's answers are listed in the correct order — shuffle them`,
      )
    }
    return 'order'
  }
  // Legacy row: more than one correct flag can only be scored as multi-select.
  return correct.length > 1 ? 'multi' : 'single'
}

function buildQuestion(
  prompt: string,
  answerCells: string[],
  correctIdx: number[],
  timeLimit: number | undefined,
  explanation: string | undefined,
  type: QuestionType,
): Question {
  const answers = answerCells.map((text) => ({ id: newId(), text: text.trim(), correct: false }))
  for (const i of correctIdx) answers[i - 1].correct = true
  return {
    id: newId(),
    prompt: prompt.trim(),
    ...(type !== 'single' ? { type } : {}),
    // For order questions `correctIdx` is the tap sequence, not just a membership set.
    ...(type === 'order' ? { correctOrder: correctIdx } : {}),
    answers,
    ...(timeLimit ? { timeLimit } : {}),
    ...(explanation?.trim() ? { explanation: explanation.trim() } : {}),
  }
}

/**
 * Detects and parses both supported CSV layouts:
 *  A. simple:  question,answer1..answer4,correct,explanation[,type][,time_limit][,title]
 *     (type = single|multi|order; blank = single, or multi when correct lists 2+)
 *  B. Kahoot export: header row containing "Question - 120 max length" (or similar),
 *     leading index column, "Time limit" + "Correct answer(s)" columns, junk/trailing rows.
 */
export function parseQuizCsv(text: string, fallbackTitle?: string): CsvImportResult {
  const parsed = Papa.parse<string[]>(text.trim(), {
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  })
  if (parsed.errors.length && !parsed.data.length) {
    throw new CsvImportError(`Could not parse CSV: ${parsed.errors[0]?.message}`)
  }
  const rows = (parsed.data as string[][]).map((r) => r.map((c) => (c ?? '').toString()))
  if (!rows.length) throw new CsvImportError('The CSV file is empty.')

  const headerIdx = rows.findIndex((r) =>
    r.some((c) => /^question\b/i.test(c.trim())),
  )
  const header = headerIdx >= 0 ? rows[headerIdx].map((c) => c.trim().toLowerCase()) : []

  if (headerIdx < 0) {
    throw new CsvImportError(
      'No header row found. Expected a column named "question" (see README for the CSV formats).',
    )
  }

  // Simple format has exact tokens like "answer1"/"correct"; Kahoot export uses
  // descriptive labels like "Answer 1 - 75 max length" / "Correct answer(s)".
  const isSimple = header.includes('answer1') && header.some((c) => /^correct( answer)?(s)?$/.test(c))
  return isSimple
    ? parseSimple(rows, headerIdx, header, fallbackTitle)
    : parseKahoot(rows, headerIdx, header, fallbackTitle)
}

/* ---------------- Format A: simple ---------------- */

function col(header: string[], ...names: string[]): number {
  return header.findIndex((h) => names.includes(h))
}

function parseSimple(
  rows: string[][],
  headerIdx: number,
  header: string[],
  fallbackTitle?: string,
): CsvImportResult {
  const qCol = col(header, 'question')
  const aCols = [1, 2, 3, 4].map((i) => col(header, `answer${i}`))
  const correctCol = col(header, 'correct', 'correct answer', 'correct answers', 'answer')
  const typeCol = col(header, 'type', 'question type')
  const explCol = col(header, 'explanation', 'explenation', 'comment')
  const timeCol = col(header, 'time_limit', 'time limit', 'time', 'seconds')
  const titleCol = col(header, 'title', 'quiz', 'quiz title')
  if (qCol < 0 || aCols[0] < 0 || aCols[1] < 0 || correctCol < 0) {
    throw new CsvImportError(
      'Header must include at least: question, answer1, answer2, correct.',
    )
  }
  const answerCols = aCols.filter((c) => c >= 0)
  const warnings: string[] = []
  const questions: Question[] = []
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r]
    const prompt = row[qCol]?.trim()
    if (!prompt) continue
    const declared = parseDeclaredType(typeCol >= 0 ? row[typeCol] : undefined, questions.length)
    let answerCells = answerCols.map((c) => row[c] ?? '')
    if (!answerCells[0]?.trim() || !answerCells[1]?.trim()) {
      warnings.push(`Skipped row ${r + 1}: needs at least two answers.`)
      continue
    }
    if (declared === 'order') {
      answerCells = answerCells.filter((a) => a.trim())
      if (answerCells.length < 3) {
        warnings.push(`Skipped row ${r + 1}: order questions need at least three answers.`)
        continue
      }
    }
    const correct = parseCorrect(row[correctCol], answerCells.length, questions.length)
    const type = resolveType(declared, correct, answerCells.length, questions.length)
    const t = timeCol >= 0 ? Number(row[timeCol]) : NaN
    questions.push(
      buildQuestion(
        prompt,
        answerCells,
        correct,
        Number.isFinite(t) && t > 0 ? Math.round(t) : undefined,
        explCol >= 0 ? row[explCol] : undefined,
        type,
      ),
    )
  }
  if (!questions.length) throw new CsvImportError('No valid questions found in the CSV.')
  const title =
    (titleCol >= 0 && rows[headerIdx + 1]?.[titleCol]?.trim()) ||
    fallbackTitle ||
    'Imported quiz'
  return { quiz: makeQuiz(title, questions, 'simple'), format: 'simple', warnings }
}

/* ---------------- Format B: Kahoot export ---------------- */

function parseKahoot(
  rows: string[][],
  headerIdx: number,
  header: string[],
  fallbackTitle?: string,
): CsvImportResult {
  const qCol = header.findIndex((c) => /question/i.test(c))
  const timeCol = header.findIndex((c) => /time limit/i.test(c))
  const correctCol = header.findIndex((c) => /correct answer/i.test(c))
  const answerCols = header
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => i !== qCol && i !== timeCol && i !== correctCol && /^answer/i.test(c))
    .map(({ i }) => i)
  if (qCol < 0 || answerCols.length < 2 || correctCol < 0) {
    throw new CsvImportError('Kahoot header must include question, two answers and correct answer(s).')
  }
  const warnings: string[] = []
  const questions: Question[] = []
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r]
    const prompt = row[qCol]?.trim()
    if (!prompt) continue // junk / trailing blank rows
    const answerCells = answerCols.slice(0, 4).map((c) => row[c] ?? '')
    const filled = answerCells.filter((a) => a.trim())
    if (filled.length < 2) {
      warnings.push(`Skipped row ${r + 1}: needs at least two answers.`)
      continue
    }
    const usedCells = answerCells.slice(0, filled.length)
    const correct = parseCorrect(row[correctCol], usedCells.length, questions.length)
    // Kahoot exports have no type column; 2+ correct answers normalise to multi-select.
    const type = resolveType('', correct, usedCells.length, questions.length)
    const t = timeCol >= 0 ? Number(row[timeCol]) : NaN
    questions.push(
      buildQuestion(prompt, usedCells, correct, Number.isFinite(t) && t > 0 ? Math.round(t) : undefined, undefined, type),
    )
  }
  if (!questions.length) throw new CsvImportError('No valid questions found in the Kahoot CSV.')
  return {
    quiz: makeQuiz(fallbackTitle || 'Imported Kahoot quiz', questions, 'kahoot'),
    format: 'kahoot',
    warnings,
  }
}
