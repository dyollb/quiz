---
name: quiz-csv-creator
description: Turns a teaching text, PDF, chapter, or notes into an import-ready multiple-choice quiz CSV for the QuizTime PWA (header question,answer1..answer4,correct,explanation). Use when asked to create quiz questions, MCQs, Kahoot-style quizzes, or a test from learning material, or to prepare a CSV for importing into the Quiz/QuizTime app.
---

# Quiz CSV Creator

Turn learning material into a quiz that teaches, not just tests. Retrieval practice is one of the strongest learning tools for school-age pupils — but only if the questions are honest and every answer gets a short explanation. The rationale and sources for these rules: [references/SOURCES.md](references/SOURCES.md).

## Output contract (exact)

- One CSV file, UTF-8, RFC 4180 quoting (quote every field containing a comma, quote, or newline).
- Header line exactly: `question,answer1,answer2,answer3,answer4,correct,explanation`
- `question` — the stem; aim under 120 characters so it fits on a phone.
- `answer1`..`answer4` — all four filled, non-empty, mutually exclusive options.
- `correct` — a single 1-based index (1–4). Exactly one correct answer per question: the app is single-choice, a pupil taps one answer, so never mark several options correct (the format technically allows `2,4`, but the app can then never score it correct).
- `explanation` — required for every question; shown after answering, correct or wrong.
- Optional extra columns at the end: `time_limit` (seconds, 5–120) and `title` (quiz title, put it on the first data row only).
- Filename = short quiz title, e.g. `Erdentstehung.csv`.
- Language: write questions, answers, and explanations in the language of the source material (header row stays English).

## Workflow

1. Read the ENTIRE source before writing anything. List the key concepts, facts, and cause-effect chains the pupil should retain (usually 8–20 for a chapter).
2. Write roughly one question per key concept, covering the whole list — a quiz only strengthens what it actually asks; do not assume adjacent facts "come along for free".
3. For each question: draft the stem first, then the correct option, then three distractors built from likely misconceptions.
4. Write each explanation with a short reference into the source.
5. Randomise the correct-answer positions (see order rules) — check before emitting.
6. Write the CSV, then run `python3 scripts/validate_quiz_csv.py <file> --strict`. Fix every error and warning and re-run until clean. Never deliver an unvalidated file.
7. Deliver the CSV plus a 3-line summary: title, question count, concepts covered.

## Question rules

- Test understanding, not keyword matching: paraphrase the source, so the answer cannot be found by searching for an unusual word from the stem. Prefer stems that apply, compare, explain causes, or use a mini-scenario ("Warum…", "Was wäre wenn…", "Woran erkennt man…").
- Every question must stand on its own: a pupil who has answered nothing else must still be able to solve it, and knowing one question's answer must not give away another's. Each testable fact from the source may be questioned only once. Never reuse the same set of options in two questions. Vary the stem template — do not ask "Zu welcher Gattung gehört X?" for several items.
  Concrete patterns to avoid:
  - ❌ "Zu welcher Instrumentenart gehört der Büchel? (…Saiten-/Schlag-/Blasinstrument)", "Zu welcher Instrumentenart gehört die Zither?", "Zu welcher Instrumentenfamilie gehört das Schwyzerörgeli?"… — one category fact per instrument, always against the same four categories: after the first item, the rest fall out by elimination.
  - ❌ Asking "Was verbindet Alphorn und Büchel?" (answer: both are Blasinstrumente) after a question already established the Büchel is a Blasinstrument.
  - ✅ Instead ask about facts that cannot be derived from other items: how the sound is produced, what a body part is for, what changes the volume — and make sure comparison items do not repeat a fact another question already states.
- Exactly one option is correct, unambiguously: a pupil who understood the text must see it; a pupil who did not must not.
- All four options must be plausible. Build distractors from real misconceptions (e.g. "im Winter ist die Erde weiter von der Sonne entfernt") or right-sounding half-truths. Never joke or filler options — each must be *clearly* wrong only after understanding.
- Keep options parallel: same grammar, similar length (max/min ratio under 3), same register, all grammatically consistent with the stem. If one option is longer or more precise than the rest, it leaks the key — rewrite.
- No "all of the above" / "none of the above" (any language equivalent). Avoid negative stems ("which is NOT"); if unavoidable, write NOT in caps. Avoid absolutes in options ("always", "never", "immer", "niemals").
- Do not repeat distinctive stem words in the correct option only — that clues it.
- One concept per question. No question may be answerable by reading another question.
- Difficulty: a pupil who read and understood the text should get roughly 80% right. Hard means thinking is required, never ambiguity or trickery.

## Explanation rules

- Required for EVERY question (including ones most pupils get right): **2–3 full sentences** — one bare sentence is too thin, and the source reference does not count as a sentence. The reference exists so you verify the answer against the source; it must never replace the learning content.
- Say why the correct option is right. If a distractor is a popular misconception, spend one clause on why it is wrong — that is the highest-value content for pupils who picked it.
- Add a bit beyond the question (a number, a cause, a consequence), so even pupils who knew the answer learn something.
- End with a short reference into the source in parentheses, e.g. `(S. 3, Abs. 2)`, `(Fig. 2)`, `(p. 12)`. Only cite places that actually support the answer — verify against the source, never invent page numbers.
- Example shape (content, not style): "Der Büchel ist kleiner und mehrfach gebogen, während das Alphorn mehrere Meter lang ist. Wegen seiner kompakten Form konnte ihn ein Hirte leichter tragen. Deshalb klingt er heller als das tiefe Alphorn. (S. 3)"
- Never leave the field empty or write "see text" placeholders.

## Correct-answer order (script-enforced — do not skip)

- Sample the correct position randomly per question (mentally shuffle after drafting).
- Over the quiz: no single position correct in more than half of the questions, and never the same position correct 3+ times in a row.
- Also vary which option the misconception sits in; the correct option must be neither systematically the shortest nor the longest.

## Validation

Run the bundled checker (stdlib Python, no dependencies):

```bash
python3 scripts/validate_quiz_csv.py <file>.csv --strict
```

It verifies the header, four non-empty answers, single in-range `correct`, duplicate/banned option patterns, explanation coverage and length, and the position statistics above. Fix all errors and warnings, re-run, and only then deliver.
