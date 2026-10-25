import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { RangeRequestsPlugin } from 'workbox-range-requests';
import { clientsClaim } from 'workbox-core';

// Take control immediately on first install (no old SW to displace).
// Updates are NOT auto-applied: the page shows an update-available toast
// and sends SKIP_WAITING on user confirmation. See the message handler below.
clientsClaim();
cleanupOutdatedCaches();

// App shell + themes + icons + mediabunny (injected by workbox at build time).
// Install fails if any of these fail to cache — that is intentional.
precacheAndRoute(self.__WB_MANIFEST);

const formatBridgeInFlight = new Set();

// Orphaned ?pending sweep on activate — survives SW death between writes.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open('format-bridge');
    for (const req of await cache.keys()) {
      if (req.url.endsWith('?pending')) await cache.delete(req);
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type === 'PRECACHE_FORMAT_BRIDGE') {
    event.waitUntil(precacheFormatBridge(event.source));
  }
});

async function precacheFormatBridge(client) {
  const cache = await caches.open('format-bridge');
  const assets = [
    '/assets/wasm/ffmpeg-audio.wasm',
    '/assets/wasm/ffmpeg-audio.worker.js',
    '/assets/wasm/ffmpeg-video.wasm',
    '/assets/wasm/ffmpeg-video.worker.js',
  ];
  for (const url of assets) {
    if (await cache.match(url)) {
      client?.postMessage({ type: 'FORMAT_BRIDGE_PROGRESS', url, done: true });
      continue;
    }
    if (formatBridgeInFlight.has(url)) continue; // another client is fetching; skip silently.
    formatBridgeInFlight.add(url);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.blob();
      // Write to a tmp key, then promote. This is belt-and-suspenders, not
      // partial-write protection — await res.blob() materializes the full body
      // before either cache.put runs, so a partial write can't happen. The real
      // window it covers: SW death between the two puts. Failure mode is
      // "orphaned complete blob, swept on next activate, re-downloaded on next
      // PRECACHE_FORMAT_BRIDGE." Wasteful by one fetch, never incorrect.
      // If 20MB retries on flaky cellular ever become a real cost, promote
      // cache.match(url + '?pending') directly on retry instead of re-fetching.
      const tmpKey = url + '?pending';
      await cache.put(tmpKey, new Response(body, { headers: res.headers }));
      await cache.put(url, new Response(body, { headers: res.headers }));
      await cache.delete(tmpKey);
      client?.postMessage({ type: 'FORMAT_BRIDGE_PROGRESS', url, done: true });
    } catch (err) {
      console.warn('[sw] format-bridge precache failed:', url, err);
      client?.postMessage({
        type: 'FORMAT_BRIDGE_PROGRESS', url, done: false, error: String(err),
      });
    } finally {
      formatBridgeInFlight.delete(url);
    }
  }
}

// ---- Runtime routes ----

registerRoute(
  ({ url }) => url.pathname.startsWith('/assets/themes/'),
  new StaleWhileRevalidate({ cacheName: 'themes' })
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/assets/skins/'),
  new StaleWhileRevalidate({ cacheName: 'themes' })
);

// FUTURE-PROOFING — currently unused in this version. See spec §2.5 and §6.12.
// All media playback routes through blob: URLs. Blob URLs never reach the SW;
// the media element decodes them directly. RangeRequestsPlugin therefore never
// fires in this build. This route exists for a possible future synthetic-URL
// scheme (/media/:id served from CacheStorage). If adopted, media-cache becomes
// load-bearing. Not before.
//
// WARNING: RangeRequestsPlugin buffers the entire response in memory. Never
// route MSE video or files larger than ~50MB through this route when it goes live.
registerRoute(
  ({ request, url }) =>
    request.headers.has('range') ||
    /\.(mp4|webm|mp3|m4a|ogg|wav|flac|avi|mkv|mov)$/i.test(url.pathname),
  new CacheFirst({
    cacheName: 'media-cache',
    plugins: [new RangeRequestsPlugin()],
  })
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/assets/wasm/'),
  new CacheFirst({ cacheName: 'format-bridge' })
);

registerRoute(
  ({ request }) => request.mode === 'navigate',
  new CacheFirst({ cacheName: 'app-shell' })
);
