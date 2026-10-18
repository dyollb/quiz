import { describe, expect, it } from 'vitest'
import { packQuiz, unpackQuiz, quizFileName } from '../src/lib/quizPackage'
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
