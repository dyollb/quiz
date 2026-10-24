import { describe, expect, it } from 'vitest'
import { packQuiz, unpackQuiz, quizFileName, QuizUpgradeNeededError } from '../src/lib/quizPackage'
import type { Quiz } from '../src/lib/schema'

function sampleQuiz(): Quiz {
  return {
    v: 1,
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Swiss Capitals: Test/Quiz',
    createdAt: new Date().toISOString(),
    timer: { enabled: true, defaultSeconds: 20 },
    source: 'test',
    questions: [
      {
        id: 'q1',
        prompt: 'Capital of Switzerland?',
        answers: [
          { id: 'a1', text: 'Zurich', correct: false },
          { id: 'a2', text: 'Bern', correct: true },
        ],
        timeLimit: 30,
        explanation: 'Bern is the federal city',
        image: { ref: 'img1.png', alt: 'Flag', credit: 'CC0: Tester' },
      },
      {
        id: 'q2',
        prompt: '2 + 2?',
        answers: [
          { id: 'a1', text: '3', correct: false },
          { id: 'a2', text: '4', correct: true },
        ],
      },
    ],
  }
}

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
])

describe('.quiz package', () => {
  it('round-trips a quiz with images', async () => {
    const quiz = sampleQuiz()
    const images = new Map<string, Blob>([
      ['img1.png', new Blob([pngBytes], { type: 'image/png' })],
    ])
    const { blob, fileName } = await packQuiz(quiz, images)
    expect(fileName).toBe('Swiss-Capitals-TestQuiz.quiz')

    const out = await unpackQuiz(blob)
    expect(out.quiz.title).toBe(quiz.title)
    expect(out.quiz.questions).toHaveLength(2)
    expect(out.quiz.questions[0].explanation).toBe('Bern is the federal city')
    expect(out.quiz.questions[0].image?.ref).toBe('img1.png')
    expect(out.quiz.questions[0].image?.credit).toBe('CC0: Tester')
    const img = out.images.get('img1.png')
    expect(img).toBeDefined()
    expect(img!.type).toBe('image/png')
    expect(new Uint8Array(await img!.arrayBuffer())).toEqual(pngBytes)
  })

  it('skips missing image refs without failing', async () => {
    const quiz = sampleQuiz()
    const { blob } = await packQuiz(quiz, new Map())
    const out = await unpackQuiz(blob)
    expect(out.images.size).toBe(0)
    expect(out.quiz.questions[0].image?.ref).toBe('img1.png') // ref preserved
  })

  it('rejects non-zip files', async () => {
    const blob = new Blob(['not a zip'])
    await expect(unpackQuiz(blob)).rejects.toThrow(/valid .quiz/i)
  })

  it('rejects zips without quiz.json', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const blob = new Blob([zipSync({ 'readme.txt': strToU8('hi') })])
    await expect(unpackQuiz(blob)).rejects.toThrow(/missing quiz.json/i)
  })

  it('quizFileName sanitises odd characters', () => {
    expect(quizFileName('Érdem/世 test??')).toMatch(/^[\w-]+\.quiz$/)
    expect(quizFileName('   ')).toBe('quiz.quiz')
  })
})

describe('.quiz package — question types', () => {
  function typedQuiz(): Quiz {
    return {
      v: 2,
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Typed quiz',
      createdAt: new Date().toISOString(),
      timer: { enabled: true, defaultSeconds: 20 },
      source: 'test',
      questions: [
        {
          id: 'q1',
          type: 'multi',
          prompt: 'Pick the primes?',
          answers: [
            { id: 'a1', text: '2', correct: true },
            { id: 'a2', text: '4', correct: false },
            { id: 'a3', text: '5', correct: true },
          ],
        },
        {
          id: 'q2',
          type: 'order',
          correctOrder: [2, 1, 3],
          prompt: 'Put in order?',
          answers: [
            { id: 'a1', text: 'Second', correct: true },
            { id: 'a2', text: 'First', correct: true },
            { id: 'a3', text: 'Third', correct: true },
          ],
        },
      ],
    }
  }

  it('round-trips multi/order fields', async () => {
    const { blob } = await packQuiz(typedQuiz(), new Map())
    const out = await unpackQuiz(blob)
    expect(out.quiz.v).toBe(2)
    expect(out.quiz.questions[0].type).toBe('multi')
    expect(out.quiz.questions[1].type).toBe('order')
    expect(out.quiz.questions[1].correctOrder).toEqual([2, 1, 3])
  })

  it('rejects unknown question types with an update-the-app error', async () => {
    const raw = typedQuiz() as unknown as Record<string, unknown>
    const { zipSync, strToU8 } = await import('fflate')
    const future = JSON.parse(JSON.stringify(raw))
    future.questions[0].type = 'matching'
    const blob = new Blob([zipSync({ 'quiz.json': strToU8(JSON.stringify(future)) })])
    await expect(unpackQuiz(blob)).rejects.toThrow(QuizUpgradeNeededError)
    await expect(unpackQuiz(blob)).rejects.toThrow(/newer version of QuizTime/i)
  })

  it('rejects future quiz schema versions', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const future = JSON.parse(JSON.stringify(typedQuiz()))
    future.v = 3
    const blob = new Blob([zipSync({ 'quiz.json': strToU8(JSON.stringify(future)) })])
    await expect(unpackQuiz(blob)).rejects.toThrow(/v3/i)
  })

  it('rejects a malformed order question missing correctOrder', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const broken = JSON.parse(JSON.stringify(typedQuiz()))
    delete broken.questions[1].correctOrder
    const blob = new Blob([zipSync({ 'quiz.json': strToU8(JSON.stringify(broken)) })])
    await expect(unpackQuiz(blob)).rejects.toThrow(/order question/i)
  })
})
