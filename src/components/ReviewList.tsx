import type { Question, RunResult } from '../lib/schema'

/**
 * Per-question review of a finished run: wrong answers are listed in detail
 * (your answer vs. the correct answer, plus the explanation when present),
 * correct answers are grouped under a collapsible summary.
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
            const correctAnswer = question.answers.find((a) => a.correct)
            const pickedAnswer = result.picked != null ? question.answers[result.picked] : undefined
            return (
              <div className="review-item" key={question.id}>
                <div className="review-prompt">{question.prompt}</div>
                <div className="review-answer wrong">
                  ✘ Your answer: {pickedAnswer ? pickedAnswer.text : 'No answer — time’s up'}
                </div>
                {correctAnswer && (
                  <div className="review-answer right">✔ Correct answer: {correctAnswer.text}</div>
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
