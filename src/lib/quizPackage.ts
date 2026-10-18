import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate'
import { newId, type Quiz } from './schema'

export const QUIZ_ZIP_MIME = 'application/vnd.quiz+zip'
export const QUIZ_EXT = '.quiz'

export interface PackedQuiz {
  blob: Blob
  fileName: string
}

export interface UnpackedQuiz {
  quiz: Quiz
  images: Map<string, Blob>
}

/** Sanitise a quiz title into a safe file name. */
export function quizFileName(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return `${base || 'quiz'}${QUIZ_EXT}`
}

/** Pack a quiz + its image blobs into a .quiz (zip) file blob. */
export async function packQuiz(quiz: Quiz, images: Map<string, Blob>): Promise<PackedQuiz> {
  const files: Record<string, Uint8Array> = {
    'quiz.json': strToU8(JSON.stringify(quiz, null, 2)),
  }
  // Read every referenced image; silently skip refs that are missing.
  for (const q of quiz.questions) {
    const ref = q.image?.ref
    if (!ref || files[`images/${ref}`]) continue
    const blob = images.get(ref)
    if (!blob) continue
    const buf = new Uint8Array(await blob.arrayBuffer())
    files[`images/${ref}`] = buf
  }
  const zipped = zipSync(files, { level: 6 })
  const blob = new Blob([zipped], { type: QUIZ_ZIP_MIME })
  return { blob, fileName: quizFileName(quiz.title) }
}

function isQuizShape(v: unknown): v is Quiz {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    Array.isArray(o.questions) &&
    typeof o.title === 'string' &&
    typeof o.id === 'string'
  )
}

/** Normalise/repair a loosely-typed quiz.json into a valid Quiz. */
function normaliseQuiz(raw: Quiz, opts?: { newIdIfDuplicate?: boolean }): Quiz {
  const quiz: Quiz = {
    v: 1,
    id: opts?.newIdIfDuplicate ? newId() : raw.id || newId(),
    title: raw.title || 'Untitled quiz',
    createdAt: raw.createdAt || new Date().toISOString(),
    timer: {
      enabled: raw.timer?.enabled ?? true,
      defaultSeconds: raw.timer?.defaultSeconds ?? 20,
    },
    source: raw.source ?? 'quiz-zip',
    questions: raw.questions.map((q) => ({
      id: q.id || newId(),
      prompt: q.prompt ?? '',
      answers: (q.answers ?? []).map((a) => ({
        id: a.id || newId(),
        text: a.text ?? '',
        correct: Boolean(a.correct),
      })),
      ...(q.timeLimit ? { timeLimit: q.timeLimit } : {}),
      ...(q.explanation ? { explanation: q.explanation } : {}),
      ...(q.image ? { image: { ref: q.image.ref, alt: q.image.alt, credit: q.image.credit } } : {}),
    })),
  }
  return quiz
}

/** Parse a .quiz (zip) blob into its quiz + image blobs. */
export async function unpackQuiz(file: Blob): Promise<UnpackedQuiz> {
  const buf = new Uint8Array(await file.arrayBuffer())
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(buf)
  } catch {
    throw new Error('This file is not a valid .quiz package (not a zip).')
  }
  const jsonEntry = entries['quiz.json']
  if (!jsonEntry) throw new Error('The .quiz package is missing quiz.json.')
  let raw: unknown
  try {
    raw = JSON.parse(strFromU8(jsonEntry))
  } catch {
    throw new Error('quiz.json inside the .quiz package is not valid JSON.')
  }
  if (!isQuizShape(raw)) throw new Error('quiz.json does not look like a quiz.')
  const quiz = normaliseQuiz(raw)

  const images = new Map<string, Blob>()
  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith('images/') || path.endsWith('/')) continue
    const ref = path.slice('images/'.length)
    if (!ref) continue
    // Guess a mime type from the extension for nicer Object URLs.
    const ext = ref.split('.').pop()?.toLowerCase()
    const type =
      ext === 'png' ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'gif' ? 'image/gif'
      : ext === 'webp' ? 'image/webp'
      : ext === 'svg' ? 'image/svg+xml'
      : 'application/octet-stream'
    images.set(ref, new Blob([data.slice()], { type }))
  }
  return { quiz, images }
}
