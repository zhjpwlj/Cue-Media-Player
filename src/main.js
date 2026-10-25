// src/main.js
import PlayerBroker from './core/player-broker.js';
import FileHandler from './core/file-handler.js';
import Toasts from './ui/toasts.js';
import VideosView from './views/videos-view.js';

const bootPromise = boot();
bootPromise.then(() => {
  document.dispatchEvent(new CustomEvent('boot-complete'));
});

// Views mount immediately; boot() runs independently (SW, storage, updates).
new VideosView({
  broker: new PlayerBroker(),
  fileHandler: new FileHandler(),
  toasts: new Toasts(),
}).mount(document.querySelector('.app-main'));

async function boot() {
  const reg = await registerServiceWorker();
  await requestPersistentStorage();
  if (reg) {
    triggerFormatBridgePrecache(reg); // fire-and-forget — does not block boot-complete
    installUpdateListener(reg);
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.warn('[boot] SW registration failed:', err);
    return null;
  }
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return;
  try {
    const granted = await navigator.storage.persist();
    console.info('[boot] persistent storage:', granted);
  } catch (err) {
    console.info('[boot] persistent storage request failed:', err);
  }
}

// Sends a PRECACHE_FORMAT_BRIDGE message to the active SW.
// Returns once the message is sent — the actual download happens in the SW.
// Page retries on visibilitychange → visible until all 4 files are cached.
async function triggerFormatBridgePrecache(reg) {
  // Offline, these fetches hard-fail and iOS raises "Turn Off Airplane Mode".
  if (!navigator.onLine) return;
  const ready = await navigator.serviceWorker.ready;
  const active = ready.active;
  if (!active) return;

  const required = [
    '/assets/wasm/ffmpeg-audio.wasm',
    '/assets/wasm/ffmpeg-audio.worker.js',
    '/assets/wasm/ffmpeg-video.wasm',
    '/assets/wasm/ffmpeg-video.worker.js',
  ];

  const cache = await caches.open('format-bridge');
  const present = await Promise.all(required.map((u) => cache.match(u)));
  if (present.every(Boolean)) return;

  const trigger = () => active.postMessage({ type: 'PRECACHE_FORMAT_BRIDGE' });
  trigger();

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (!navigator.onLine) return;
    const fresh = await Promise.all(required.map((u) => cache.match(u)));
    if (fresh.every(Boolean)) return;
    trigger();
  });
}

// Update flow: page shows a toast when a new SW is waiting; user confirms → SKIP_WAITING.
function installUpdateListener(reg) {
  const notify = () => {
    if (reg.waiting) {
      document.dispatchEvent(new CustomEvent('sw-update-available'));
    }
  };
  reg.addEventListener('updatefound', () => {
    const incoming = reg.installing;
    incoming?.addEventListener('statechange', () => {
      if (incoming.state === 'installed') notify();
    });
  });
  notify();

  document.addEventListener('sw-apply-update', () => {
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  });
}
