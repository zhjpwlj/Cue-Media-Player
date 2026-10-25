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
- [ ] Open the diagnostics panel (five quick taps on the `cue` header). `SharedArrayBuffer: function`.
- [ ] Panel `storage.persist()` / `storage.persisted()` values recorded (actual values, not "logged").
- [ ] No Cross-Origin-Embedder-Policy warnings. (Panel `crossOriginIsolated: true`; no tethered console available.)
- [ ] `innerHeight / visualViewport / 100dvh` agree; `safe-area` insets non-zero on a notched device; no scroll bar, no gap under status bar, no home-indicator overlap.
- [ ] Airplane mode on. Relaunch. Shell renders.
- [ ] Panel: `app-shell entries: 10`, `format-bridge entries: 0` on first install.
- [ ] ~~Airplane mode off, poll 60 s: 4 files in `format-bridge`.~~ **Blocked by design — see Deviation 6.** Cannot pass until M15 ships the WASM binaries.
- [ ] Background → foreground: no new network requests to `/assets/wasm/*`. (Only meaningful after Deviation 6 clears.)

## Verification on macOS Safari 26.x

- [x] Deployed URL renders. (curl 200, `<title>Cue</title>`)
- [ ] Service worker active and controlling.
- [ ] Cache Storage contains expected `app-shell` entries.
- [x] Response headers on `/`: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: same-origin`. (curl-verified)
- [ ] `typeof SharedArrayBuffer === 'function'`.

## SW update flow test

- [ ] Deploy version A, install, wait for format-bridge.
- [ ] Deploy version B with changed bytes in a precached file.
- [ ] Reopen the app; `sw.waiting: yes` in the diagnostics panel. Old app keeps working.
- [ ] Tap **Apply update** in the panel (`SKIP_WAITING` → `controllerchange` → reload) → version B active.

## Live deployment — https://cue-media-player.pages.dev (Cloudflare Pages, 2026-10-25)

- `/` → 200, `text/html`, `<title>Cue</title>`; `cross-origin-opener-policy: same-origin`, `cross-origin-embedder-policy: require-corp`, `cross-origin-resource-policy: same-origin`, `cache-control: no-cache`.
- `/sw.js` → 200 `application/javascript`, `cache-control: no-cache`; injected manifest now 10 URLs including `404.html`.
- `/manifest.json` → 200 `application/json`, `cache-control: no-cache`.
- Icons + `silent.mp3` → 200, correct content types, `cache-control: public, max-age=31536000, immutable`.
- `/nope` → 404 with the custom page. `/_headers` → 404 (not served). `/assets/wasm/ffmpeg-audio.wasm` → 404 `text/html` 815 B, i.e. the SPA fallback is off and `precacheFormatBridge()` will now fail cleanly instead of caching HTML.
- `access-control-allow-origin: *` is added by Pages itself; harmless because every resource is same-origin with `cross-origin-resource-policy: same-origin`.

## Local evidence (this machine)

- `npm run build` exit 0; 9 precache URLs, 23.6 kB.
- `dist/sw.js`: 99,104 B, IIFE, zero bare `import`, no `__WB_MANIFEST` placeholder. Node `--check` clean.
- VM smoke test of built SW: `install/activate/fetch/message` listeners registered; `PRECACHE_FORMAT_BRIDGE` writes exactly 4 assets, leaves no `?pending` key, re-run hits cache 4×; `SKIP_WAITING` calls `self.skipWaiting()` inside `waitUntil`.
- `vite preview` returns 200 for `/`, `/sw.js`, `/manifest.json`, `/_headers`, `silent.mp3`, `icon-192.png`; `/sw.js` served `Cache-Control: no-cache`.
- No `console.log` in `src/`.
- `npm test` → 2/2 pass (`node --test`): converter-URL drift guard, `public/404.html` presence guard.
- `src/diagnostics.js` is bundled into the built JS and executes after DOM parse (module scripts are deferred).

## Deviations from spec

1. **SW bundling (required for a working milestone).** `workbox injectManifest` only injects the precache manifest — it does not bundle, and `nodeResolve` was not applied. The specified script left bare `import ... from 'workbox-precaching'` in `dist/sw.js`, which a classic service worker rejects at registration (`SyntaxError`). Fix: `esbuild src/sw.js --bundle --format=iife` into `.build/sw.js` before injection, and `swSrc: '.build/sw.js'`. `src/sw.js` is untouched. `esbuild@^0.21.5` added explicitly (already a Vite transitive dep). Revert if the handoff's tooling is corrected upstream.
2. Icons are full-bleed squares, not pre-rounded: the OS applies its own mask (iOS squircle, Android maskable). Rounding inside the PNG double-rounds on both.
3. `src/index.html` contains ~5 lines of static shell markup (`cue` header + empty main) so safe-area and `100dvh` are observable before Milestone 3.
4. `vite build` prints a Vite CJS-Node-API deprecation warning. Benign; caused by `workbox-config.js` requiring CJS, so `"type": "module"` cannot be set.
5. **`public/404.html` added (deployment correctness).** Cloudflare Pages treats a project with no top-level `404.html` as an SPA and answers every unmatched path with `/` and status 200. Verified live: `/assets/wasm/ffmpeg-audio.wasm` returned 969 bytes of `text/html`. `precacheFormatBridge()` checks only `res.ok`, so it would have cached that HTML under the WASM key and, because it skips existing keys, never replaced it at M15. A top-level 404 makes Pages return a real 404 for missing files. Do not add `_redirects` SPA fallback for the same reason.
6. **`format-bridge` cannot populate in Milestone 1.** The checklist asks to poll until the 4 WASM files appear, but `public/assets/wasm/*` are Milestone 15–16 deliverables and are intentionally absent. Stub binaries were rejected: `precacheFormatBridge()` skips keys that already exist, so a placeholder would be cached once and never replaced by the real module. The write path itself is verified in the VM test above (4 assets, no `?pending`, idempotent re-run). Until M15, each visibility change retries 4 fetches that 404 and logs `format-bridge precache failed` — no app-shell impact.
7. **On-device diagnostics panel (`src/diagnostics.js`).** No tethered Mac, so the M1 values would otherwise be unreadable on iPad. Five quick taps on the header opens a panel printing `SharedArrayBuffer`, `crossOriginIsolated`, `persist()`/`persisted()`, storage estimate, SW controller/scope/state/waiting, cache entry counts, each converter asset's cached byte size and content-type, `innerHeight`/`visualViewport`/`100dvh`, safe-area insets, and UA. It also exposes an **Apply update** button that dispatches the same `sw-apply-update` event the future toast will use. Deviation: production code, ~200 lines, always loaded (a gesture gates it). Remove at M22 or keep as the permanent fallback.
8. **`npm test` uses `node --test`, not vitest.** Two invariants guard the bugs found during M1: the diagnostics panel must inspect the same four converter URLs as the SW, and `public/404.html` must exist. `vitest@^1` is still installed per the deliverable but unused this milestone.

## Explicit non-goals (untouched)

Views, session manager, player broker, media elements, theme picker, theme swap logic, FFmpeg, mediabunny, `classify()`, `scripts/lint-themes.mjs`.
