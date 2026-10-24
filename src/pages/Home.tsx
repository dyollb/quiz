import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createFolder,
  deleteFolder,
  deleteQuiz,
  getBestScore,
  listFolders,
  listGameStateQuizIds,
  listHistoryForQuiz,
  listQuizFolders,
  listQuizzes,
  moveQuizToFolder,
  renameFolder,
  type Folder,
} from '../lib/db'
import type { Quiz } from '../lib/schema'

interface HomeRow {
  quiz: Quiz
  best?: number
  runs: number
  resumable: boolean
  folderId: string | null
}

const COLLAPSED_KEY = 'quiztime:collapsed-folders'

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {
    /* ignore */
  }
  return new Set()
}

function saveCollapsed(set: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]))
  } catch {
    /* ignore */
  }
}

export default function Home() {
  const [rows, setRows] = useState<HomeRow[] | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [pendingDelete, setPendingDelete] = useState<Quiz | null>(null)
  const [pendingFolderDelete, setPendingFolderDelete] = useState<Folder | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [moveFor, setMoveFor] = useState<HomeRow | null>(null)
  const [moveNewFolder, setMoveNewFolder] = useState(false)
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    const [quizzes, resumableIds, folderList, folderMap] = await Promise.all([
      listQuizzes(),
      listGameStateQuizIds(),
      listFolders(),
      listQuizFolders(),
    ])
    const detailed = await Promise.all(
      quizzes.map(async (quiz) => {
        const best = await getBestScore(quiz.id)
        const runs = (await listHistoryForQuiz(quiz.id)).length
        return {
          quiz,
          best,
          runs,
          resumable: resumableIds.has(quiz.id),
          folderId: folderMap.get(quiz.id) ?? null,
        }
      }),
    )
    setRows(detailed)
    setFolders(folderList)
  }, [])

  useEffect(() => {
    void refresh()
    window.addEventListener('quiz-imported', refresh)
    return () => window.removeEventListener('quiz-imported', refresh)
  }, [refresh])

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveCollapsed(next)
      return next
    })
  }

  async function confirmDelete(quiz: Quiz) {
    setPendingDelete(null)
    await deleteQuiz(quiz.id)
    await refresh()
  }

  async function confirmFolderDelete(folder: Folder) {
    setPendingFolderDelete(null)
    await deleteFolder(folder.id)
    await refresh()
  }

  async function onMove(quizId: string, folderId: string | null) {
    setMoveFor(null)
    setMoveNewFolder(false)
    await moveQuizToFolder(quizId, folderId)
    await refresh()
  }

  async function onNewFolderAndMove(name: string) {
    const trimmed = name.trim()
    if (!trimmed || !moveFor) return
    const folder = await createFolder(trimmed)
    if (folder) await moveQuizToFolder(moveFor.quiz.id, folder.id)
    setMoveFor(null)
    setMoveNewFolder(false)
    await refresh()
  }

  if (rows === null) return <p className="muted">Loading…</p>

  // Folder sections always show (so empty folders stay discoverable);
  // Ungrouped only when it actually contains quizzes. A mapping that points at
  // a folder which no longer exists is treated as ungrouped.
  const knownFolders = new Set(folders.map((f) => f.id))
  const ungrouped = rows.filter((r) => r.folderId === null || !knownFolders.has(r.folderId))
  const sections: Array<{ key: string; title: string; items: HomeRow[]; folder?: Folder }> = [
    ...folders.map((f) => ({
      key: f.id,
      title: f.name,
      folder: f,
      items: rows.filter((r) => r.folderId === f.id),
    })),
    ...(ungrouped.length ? [{ key: '__none__', title: 'Ungrouped', items: ungrouped }] : []),
  ]

  const rowCard = (r: HomeRow) => (
    <div className="card" key={r.quiz.id}>
      <div className="card-row">
        <div>
          <h3>{r.quiz.title}</h3>
          <p className="muted small" style={{ margin: '2px 0' }}>
            {r.quiz.questions.length} question{r.quiz.questions.length === 1 ? '' : 's'}
            {r.best !== undefined && <> · best {r.best} pts</>}
            {r.runs > 0 && <> · {r.runs} run{r.runs === 1 ? '' : 's'}</>}
            {r.resumable && (
              <>
                {' · '}
                <span style={{ color: 'var(--triangle, #f4b400)' }}>round in progress</span>
              </>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="primary" onClick={() => navigate(`/play/${r.quiz.id}`)}>
            {r.resumable ? 'Resume' : 'Play'}
          </button>
          {r.resumable && (
            <button className="ghost" onClick={() => navigate(`/play/${r.quiz.id}?restart=1`)}>
              Restart
            </button>
          )}
          <button className="ghost" title="Move to folder" onClick={() => setMoveFor(r)}>
            📁
          </button>
          <button className="ghost" title="History" onClick={() => navigate(`/history/${r.quiz.id}`)}>
            📈
          </button>
          <button className="danger" title="Delete quiz" onClick={() => setPendingDelete(r.quiz)}>
            🗑
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div>
      <div className="page-head">
        <h1>Your quizzes</h1>
        {creatingFolder ? (
          <FolderNameInput
            placeholder="Folder name"
            onSubmit={async (name) => {
              setCreatingFolder(false)
              await createFolder(name)
              await refresh()
            }}
            onCancel={() => setCreatingFolder(false)}
          />
        ) : (
          <button className="ghost" onClick={() => setCreatingFolder(true)}>
            + New folder
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <div className="card center">
          <p>No quizzes yet.</p>
          <button className="primary big" onClick={() => navigate('/import')}>
            Import a CSV or .quiz file
          </button>
        </div>
      )}

      {rows.length > 0 &&
        sections.map((section) => {
          const isCollapsed = collapsed.has(section.key)
          return (
            <section className="folder-section" key={section.key}>
              <div className="folder-header">
                <button
                  className="folder-toggle"
                  onClick={() => toggleCollapsed(section.key)}
                  aria-expanded={!isCollapsed}
                >
                  <span className={`folder-caret${isCollapsed ? '' : ' open'}`}>▸</span>
                  <strong>{section.title}</strong>
                  <span className="muted small">
                    {section.items.length} quiz{section.items.length === 1 ? '' : 'zes'}
                  </span>
                </button>
                {section.folder &&
                  (renamingId === section.folder.id ? (
                    <FolderNameInput
                      defaultValue={section.folder.name}
                      onSubmit={async (name) => {
                        setRenamingId(null)
                        await renameFolder(section.folder!.id, name)
                        await refresh()
                      }}
                      onCancel={() => setRenamingId(null)}
                    />
                  ) : (
                    <span className="folder-actions">
                      <button
                        className="ghost"
                        title="Rename folder"
                        onClick={() => setRenamingId(section.folder!.id)}
                      >
                        ✎
                      </button>
                      <button
                        className="ghost"
                        title="Delete folder"
                        onClick={() => setPendingFolderDelete(section.folder!)}
                      >
                        🗑
                      </button>
                    </span>
                  ))}
              </div>
              {!isCollapsed && section.items.map(rowCard)}
            </section>
          )
        })}

      {moveFor && (
        <div
          className="notice"
          role="dialog"
          aria-label="Move quiz"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            width: 'min(92vw, 480px)',
            zIndex: 50,
          }}
        >
          <strong>Move “{moveFor.quiz.title}” to…</strong>
          <div className="folder-picker">
            <button className="folder-pick" onClick={() => void onMove(moveFor.quiz.id, null)}>
              📂 Ungrouped
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                className={`folder-pick${moveFor.folderId === f.id ? ' current' : ''}`}
                onClick={() => void onMove(moveFor.quiz.id, f.id)}
              >
                📁 {f.name}
                {moveFor.folderId === f.id && <span className="muted small"> · current</span>}
              </button>
            ))}
            {moveNewFolder ? (
              <FolderNameInput
                placeholder="New folder name"
                onSubmit={(name) => void onNewFolderAndMove(name)}
                onCancel={() => setMoveNewFolder(false)}
              />
            ) : (
              <button className="folder-pick" onClick={() => setMoveNewFolder(true)}>
                ➕ New folder…
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="ghost" onClick={() => setMoveFor(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {pendingFolderDelete && (
        <div
          className="notice error"
          role="alertdialog"
          aria-label="Confirm folder delete"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            width: 'min(92vw, 480px)',
            zIndex: 60,
          }}
        >
          <strong>Delete folder “{pendingFolderDelete.name}”?</strong>
          <p className="small" style={{ margin: '6px 0' }}>
            The folder is removed; its quizzes stay and move to Ungrouped.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="ghost" onClick={() => setPendingFolderDelete(null)}>
              Cancel
            </button>
            <button className="danger" onClick={() => void confirmFolderDelete(pendingFolderDelete)}>
              Delete folder
            </button>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div
          className="notice error"
          role="alertdialog"
          aria-label="Confirm delete"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            width: 'min(92vw, 480px)',
            zIndex: 70,
          }}
        >
          <strong>Delete “{pendingDelete.title}”?</strong>
          <p className="small" style={{ margin: '6px 0' }}>
            This removes the quiz, its scores and any images no other quiz uses. This cannot be
            undone.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </button>
            <button className="danger" onClick={() => void confirmDelete(pendingDelete)}>
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function FolderNameInput({
  defaultValue = '',
  placeholder,
  onSubmit,
  onCancel,
}: {
  defaultValue?: string
  placeholder?: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  return (
    <form
      className="folder-name-form"
      onSubmit={(e) => {
        e.preventDefault()
        const input = e.currentTarget.elements.namedItem('name') as HTMLInputElement
        const name = input.value.trim()
        if (name) onSubmit(name)
        else onCancel()
      }}
    >
      <input name="name" type="text" defaultValue={defaultValue} placeholder={placeholder} autoFocus />
      <button className="primary" type="submit">
        OK
      </button>
      <button className="ghost" type="button" onClick={onCancel}>
        ✕
      </button>
    </form>
  )
}
