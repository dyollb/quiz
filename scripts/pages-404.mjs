// GitHub Pages serves the contents of 404.html *at the requested URL* (the
// URL is not rewritten), so a copy of the SPA index.html lets react-router
// boot on deep links like /<repo>/history after refresh or direct entry.
// Run after `npm run build` (see .github/workflows/deploy.yml).
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dist = resolve(import.meta.dirname, '..', 'dist')
copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'))
console.log('Wrote dist/404.html (SPA deep-link fallback for GitHub Pages)')
