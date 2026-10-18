import { parseQuizCsv } from './csv'
import { saveQuiz } from './db'
import { unpackQuiz } from './quizPackage'
import type { Quiz } from './schema'

export interface ImportOutcome {
  quiz: Quiz
  kind: 'quiz-zip' | 'csv' | 'json'
  warnings: string[]
}

/**
 * Import any supported file into the library:
 *  - .quiz (zip with quiz.json + images/)
 *  - .csv (simple or Kahoot export layout)
 *  - .json (bare quiz.json without images)
 */
export async function importFile(
  file: File | Blob,
  opts: { titleHint?: string } = {},
): Promise<ImportOutcome> {
  const name = 'name' in file ? file.name : 'shared-file'
  const lower = name.toLowerCase()
  const titleHint = opts.titleHint ?? name.replace(/\.[^.]+$/, '')

  if (lower.endsWith('.quiz') || lower.endsWith('.zip')) {
    const { quiz, images } = await unpackQuiz(file)
    await saveQuiz(quiz, images)
    return { quiz, kind: 'quiz-zip', warnings: [] }
  }

  if (lower.endsWith('.csv') || lower.endsWith('.txt') || file.type.startsWith('text/csv')) {
    const text = await readFileAsText(file)
    const { quiz, warnings } = parseQuizCsv(text, titleHint)
    await saveQuiz(quiz)
    return { quiz, kind: 'csv', warnings }
  }

  if (lower.endsWith('.json') || file.type === 'application/json') {
    const text = await readFileAsText(file)
    const { quiz } = parseBareQuizJson(text, titleHint)
    await saveQuiz(quiz) // no images resolvable from a bare json
    return {
      quiz,
      kind: 'json',
      warnings: quiz.questions.some((q) => q.image)
        ? ['This JSON references images that are only available inside a .quiz package.']
        : [],
    }
  }

  throw new Error(
    `Unsupported file "${name}". Share or pick a .quiz, .csv or .json file.`,
  )
}

async function readFileAsText(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer()
  // Strip UTF-8 BOM which Excel exports sometimes add.
  return new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, '')
}

/** Import a standalone quiz.json (e.g. saved from the dev tools). */
export function parseBareQuizJson(text: string, titleHint?: string): { quiz: Quiz } {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('The JSON file is not valid JSON.')
  }
  const o = raw as Record<string, unknown>
  if (!o || !Array.isArray(o.questions) || typeof o.title !== 'string') {
    throw new Error('The JSON does not look like a quiz (needs "title" and "questions").')
  }
  const quiz: Quiz = {
    v: 1,
    id: crypto.randomUUID(), // always assign a fresh id to avoid collisions
    title: o.title || titleHint || 'Imported quiz',
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
    timer: {
      enabled: (o as unknown as Quiz).timer?.enabled ?? true,
      defaultSeconds: (o as unknown as Quiz).timer?.defaultSeconds ?? 20,
    },
    source: 'json',
    questions: (o as unknown as Quiz).questions.map((q) => ({
      id: crypto.randomUUID(),
      prompt: q.prompt ?? '',
      answers: (q.answers ?? []).map((a) => ({
        id: crypto.randomUUID(),
        text: a.text ?? '',
        correct: Boolean(a.correct),
      })),
      ...(q.timeLimit ? { timeLimit: q.timeLimit } : {}),
      ...(q.explanation ? { explanation: q.explanation } : {}),
      // image refs kept but unresolvable without the zip
      ...(q.image ? { image: { ref: q.image.ref, alt: q.image.alt, credit: q.image.credit } } : {}),
    })),
  }
  return { quiz }
}

/** Collect all image blobs a quiz references, for packing/exporting. */
export async function collectQuizImages(
  quiz: Quiz,
  getMedia: (ref: string) => Promise<Blob | undefined>,
): Promise<Map<string, Blob>> {
  const images = new Map<string, Blob>()
  for (const q of quiz.questions) {
    const ref = q.image?.ref
    if (!ref || images.has(ref)) continue
    const blob = await getMedia(ref)
    if (blob) images.set(ref, blob)
  }
  return images
}
