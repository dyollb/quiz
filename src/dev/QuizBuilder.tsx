import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { parseQuizCsv } from '../lib/csv'
import { saveQuiz } from '../lib/db'
import { queryFromQuestion, searchCommons, type CommonsImage } from '../lib/images'
import { packQuiz } from '../lib/quizPackage'
import { newId, type Question, type Quiz } from '../lib/schema'

/**
 * DEV-ONLY tool: import a CSV, attach images (Wikimedia Commons search or local
 * files), then download a .quiz package or push it into your local library.
 * Route is only registered in dev builds (see App.tsx).
 */
export default function QuizBuilder() {
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [images, setImages] = useState<Map<string, Blob>>(new Map())
  const [csvError, setCsvError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const onCsv = useCallback(async (file: File) => {
    setCsvError(null)
    try {
      const text = await file.text()
      const { quiz: q, warnings, format } = parseQuizCsv(text, file.name.replace(/\.csv$/i, ''))
      setQuiz(q)
      setImages(new Map())
      setMessage(`Parsed ${q.questions.length} questions (${format} format).${warnings.length ? ' ' + warnings.join(' ') : ''}`)
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  function updateQuestion(id: string, patch: Partial<Question>) {
    setQuiz((q) =>
      q
        ? { ...q, questions: q.questions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }
        : q,
    )
  }

  function attachImage(qId: string, ref: string, blob: Blob, credit?: string, alt?: string) {
    setImages((m) => new Map(m).set(ref, blob))
    updateQuestion(qId, { image: { ref, credit, alt } })
  }

  function detachImage(qId: string) {
    updateQuestion(qId, { image: undefined })
  }

  async function download() {
    if (!quiz) return
    setMessage('Packing…')
    const { blob, fileName } = await packQuiz(quiz, images)
    triggerDownload(blob, fileName)
    setMessage(`Downloaded ${fileName}`)
  }

  async function loadIntoLibrary() {
    if (!quiz) return
    // Fresh copy so library edits don't collide with a re-download.
    const copy: Quiz = { ...quiz, id: newId(), createdAt: new Date().toISOString() }
    await saveQuiz(copy, images)
    window.dispatchEvent(new CustomEvent('quiz-imported'))
    setMessage(`Loaded “${copy.title}” into your library.`)
  }

  return (
    <div>
      <h1>Quiz builder <span className="pill">dev only</span></h1>
      <p className="muted small">
        CSV → <code>.quiz</code> with images. <Link to="/">Back to app</Link>
      </p>

      <div className="card">
        <label>Import CSV</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onCsv(f)
            e.target.value = ''
          }}
        />
        {csvError && <div className="notice error">{csvError}</div>}
        {message && <div className="notice ok">{message}</div>}
      </div>

      {quiz && (
        <>
          <div className="card">
            <label>Quiz title</label>
            <input
              type="text"
              value={quiz.title}
              onChange={(e) => setQuiz({ ...quiz, title: e.target.value })}
            />
            <label className="toggle-row" style={{ marginTop: 14 }}>
              <span>Timer enabled by default</span>
              <input
                type="checkbox"
                checked={quiz.timer.enabled}
                onChange={(e) =>
                  setQuiz({ ...quiz, timer: { ...quiz.timer, enabled: e.target.checked } })
                }
                style={{ width: 'auto' }}
              />
            </label>
          </div>

          {quiz.questions.map((q, i) => (
            <QuestionEditor
              key={q.id}
              index={i}
              question={q}
              onAttach={(ref, blob, credit, alt) => attachImage(q.id, ref, blob, credit, alt)}
              onDetach={() => detachImage(q.id)}
            />
          ))}

          <div className="spread">
            <button className="primary big" onClick={() => void download()}>
              Download .quiz
            </button>
            <button onClick={() => void loadIntoLibrary()}>Load into library</button>
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function QuestionEditor({
  index,
  question,
  onAttach,
  onDetach,
}: {
  index: number
  question: Question
  onAttach: (ref: string, blob: Blob, credit?: string, alt?: string) => void
  onDetach: () => void
}) {
  const defaultQuery = useMemo(
    () =>
      queryFromQuestion(
        question.prompt,
        question.answers.filter((a) => a.correct).map((a) => a.text),
      ),
    // Re-derive when the prompt or a correct answer text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question.prompt, question.answers.map((a) => `${a.correct ? '=' : '-'}${a.text}`).join('\n')],
  )
  const [query, setQuery] = useState(defaultQuery)
  const [results, setResults] = useState<CommonsImage[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const localInputRef = useRef<HTMLInputElement>(null)

  async function runSearch() {
    setSearching(true)
    setSearchError(null)
    try {
      setResults(await searchCommons(query || defaultQuery))
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err))
      setResults(null)
    } finally {
      setSearching(false)
    }
  }

  async function pickCommons(img: CommonsImage) {
    try {
      const res = await fetch(img.fullUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const ext = guessExt(img.fullUrl, blob.type)
      const ref = `${crypto.randomUUID()}.${ext}`
      registerPreview(ref, blob)
      onAttach(ref, blob, img.credit, stripFileExt(img.title))
    } catch (err) {
      setSearchError(`Could not fetch image: ${err instanceof Error ? err.message : err}`)
    }
  }

  async function pickLocal(file: File) {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const ref = `${crypto.randomUUID()}.${ext}`
    registerPreview(ref, file)
    onAttach(ref, file, undefined, file.name.replace(/\.[^.]+$/, ''))
  }

  return (
    <div className="builder-q">
      <div className="card-row">
        <strong>Q{index + 1}</strong>
        {question.type && question.type !== 'single' && (
          <span className="type-badge">{question.type === 'multi' ? 'multiple answers' : 'put in order'}</span>
        )}
        {question.image ? (
          <button className="ghost" onClick={onDetach}>
            Remove image
          </button>
        ) : null}
      </div>
      <p style={{ margin: '4px 0' }}>{question.prompt}</p>
      <div className="muted small">
        {question.answers.map((a, i) => (
          <span key={a.id} style={{ marginRight: 10 }}>
            {question.type === 'order' ? '▸' : a.correct ? '✔' : '○'} {i + 1}. {a.text}
          </span>
        ))}
      </div>
      {question.type === 'order' && (
        <div className="muted small">Correct order: {(question.correctOrder ?? []).join(' → ')}</div>
      )}

      {question.image && <ImagePreview question={question} />}

      <div className="search-bar" style={{ marginTop: 10 }}>
        <input
          type="search"
          value={query}
          placeholder={defaultQuery}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
        />
        <button onClick={() => void runSearch()} disabled={searching}>
          {searching ? '…' : 'Search Commons'}
        </button>
        <button className="ghost" onClick={() => localInputRef.current?.click()}>
          Local file…
        </button>
        <input
          ref={localInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void pickLocal(f)
            e.target.value = ''
          }}
        />
      </div>
      <div className="muted small" style={{ marginTop: 4 }}>
        Commons works best with short keywords (e.g. “Bern Bundeshaus”), not full sentences.
      </div>
      {searchError && <div className="notice error small">{searchError}</div>}
      {results && (
        <div className="thumb-grid">
          {results.map((img) => (
            <button
              key={img.fullUrl}
              className={question.image?.credit && img.credit === question.image.credit ? 'sel' : ''}
              title={`${img.title} · ${img.license}`}
              onClick={() => void pickCommons(img)}
            >
              <img src={img.thumbUrl} alt={img.title} loading="lazy" />
            </button>
          ))}
          {results.length === 0 && <span className="muted small">No results.</span>}
        </div>
      )}
    </div>
  )
}

function ImagePreview({ question }: { question: Question }) {
  const ref = question.image?.ref
  const url = ref ? imagePreviews.get(ref) : undefined
  if (!url) return null
  return (
    <div style={{ marginTop: 8 }}>
      <img src={url} alt={question.image?.alt ?? ''} style={{ maxHeight: 140, borderRadius: 8 }} />
      {question.image?.credit && <div className="muted small">{question.image.credit}</div>}
    </div>
  )
}

/** Preview cache: ref -> object URL, so attached images render without a DB round-trip. */
const imagePreviews = new Map<string, string>()

function registerPreview(ref: string, blob: Blob) {
  const old = imagePreviews.get(ref)
  if (old) URL.revokeObjectURL(old)
  imagePreviews.set(ref, URL.createObjectURL(blob))
}

/* ------------------------------------------------------------------ */

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function guessExt(url: string, mime: string): string {
  const m = url.match(/\.(png|jpe?g|gif|webp|svg)(\?|$)/i)
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg')
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('svg')) return 'svg'
  return 'bin'
}

function stripFileExt(title: string): string {
  return title.replace(/\.[^.]+$/, '')
}
