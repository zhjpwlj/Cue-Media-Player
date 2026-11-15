// src/main.ts
// Boot sequence: register the SW, request persistent storage, kick off the
// format-bridge precache (fire-and-forget), install the update listener.
// Views mount immediately; boot() runs independently.

import MediaSessionController from './core/media-session';
import installAutoUpdate from './core/app-update';
import PlayerBroker from './core/player-broker';
import FileHandler from './core/file-handler';
import PlaylistManager from './core/playlist-manager';
import SessionManager from './core/session-manager';
import SettingsModal from './ui/settings-modal';
import Toasts from './ui/toasts';
import VideosView from './views/videos-view';

const bootPromise = boot();
bootPromise.then(() => {
  document.dispatchEvent(new CustomEvent('boot-complete'));
});

const toasts = new Toasts();
document.addEventListener('toast', (e) => {
  toasts.show((e as CustomEvent<{ message: string }>).detail.message);
});

void start();

async function start(): Promise<void> {
  try {
    const sessions = new SessionManager();
    await sessions.init();
    const broker = new PlayerBroker(() => sessions.getActive().fullscreenMode);
    const playlist = new PlaylistManager(sessions, broker);
    const playlistRegistry = new Map<string, PlaylistManager>();
    playlistRegistry.set(sessions.activeSessionId, playlist);
    new MediaSessionController(broker, sessions, playlistRegistry).init();

    new VideosView({
      broker,
      fileHandler: new FileHandler(playlist),
      playlist,
      toasts,
      sessions,
    }).mount(document.querySelector<HTMLElement>('.app-main')!);

    new SettingsModal(
      sessions,
      document.querySelector<HTMLButtonElement>('#btn-settings') ?? undefined,
    ).mount();
  } catch {
    toasts.show('Cue failed to start.');
  }
}

async function boot(): Promise<void> {
  const reg = await registerServiceWorker();
  await requestPersistentStorage();
  if (reg) {
    triggerFormatBridgePrecache(reg); // fire-and-forget — does not block boot-complete
    installUpdateListener(reg);
  }
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      // Never let an HTTP-cached sw.js hide a deployment.
      updateViaCache: 'none',
    });
    // Launch update check. The shell came from precache; this only fetches
    // sw.js, and a changed build activates + reloads (app-update.ts).
    void reg.update().catch(() => undefined);
    return reg;
  } catch (err) {
    console.warn('[boot] SW registration failed:', err);
    return null;
  }
}

async function requestPersistentStorage(): Promise<void> {
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
async function triggerFormatBridgePrecache(reg: ServiceWorkerRegistration): Promise<void> {
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
  ] as const;

  const cache = await caches.open('format-bridge');
  const present = await Promise.all(required.map((u) => cache.match(u)));
  if (present.every(Boolean)) return;

  const trigger = (): void => active.postMessage({ type: 'PRECACHE_FORMAT_BRIDGE' });
  trigger();

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (!navigator.onLine) return;
    const fresh = await Promise.all(required.map((u) => cache.match(u)));
    if (fresh.every(Boolean)) return;
    trigger();
  });
}

// Update flow: the shell starts from precache, a new deployment activates
// silently, and the page reloads once into the newest build. The diagnostics
// panel can force a check without waiting for the next launch.
function installUpdateListener(reg: ServiceWorkerRegistration): void {
  installAutoUpdate(reg, navigator.serviceWorker, () => location.reload());
  document.addEventListener('sw-check-update', () => {
    void reg.update().catch(() => undefined);
  });
}
