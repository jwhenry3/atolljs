/*
 * coi-sw.js — injects cross-origin isolation headers (COOP + COEP + CORP)
 * into same-origin responses on static hosts that cannot set headers
 * themselves (GitHub Pages), so SharedArrayBuffer-backed demos run there.
 *
 * COEP is `credentialless` under the react-dom-worker mount — its map island
 * hot-loads no-cors OSM tiles that require-corp would block — and
 * `require-corp` everywhere else, mirroring scripts/serve-static.mjs.
 * Browsers without `credentialless` support stay non-isolated; the pages
 * degrade to poll mode or show a notice instead of breaking.
 *
 * Each entry HTML registers './coi-sw.js' via an inline snippet and reloads
 * once after first install so its document becomes controlled — header
 * injection only applies to responses served while controlled.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  // Only same-origin responses get headers injected. Cross-origin
  // subresources (the map island's no-cors OSM tiles) pass straight through —
  // under COEP credentialless they load without credentials anyway, and
  // re-fetching them from the SW would drop that and fail outright.
  // (Also covers the only-if-cached quirk coi-serviceworker guards against.)
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Opaque responses (no-cors cross-origin fetches, e.g. map tiles)
        // can't be rewritten — pass them through unchanged.
        if (response.status === 0) return response;
        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set(
          'Cross-Origin-Embedder-Policy',
          new URL(request.url).pathname.split('/').includes('react-dom-worker')
            ? 'credentialless'
            : 'require-corp',
        );
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })
      .catch(() => Response.error()),
  );
});
