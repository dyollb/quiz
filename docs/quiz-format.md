# Quiz file formats

Reference for the files the app can import. The README only lists the basics; everything the importers accept is documented here.

## CSV — simple format

```csv
question,answer1,answer2,answer3,answer4,correct,explanation
Capital of Switzerland?,Zurich,Bern,Geneva,Basel,2,Bern is the federal city
2 + 2?,3,4,5,6,2,2 + 2 equals 4.
```

- `correct` is the 1-based answer index; several correct answers may be listed (`2,4`).
- `explanation` is shown after every answer (right or wrong) so pupils learn from mistakes too.
- Optional extra columns: `type`, `time_limit` (seconds per question) and `title` (quiz title, put it on the first data row only).
- Kahoot-export CSVs have no explanation or type column — only the simple format carries them.

### Question types (`type` column)

| type | play | `correct` | default time |
|---|---|---|---|
| `single` (default, column may be left empty) | tap one answer — instant | one index, e.g. `2` | 20 s (quiz default) |
| `multi` | tap-toggle options, then **Lock in**; all-or-nothing exact-set match | every correct index, e.g. `"2,4"` (≥2 correct, ≥1 wrong) | 30 s |
| `order` | tap answers into the correct sequence, then **Lock in**; all-or-nothing exact-permutation match | the full tap sequence, e.g. `"3,1,4,2"` — every answer once | 30 s |

For `order`, the answer columns hold the **shuffled display order**; `correct` maps the sequence onto them (first tap = `answer3`, then `answer1`, …). A row whose answers are already listed in the correct order is rejected — it would leak the key. Order questions use 3–4 answers (4 recommended).

Timer resolution: `time_limit` (per question) wins; otherwise the quiz default, but never below the type floor (20 s single / 30 s multi and order).

A row without a `type` column but with **2+ correct indices** (e.g. a Kahoot export whose "Correct answer(s)" is `2,4`) is imported as `multi` — the old "can never be scored" rows now play as select-all-that-apply.

A worked example with explanations: [`example/Simple_demo_quiz.csv`](../example/Simple_demo_quiz.csv); one with all three types: [`example/Mixed_types_demo_quiz.csv`](../example/Mixed_types_demo_quiz.csv). To *generate* quizzes in this format from teaching material, see the [`quiz-csv-creator` skill](../.agents/skills/quiz-csv-creator/SKILL.md).

## CSV — Kahoot export

The standard Kahoot `.csv`/`.xlsx`-export layout (header row containing `Question - 120 max length`, `Time limit`, `Correct answer(s)` columns) is auto-detected; junk rows, the leading index column, and trailing blanks are ignored. Example: [`example/Kahoot_Erdentstehung_Quiz.csv`](../example/Kahoot_Erdentstehung_Quiz.csv).

## `.quiz` package

A zip containing:

```
quiz.json      # the quiz (schema below)
images/<ref>   # optional image files referenced by questions
```

Import a `.quiz` via the in-app **Import** page (file picker or drag-and-drop, works everywhere including iOS), by **sharing** it to the installed PWA (Chrome/Edge desktop + Android), or by **double-clicking** it (desktop Chrome/Edge, via the manifest `file_handlers` entry).

### quiz.json schema

```jsonc
{
  "id": "uuid",
  "title": "Earth & Solar System",
  "createdAt": "2026-10-02T00:00:00.000Z",
  "timer": { "enabled": true, "defaultSeconds": 20 },
  "questions": [
    {
      "id": "uuid",
      "prompt": "Capital of Switzerland?",
      "answers": [
        { "id": "a1", "text": "Zurich", "correct": false },
        { "id": "a2", "text": "Bern",   "correct": true }
      ],
      "timeLimit": 20,
      "explanation": "Bern is the federal city",
      "image": { "ref": "abc.png", "alt": "...", "credit": "CC-BY-SA 4.0: Jane Doe" }
    },
    {
      "id": "uuid",
      "type": "order",
      "correctOrder": [3, 1, 4, 2],
      "prompt": "Put in chronological order?",
      "answers": [
        { "id": "a1", "text": "Second up", "correct": true },
        { "id": "a2", "text": "Fourth up", "correct": true },
        { "id": "a3", "text": "First up",  "correct": true },
        { "id": "a4", "text": "Third up",  "correct": true }
      ]
    }
  ]
}
```

Images carry `alt` text and a `credit` line (kept from Wikimedia Commons when added via the dev quiz builder).

Question types: omit `type` for plain single-choice; `"type": "multi"` marks its correct options with the usual `correct` flags; `"type": "order"` requires `correctOrder` — the tap sequence as 1-based indices into `answers` (all answers carry `correct: true`). A quiz containing multi or order questions is written with `"v": 2`; an app build that doesn't know the type or version refuses the import with an "update the app" error instead of mis-rendering it as plain choice.
