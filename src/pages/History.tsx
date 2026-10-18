import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listRecentHistory } from '../lib/db'
import type { HistoryEntry } from '../lib/schema'

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ModePill({ mode }: { mode: 'timed' | 'practice' }) {
  return <span className={`pill ${mode}`}>{mode === 'timed' ? 'Timed' : 'Practice'}</span>
}

export default function HistoryPage() {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    void listRecentHistory(50).then(setRows)
  }, [])

  if (rows === null) return <p className="muted">Loading…</p>

  return (
    <div>
      <h1>Recent games</h1>
      {rows.length === 0 && <p className="muted">No games played yet.</p>}
      {rows.length > 0 && (
        <div className="card" style={{ padding: '4px 8px' }}>
          <table className="history">
            <thead>
              <tr>
                <th>Quiz</th>
                <th>Score</th>
                <th>Mode</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/history/${r.quizId}`)}
                >
                  <td>{r.quizTitle}</td>
                  <td>
                    {r.score}/{r.maxScore}
                  </td>
                  <td>
                    <ModePill mode={r.mode} />
                  </td>
                  <td className="muted small">{formatDate(r.playedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
