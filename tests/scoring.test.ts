import { describe, expect, it } from 'vitest'
import { BASE_POINTS, MAX_TIME_BONUS, scoreAnswer, timeBonus } from '../src/lib/scoring'

describe('scoring', () => {
  it('timed: full speed correct answer earns max points', () => {
    expect(
      scoreAnswer({ mode: 'timed', correct: true, remainingMs: 20_000, totalMs: 20_000 }),
    ).toBe(BASE_POINTS + MAX_TIME_BONUS)
  })

  it('timed: half the time left earns half the bonus', () => {
    expect(scoreAnswer({ mode: 'timed', correct: true, remainingMs: 10_000, totalMs: 20_000 })).toBe(
      BASE_POINTS + 250,
    )
  })

  it('timed: wrong and timeouts score zero', () => {
    expect(
      scoreAnswer({ mode: 'timed', correct: false, remainingMs: 15_000, totalMs: 20_000 }),
    ).toBe(0)
    expect(scoreAnswer({ mode: 'timed', correct: true, remainingMs: 0, totalMs: 20_000 })).toBe(
      BASE_POINTS,
    )
  })

  it('practice: flat points, no time component', () => {
    expect(
      scoreAnswer({ mode: 'practice', correct: true, remainingMs: 0, totalMs: 20_000 }),
    ).toBe(BASE_POINTS)
    expect(
      scoreAnswer({ mode: 'practice', correct: false, remainingMs: 0, totalMs: 20_000 }),
    ).toBe(0)
  })

  it('timeBonus is clamped to [0, total]', () => {
    expect(timeBonus(50_000, 20_000)).toBe(MAX_TIME_BONUS)
    expect(timeBonus(-5, 20_000)).toBe(0)
    expect(timeBonus(100, 0)).toBe(0)
  })
})
