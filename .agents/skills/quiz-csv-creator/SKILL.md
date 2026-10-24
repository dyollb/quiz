---
name: quiz-csv-creator
description: Import-ready quiz CSVs for the Quiz/QuizTime PWA. Use when asked to turn learning material (text, PDF, chapter, notes) into a quiz or test, or to prepare quiz questions for importing into QuizTime.
---

# Quiz CSV Creator

Turn learning material into a quiz that teaches, not just tests. Retrieval practice only hones honest questions: every key unambiguous, every option answered with a short explanation. Rationale and sources: [references/SOURCES.md](references/SOURCES.md).

## Workflow

1. Read the ENTIRE source before writing anything. List the key concepts, facts, and cause-effect chains the pupil should retain (usually 8–20 for a chapter).
2. Write roughly one question per key concept, covering the whole list — a quiz only strengthens what it asks. Mix in multi and order questions where the content fits (see "Choosing a question type").
3. Per question: draft the stem first, then the correct option, then three distractors built from likely misconceptions.
4. Write each explanation with a short reference into the source (see "Explanation rules").
5. Shuffle the answer columns and check the correct-position spread before emitting (see "Correct-answer order").
6. Write the CSV and run the validator with `--strict` (see "Validation"). Fix every error and warning and re-run until it reports OK. Never deliver an unvalidated file.
7. Deliver the CSV plus a 3-line summary: title, question count, concepts covered.

## Output contract (exact)

- One CSV file, UTF-8, RFC 4180 quoting (quote every field containing a comma, quote, or newline).
- Header exactly `question,answer1,answer2,answer3,answer4,correct,type,explanation`; drop the `type` column when every question is single-choice.
- `question` — the stem; under 120 characters so it fits on a phone.
- `answer1`..`answer4` — all four non-empty and mutually exclusive (an order question may leave `answer4` empty to use 3; 4 is better).
- `type` — `single` (default: tap one answer), `multi` (tap every correct answer, then lock in — graded on the exact set, all-or-nothing), `order` (tap all answers in the right sequence, then lock in).
- `correct` — per type: `single` one 1-based index; `multi` two or more 1-based indices, comma-separated and quoted (`"2,4"`), at least two correct and at least one wrong; `order` the full tap sequence with every answer exactly once, quoted (`"3,1,4,2"` = tap answer3, then answer1, answer4, answer2), with the columns listed scrambled.
- `explanation` — every question, shown after answering; rules under "Explanation rules".
- Optional trailing columns: `time_limit` (seconds, 5–120) and `title` (quiz title, first data row only). Omit `time_limit` for multi/order — the app already gives them 30 seconds.
- Filename = short quiz title, e.g. `Erdentstehung.csv`.
- Language: write questions, answers, and explanations in the language of the source material (header row stays English).

## Choosing a question type

A four-option single question is a 25% guess; multi and order push that well under 10%. That is their whole point — use them where the content fits, 2–4 across a quiz, one concept each.

- **`multi` — "select all that apply"**: for a concept with a set of members, traits, or causes ("Which of these are mammals?", "Which actions reduce CO₂?"). 4 options, exactly 2–3 correct, each wrong option a plausible misconception. Grading is the exact set, so ambiguity between two options is fatal and the explanation must justify every option in/out.
- **`order` — "put in sequence"**: for genuinely ordered content — timelines, size/distance comparisons, process steps, cause-effect chains. Use 4 items (24 possible orders; 3 items give away a third of the work). The sequence must be objectively checkable from the source, and the columns listed scrambled.

## Question rules

- Test understanding, not keyword matching: paraphrase the source, so the answer cannot be found by searching for an unusual word from the stem. Prefer stems that apply, compare, explain causes, or use a mini-scenario ("Warum…", "Was wäre wenn…", "Woran erkennt man…").
- Keep every question honest and leak-free, inside and between questions:
  - A pupil who understood the source must see the answer; a pupil who did not must not. If one option is longer or more precise than the rest, or a distinctive stem word reappears only in the key, the question leaks — rewrite it.
  - Knowing one answer must never hand over another's: each testable fact gets asked once, the same set of options never appears in two questions, and comparison items stay clear of facts other items already state. Beware elimination chains — items drawn from one category against the same options ("Zu welcher Gattung gehört X?" five times) answer each other; ask instead about facts no other item touches (how the sound is produced, what a body part is for, what changes the volume).
- Exactly one option is correct and unambiguous — for `multi`, exactly the marked set: no pupil can plausibly argue a distractor in or a key out.
- Build all distractors from real misconceptions (e.g. "im Winter ist die Erde weiter von der Sonne entfernt") or right-sounding half-truths, so each fails only after understanding.
- Keep options parallel: same grammar and register, all grammatical with the stem, similar length (max/min ratio under 3).
- One concept per question. Difficulty: a pupil who read and understood the text should get roughly 80% right — hard means thinking is required, never ambiguity or trickery.
- Guardrails the validator flags: positive stems (write NOT in caps where unavoidable), no "all/none of the above" in any language, no absolutes in options ("always", "never", "immer", "niemals").

## Explanation rules

- Required for every question, including ones most pupils get right: **2–3 full sentences** — the source reference does not count as a sentence, and it supplements the learning content instead of replacing it.
- Say why the correct option is right; spend one clause on any distractor that is a popular misconception — the highest-value sentence for pupils who picked it.
- Add a bit beyond the question (a number, a cause, a consequence), so even pupils who knew the answer learn something.
- End with a short verified reference into the source in parentheses — `(S. 3, Abs. 2)`, `(Fig. 2)`, `(p. 12)` — citing only places you checked actually support the answer.
- Example shape (content, not style): "Der Büchel ist kleiner und mehrfach gebogen, während das Alphorn mehrere Meter lang ist. Wegen seiner kompakten Form konnte ihn ein Hirte leichter tragen. Deshalb klingt er heller als das tiefe Alphorn. (S. 3)"

## Correct-answer order (the validator enforces all of it)

- Single: sample the correct position randomly per question (mentally shuffle after drafting); across the quiz, no position correct in more than half of the questions, no position correct 3+ times in a row, and all four positions used.
- Multi: vary which options are correct — repeated key sets are guessable.
- Order: scramble the columns and vary sequences across questions; answers listed in (or nearly in) their correct order are rejected.
- Vary which option the misconception sits in; keep the correct option neither the shortest nor the longest.

## Validation

```bash
python3 scripts/validate_quiz_csv.py <file>.csv --strict
```

The bundled checker is stdlib Python with no dependencies, and enforces the contract, the type-correct `correct` formats, explanation rules, and the position rules above. Deliver only once it prints `OK`, with every error and warning fixed (workflow step 6).
