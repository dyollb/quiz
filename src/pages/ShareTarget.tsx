import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { takeStagedFile } from '../lib/db'
import { importFile } from '../lib/intake'
import type { Status } from './Import'

/**
 * Landing page for the Web Share Target. The service worker stashed the shared
 * file in IndexedDB and opened this page with ?file=<key>.
 */
export default function ShareTarget() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status | null>(null)

  const consume = useCallback(
    async (key: string) => {
      try {
        const staged = await takeStagedFile(key)
        if (!staged) {
          setStatus({ kind: 'error', text: 'The shared file could not be found anymore.' })
          return
        }
        const { quiz } = await importFile(
          new File([staged.blob], staged.name, { type: staged.type }),
        )
        setStatus({ kind: 'ok', text: `“${quiz.title}” added to your library.` })
        window.dispatchEvent(new CustomEvent('quiz-imported'))
        setTimeout(() => navigate('/', { replace: true }), 1200)
      } catch (err) {
        setStatus({
          kind: 'error',
          text: err instanceof Error ? err.message : String(err),
        })
      }
    },
    [navigate],
  )

  useEffect(() => {
    const key = params.get('file')
    if (key) void consume(key)
    else setStatus({ kind: 'error', text: 'Nothing was shared.' })
    // NB: shared-file messages for already-open windows are handled globally in Layout.
  }, [params, consume])

  return (
    <div className="center" style={{ paddingTop: 40 }}>
      <h1>Shared to QuizTime</h1>
      {!status && <p className="muted">Importing the shared file…</p>}
      {status && (
        <div className={`notice ${status.kind === 'ok' ? 'ok' : 'error'}`}>{status.text}</div>
      )}
      {status?.kind === 'error' && (
        <button onClick={() => navigate('/import', { replace: true })}>Open Import page</button>
      )}
    </div>
  )
}
