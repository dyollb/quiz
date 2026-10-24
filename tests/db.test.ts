import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addHistory,
  clearGameState,
  clearHistory,
  createFolder,
  deleteFolder,
  deleteHistoryRun,
  deleteQuiz,
  getBestScore,
  getDB,
  getGameState,
  getMedia,
  getQuiz,
  listFolders,
  listGameStateQuizIds,
  listHistoryForQuiz,
  listQuizFolders,
  listQuizzes,
  moveQuizToFolder,
  renameFolder,
  saveGameState,
  saveQuiz,
  stageFile,
  takeStagedFile,
} from '../src/lib/db'
import type { HistoryEntry, Quiz } from '../src/lib/schema'

async function clearAll() {
  const db = await getDB()
  await Promise.all([
    db.clear('quizzes'),
    db.clear('media'),
    db.clear('history'),
    db.clear('staged'),
    db.clear('gameState'),
    db.clear('folders'),
    db.clear('quizFolders'),
  ])
}

beforeEach(async () => {
  await clearAll()
})

function makeQuiz(id: string, imageRefs: (string | undefined)[]): Quiz {
  return {
    v: 1,
    id,
    title: `Quiz ${id}`,
    createdAt: new Date().toISOString(),
    timer: { enabled: true, defaultSeconds: 20 },
    questions: imageRefs.map((ref, i) => ({
      id: `${id}-q${i}`,
      prompt: `Q${i}?`,
      answers: [
        { id: 'a', text: 'a', correct: true },
        { id: 'b', text: 'b', correct: false },
      ],
      ...(ref ? { image: { ref } } : {}),
    })),
  }
}

function run(quizId: string, score = 10): HistoryEntry {
  return {
    quizId,
    quizTitle: `Quiz ${quizId}`,
    mode: 'timed',
    score,
    maxScore: 100,
    correct: 1,
    total: 2,
    durationMs: 5,
    playedAt: new Date().toISOString(),
  }
}

describe('db: save/load', () => {
  it('saves a quiz and lists it', async () => {
    await saveQuiz(makeQuiz('q1', []))
    expect((await listQuizzes()).map((q) => q.id)).toEqual(['q1'])
  })

  it('stages and takes a shared file exactly once', async () => {
    await stageFile('k1', 'a.csv', 'text/csv', new Blob(['csv data']))
    const first = await takeStagedFile('k1')
    expect(first?.name).toBe('a.csv')
    expect(await takeStagedFile('k1')).toBeUndefined()
  })
})

describe('db: media ref-counting + delete cleanup', () => {
  it('deleteQuiz removes quiz, its history and orphaned images but keeps shared images', async () => {
    const shared = new Blob(['shared'], { type: 'image/png' })
    const onlyA = new Blob(['a-only'], { type: 'image/png' })

    await saveQuiz(
      makeQuiz('A', ['shared.png', 'a.png']),
      new Map([
        ['shared.png', shared],
        ['a.png', onlyA],
      ]),
    )
    await saveQuiz(makeQuiz('B', ['shared.png']), new Map([['shared.png', shared]]))

    await addHistory(run('A'))
    await addHistory(run('B'))

    const { removedMedia, removedRuns } = await deleteQuiz('A')
    expect(removedRuns).toBe(1)
    expect(removedMedia).toBe(1) // only a.png was orphaned

    expect(await getQuiz('A')).toBeUndefined()
    expect(await getQuiz('B')).toBeDefined()
    expect(await getMedia('a.png')).toBeUndefined()
    const sharedRec = await getMedia('shared.png')
    expect(sharedRec).toBeDefined()
    expect(sharedRec?.usedBy).toEqual(['B'])
    expect(await listHistoryForQuiz('A')).toHaveLength(0)
    expect(await listHistoryForQuiz('B')).toHaveLength(1)

    // Deleting B now orphans shared.png.
    const res2 = await deleteQuiz('B')
    expect(res2.removedMedia).toBe(1)
    expect(await getMedia('shared.png')).toBeUndefined()
  })

  it('re-importing the same image ref shares the media record', async () => {
    const img = new Blob(['x'], { type: 'image/png' })
    await saveQuiz(makeQuiz('A', ['i.png']), new Map([['i.png', img]]))
    await saveQuiz(makeQuiz('B', ['i.png']), new Map([['i.png', img]]))
    const rec = await getMedia('i.png')
    expect(rec?.usedBy.slice().sort()).toEqual(['A', 'B'])
  })
})

describe('db: history helpers', () => {
  it('clearHistory wipes only the target quiz', async () => {
    await saveQuiz(makeQuiz('A', []))
    await saveQuiz(makeQuiz('B', []))
    await addHistory(run('A'))
    await addHistory(run('B'))
    await addHistory(run('B'))

    expect(await clearHistory('B')).toBe(2)
    expect(await listHistoryForQuiz('B')).toHaveLength(0)
    expect(await listHistoryForQuiz('A')).toHaveLength(1)
  })

  it('deleteHistoryRun removes a single run', async () => {
    await saveQuiz(makeQuiz('A', []))
    await addHistory(run('A', 1))
    await addHistory(run('A', 2))
    const rows = await listHistoryForQuiz('A')
    await deleteHistoryRun(rows[0].id!)
    const left = await listHistoryForQuiz('A')
    expect(left).toHaveLength(1)
    expect(left[0].score).not.toBe(rows[0].score)
  })

  it('getBestScore returns max, undefined when empty', async () => {
    expect(await getBestScore('A')).toBeUndefined()
    await addHistory(run('A', 300))
    await addHistory(run('A', 900))
    await addHistory(run('A', 100))
    expect(await getBestScore('A')).toBe(900)
  })

  it('persists the per-question review and round-trips it', async () => {
    const entry: HistoryEntry = {
      ...run('A', 500),
      review: [
        { correct: true, points: 500, answeredMs: 1000, picked: 0 },
        { correct: false, points: 0, answeredMs: 2000, picked: 1 },
        { correct: false, points: 0, answeredMs: 3000, picked: null },
      ],
    }
    await addHistory(entry)
    const [saved] = await listHistoryForQuiz('A')
    expect(saved.review).toEqual(entry.review)
    // Old-style entries without a review stay review-less.
    await addHistory(run('B'))
    expect((await listHistoryForQuiz('B'))[0].review).toBeUndefined()
  })
})

describe('db: listQuizzes ordering', () => {
  it('newest first', async () => {
    await saveQuiz({ ...makeQuiz('old', []), createdAt: '2020-01-01T00:00:00.000Z' })
    await saveQuiz({ ...makeQuiz('new', []), createdAt: '2024-01-01T00:00:00.000Z' })
    expect((await listQuizzes()).map((q) => q.id)).toEqual(['new', 'old'])
  })
})

describe('db: game state (resume)', () => {
  const state = (quizId: string, qIndex: number) => ({
    quizId,
    mode: 'timed' as const,
    qIndex,
    results: Array.from({ length: qIndex }, (_, i) => ({
      correct: i % 2 === 0,
      points: 500 + i,
      answeredMs: 1000,
      picked: i % 3 === 2 ? null : i % 2,
    })),
    startedAt: 1234,
    updatedAt: new Date().toISOString(),
  })

  it('keeps the picked answer index in snapshots', async () => {
    await saveGameState(state('A', 3))
    const s = await getGameState('A')
    expect(s?.results.map((r) => r.picked)).toEqual([0, 1, null])
  })

  it('saves, reads back, and overwrites per quiz', async () => {
    await saveGameState(state('A', 3))
    let s = await getGameState('A')
    expect(s?.qIndex).toBe(3)
    expect(s?.results).toHaveLength(3)
    await saveGameState(state('A', 5))
    s = await getGameState('A')
    expect(s?.qIndex).toBe(5)
    expect(await getGameState('B')).toBeUndefined()
  })

  it('clear removes the snapshot', async () => {
    await saveGameState(state('A', 2))
    await clearGameState('A')
    expect(await getGameState('A')).toBeUndefined()
  })

  it('lists quiz ids with an interrupted round', async () => {
    await saveGameState(state('A', 1))
    await saveGameState(state('B', 2))
    await clearGameState('B')
    expect([...(await listGameStateQuizIds())]).toEqual(['A'])
  })

  it('deleting a quiz also removes its game state', async () => {
    await saveQuiz(makeQuiz('A', []))
    await saveGameState(state('A', 4))
    await deleteQuiz('A')
    expect(await getGameState('A')).toBeUndefined()
  })
})

describe('db: folders (quiz groups)', () => {
  it('creates, lists alphabetically and renames folders', async () => {
    await createFolder('Zulu')
    const b = await createFolder('Alpha')
    expect((await listFolders()).map((f) => f.name)).toEqual(['Alpha', 'Zulu'])
    await renameFolder(b!.id, 'Middle')
    expect((await listFolders()).map((f) => f.name)).toEqual(['Middle', 'Zulu'])
    expect(await createFolder('  ')).toBeUndefined()
    expect(await createFolder('x')).toBeDefined()
  })

  it('moves quizzes between folders and ungroups them', async () => {
    await saveQuiz(makeQuiz('A', []))
    const f = await createFolder('Schule')
    await moveQuizToFolder('A', f!.id)
    expect((await listQuizFolders()).get('A')).toBe(f!.id)
    await moveQuizToFolder('A', null)
    expect((await listQuizFolders()).has('A')).toBe(false)
  })

  it('deleting a folder ungroups its quizzes', async () => {
    const f = await createFolder('Temp')
    await moveQuizToFolder('A', f!.id)
    await moveQuizToFolder('B', f!.id)
    await moveQuizToFolder('C', 'other-folder')
    await deleteFolder(f!.id)
    const map = await listQuizFolders()
    expect(map.has('A')).toBe(false)
    expect(map.has('B')).toBe(false)
    expect(map.get('C')).toBe('other-folder')
    expect(await listFolders()).toHaveLength(0)
  })

  it('deleting a quiz removes its folder mapping', async () => {
    await saveQuiz(makeQuiz('A', []))
    const f = await createFolder('Schule')
    await moveQuizToFolder('A', f!.id)
    await deleteQuiz('A')
    expect((await listQuizFolders()).has('A')).toBe(false)
  })
})
