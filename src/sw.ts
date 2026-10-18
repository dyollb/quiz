/// <reference lib="webworker" />
/* eslint-env serviceworker */
import { skipWaiting, clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { stageFile } from './lib/db'

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0]
}

skipWaiting()
clientsClaim()

// Offline app shell (hashed assets precached at build time).
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// SPA navigation fallback to the precached index.html.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/share-target/], // let our fetch handler deal with these
  }),
)

/**
 * Web Share Target (installed PWA on Chrome/Edge desktop + Android):
 * the OS share sheet POSTs multipart/form-data to /share-target. We cannot
 * pass File objects to a page directly, so stash each file in IndexedDB
 * (`staged` store) and open the app on /share-target?file=<key>.
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.pathname !== '/share-target' || event.request.method !== 'POST') return

  event.respondWith(handleShare(event.request))
})

async function handleShare(request: Request): Promise<Response> {
  try {
    const form = await request.formData()
    const entries = form.getAll('files')
    const keys: string[] = []
    for (const entry of entries) {
      if (!(entry instanceof File) || entry.size === 0) continue
      const key = crypto.randomUUID()
      await stageFile(key, entry.name || 'shared-file', entry.type, entry)
      keys.push(key)
    }
    if (!keys.length) {
      return new Response('No file received', { status: 400 })
    }
    const target = `/share-target?file=${encodeURIComponent(keys[0])}`
    // Focus/openWindow can be blocked outside a user gesture — never fail the
    // share for that; the file is already staged and picked up by the app.
    const existing = await self.clients.matchAll({ type: 'window' })
    if (existing.length) {
      try {
        await existing[0].focus()
      } catch {
        /* focus not allowed — the message below still delivers the file */
      }
      existing[0].postMessage({ type: 'shared-file', key: keys[0] })
    } else {
      try {
        await self.clients.openWindow(target)
      } catch (err) {
        console.error('share-target openWindow blocked; app will sweep staged files on next start', err)
      }
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    console.error('share-target failed', err)
    return new Response('Share failed', { status: 500 })
  }
}
