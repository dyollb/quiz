# Development & device setup

Everything that is not day-to-day app usage: serving over LAN HTTPS for development, installing the PWA on a phone, and running/testing it offline.

## Quick start

```bash
npm install
npm run dev        # HTTPS on the LAN once certs exist (see below), plain HTTP on localhost otherwise
```

## LAN HTTPS with mkcert

PWA installs and the Web Share Target require HTTPS. For development we use [mkcert](https://github.com/FiloSottile/mkcert) with the dev machine's stable `.local` hostname:

```bash
brew install mkcert
mkcert -install                       # creates + trusts a local root CA on this machine
scutil --get LocalHostName            # e.g. "lloyd-lptp"  -> host is lloyd-lptp.local (macOS)
mkdir -p certs                        # mkcert won't create the folder itself
mkcert -cert-file certs/cert.pem -key-file certs/key.pem \
  localhost 127.0.0.1 "<host>.local"
```

`vite.config.ts` picks up `certs/` automatically and serves HTTPS on the LAN (`host: true`). Without certs, `npm run dev` falls back to plain HTTP on localhost.

## Installing on your phone / another computer

`npm run dev` always runs on the **dev machine** — the phone just opens the page over Wi-Fi. Nothing is installed or run on the phone except the PWA and the CA certificate.

1. Make sure the dev cert covers the machine's LAN IP (regenerate if the IP changed):

   ```bash
   mkcert -cert-file certs/cert.pem -key-file certs/key.pem \
     localhost 127.0.0.1 "<host>.local" "$(ipconfig getifaddr en0)"   # macOS; use your interface name
   ```

2. Run `npm run ca` on the dev machine. It prints a plain-HTTP URL (e.g. `http://192.168.1.153:8383`) with step-by-step instructions.
3. Open that URL **on the phone** → tap **Download rootCA.pem** → follow the on-screen Android steps (Settings → search *CA certificate* → *Install a CA certificate* → pick the file). No USB, no file copying needed.
4. On the phone open `https://<lan-ip>:5173` (the IP is printed by `npm run dev`; prefer it over `https://<host>.local:5173`, because Android often cannot resolve `.local` mDNS hostnames).
5. Chrome → ⋮ → *Add to Home screen* / *Install app*. The app now appears in the Android share sheet, so you can **Share a `.quiz`/`.csv` file from WhatsApp/Files → QuizTime**.

> If the browser says *"This app cannot be installed"*, the CA is not installed/trusted yet, or you opened an `http://` (non-HTTPS) URL — both HTTPS and a trusted cert are required.

**Windows alternative for the CA**: copy `"$(mkcert -CAROOT)/rootCA.p12"` (empty password) to the Windows machine → double-click → install into *Trusted Root Certification Authorities*.

## Running the app when the dev machine is offline

Once properly installed, the app **does** run autonomously on the phone — the quizzes, scores, and images all live in the phone's IndexedDB, and the service worker precaches the entire app shell (verified: full production build loads with the server unreachable). Two caveats about *how* it's installed:

- **The dev server cannot serve offline.** `npm run dev` runs the service worker in dev-proxy mode; there is no real precache until you make a production build. Installing from `npm run dev` therefore breaks whenever the dev machine is offline.
- **The origin is the dev machine.** An install is tied to `https://<lan-ip>:port`. If the machine sleeps, its DHCP IP changes, or the port changes, the phone may see it as a *different site* and start you a fresh, empty install instead of your app.

**Option A — laptop as server (works today):** on the dev machine run `npm run build && npm run preview`, then install on the phone from the printed `Network` HTTPS URL (same CA steps as above). Turning the machine off afterwards is fine — the installed app keeps working, including your data. To update the app shell later, the machine must be back online (sharing a `.quiz`/`.csv` file to the app also only needs the machine online for the *first* install/import).

**Option B — free static hosting (recommended):** the app is a pure static SPA with no backend, so hosting it anywhere with real HTTPS removes all of the above: no mkcert CA installs, stable origin across IP changes, and updates over the air. Deploy the `dist/` folder (after `npm run build`) to Netlify or Cloudflare Pages (drag-and-drop works; `public/_redirects` already handles SPA routing). For GitHub Pages project sites, set `base: '/<repo>/'` in `vite.config.ts` and add a `404.html` copy of `index.html`. Then open the hosted URL on the phone once, *Install app*, and it runs offline forever after; your data always stays on the phone.

## Tests & production build

```bash
npm run test                        # vitest: CSV parsing, scoring, .quiz round-trip, storage cleanup, resume state
npm run build && npm run preview    # production build (share target needs an installed PWA)
```

## Dev-only quiz builder

`http://localhost:5173/dev/quiz-builder` (dev builds only — it is excluded from production): import a CSV, attach photos to questions by searching **Wikimedia Commons** (free-licensed, attribution kept) or local files, then **Download `.quiz`** or push straight into your library.

## Repository layout

```
src/lib/          schema, CSV importers, .quiz packaging, IndexedDB, scoring, Commons search
src/pages/        Home, Play (start/timer toggle), Results, History, Import, ShareTarget
src/dev/          dev-only quiz builder
src/sw.ts         service worker: offline cache + share-target POST handling
scripts/          icon generation, LAN CA helper (npm run ca)
example/          sample CSVs (Kahoot export + simple format with explanations)
docs/             reference docs (this folder)
.agents/skills/   quiz-csv-creator — ChatGPT/Codex skill that generates quiz CSVs
```
