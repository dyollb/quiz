import { describe, expect, it } from 'vitest'
import {
  isPermutation,
  questionSeconds,
  questionType,
  quizVersionFor,
  type Answer,
  type Question,
  type Quiz,
} from '../src/lib/schema'

function answers(spec: Array<[string, boolean]>): Answer[] {
  return spec.map(([text, correct], i) => ({ id: `a${i}`, text, correct }))
}

function quiz(defaultSeconds: number): Quiz {
  return {
    v: 1,
    id: 'quiz-1',
    title: 'T',
    createdAt: new Date().toISOString(),
    timer: { enabled: true, defaultSeconds },
    questions: [],
  }
}

describe('questionType', () => {
  it('defaults to single when no type and one correct flag', () => {
    const q: Question = { id: 'q', prompt: 'p', answers: answers([['a', false], ['b', true]]) }
    expect(questionType(q)).toBe('single')
  })

  it('normalises legacy multi-correct questions to multi', () => {
    const q: Question = {
      id: 'q',
      prompt: 'p',
      answers: answers([['a', true], ['b', false], ['c', true]]),
    }
    expect(questionType(q)).toBe('multi')
  })

  it('honours an explicit type over the flags', () => {
    const q: Question = {
      id: 'q',
      prompt: 'p',
      type: 'order',
      answers: answers([['a', true], ['b', true]]),
    }
    expect(questionType(q)).toBe('order')
  })
})

describe('questionSeconds', () => {
  it('uses 20s for single with the default quiz timer', () => {
    const q: Question = { id: 'q', prompt: 'p', answers: answers([['a', true]]) }
    expect(questionSeconds(q, quiz(20))).toBe(20)
  })

  it('raises multi and order to the 30s type floor', () => {
    const multi: Question = {
      id: 'q',
      prompt: 'p',
      type: 'multi',
      answers: answers([['a', true], ['b', false], ['c', true]]),
    }
    const order: Question = {
      id: 'q',
      prompt: 'p',
      type: 'order',
      correctOrder: [2, 1, 3],
      answers: answers([['a', true], ['b', true], ['c', true]]),
    }
    expect(questionSeconds(multi, quiz(20))).toBe(30)
    expect(questionSeconds(order, quiz(20))).toBe(30)
  })

  it('honours an explicit per-question timeLimit even below the floor', () => {
    const q: Question = { id: 'q', prompt: 'p', type: 'order', timeLimit: 15, answers: [] }
    expect(questionSeconds(q, quiz(20))).toBe(15)
  })

  it('honours a longer quiz default over the type floor', () => {
    const q: Question = { id: 'q', prompt: 'p', type: 'multi', answers: [] }
    expect(questionSeconds(q, quiz(45))).toBe(45)
  })
})

describe('quizVersionFor / isPermutation', () => {
  it('needs v2 only for multi/order questions', () => {
    const single: Question = { id: 'q', prompt: 'p', answers: [] }
    const multi: Question = { id: 'q', prompt: 'p', type: 'multi', answers: [] }
    expect(quizVersionFor([single])).toBe(1)
    expect(quizVersionFor([single, multi])).toBe(2)
  })

  it('recognises full permutations only', () => {
    expect(isPermutation([3, 1, 4, 2], 4)).toBe(true)
    expect(isPermutation([1, 2, 3], 3)).toBe(true)
    expect(isPermutation([1, 2, 2], 3)).toBe(false) // duplicate
    expect(isPermutation([1, 2], 3)).toBe(false) // incomplete
    expect(isPermutation([1, 2, 4], 3)).toBe(false) // out of range
    expect(isPermutation(undefined, 3)).toBe(false)
  })
})
