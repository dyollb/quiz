import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { HistoryEntry, Quiz } from './schema'

/** Blob + provenance for an image referenced by questions (`image.ref`). */
export interface MediaRecord {
  ref: string
  blob: Blob
  type: string
  /** Quiz ids currently referencing this media (ref-count). */
  usedBy: string[]
  addedAt: string
}

/** A file handed over by the share-target service worker or file handler. */
export interface StagedRecord {
  key: string
  name: string
  type: string
  blob: Blob
  stagedAt: string
}

/**
 * Snapshot of an interrupted game so it can be resumed later (one per quiz —
 * starting a new round overwrites the previous snapshot). `results.length`
 * equals `qIndex`: the question at `qIndex` was in progress (not yet answered)
 * when the game was interrupted.
 */
export interface GameState {
  quizId: string
  mode: 'timed' | 'practice'
  /** Index of the question that was in progress. */
  qIndex: number
  /** Per-question outcomes for questions 0..qIndex-1. */
  results: Array<{ correct: boolean; points: number; answeredMs: number }>
  /** Epoch ms when the game started (for the final duration). */
  startedAt: number
  updatedAt: string
}

interface QuizDB extends DBSchema {
  quizzes: { key: string; value: Quiz }
  media: { key: string; value: MediaRecord }
  history: {
    key: number
    value: HistoryEntry
    indexes: { 'by-quiz': string; 'by-date': string }
  }
  staged: { key: string; value: StagedRecord }
  gameState: { key: string; value: GameState }
}

const DB_NAME = 'quiztime'
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase<QuizDB>> | null = null

export function getDB(): Promise<IDBPDatabase<QuizDB>> {
  if (!dbPromise) {
    dbPromise = openDB<QuizDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('quizzes')) {
          db.createObjectStore('quizzes', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('media')) {
          db.createObjectStore('media', { keyPath: 'ref' })
        }
        if (!db.objectStoreNames.contains('history')) {
          const history = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true })
          history.createIndex('by-quiz', 'quizId')
          history.createIndex('by-date', 'playedAt')
        }
        if (!db.objectStoreNames.contains('staged')) {
          db.createObjectStore('staged', { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains('gameState')) {
          db.createObjectStore('gameState', { keyPath: 'quizId' })
        }
      },
    })
  }
  return dbPromise
}

/* ------------------------------ quizzes ------------------------------ */

export async function saveQuiz(
  quiz: Quiz,
  images: Map<string, Blob> = new Map(),
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['quizzes', 'media'], 'readwrite')
  await tx.objectStore('quizzes').put(quiz)
  for (const [ref, blob] of images) {
    const existing = await tx.objectStore('media').get(ref)
    const usedBy = [...new Set([...(existing?.usedBy ?? []), quiz.id])]
    await tx.objectStore('media').put({
      ref,
      blob,
      type: blob.type || 'application/octet-stream',
      usedBy,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
    })
  }
  await tx.done
}

export async function getQuiz(id: string): Promise<Quiz | undefined> {
  const db = await getDB()
  return db.get('quizzes', id)
}

export async function listQuizzes(): Promise<Quiz[]> {
  const db = await getDB()
  const all = await db.getAll('quizzes')
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function renameQuiz(id: string, title: string): Promise<void> {
  const db = await getDB()
  const quiz = await db.get('quizzes', id)
  if (!quiz) return
  await db.put('quizzes', { ...quiz, title })
  // Keep history labels in sync for future runs only; old rows keep their label.
}

/**
 * Delete a quiz: its record, its history rows, and drop it from the ref-count of
 * every image it used — images whose count hits zero are deleted (cleanup).
 */
export async function deleteQuiz(id: string): Promise<{ removedMedia: number; removedRuns: number }> {
  const db = await getDB()
  const quiz = await db.get('quizzes', id)
  if (!quiz) return { removedMedia: 0, removedRuns: 0 }

  const refs = new Set(
    quiz.questions.map((q) => q.image?.ref).filter((r): r is string => Boolean(r)),
  )

  const tx = db.transaction(['quizzes', 'media', 'history', 'gameState'], 'readwrite')
  await tx.objectStore('quizzes').delete(id)
  await tx.objectStore('gameState').delete(id)

  let removedRuns = 0
  const historyStore = tx.objectStore('history')
  const runKeys: number[] = []
  for await (const cursor of historyStore.index('by-quiz').iterate(id)) {
    runKeys.push(cursor.primaryKey)
  }
  for (const key of runKeys) {
    await historyStore.delete(key)
    removedRuns++
  }

  const mediaStore = tx.objectStore('media')
  let removedMedia = 0
  for (const ref of refs) {
    const rec = await mediaStore.get(ref)
    if (!rec) continue
    const usedBy = rec.usedBy.filter((q) => q !== id)
    if (usedBy.length === 0) {
      await mediaStore.delete(ref)
      removedMedia++
    } else {
      await mediaStore.put({ ...rec, usedBy })
    }
  }
  await tx.done
  return { removedMedia, removedRuns }
}

/** Remove only the play history for a quiz (keeps the quiz + images). */
export async function clearHistory(quizId: string): Promise<number> {
  const db = await getDB()
  const tx = db.transaction('history', 'readwrite')
  let removed = 0
  const keys: number[] = []
  for await (const cursor of tx.store.index('by-quiz').iterate(quizId)) {
    keys.push(cursor.primaryKey)
  }
  for (const key of keys) {
    await tx.store.delete(key)
    removed++
  }
  await tx.done
  return removed
}

export async function deleteHistoryRun(runId: number): Promise<void> {
  const db = await getDB()
  await db.delete('history', runId)
}

/* ------------------------------ media ------------------------------ */

export async function getMedia(ref: string): Promise<MediaRecord | undefined> {
  const db = await getDB()
  return db.get('media', ref)
}

/** Object URL for a question image; caller revokes. Returns undefined if missing. */
export async function getMediaUrl(ref: string): Promise<string | undefined> {
  const rec = await getMedia(ref)
  return rec ? URL.createObjectURL(rec.blob) : undefined
}

/* ------------------------------ history ------------------------------ */

export async function addHistory(entry: HistoryEntry): Promise<number> {
  const db = await getDB()
  return db.add('history', entry)
}

export async function listRecentHistory(limit = 20): Promise<HistoryEntry[]> {
  const db = await getDB()
  const all = await db.getAllFromIndex('history', 'by-date')
  return all.reverse().slice(0, limit)
}

export async function listHistoryForQuiz(quizId: string): Promise<HistoryEntry[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex('history', 'by-quiz', quizId)
  return rows.sort((a, b) => b.playedAt.localeCompare(a.playedAt))
}

export async function getBestScore(quizId: string): Promise<number | undefined> {
  const rows = await listHistoryForQuiz(quizId)
  if (!rows.length) return undefined
  return Math.max(...rows.map((r) => r.score))
}

/* ------------------------------ staged files ------------------------------ */

export async function stageFile(
  key: string,
  name: string,
  type: string,
  blob: Blob,
): Promise<void> {
  const db = await getDB()
  await db.put('staged', { key, name, type, blob, stagedAt: new Date().toISOString() })
}

export async function takeStagedFile(key: string): Promise<StagedRecord | undefined> {
  const db = await getDB()
  const rec = await db.get('staged', key)
  if (rec) await db.delete('staged', key)
  return rec
}

/* ------------------------------ game state (resume) ------------------------------ */

export async function saveGameState(state: GameState): Promise<void> {
  const db = await getDB()
  await db.put('gameState', { ...state, updatedAt: new Date().toISOString() })
}

export async function getGameState(quizId: string): Promise<GameState | undefined> {
  const db = await getDB()
  return db.get('gameState', quizId)
}

export async function clearGameState(quizId: string): Promise<void> {
  const db = await getDB()
  await db.delete('gameState', quizId)
}

/** Quiz ids that currently have an interrupted round saved. */
export async function listGameStateQuizIds(): Promise<Set<string>> {
  const db = await getDB()
  const keys = await db.getAllKeys('gameState')
  return new Set(keys as string[])
}
