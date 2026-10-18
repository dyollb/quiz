# Quiz PWA

A Kahoot-style, single-player quiz PWA. Import questions from CSV (your format or Kahoot exports) or share `.quiz` files into the app, play timed (Kahoot-style scoring) or untimed (school-test practice) rounds, and keep a local history of your results.

## Quick start (this Mac)

```bash
npm install
npm run dev        # https://<mac-name>.local:5173 once certs exist (see below)
```

### LAN HTTPS with mkcert (needed for install + share target on other devices)

PWA installs and the Web Share Target require HTTPS. For development we use [mkcert](https://github.com/FiloSottile/mkcert) with the Mac's stable `.local` hostname:

```bash
brew install mkcert
mkcert -install                       # creates + trusts a local root CA on this Mac
scutil --get LocalHostName            # e.g. "lloyd-lptp-2"  -> host is lloyd-lptp-2.local
mkdir -p certs                        # mkcert won't create the folder itself
mkcert -cert-file certs/cert.pem -key-file certs/key.pem \
  localhost 127.0.0.1 "<mac-name>.local"
```

`vite.config.ts` picks up `certs/` automatically and serves HTTPS on the LAN (`host: true`). Without certs, `npm run dev` falls back to plain HTTP on localhost.

### Installing on your phone / Windows machine

`npm run dev` always runs on the **Mac** — the phone just opens the page over Wi-Fi. Nothing is installed or run on the phone except the PWA and the CA certificate.

1. Make sure the dev cert covers your Mac's LAN IP (regenerate if the IP changed):

   ```bash
   mkcert -cert-file certs/cert.pem -key-file certs/key.pem \
     localhost 127.0.0.1 "<mac-name>.local" "$(ipconfig getifaddr en0)"
   ```

2. Run `npm run ca` on the Mac. It prints a plain-HTTP URL (e.g. `http://192.168.1.153:8383`) with step-by-step instructions.
3. Open that URL **on the phone** → tap **Download rootCA.pem** → follow the on-screen Android steps (Settings → search *CA certificate* → *Install a CA certificate* → pick the file). No USB, no file copying needed.
4. On the phone open `https://<mac-ip>:5173` (the IP is printed by `npm run dev`; prefer it over `https://<mac-name>.local:5173`, because Android often cannot resolve `.local` mDNS hostnames).
5. Chrome → ⋮ → *Add to Home screen* / *Install app*. The app now appears in the Android share sheet, so you can **Share a `.quiz`/`.csv` file from WhatsApp/Files → QuizTime**.

> If the browser says *"This app cannot be installed"*, the CA is not installed/trusted yet, or you opened an `http://` (non-HTTPS) URL — both HTTPS and a trusted cert are required.

**Windows alternative**: copy `"$(mkcert -CAROOT)/rootCA.p12"` (empty password) → double-click → install into *Trusted Root Certification Authorities*.

### Running the app when the Mac is offline

Once properly installed, the app **does** run autonomously on the phone — the quizzes, scores, and images all live in the phone's IndexedDB, and the service worker precaches the entire app shell (verified: full production build loads with the server unreachable). Two caveats about *how* it's installed:

- **The dev server cannot serve offline.** `npm run dev` runs the service worker in dev-proxy mode; there is no real precache until you make a production build. Installing from `npm run dev` therefore breaks whenever the Mac is offline.
- **The origin is your Mac.** An install is tied to `https://<mac-ip>:port`. If the Mac sleeps, its DHCP IP changes, or the port changes, the phone may see it as a *different site* and start you a fresh, empty install instead of your app.

**Option A — laptop as server (works today):** on the Mac run `npm run build && npm run preview`, then install on the phone from the printed `Network` HTTPS URL (same CA steps as above). Turning the Mac off afterwards is fine — the installed app keeps working, including your data. To update the app shell later, the Mac must be back online (Share a `.quiz`/`.csv` file to the app also only needs the Mac online for the *first* install/import).

**Option B — free static hosting (recommended):** the app is a pure static SPA with no backend, so hosting it anywhere with real HTTPS removes all of the above: no mkcert CA installs, stable origin across IP changes, and updates over the air. Deploy the `dist/` folder (after `npm run build`) to Netlify or Cloudflare Pages (drag-and-drop works; `public/_redirects` already handles SPA routing). For GitHub Pages project sites, set `base: '/<repo>/'` in `vite.config.ts` and add a `404.html` copy of `index.html`. Then open the hosted URL on the phone once, *Install app*, and it runs offline forever after; your data always stays on the phone.

## Import formats

### CSV — simple format

```csv
question,answer1,answer2,answer3,answer4,correct,explanation
Capital of Switzerland?,Zurich,Bern,Geneva,Basel,2,Bern is the federal city
2 + 2?,3,4,5,6,2,2 + 2 equals 4.
```

`correct` is the 1-based answer index; use `2,4` for multiple correct answers. The `explanation` is shown after every answer (right or wrong) so pupils learn from mistakes too. Optional columns: `time_limit` (seconds), `title`. Kahoot-export CSVs have no explanation column — only the simple format carries explanations.

### CSV — Kahoot export

The standard Kahoot `.csv`/`.xlsx`-export layout (header row containing `Question - 120 max length`, `Time limit`, `Correct answer(s)` columns) is auto-detected; junk rows, the leading index column, and trailing blanks are ignored.

### `.quiz` package

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

## Generating quiz CSVs with ChatGPT / Codex

This repo ships an agent skill at `.agents/skills/quiz-csv-creator/` that turns any teaching text (chapter, PDF, notes) into an import-ready quiz CSV in the simple format above — including the `explanation` shown after each answer. The question-design rules follow learning-science research (retrieval practice, plausible misconception-based distractors, ~80% difficulty, elaborated feedback); the skill enforces its own output contract with a bundled validator.

- **ChatGPT (desktop app):** enable the skill under *Skills*, then pick it with `@quiz-csv-creator` in a chat and attach or paste your source text.
- **Codex (CLI / IDE / desktop):** skills in this repo's `.agents/skills/` are discovered automatically — mention it with `$quiz-csv-creator` or just ask “make a quiz from <file>”.
- **Other projects:** copy or symlink the folder into `~/.agents/skills/quiz-csv-creator/`.

It follows the open [Agent Skills](https://agentskills.io/specification) format. You can check any generated file yourself (stdlib Python, no dependencies):

```bash
python3 .agents/skills/quiz-csv-creator/scripts/validate_quiz_csv.py MyQuiz.csv --strict
```

Import the result on the app's **Import** page. A worked example with explanations: `example/Simple_demo_quiz.csv`.

## Scoring

| Mode | Points |
|---|---|
| Timed | correct = 500 + time bonus up to 500 (`500 * remaining/total`, rounded) |
| Practice (untimed) | correct = 500, no timer |

The mode is chosen per game on the start screen; results are stored per quiz in IndexedDB (best/last score, all runs). Deleting a quiz also removes its history and any images no longer used by other quizzes.

If you leave mid-round (close the tab, switch apps, lose connection), the app saves your progress: the quiz shows **Resume** on the home screen and the start screen offers *Resume* / *Discard & start new*. Resuming keeps your score, mode, and position; the interrupted question simply gets a fresh timer.

## Development

```bash
npm run test            # vitest: CSV parsing, scoring, .quiz round-trip, storage cleanup, resume state
npm run build && npm run preview   # production build (share target needs an installed PWA)
```

### Dev-only quiz builder

`http://localhost:5173/dev/quiz-builder` (dev builds only — it is excluded from production): import a CSV, attach photos to questions by searching **Wikimedia Commons** (free-licensed, attribution kept) or local files, then **Download `.quiz`** or push straight into your library.

## Repository layout

```
src/lib/          schema, CSV importers, .quiz packaging, IndexedDB, scoring, Commons search
src/pages/        Home, Play (start/timer toggle), Results, History, Import, ShareTarget
src/dev/          dev-only quiz builder
src/sw.ts         service worker: offline cache + share-target POST handling
scripts/          icon generation
example/          sample CSVs (Kahoot export + simple format with explanations)
.agents/skills/   quiz-csv-creator — ChatGPT/Codex skill that generates quiz CSVs
```
