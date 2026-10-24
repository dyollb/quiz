# Development & device setup

Everything that is not day-to-day app usage: how the site is deployed and shipped, installing the PWA on a phone, and the optional LAN HTTPS setup for on-device testing of unreleased code.

## Quick start

```bash
npm install
npm run dev        # HTTPS on the LAN once certs exist (see below), plain HTTP on localhost otherwise
```

## Deployments & ship flow

The site lives at <https://dyollb.github.io/quiz/>, published by GitHub Actions (`.github/workflows/deploy.yml`) whenever `main` changes. `main` is protected: direct pushes are rejected; changes arrive via PR and CI (`npm run test` + production build) must be green.

Ship from a feature branch:

```bash
git checkout -b my-change
# ... edit, commit ...
./scripts/ship.sh
```

`ship.sh` pushes the branch, opens a PR, and arms auto-merge — GitHub squash-merges once checks pass and Pages redeploys. Installed PWAs pick the new version up in the background; the URL never changes.

Subpath hosting (`/quiz/`) is wired up automatically: `vite.config.ts` derives Vite's `base` from Actions' `GITHUB_REPOSITORY`, the router uses it as its basename, and `scripts/pages-404.mjs` adds the `404.html` copy that lets GitHub Pages serve SPA deep links. Local dev/build runs at `/` as before.

The repo is public — keep personal quiz material out of it. (Your actual quizzes live in on-device IndexedDB and are never published.)

## Installing on your phone

Open <https://dyollb.github.io/quiz/> → browser menu → **Add to Home screen / Install app**. Done — no certificate setup. The installed app runs offline (app shell precached, data in IndexedDB) and appears in the OS share sheet, so you can **share a `.quiz`/`.csv` file from Files/WhatsApp → QuizTime**.

To test *unmerged* changes on a phone, use the optional LAN setup below.

## Optional: LAN HTTPS with mkcert (on-device dev testing)

Only needed to preview unreleased changes on a real device before merging — the hosted site needs none of this. PWA installs and the Web Share Target require HTTPS, so a LAN dev-server install must trust a certificate. We use [mkcert](https://github.com/FiloSottile/mkcert) with the dev machine's stable `.local` hostname:

```bash
brew install mkcert
mkcert -install                       # creates + trusts a local root CA on this machine
scutil --get LocalHostName            # e.g. "lloyd-lptp"  -> host is lloyd-lptp.local (macOS)
mkdir -p certs                        # mkcert won't create the folder itself
mkcert -cert-file certs/cert.pem -key-file certs/key.pem \
  localhost 127.0.0.1 "<host>.local"
```

`vite.config.ts` picks up `certs/` automatically and serves HTTPS on the LAN (`host: true`). Without certs, `npm run dev` falls back to plain HTTP on localhost.

## Installing a LAN dev build on your phone

For the normal install path (hosted site, no CA), see above. For an *unmerged* dev build: `npm run dev` always runs on the **dev machine** — the phone just opens the page over Wi-Fi. Nothing is installed on the phone except the PWA and the mkcert CA certificate.

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

The hosted install (<https://dyollb.github.io/quiz/>) is unaffected by the dev machine — install from there and it runs offline forever after; that is the recommended path. If instead you installed from a LAN dev server, note:

- **The dev server cannot serve offline.** `npm run dev` runs the service worker in dev-proxy mode; there is no real precache until you make a production build. Installing from `npm run dev` therefore breaks whenever the dev machine is offline.
- **The origin is the dev machine.** An install is tied to `https://<lan-ip>:port`. If the machine sleeps, its DHCP IP changes, or the port changes, the phone may see it as a *different site* and start you a fresh, empty install instead of your app.

In a pinch: on the dev machine run `npm run build && npm run preview` and install from the printed `Network` HTTPS URL (same CA steps as above) — a real production build with a real precache.

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
scripts/          icon generation, LAN CA helper (npm run ca), ship.sh (PR + auto-merge), pages-404 (deploy step)
example/          sample CSVs (Kahoot export + simple format with explanations)
docs/             reference docs (this folder)
.agents/skills/   quiz-csv-creator — ChatGPT/Codex skill that generates quiz CSVs
```
