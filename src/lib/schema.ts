/** Internal quiz format (what gets serialised into quiz.json inside a .quiz zip). */

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
  /** Schema version for forward-compatible imports. */
  v: 1
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
  /** Index into the question's answers; null/undefined = no answer (timed out). */
  picked?: number | null
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

export function newId(): string {
  return crypto.randomUUID()
}
