import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ReviewList from '../components/ReviewList'
import { addHistory, clearGameState, getGameState, getMediaUrl, getQuiz, saveGameState, type GameState } from '../lib/db'
import { BASE_POINTS, scoreAnswer } from '../lib/scoring'
import { questionSeconds, questionType, quizMaxScore, type QuestionType, type Quiz, type RunResult } from '../lib/schema'

type Phase = 'start' | 'question' | 'reveal' | 'done'

const SHAPES = ['◆', '▲', '●', '■']
const SHAPE_NAMES = ['Diamond', 'Triangle', 'Circle', 'Square']
const LAST_MODE_KEY = 'quiztime:last-mode'

export default function Play() {
  const { quizId } = useParams<{ quizId: string }>()
  const navigate = useNavigate()
  const [quiz, setQuiz] = useState<Quiz | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    if (!quizId) return
    void getQuiz(quizId).then((q) => alive && setQuiz(q ?? null))
    return () => {
      alive = false
    }
  }, [quizId])

  if (quiz === undefined) return <p className="muted">Loading…</p>
  if (quiz === null)
    return (
      <div className="center">
        <p>Quiz not found — it may have been deleted.</p>
        <Link to="/">
          <button>Back to quizzes</button>
        </Link>
      </div>
    )
  return <Game key={quiz.id} quiz={quiz} onExit={() => navigate('/')} />
}

function Game({ quiz, onExit }: { quiz: Quiz; onExit: () => void }) {
  const lastMode = ((): 'timed' | 'practice' => {
    try {
      const v = localStorage.getItem(LAST_MODE_KEY)
      if (v === 'timed' || v === 'practice') return v
    } catch {
      /* ignore */
    }
    return quiz.timer.enabled ? 'timed' : 'practice'
  })()

  const [mode, setMode] = useState<'timed' | 'practice'>(lastMode)
  const [phase, setPhase] = useState<Phase>('start')
  const [qIndex, setQIndex] = useState(0)
  const [results, setResults] = useState<RunResult[]>([])
  // Committed selection for the question being revealed:
  // single = one index, multi = picked set, order = tap sequence, null = timed out.
  const [picked, setPicked] = useState<number | number[] | null>(null)
  // In-progress selection for multi/order questions before "Lock in".
  const [draft, setDraft] = useState<number[]>([])
  const [remainingMs, setRemainingMs] = useState(0)
  const [mediaUrl, setMediaUrl] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState<GameState | null>(null)
  const [savedLoaded, setSavedLoaded] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const restartRequested = searchParams.get('restart') === '1'
  const navigate = useNavigate()

  // Load an interrupted round for this quiz (if any) so the start screen can offer "Resume".
  useEffect(() => {
    let alive = true
    void getGameState(quiz.id).then((s) => {
      if (!alive) return
      // Drop snapshots that no longer fit the quiz (e.g. questions were removed on re-import).
      if (s && (s.qIndex >= quiz.questions.length || s.results.length !== s.qIndex)) {
        void clearGameState(quiz.id)
        s = undefined
      }
      setSaved(s ?? null)
      setSavedLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [quiz])

  // Arriving via Home's "Restart" (?restart=1): discard any interrupted round and start fresh.
  const didAutoRestart = useRef(false)
  useEffect(() => {
    if (!restartRequested || !savedLoaded || didAutoRestart.current) return
    didAutoRestart.current = true
    setSearchParams({}, { replace: true })
    startGame()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restartRequested, savedLoaded])

  // Persist the snapshot whenever a question begins (results.length === qIndex).
  useEffect(() => {
    if (phase !== 'question') return
    void saveGameState({
      quizId: quiz.id,
      mode,
      qIndex,
      results,
      startedAt: startAtRef.current,
      updatedAt: new Date().toISOString(),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, qIndex])

  const question = quiz.questions[qIndex]
  const qType: QuestionType = question ? questionType(question) : 'single'
  const totalMs = useMemo(() => (question ? questionSeconds(question, quiz) * 1000 : 20_000), [question, quiz])

  const questionStartRef = useRef(0)
  const deadlineRef = useRef(0)

  // Image URL for the current question.
  useEffect(() => {
    let url: string | undefined
    let alive = true
    const ref = question?.image?.ref
    if (!ref) {
      setMediaUrl(undefined)
      return
    }
    void getMediaUrl(ref).then((u) => {
      if (alive) {
        url = u
        setMediaUrl(u)
      }
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [question])

  // Countdown loop (timed mode only).
  useEffect(() => {
    if (phase !== 'question' || mode !== 'timed') return
    const tick = () => {
      const rem = deadlineRef.current - performance.now()
      if (rem <= 0) {
        setRemainingMs(0)
        commit(null) // locking in is "answering": an uncommitted selection scores 0
        return true
      }
      setRemainingMs(rem)
      return false
    }
    const id = window.setInterval(() => {
      if (tick()) window.clearInterval(id)
    }, 100)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode, qIndex])

  function beginQuestion(index: number) {
    setPicked(null)
    setDraft([])
    setQIndex(index)
    questionStartRef.current = performance.now()
    const sec = questionSeconds(quiz.questions[index], quiz)
    deadlineRef.current = performance.now() + sec * 1000
    setRemainingMs(sec * 1000)
    setPhase('question')
  }

  /** All-or-nothing grading against the question's type. `sel` = 0-based answer indices. */
  function gradeCorrect(sel: number[] | null): boolean {
    if (!sel || sel.length === 0) return false
    const q = question
    if (qType === 'single') {
      return sel.length === 1 && Boolean(q.answers[sel[0]]?.correct)
    }
    if (qType === 'multi') {
      const correct = q.answers.flatMap((a, i) => (a.correct ? [i] : []))
      return sel.length === correct.length && correct.every((i) => sel.includes(i))
    }
    // order: tap sequence must match correctOrder (1-based) exactly.
    const expected = q.correctOrder ?? []
    return sel.length === expected.length && sel.every((idx, pos) => expected[pos] === idx + 1)
  }

  /** Finalise the question with a committed selection (null = timed out / no answer). */
  function commit(sel: number[] | null) {
    if (phase !== 'question') return
    const answeredMs = performance.now() - questionStartRef.current
    const rem = mode === 'timed' ? Math.max(0, deadlineRef.current - performance.now()) : 0
    const correct = gradeCorrect(sel)
    const points = scoreAnswer({ mode, correct, remainingMs: rem, totalMs })
    const recorded =
      sel === null || sel.length === 0 ? null : qType === 'single' ? sel[0] : sel
    setPicked(recorded)
    setResults((r) => [...r, { correct, points, answeredMs, picked: recorded }])
    setPhase('reveal')
  }

  /** Single-choice: one tap commits immediately (unchanged behaviour). */
  function answer(choice: number) {
    if (phase !== 'question') return
    commit([choice])
  }

  /** Multi/order: tap toggles membership (for order, the sequence position). */
  function tapOption(i: number) {
    if (phase !== 'question') return
    setDraft((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]))
  }

  function next() {
    if (qIndex + 1 >= quiz.questions.length) {
      setPhase('done')
      void recordHistory(results)
    } else {
      beginQuestion(qIndex + 1)
    }
  }

  const score = results.reduce((s, r) => s + r.points, 0)
  const correctCount = results.filter((r) => r.correct).length
  const startAtRef = useRef(0)

  function startGame() {
    try {
      localStorage.setItem(LAST_MODE_KEY, mode)
    } catch {
      /* ignore */
    }
    setSaved(null)
    void clearGameState(quiz.id)
    startAtRef.current = Date.now()
    beginQuestion(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }

  function resumeGame(s: GameState) {
    try {
      localStorage.setItem(LAST_MODE_KEY, s.mode)
    } catch {
      /* ignore */
    }
    setMode(s.mode)
    startAtRef.current = s.startedAt || Date.now()
    setResults(s.results)
    beginQuestion(s.qIndex)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }

  async function recordHistory(finalResults: RunResult[]) {
    const s = finalResults.reduce((sum, r) => sum + r.points, 0)
    const c = finalResults.filter((r) => r.correct).length
    await clearGameState(quiz.id)
    await addHistory({
      quizId: quiz.id,
      quizTitle: quiz.title,
      mode,
      score: s,
      maxScore: mode === 'timed' ? quizMaxScore(quiz) : quiz.questions.length * BASE_POINTS,
      correct: c,
      total: quiz.questions.length,
      durationMs: Date.now() - startAtRef.current,
      playedAt: new Date().toISOString(),
      review: finalResults.map((r) => ({ correct: r.correct, points: r.points, answeredMs: r.answeredMs, picked: r.picked ?? null })),
    })
  }

  /* ---------------- render ---------------- */

  if (phase === 'start') {
    return (
      <div className="card center">
        <h1>{quiz.title}</h1>
        <p className="muted">{quiz.questions.length} questions</p>
        {saved && (
          <div className="notice" style={{ margin: '12px 0', textAlign: 'left' }}>
            <strong>Interrupted round</strong>
            <p className="small" style={{ margin: '4px 0 8px' }}>
              {saved.qIndex} of {quiz.questions.length} answered ·{' '}
              {saved.results.filter((r) => r.correct).length} correct ·{' '}
              {saved.results.reduce((s, r) => s + r.points, 0)} pts
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" onClick={() => resumeGame(saved)}>
                Resume
              </button>
              <button className="ghost" onClick={startGame}>
                Restart
              </button>
            </div>
          </div>
        )}
        <div className="toggle-row" style={{ margin: '22px 0 8px' }}>
          <div style={{ textAlign: 'left' }}>
            <strong>Timer</strong>
            <p className="muted small" style={{ margin: '2px 0 0' }}>
              {mode === 'timed'
                ? 'On — earn up to 500 extra points per question for answering fast.'
                : 'Off — practice mode: no countdown, 500 points per correct answer.'}
            </p>
          </div>
          <label className="switch" aria-label="Toggle timer">
            <input
              type="checkbox"
              checked={mode === 'timed'}
              onChange={(e) => setMode(e.target.checked ? 'timed' : 'practice')}
            />
            <span className="track" />
            <span className="thumb" />
          </label>
        </div>
        <div className="center muted small">Default is {quiz.timer.enabled ? 'timed' : 'practice'} for this quiz.</div>
        <div className="spread">
          {!saved && (
            <button className="primary big" onClick={startGame}>
              Start
            </button>
          )}
          <button className={saved ? 'ghost' : ''} onClick={onExit}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    const max = mode === 'timed' ? quizMaxScore(quiz) : quiz.questions.length * BASE_POINTS
    return (
      <div className="card center">
        <h1>{mode === 'timed' ? 'Timed round' : 'Practice round'} complete!</h1>
        <div className="result-banner">
          <div className="big-score">{score}</div>
          <div className="muted">points of {max} possible</div>
        </div>
        <p>
          {correctCount} of {quiz.questions.length} correct
        </p>
        <ReviewList questions={quiz.questions} results={results} />
        <div className="spread">
          <button className="primary" onClick={() => { setResults([]); startGame() }}>
            Play again
          </button>
          <button onClick={() => navigate(`/history/${quiz.id}`)}>Scores</button>
          <button className="ghost" onClick={onExit}>
            Done
          </button>
        </div>
      </div>
    )
  }

  const reveal = phase === 'reveal'
  const progress = (qIndex + (reveal ? 1 : 0)) / quiz.questions.length
  const wasCorrect = results[results.length - 1]?.correct ?? false
  // The committed selection as an array, for reveal diffing across all types.
  const revealSel: number[] = Array.isArray(picked) ? picked : typeof picked === 'number' ? [picked] : []
  const canLock = qType === 'multi' ? draft.length > 0 : draft.length === question.answers.length

  return (
    <div>
      <div className="progress-line" aria-hidden="true">
        <div style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="card question-card">
        {mode === 'timed' && !reveal && (
          <TimerRing remainingMs={remainingMs} totalMs={totalMs} />
        )}
        {question.timeLimit === undefined && mode === 'timed' && !reveal && (
          <div className="muted small">{totalMs / 1000}s</div>
        )}
        {mediaUrl && <img className="question-img" src={mediaUrl} alt={question.image?.alt ?? ''} />}
        <div className="prompt">{question.prompt}</div>
        {!reveal && qType !== 'single' && (
          <div className="muted small type-hint">
            {qType === 'multi'
              ? 'Multiple answers — select every correct one, then lock in.'
              : 'Put the answers in the correct order, then lock in.'}
          </div>
        )}

        <div className="shape-grid">
          {question.answers.map((a, i) => {
            let cls = `answer-btn shape-${i % 4}`
            let ordPos = -1
            if (reveal) {
              ordPos = revealSel.indexOf(i)
              if (qType === 'single') {
                if (a.correct) cls += ' reveal-correct'
                else if (ordPos >= 0) cls += ' reveal-wrong'
                else cls += ' dim'
              } else if (qType === 'multi') {
                if (a.correct && ordPos >= 0) cls += ' reveal-correct'
                else if (a.correct) cls += ' reveal-missed'
                else if (ordPos >= 0) cls += ' reveal-wrong'
                else cls += ' dim'
              } else {
                // order: right answer at the right position wins.
                const expectedPos = (question.correctOrder ?? []).indexOf(i + 1)
                if (ordPos >= 0 && expectedPos === ordPos) cls += ' reveal-correct'
                else if (ordPos >= 0) cls += ' reveal-wrong'
                else cls += ' dim'
              }
            } else if (qType !== 'single' && draft.includes(i)) {
              cls += ' selected'
              ordPos = draft.indexOf(i)
            }
            return (
              <button
                key={a.id}
                className={cls}
                disabled={reveal}
                onClick={qType === 'single' ? () => answer(i) : () => tapOption(i)}
                aria-label={
                  qType === 'single'
                    ? `${SHAPE_NAMES[i % 4]}: ${a.text}`
                    : `${a.text}${ordPos >= 0 ? ` (position ${ordPos + 1})` : ''}`
                }
                aria-pressed={qType !== 'single' ? ordPos >= 0 : undefined}
              >
                {qType === 'order' && ordPos >= 0 ? (
                  <span className="ord" aria-hidden="true">{ordPos + 1}</span>
                ) : (
                  <span className="shape" aria-hidden="true">{SHAPES[i % 4]}</span>
                )}
                <span>{a.text}</span>
              </button>
            )
          })}
        </div>

        {!reveal && qType !== 'single' && (
          <div className="lock-row">
            <button className="primary big" disabled={!canLock} onClick={() => commit(draft)}>
              Lock in
            </button>
          </div>
        )}

        {reveal && (
          <>
            {picked === null ? (
              <p className="center" style={{ marginTop: 14 }}>
                ⏰ Time&apos;s up!
              </p>
            ) : wasCorrect ? (
              <p className="center" style={{ marginTop: 14 }}>
                ✔ Correct
                {mode === 'timed' && (
                  <span className="muted"> · +{results[results.length - 1]?.points} pts</span>
                )}
              </p>
            ) : (
              <p className="center" style={{ marginTop: 14 }}>
                ✘ Not quite
              </p>
            )}
            {qType === 'order' && (
              <div className="order-answer">
                <div className="seq-line">
                  <span className="muted">Correct order:</span>{' '}
                  {(question.correctOrder ?? []).map((n, pos) => (
                    <span key={n} className="chip">
                      {pos + 1}. {question.answers[n - 1]?.text}
                    </span>
                  ))}
                </div>
                {revealSel.length > 0 && (
                  <div className="seq-line muted small">
                    Your order: {revealSel.map((idx) => question.answers[idx]?.text).join(' → ')}
                  </div>
                )}
              </div>
            )}
            {question.explanation && <div className="explanation">{question.explanation}</div>}
            <div className="spread">
              <button className="primary big" onClick={next} autoFocus>
                {qIndex + 1 >= quiz.questions.length ? 'See results' : 'Next'}
              </button>
            </div>
          </>
        )}
      </div>
      <p className="center muted small">
        {qIndex + 1} / {quiz.questions.length} · score {score}
      </p>
    </div>
  )
}

function TimerRing({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const frac = Math.max(0, Math.min(1, remainingMs / totalMs))
  const r = 24
  const c = 2 * Math.PI * r
  const secs = Math.ceil(remainingMs / 1000)
  return (
    <div className="timer-ring" role="timer" aria-label={`${secs} seconds left`}>
      <svg width="58" height="58" viewBox="0 0 58 58">
        <circle cx="29" cy="29" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="5" />
        <circle
          cx="29"
          cy="29"
          r={r}
          fill="none"
          stroke={secs <= 5 ? 'var(--wrong)' : 'var(--triangle)'}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
        />
      </svg>
      <div className="num">{secs}</div>
    </div>
  )
}
