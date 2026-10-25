// On-device diagnostics for devices with no tethered console (iPad).
// Open with five quick taps on the app header. Remove at M22 if the harness
// gains a real inspector; nothing here runs unless the panel is opened.

const TAP_COUNT = 5;
const TAP_WINDOW_MS = 700;
const WASM_URLS = [
  '/assets/wasm/ffmpeg-audio.wasm',
  '/assets/wasm/ffmpeg-audio.worker.js',
  '/assets/wasm/ffmpeg-video.wasm',
  '/assets/wasm/ffmpeg-video.worker.js',
];

let tapTimes = [];
let booted = false;
document.addEventListener('boot-complete', () => {
  booted = true;
});

document.getElementById('app-header')?.addEventListener('pointerdown', () => {
  const now = Date.now();
  tapTimes = tapTimes.filter((t) => now - t < TAP_WINDOW_MS);
  tapTimes.push(now);
  if (tapTimes.length >= TAP_COUNT) {
    tapTimes = [];
    togglePanel();
  }
});

function togglePanel() {
  const existing = document.getElementById('diagnostics');
  if (existing) {
    existing.remove();
    return;
  }

  const root = document.createElement('div');
  root.id = 'diagnostics';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Diagnostics');
  root.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:10000', 'overflow:auto',
    'background:#000', 'color:#f1f1f1',
    'font-family:ui-monospace,"SF Mono",Menlo,monospace', 'font-size:13px', 'line-height:1.45',
    'padding:calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 16px)',
  ].join(';');

  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px';

  const title = document.createElement('strong');
  title.textContent = 'Cue diagnostics';
  title.style.cssText = 'flex:1;font-size:15px';

  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;margin:0';
  pre.textContent = 'gathering…';

  const closePanel = () => {
    root.remove();
    document.removeEventListener('keydown', onKey);
  };

  const close = makeButton('Close', closePanel);
  const copy = makeButton('Copy', async () => {
    try {
      await navigator.clipboard.writeText(pre.textContent);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Copy failed';
    }
  });

  const onKey = (e) => {
    if (e.key === 'Escape') closePanel();
  };
  document.addEventListener('keydown', onKey);

  bar.append(title, copy, close);
  addUpdateButton(bar);
  root.append(bar, pre);
  document.body.append(root);
  close.focus();

  snapshot().then((lines) => {
    if (root.isConnected) pre.textContent = lines.join('\n');
  });
}

function makeButton(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText = 'font:inherit;padding:6px 10px;border:1px solid #444;border-radius:8px;background:#1a1a1a;color:#f1f1f1';
  b.addEventListener('click', onClick);
  return b;
}

// M1 has no update toast yet, so expose the same path the toast will use.
// Reuses main.js's sw-apply-update handler instead of duplicating SKIP_WAITING.
async function addUpdateButton(bar) {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg?.waiting) return;
  bar.append(makeButton('Apply update', () => {
    document.dispatchEvent(new CustomEvent('sw-apply-update'));
  }));
}

async function snapshot() {
  const lines = [];
  const add = (key, value) => lines.push(`${key}: ${value}`);

  add('url', location.href);
  add('standalone', matchMedia('(display-mode: standalone)').matches);
  add('navigator.standalone', String(navigator.standalone));
  add('SharedArrayBuffer', typeof SharedArrayBuffer);
  add('crossOriginIsolated', String(globalThis.crossOriginIsolated));
  add('boot-complete', String(booted));

  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100dvh;visibility:hidden';
  document.body.append(probe);
  const dvh = Math.round(probe.getBoundingClientRect().height);
  probe.remove();
  add('innerHeight / visualViewport / 100dvh', `${innerHeight} / ${Math.round(window.visualViewport?.height ?? 0)} / ${dvh}`);
  add('safe-area t r b l', safeAreaInsets());

  await addStorage(add);
  await addServiceWorker(add);
  await addCaches(add);

  add('userAgent', navigator.userAgent);
  return lines;
}

function safeAreaInsets() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const out = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' ');
  probe.remove();
  return out;
}

async function addStorage(add) {
  if (!navigator.storage?.persist) {
    add('storage.persist()', 'unsupported');
    return;
  }
  try {
    add('storage.persist()', String(await navigator.storage.persist()));
  } catch (err) {
    add('storage.persist()', `error: ${err.message}`);
  }
  try {
    add('storage.persisted()', String(await navigator.storage.persisted()));
  } catch (err) {
    add('storage.persisted()', `error: ${err.message}`);
  }
  if (navigator.storage.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      add('storage.usage / quota MB', `${Math.round(usage / 1e6)} / ${Math.round(quota / 1e6)}`);
    } catch (err) {
      add('storage.estimate()', `error: ${err.message}`);
    }
  }
}

async function addServiceWorker(add) {
  if (!('serviceWorker' in navigator)) {
    add('serviceWorker', 'unsupported');
    return;
  }
  add('sw.controller', navigator.serviceWorker.controller?.scriptURL ?? 'none');
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    add('sw.scope', reg?.scope ?? 'none');
    add('sw.active', reg?.active?.state ?? 'none');
    add('sw.waiting', reg?.waiting ? 'yes' : 'no');
  } catch (err) {
    add('sw.registration', `error: ${err.message}`);
  }
}

// A wrong content-type here means a host fallback served HTML as a converter
// binary; that entry would never be replaced, because the SW skips cached keys.
async function addCaches(add) {
  if (!globalThis.caches) {
    add('caches', 'unsupported');
    return;
  }
  const names = await caches.keys();
  add('cache names', names.join(', ') || 'none');

  for (const name of ['app-shell', 'format-bridge']) {
    if (!names.includes(name)) {
      add(`${name} entries`, 'cache missing');
      continue;
    }
    const cache = await caches.open(name);
    const keys = await cache.keys();
    add(`${name} entries`, String(keys.length));
    if (name !== 'format-bridge') continue;
    for (const url of WASM_URLS) {
      const res = await cache.match(url);
      if (!res) {
        add(`  ${url.split('/').pop()}`, 'absent');
        continue;
      }
      const size = (await res.clone().blob()).size;
      add(`  ${url.split('/').pop()}`, `${size} B, ${res.headers.get('content-type') ?? 'no content-type'}`);
    }
  }
}
