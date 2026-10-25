# Milestone 1 — App Shell

Legend: `[x]` verified locally from the built artifact · `[ ]` requires a device or deploy, run by the human.

## Deliverables

- [x] `package.json` with vite@^5, workbox-cli@^7, workbox-precaching@^7, workbox-routing@^7, workbox-strategies@^7, workbox-range-requests@^7, workbox-core@^7, postcss@^8, vitest@^1. `package-lock.json` committed.
- [x] `vite.config.js` — `root: 'src'`, `publicDir: '../public'`, `build.outDir: '../dist'`, `emptyOutDir`.
- [x] `workbox-config.js` — glob patterns, globIgnores, 5MB cap. `swSrc` points at `.build/sw.js` (pre-bundled); see Deviation 1.
- [x] `package.json` build script — `vite build` → esbuild SW bundle → `workbox injectManifest`. See Deviation 1.
- [x] `public/_headers` — COOP/COEP/CORP, cache policy, WASM immutable rule before `/assets/*`.
- [x] `public/manifest.json` — name/short_name `Cue`, `id`/`start_url`/`scope` `/`, `display: standalone`, `orientation: any`, `#0f0f0f`, 4 icons. No `display_override`.
- [x] `public/assets/icons/` — `icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon-180.png`. Amber `#f2b544` play triangle on `#0f0f0f`, full-bleed. All 8-bit RGB, opaque, valid PNG; no alpha (iOS/Android render transparency inconsistently). Center pixel `srgb(242,181,68)` on all four.
- [x] `public/assets/silent.mp3` — 0.5 s, 44.1 kHz mono, `volumedetect` mean/max −91.0 dB (digital silence). Ear check still worth doing.
- [x] `src/index.html` — `viewport-fit=cover`, `<title>Cue</title>`, `apple-mobile-web-app-title=Cue`, `status-bar-style=black-translucent`, `theme-color=#0f0f0f`, manifest + apple-touch-icon links.
- [x] `src/css/base.css` — all 23 §8.4 variables present, `100dvh`, `env(safe-area-inset-*)` padding, reduced-motion guard, accent focus ring.
- [x] `src/main.js` — matches Part 2. No top-level `await`.
- [x] `src/sw.js` — matches Part 2: `clientsClaim()` at top level, no top-level `skipWaiting()`, message handlers for `SKIP_WAITING` and `PRECACHE_FORMAT_BRIDGE`, media route marked unused.
- [x] `dist/` builds via `npm run build` (exit 0).
- [x] manifest name/short_name, `<title>`, and `apple-mobile-web-app-title` all read `Cue` in the built artifact. Home Screen icon label still needs device confirmation.

## Verification on real iOS 26.x device (installed PWA)

- [x] Launch installed PWA. No browser chrome. (`standalone: true`, `navigator.standalone: true`)
- [x] Diagnostics panel opens in the installed app (long press on `cue`). `SharedArrayBuffer: function`.
- [x] Panel `storage.persist(): true` / `storage.persisted(): true` — recorded, not "logged".
- [x] `crossOriginIsolated: true` — COOP/COEP verified on-device; no tethered console needed.
- [x] `innerHeight / visualViewport / 100dvh: 810 / 810 / 810`; `safe-area t r b l: 20px 0px 0px 0px`; no gap under the status bar.
- [x] `scrollHeight / innerHeight: 810 / 810`; no page movement on drag after fixing the root. iOS rubber-band on the document is gone (`body` fixed, `.app-main` owns scrolling).
- [x] Airplane mode on. Relaunch. Shell renders and works. iOS still shows "Turn Off Airplane Mode to Access Data" — that dialog comes from the browser's own `/sw.js` update probe, which a SW cannot serve or a page cancel. Cosmetic; offline behavior passes.
- [ ] Panel reports `10` entries for `workbox-precache-v2-*` and `0` for `format-bridge` on first install. (Value not yet pasted after the icon deploy.)
- [ ] ~~Airplane mode off, poll 60 s: 4 files in `format-bridge`.~~ **Blocked by design — see Deviation 6.** Cannot pass until M15 ships the WASM binaries.
- [ ] Background → foreground: no new network requests to `/assets/wasm/*`. (Only meaningful after Deviation 6 clears.)

Device actually used: **iPadOS/Safari 18.3** per the panel UA (`Version/18.3`), not the spec floor of 26.x. Re-run on 26.x when available.

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
- `npm test` → 3/3 pass (`node --test`): converter-URL drift guard, `public/404.html` presence guard, footer-version guard.
- `src/diagnostics.js` is bundled into the built JS and executes after DOM parse (module scripts are deferred).

## Deviations from spec

1. **SW bundling (required for a working milestone).** `workbox injectManifest` only injects the precache manifest — it does not bundle, and `nodeResolve` was not applied. The specified script left bare `import ... from 'workbox-precaching'` in `dist/sw.js`, which a classic service worker rejects at registration (`SyntaxError`). Fix: `esbuild src/sw.js --bundle --format=iife` into `.build/sw.js` before injection, and `swSrc: '.build/sw.js'`. `src/sw.js` is untouched. `esbuild@^0.21.5` added explicitly (already a Vite transitive dep). Revert if the handoff's tooling is corrected upstream.
2. Icons are full-bleed squares, not pre-rounded: the OS applies its own mask (iOS squircle, Android maskable). Rounding inside the PNG double-rounds on both.
3. `src/index.html` contains ~5 lines of static shell markup (`cue` header + empty main) so safe-area and `100dvh` are observable before Milestone 3.
4. `vite build` prints a Vite CJS-Node-API deprecation warning. Benign; caused by `workbox-config.js` requiring CJS, so `"type": "module"` cannot be set.
5. **`public/404.html` added (deployment correctness).** Cloudflare Pages treats a project with no top-level `404.html` as an SPA and answers every unmatched path with `/` and status 200. Verified live: `/assets/wasm/ffmpeg-audio.wasm` returned 969 bytes of `text/html`. `precacheFormatBridge()` checks only `res.ok`, so it would have cached that HTML under the WASM key and, because it skips existing keys, never replaced it at M15. A top-level 404 makes Pages return a real 404 for missing files. Do not add `_redirects` SPA fallback for the same reason.
6. **`format-bridge` cannot populate in Milestone 1.** The checklist asks to poll until the 4 WASM files appear, but `public/assets/wasm/*` are Milestone 15–16 deliverables and are intentionally absent. Stub binaries were rejected: `precacheFormatBridge()` skips keys that already exist, so a placeholder would be cached once and never replaced by the real module. The write path itself is verified in the VM test above (4 assets, no `?pending`, idempotent re-run). Until M15, each visibility change retries 4 fetches that 404 and logs `format-bridge precache failed` — no app-shell impact.
7. **On-device diagnostics panel (`src/diagnostics.js`).** No tethered Mac, so the M1 values would otherwise be unreadable on iPad. Open with five quick taps or a ~0.9 s long press on the `cue` header (long press is immune to iOS double-tap zoom, which swallowed the first tap-only trigger; the header also gets `touch-action: manipulation`). Panel prints build filename, `SharedArrayBuffer`, `crossOriginIsolated`, `persist()`/`persisted()`, storage estimate, SW controller/scope/state/waiting, cache entry counts, each converter asset's cached byte size and content-type, `innerHeight`/`visualViewport`/`100dvh`, safe-area insets, and UA. It also exposes an **Apply update** button that dispatches the same `sw-apply-update` event the future toast will use. Deviation: production code, ~210 lines, always loaded (a gesture gates it). Remove at M22 or keep as the permanent fallback.
8. **`npm test` uses `node --test`, not vitest.** Two invariants guard the bugs found during M1: the diagnostics panel must inspect the same four converter URLs as the SW, and `public/404.html` must exist. `vitest@^1` is still installed per the deliverable but unused this milestone.
9. **Icon is an amber play triangle, not the red cue dot.** Requested after first deploy. Accent variables moved to `#f2b544` / `#d99a2b` / `#0f0f0f` (dark text on amber), and the 404 link matches. Icons stay full-bleed squares so the OS applies its own mask.
10. **Precache cache name.** The checklist and first panel reported `app-shell`, but `precacheAndRoute` stores under `workbox-precache-v2-<scope>`. The `app-shell` cache only fills when a navigation misses precache (e.g. `/?v=3`). Panel now prints entry counts for every cache, and the check is "10 entries in `workbox-precache-v2-*`".
11. **Safe-area double count fixed.** `body` had `min-height: 100dvh` plus `padding-top: env(...)`, while `.app-shell` also claimed `100dvh`; border-box puts the inset inside the viewport height, so the document was taller by exactly the inset (20 px on iPad) and scrolled. Body is now the flex column; `.app-shell` uses `flex: 1`. Panel prints `scrollHeight / innerHeight` so this is measurable on-device instead of eyeballed.
12. **Root rubber-band scroll.** With `810 / 810` the content already fit; the movement was iOS bouncing the root document. `html, body` now set `height: 100%; overflow: hidden`, `body` is `position: fixed; inset: 0`, and `.app-main` owns scrolling (`overflow-y: auto; overscroll-behavior: contain`). Views added later must scroll inside `.app-main`, not rely on document scroll.
13. **Version label.** `v0.1.0` bottom-right, safe-area aware, `pointer-events: none`. A test pins it to `package.json`; bump both when the version changes.
14. **Converter precache skips offline.** `triggerFormatBridgePrecache()` and its `visibilitychange` retry now return early when `!navigator.onLine`. Without this, the four failing WASM fetches offline raise iOS's "Turn Off Airplane Mode to Access Data" alert while the cached shell keeps working.
15. **The airplane-mode dialog cannot be removed from app code.** Even with the offline guard, iOS raises the same dialog for the browser's periodic `/sw.js` update probe. Service worker scripts bypass the SW itself and are fetched by the browser, so neither the page nor the worker can intercept it. The app still renders and plays from cache; treat the dialog as expected platform noise, not a failure.

## Explicit non-goals (untouched)

Views, session manager, player broker, media elements, theme picker, theme swap logic, FFmpeg, mediabunny, `classify()`, `scripts/lint-themes.mjs`.
