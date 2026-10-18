import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteQuiz, getBestScore, listGameStateQuizIds, listHistoryForQuiz, listQuizzes } from '../lib/db'
import type { Quiz } from '../lib/schema'

interface HomeRow {
  quiz: Quiz
  best?: number
  runs: number
  resumable: boolean
}

export default function Home() {
  const [rows, setRows] = useState<HomeRow[] | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Quiz | null>(null)
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    const [quizzes, resumableIds] = await Promise.all([listQuizzes(), listGameStateQuizIds()])
    const detailed = await Promise.all(
      quizzes.map(async (quiz) => {
        const best = await getBestScore(quiz.id)
        const runs = (await listHistoryForQuiz(quiz.id)).length
        return { quiz, best, runs, resumable: resumableIds.has(quiz.id) }
      }),
    )
    setRows(detailed)
  }, [])

  useEffect(() => {
    void refresh()
    window.addEventListener('quiz-imported', refresh)
    return () => window.removeEventListener('quiz-imported', refresh)
  }, [refresh])

  async function confirmDelete(quiz: Quiz) {
    setPendingDelete(null)
    await deleteQuiz(quiz.id)
    await refresh()
  }

  if (rows === null) return <p className="muted">Loading…</p>

  return (
    <div>
      <h1>Your quizzes</h1>
      {rows.length === 0 && (
        <div className="card center">
          <p>No quizzes yet.</p>
          <button className="primary big" onClick={() => navigate('/import')}>
            Import a CSV or .quiz file
          </button>
        </div>
      )}
      {rows.map(({ quiz, best, runs, resumable }) => (
        <div className="card" key={quiz.id}>
          <div className="card-row">
            <div>
              <h3>{quiz.title}</h3>
              <p className="muted small" style={{ margin: '2px 0' }}>
                {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'}
                {best !== undefined && <> · best {best} pts</>}
                {runs > 0 && <> · {runs} run{runs === 1 ? '' : 's'}</>}
                {resumable && <> · <span style={{ color: 'var(--triangle, #f4b400)' }}>round in progress</span></>}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" onClick={() => navigate(`/play/${quiz.id}`)}>
                {resumable ? 'Resume' : 'Play'}
              </button>
              <button className="ghost" title="History" onClick={() => navigate(`/history/${quiz.id}`)}>
                📈
              </button>
              <button className="danger" title="Delete quiz" onClick={() => setPendingDelete(quiz)}>
                🗑
              </button>
            </div>
          </div>
        </div>
      ))}

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
            zIndex: 50,
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
