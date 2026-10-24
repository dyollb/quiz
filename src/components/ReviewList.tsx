import { questionType, type Question, type RunResult } from '../lib/schema'

/**
 * Per-question review of a finished run: wrong answers are listed in detail
 * (your answer vs. the correct answer, plus the explanation when present),
 * correct answers are grouped under a collapsible summary.
 * Handles all question types: single (one answer), multi (answer sets) and
 * order (full sequences from correctOrder).
 * `results` is index-aligned with `questions`; mismatched entries are skipped.
 */
export default function ReviewList({
  questions,
  results,
}: {
  questions: Question[]
  results: RunResult[]
}) {
  const wrong: Array<{ question: Question; result: RunResult }> = []
  const right: Question[] = []
  results.forEach((r, i) => {
    const question = questions[i]
    if (!question) return
    if (r.correct) right.push(question)
    else wrong.push({ question, result: r })
  })
  if (wrong.length === 0 && right.length === 0) return null

  return (
    <div className="review-list">
      {wrong.length === 0 ? (
        <p className="review-perfect">🎉 Perfect round — no wrong answers!</p>
      ) : (
        <>
          <h3 className="review-heading">Review your answers</h3>
          {wrong.map(({ question, result }) => {
            const type = questionType(question)
            const picked = Array.isArray(result.picked)
              ? result.picked
              : result.picked != null
                ? [result.picked]
                : []
            const textAt = (i: number) => question.answers[i]?.text ?? '?'
            let correctLine: string | undefined
            let yourLine: string | undefined
            if (type === 'order') {
              correctLine = (question.correctOrder ?? [])
                .map((n, pos) => `${pos + 1}. ${question.answers[n - 1]?.text ?? '?'}`)
                .join(' → ')
              yourLine = picked.length ? picked.map((i, pos) => `${pos + 1}. ${textAt(i)}`).join(' → ') : undefined
            } else if (type === 'multi') {
              correctLine = question.answers
                .filter((a) => a.correct)
                .map((a) => a.text)
                .join(', ')
              yourLine = picked.length ? picked.map(textAt).join(', ') : undefined
            } else {
              correctLine = question.answers.find((a) => a.correct)?.text
              yourLine = picked.length ? textAt(picked[0]) : undefined
            }
            return (
              <div className="review-item" key={question.id}>
                <div className="review-prompt">{question.prompt}</div>
                <div className="review-answer wrong">
                  ✘ Your answer: {yourLine ?? 'No answer — time’s up'}
                </div>
                {correctLine && (
                  <div className="review-answer right">
                    ✔ {type === 'order' ? 'Correct order' : type === 'multi' ? 'Correct answers' : 'Correct answer'}: {correctLine}
                  </div>
                )}
                {question.explanation && <div className="explanation">{question.explanation}</div>}
              </div>
            )
          })}
        </>
      )}
      {wrong.length > 0 && right.length > 0 && (
        <details className="review-right">
          <summary>
            {right.length} correct answer{right.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {right.map((q) => (
              <li key={q.id}>✔ {q.prompt}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
