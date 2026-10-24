/** Internal quiz format (what gets serialised into quiz.json inside a .quiz zip). */

/**
 * Question interaction types:
 *  - single: tap exactly one answer (instant commit)
 *  - multi:  tap-toggle several, then "Lock in" (all-or-nothing exact-set match)
 *  - order:  tap answers into the correct sequence, then "Lock in"
 *            (all-or-nothing exact-permutation match)
 * A question without `type` is 'single' — except that legacy imports carrying more
 * than one correct flag (e.g. Kahoot "Correct answer(s)" = 2,4) normalise to 'multi'.
 */
export type QuestionType = 'single' | 'multi' | 'order'

/** Every question type this build understands. New types must be added here. */
export const QUESTION_TYPES: readonly QuestionType[] = ['single', 'multi', 'order']

/** Highest quiz schema version this build can import. Bump when adding a type. */
export const SUPPORTED_QUIZ_VERSION = 2

/** Per-type thinking-time floors (seconds) used when no explicit timeLimit. */
export const TYPE_DEFAULT_SECONDS: Record<QuestionType, number> = { single: 20, multi: 30, order: 30 }

export interface Answer {
  id: string
  text: string
  correct: boolean
}

export interface QuestionImage {
  /** Key into the IndexedDB `media` store / `images/<ref>` inside a .quiz zip. */
  ref: string
  alt?: string
  /** License/attribution note, e.g. "CC BY-SA 4.0: Jane Doe (Wikimedia Commons)". */
  credit?: string
}

export interface Question {
  id: string
  prompt: string
  /** Absent = 'single' (all quizzes authored before the new types existed). */
  type?: QuestionType
  /**
   * For 'order' questions: the correct tap sequence as 1-based indices into
   * `answers` (a full permutation, e.g. [3,1,4,2]). Required when type='order'.
   */
  correctOrder?: number[]
  answers: Answer[]
  /** Per-question seconds; falls back to quiz.timer.defaultSeconds when missing. */
  timeLimit?: number
  explanation?: string
  image?: QuestionImage
}

export interface QuizTimerSettings {
  /** Default for the pre-game timer toggle (game-level choice still wins). */
  enabled: boolean
  /** Used when a question has no explicit timeLimit. Default 20. */
  defaultSeconds: number
}

export interface Quiz {
  /** Schema version for forward-compatible imports. 2 = contains multi/order questions. */
  v: 1 | 2
  id: string
  title: string
  createdAt: string
  timer: QuizTimerSettings
  questions: Question[]
  /** Import provenance (e.g. "csv", "quiz-zip", "share"). */
  source?: string
}

/** Outcome for a single question within a run (stored per question, in question order). */
export interface RunResult {
  correct: boolean
  points: number
  answeredMs: number
  /**
   * Index(es) into the question's answers; null/undefined = no answer (timed out).
   * Single: one index. Multi: picked set (unordered). Order: picked tap sequence.
   */
  picked?: number | number[] | null
}

export interface HistoryEntry {
  /** autoIncrement */
  id?: number
  quizId: string
  quizTitle: string
  /** 'timed' = Kahoot-style speed bonus, 'practice' = untimed. */
  mode: 'timed' | 'practice'
  score: number
  maxScore: number
  correct: number
  total: number
  durationMs: number
  playedAt: string
  /** Per-question results, index-aligned with the quiz questions. Missing on old runs. */
  review?: RunResult[]
}

export function quizMaxScore(quiz: Quiz): number {
  return quiz.questions.length * 1000
}

/** Effective type of a question, including the legacy multi-correct fallback. */
export function questionType(q: Question): QuestionType {
  if (q.type) return q.type
  return q.answers.filter((a) => a.correct).length > 1 ? 'multi' : 'single'
}

/** Minimum schema version needed to serialise these questions. */
export function quizVersionFor(questions: Question[]): 1 | 2 {
  return questions.some((q) => q.type === 'multi' || q.type === 'order') ? 2 : 1
}

/** True when `order` is a full permutation of 1..n (each index exactly once). */
export function isPermutation(order: number[] | undefined, n: number): boolean {
  if (!order || order.length !== n) return false
  const seen = new Set<number>()
  for (const v of order) {
    if (!Number.isInteger(v) || v < 1 || v > n || seen.has(v)) return false
    seen.add(v)
  }
  return true
}

/**
 * Seconds allowed for a question: an explicit per-question timeLimit always wins;
 * otherwise the quiz default, but never below the question type's floor.
 */
export function questionSeconds(q: Question, quiz: Quiz): number {
  const quizDefault = quiz.timer?.defaultSeconds ?? 20
  return q.timeLimit ?? Math.max(quizDefault, TYPE_DEFAULT_SECONDS[questionType(q)])
}

export function newId(): string {
  return crypto.randomUUID()
}
