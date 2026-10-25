# Milestone 1 — App Shell

Legend: `[x]` verified locally from the built artifact · `[ ]` requires a device or deploy, run by the human.

## Deliverables

- [x] `package.json` with vite@^5, workbox-cli@^7, workbox-precaching@^7, workbox-routing@^7, workbox-strategies@^7, workbox-range-requests@^7, workbox-core@^7, postcss@^8, vitest@^1. `package-lock.json` committed.
- [x] `vite.config.js` — `root: 'src'`, `publicDir: '../public'`, `build.outDir: '../dist'`, `emptyOutDir`.
- [x] `workbox-config.js` — glob patterns, globIgnores, 5MB cap. `swSrc` points at `.build/sw.js` (pre-bundled); see Deviation 1.
- [x] `package.json` build script — `vite build` → esbuild SW bundle → `workbox injectManifest`. See Deviation 1.
- [x] `public/_headers` — COOP/COEP/CORP, cache policy, WASM immutable rule before `/assets/*`.
- [x] `public/manifest.json` — name/short_name `Cue`, `id`/`start_url`/`scope` `/`, `display: standalone`, `orientation: any`, `#0f0f0f`, 4 icons. No `display_override`.
- [x] `public/assets/icons/` — `icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon-180.png`. All 8-bit RGB, opaque, valid PNG; no alpha (iOS/Android render transparency inconsistently).
- [x] `public/assets/silent.mp3` — 0.5 s, 44.1 kHz mono, `volumedetect` mean/max −91.0 dB (digital silence). Ear check still worth doing.
- [x] `src/index.html` — `viewport-fit=cover`, `<title>Cue</title>`, `apple-mobile-web-app-title=Cue`, `status-bar-style=black-translucent`, `theme-color=#0f0f0f`, manifest + apple-touch-icon links.
- [x] `src/css/base.css` — all 23 §8.4 variables present, `100dvh`, `env(safe-area-inset-*)` padding, reduced-motion guard, accent focus ring.
- [x] `src/main.js` — matches Part 2. No top-level `await`.
- [x] `src/sw.js` — matches Part 2: `clientsClaim()` at top level, no top-level `skipWaiting()`, message handlers for `SKIP_WAITING` and `PRECACHE_FORMAT_BRIDGE`, media route marked unused.
- [x] `dist/` builds via `npm run build` (exit 0).
- [x] manifest name/short_name, `<title>`, and `apple-mobile-web-app-title` all read `Cue` in the built artifact. Home Screen icon label still needs device confirmation.

## Verification on real iOS 26.x device (installed PWA)

- [ ] Launch installed PWA. No browser chrome.
- [ ] `console.log(typeof SharedArrayBuffer)` from tethered Web Inspector returns `'function'`.
- [ ] `navigator.storage.persist()` result recorded (actual value).
- [ ] No Cross-Origin-Embedder-Policy warnings from sub-resources.
- [ ] `100dvh` on body — no scroll bar, no gap under status bar, no overlap with home indicator.
- [ ] Airplane mode on. Relaunch. Shell renders.
- [ ] Cache Storage: `app-shell` populated; `format-bridge` empty on first install.
- [ ] ~~Airplane mode off, poll 60 s: 4 files in `format-bridge`.~~ **Blocked by design — see Deviation 5.** Cannot pass until M15 ships the WASM binaries.
- [ ] Background → foreground: no new network requests to `/assets/wasm/*`. (Only meaningful after Deviation 5 clears.)

## Verification on macOS Safari 26.x

- [ ] Deployed URL renders.
- [ ] Service worker active and controlling.
- [ ] Cache Storage contains expected `app-shell` entries.
- [ ] Response headers on `/`: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: same-origin`.
- [ ] `typeof SharedArrayBuffer === 'function'`.

## SW update flow test

- [ ] Deploy version A, install, wait for format-bridge.
- [ ] Deploy version B with changed bytes in a precached file.
- [ ] Reload: `sw-update-available` fires; old app keeps working.
- [ ] Update → `SKIP_WAITING` → `controllerchange` → reload → version B active.

## Local evidence (this machine)

- `npm run build` exit 0; 9 precache URLs, 23.6 kB.
- `dist/sw.js`: 99,104 B, IIFE, zero bare `import`, no `__WB_MANIFEST` placeholder. Node `--check` clean.
- VM smoke test of built SW: `install/activate/fetch/message` listeners registered; `PRECACHE_FORMAT_BRIDGE` writes exactly 4 assets, leaves no `?pending` key, re-run hits cache 4×; `SKIP_WAITING` calls `self.skipWaiting()` inside `waitUntil`.
- `vite preview` returns 200 for `/`, `/sw.js`, `/manifest.json`, `/_headers`, `silent.mp3`, `icon-192.png`; `/sw.js` served `Cache-Control: no-cache`.
- No `console.log` in `src/`.

## Deviations from spec

1. **SW bundling (required for a working milestone).** `workbox injectManifest` only injects the precache manifest — it does not bundle, and `nodeResolve` was not applied. The specified script left bare `import ... from 'workbox-precaching'` in `dist/sw.js`, which a classic service worker rejects at registration (`SyntaxError`). Fix: `esbuild src/sw.js --bundle --format=iife` into `.build/sw.js` before injection, and `swSrc: '.build/sw.js'`. `src/sw.js` is untouched. `esbuild@^0.21.5` added explicitly (already a Vite transitive dep). Revert if the handoff's tooling is corrected upstream.
2. Icons are full-bleed squares, not pre-rounded: the OS applies its own mask (iOS squircle, Android maskable). Rounding inside the PNG double-rounds on both.
3. `src/index.html` contains ~5 lines of static shell markup (`cue` header + empty main) so safe-area and `100dvh` are observable before Milestone 3.
4. `vite build` prints a Vite CJS-Node-API deprecation warning. Benign; caused by `workbox-config.js` requiring CJS, so `"type": "module"` cannot be set.
5. **`public/404.html` added (deployment correctness).** Cloudflare Pages treats a project with no top-level `404.html` as an SPA and answers every unmatched path with `/` and status 200. Verified live: `/assets/wasm/ffmpeg-audio.wasm` returned 969 bytes of `text/html`. `precacheFormatBridge()` checks only `res.ok`, so it would have cached that HTML under the WASM key and, because it skips existing keys, never replaced it at M15. A top-level 404 makes Pages return a real 404 for missing files. Do not add `_redirects` SPA fallback for the same reason.
6. **`format-bridge` cannot populate in Milestone 1.** The checklist asks to poll until the 4 WASM files appear, but `public/assets/wasm/*` are Milestone 15–16 deliverables and are intentionally absent. Stub binaries were rejected: `precacheFormatBridge()` skips keys that already exist, so a placeholder would be cached once and never replaced by the real module. The write path itself is verified in the VM test above (4 assets, no `?pending`, idempotent re-run). Until M15, each visibility change retries 4 fetches that 404 and logs `format-bridge precache failed` — no app-shell impact.

## Explicit non-goals (untouched)

Views, session manager, player broker, media elements, theme picker, theme swap logic, FFmpeg, mediabunny, `classify()`, `scripts/lint-themes.mjs`.
