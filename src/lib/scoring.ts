/**
 * Scoring rules:
 *  - Timed:    correct answer = 500 base + time bonus up to 500 (proportional to
 *              remaining time); wrong or timed-out = 0. No streak bonus.
 *  - Practice: untimed; correct = flat 500, wrong = 0.
 */

export const BASE_POINTS = 500
export const MAX_TIME_BONUS = 500

export function timeBonus(remainingMs: number, totalMs: number): number {
  if (totalMs <= 0) return 0
  const ratio = Math.min(1, Math.max(0, remainingMs / totalMs))
  return Math.round(MAX_TIME_BONUS * ratio)
}

export function scoreAnswer(opts: {
  mode: 'timed' | 'practice'
  correct: boolean
  remainingMs: number
  totalMs: number
}): number {
  if (!opts.correct) return 0
  if (opts.mode === 'practice') return BASE_POINTS
  return BASE_POINTS + timeBonus(opts.remainingMs, opts.totalMs)
}
