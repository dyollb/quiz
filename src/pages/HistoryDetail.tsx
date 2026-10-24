import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReviewList from '../components/ReviewList'
import { clearHistory, deleteHistoryRun, getQuiz, listHistoryForQuiz } from '../lib/db'
import type { HistoryEntry, Quiz } from '../lib/schema'
import { ModePill, formatDate } from './History'

export default function HistoryDetail() {
  const { quizId } = useParams<{ quizId: string }>()
  const [quiz, setQuiz] = useState<Quiz | null | undefined>(undefined)
  const [rows, setRows] = useState<HistoryEntry[] | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const refresh = useCallback(async () => {
    if (!quizId) return
    const [q, r] = await Promise.all([getQuiz(quizId), listHistoryForQuiz(quizId)])
    setQuiz(q ?? null)
    setRows(r)
  }, [quizId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (quiz === undefined || rows === null) return <p className="muted">Loading…</p>
  if (quiz === null)
    return (
      <div className="center">
        <p>Quiz not found.</p>
        <Link to="/history">
          <button>Back to history</button>
        </Link>
      </div>
    )

  const best = rows.length ? Math.max(...rows.map((r) => r.score)) : undefined

  async function removeRun(id: number) {
    await deleteHistoryRun(id)
    await refresh()
  }

  async function onClear() {
    setConfirmClear(false)
    if (quizId) await clearHistory(quizId)
    await refresh()
  }

  return (
    <div>
      <h1>{quiz.title}</h1>
      <p className="muted">
        {rows.length} run{rows.length === 1 ? '' : 's'}
        {best !== undefined && <> · best score {best}</>}
      </p>
      {rows.length === 0 && <p className="muted">No runs recorded for this quiz yet.</p>}
      {rows.length > 0 && (
        <div className="card" style={{ padding: '4px 8px' }}>
          <table className="history">
            <thead>
              <tr>
                <th>Score</th>
                <th>Correct</th>
                <th>Mode</th>
                <th>When</th>
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td>
                      {r.score}/{r.maxScore}
                    </td>
                    <td>
                      {r.correct}/{r.total}
                    </td>
                    <td>
                      <ModePill mode={r.mode} />
                    </td>
                    <td className="muted small">{formatDate(r.playedAt)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="ghost" onClick={() => r.id && void removeRun(r.id)} title="Delete run">
                        ✕
                      </button>
                    </td>
                  </tr>
                  {r.review && r.review.length > 0 && (
                    <tr>
                      <td className="review-cell" colSpan={5}>
                        <details>
                          <summary>Review answers</summary>
                          <ReviewList questions={quiz.questions} results={r.review} />
                        </details>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 &&
        (confirmClear ? (
          <div className="notice error">
            Delete all {rows.length} scores for this quiz?
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
              <button className="danger" onClick={() => void onClear()}>
                Delete all
              </button>
            </div>
          </div>
        ) : (
          <button className="danger" onClick={() => setConfirmClear(true)}>
            Clear history for this quiz
          </button>
        ))}
    </div>
  )
}
