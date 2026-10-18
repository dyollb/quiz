# Quiz file formats

Reference for the files the app can import. The README only lists the basics; everything the importers accept is documented here.

## CSV — simple format

```csv
question,answer1,answer2,answer3,answer4,correct,explanation
Capital of Switzerland?,Zurich,Bern,Geneva,Basel,2,Bern is the federal city
2 + 2?,3,4,5,6,2,2 + 2 equals 4.
```

- `correct` is the 1-based answer index; use `2,4` for multiple correct answers.
- `explanation` is shown after every answer (right or wrong) so pupils learn from mistakes too.
- Optional extra columns: `time_limit` (seconds per question) and `title` (quiz title, put it on the first data row only).
- Kahoot-export CSVs have no explanation column — only the simple format carries explanations.

A worked example with explanations: [`example/Simple_demo_quiz.csv`](../example/Simple_demo_quiz.csv). To *generate* quizzes in this format from teaching material, see the [`quiz-csv-creator` skill](../.agents/skills/quiz-csv-creator/SKILL.md).

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
    }
  ]
}
```

Images carry `alt` text and a `credit` line (kept from Wikimedia Commons when added via the dev quiz builder).
