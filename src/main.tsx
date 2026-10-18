import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { importFile } from './lib/intake'
import './styles.css'

interface LaunchParamsLike {
  files?: FileSystemFileHandle[]
  params?: URLSearchParams
  targetURL?: string
}
interface LaunchQueueLike {
  setConsumer(consumer: (params: LaunchParamsLike) => void | Promise<void>): void
}

// PWA service worker (share target + offline). Auto-updates.
registerSW({ immediate: true })

// Desktop Chrome/Edge "file_handlers": double-clicking a .quiz opens the app here.
if ('launchQueue' in window && 'LaunchParams' in window) {
  const launchQueue = (window as unknown as { launchQueue: LaunchQueueLike }).launchQueue
  launchQueue.setConsumer(async (params) => {
    for (const handle of params.files ?? []) {
      try {
        const file = await handle.getFile()
        await importFile(file, { titleHint: handle.name })
        // Let the app pick it up via a storage event + small delay for router mount.
        window.dispatchEvent(
          new CustomEvent('quiz-imported', { detail: { name: handle.name } }),
        )
      } catch (err) {
        console.error('file handler import failed', err)
        window.dispatchEvent(
          new CustomEvent('quiz-import-error', {
            detail: { message: String(err instanceof Error ? err.message : err) },
          }),
        )
      }
    }
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
