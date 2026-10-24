import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { importFile } from '../lib/intake'

export interface Status {
  kind: 'ok' | 'error'
  text: string
  quizId?: string
}

export default function ImportPage() {
  const [over, setOver] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  async function handleFiles(files: FileList | File[]) {
    setBusy(true)
    const list = [...files]
    const ok: string[] = []
    const failed: string[] = []
    for (const f of list) {
      try {
        const { quiz, warnings } = await importFile(f)
        ok.push(quiz.title)
        if (warnings.length) failed.push(`${quiz.title}: ${warnings.join(' ')}`)
      } catch (err) {
        failed.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    setBusy(false)
    if (ok.length) {
      setStatus({
        kind: 'ok',
        text: failed.length
          ? `Imported: ${ok.join(', ')} — issues: ${failed.join(' | ')}`
          : `Imported ${ok.join(', ')}.`,
      })
      setTimeout(() => navigate('/'), 900)
    } else {
      setStatus({ kind: 'error', text: failed.join(' | ') || 'No files processed.' })
    }
  }

  return (
    <div>
      <h1>Import a quiz</h1>
      <p className="muted">
        Supported: <strong>.quiz</strong> (our zip package), <strong>.csv</strong> (simple format or
        Kahoot export) and bare <strong>.json</strong>. On a phone, you can also{' '}
        <em>share</em> a file to the installed app from WhatsApp/Files.
      </p>

      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files)
        }}
      >
        {busy ? 'Importing…' : 'Drop files here'}
      </div>

      <div className="center">
        <input
          ref={inputRef}
          type="file"
          accept=".quiz,.csv,.json,.zip,text/csv,application/json,application/zip"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <button className="primary big" disabled={busy} onClick={() => inputRef.current?.click()}>
          Choose file…
        </button>
      </div>

      {status && (
        <div className={`notice ${status.kind === 'ok' ? 'ok' : 'error'}`}>{status.text}</div>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <h3>CSV formats</h3>
        <p className="small muted" style={{ marginBottom: 4 }}>
          Simple format (header required):
        </p>
        <pre className="small" style={{ overflowX: 'auto' }}>
{`question,answer1,answer2,answer3,answer4,correct,type,explanation
Capital of Switzerland?,Zurich,Bern,Geneva,Basel,2,,Bern is the federal city
Pick the primes?,2,3,4,6,"2,3",multi,2 and 3 are prime numbers
Put in order?,Moon forms,Solar System,Earth forms,Milky Way,"2,3,1,4",order,Solar System first`}
        </pre>
        <p className="small muted">
          Kahoot exports are detected automatically. <code>correct</code> is a 1-based number;
          use <code>2,4</code> for multi-select questions (pick every correct answer, all-or-nothing).
          An optional <code>type</code> column takes <code>single</code> (default), <code>multi</code>{' '}
          or <code>order</code>; for <code>order</code>, list the answers shuffled and put the whole
          tap sequence in <code>correct</code> (e.g. <code>3,1,4,2</code>).
          Order/multi questions get 30&nbsp;seconds unless a <code>time_limit</code> says otherwise.
        </p>
      </div>
    </div>
  )
}
