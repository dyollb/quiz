import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// LAN HTTPS: mkcert puts certs/ next to this file (see README). Falls back to
// plain HTTP when the cert files are absent so a fresh clone still runs `npm run dev`.
const certsDir = resolve(import.meta.dirname, 'certs')
const keyPath = resolve(certsDir, 'key.pem')
const certPath = resolve(certsDir, 'cert.pem')
const https =
  existsSync(keyPath) && existsSync(certPath)
    ? { key: readFileSync(keyPath), cert: readFileSync(certPath) }
    : undefined

// GitHub Pages serves the site under /<repo>/. In Actions builds the repo name
// comes from GITHUB_REPOSITORY ("owner/repo"); local dev/build stays at "/".
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = repoName ? `/${repoName}/` : '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false, // registered via virtual:pwa-register in main.tsx
      manifest: {
        id: base,
        name: 'QuizTime',
        short_name: 'QuizTime',
        description: 'Kahoot-style single-player quiz practice with CSV/.quiz import.',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#20063b',
        theme_color: '#46178f',
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${base}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Desktop Chrome/Edge only: double-clicking a .quiz file opens the installed app.
        file_handlers: [
          {
            action: base,
            accept: {
              'application/vnd.quiz+zip': ['.quiz'],
              'application/zip': ['.quiz'],
            },
          },
        ],
        // Installed PWA on Chrome/Edge (desktop + Android): appears in the OS share sheet.
        share_target: {
          action: `${base}share-target`,
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              {
                name: 'files',
                accept: [
                  '.quiz',
                  '.csv',
                  '.json',
                  'application/zip',
                  'application/vnd.quiz+zip',
                  'application/octet-stream',
                  'text/csv',
                  'text/plain',
                  'application/json',
                ],
              },
            ],
          },
        },
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      devOptions: {
        enabled: true, // lets you test the SW + share target during `npm run dev`
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    host: true, // expose on the LAN so phones/other machines can reach the dev server
    allowedHosts: true,
    https,
  },
  preview: {
    host: true,
    allowedHosts: true,
    https,
  },
})
