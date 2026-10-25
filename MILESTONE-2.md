# Milestone 2 — File Handling and Single-Track Native Playback

Status: implemented, built, deployed. Awaiting device verification.

Scope: pick one local audio or video file, play it with the platform's native
controls, show track name and elapsed/duration. No folder picker, playlist,
sessions UI, themes, FormatBridge, or custom transport controls — those are
later milestones.

## Delivered

### New modules (one class per module, default export, instances in `main.js`)

- `src/core/file-handler.js` — `mediaKind(file)` plus `FileHandler.openFilePicker()`.
  MIME type first, short extension allowlist second. Uses a transient
  `<input type="file" accept="audio/*,video/*">`; must run from a user gesture.
- `src/core/player-broker.js` — `PlayerBroker`. Owns every media element, one
  session (`main`) for now. `loadTrack`, `play`, `pause`, `seek`, `getState`,
  `getCurrentElement`, `attachTo`. Emits `state-changed`, `track-changed`,
  `time-update`, `playback-started`, `playback-paused`, `playback-error`,
  `track-ended` on `document`.
- `src/views/videos-view.js` — `VideosView`. Toolbar with **Open file**, stage,
  track name, time line, toasts. Mounts into `.app-main`.
- `src/ui/toasts.js` — `Toasts`. Non-blocking messages, `role="status"`,
  auto-remove after 5 s. No console output.
- `src/utils/time.js` — `formatTime(seconds)` → `m:ss`, `h:mm:ss` past an hour.
- `src/css/components.css` — M2 view, stage, button and toast styles; theme
  values come only from the §8.4 custom properties.

### Wiring

- `src/main.js`: imports the four modules, creates instances, mounts the view
  immediately; SW boot/`boot-complete` is unchanged and independent.
- `src/index.html`: links `components.css`; footer is `v0.2.0`.
- `package.json`: version `0.2.0`.

### Tests

`npm test` → 6/6 pass (`node --test`):

1. Diagnostics inspects the same four converter URLs as the SW (M1).
2. `public/404.html` exists (M1).
3. Footer version matches `package.json` (M1).
4. `formatTime` covers minutes, hours, `NaN`, negative (M2).
5. `mediaKind` prefers MIME, falls back to case-insensitive extension (M2).
6. Broker revokes each replaced blob URL exactly once and pauses across
   sessions (M2, fake DOM/media elements).

Build: `npm run build` exit 0, 11 modules, one CSS + one JS asset, Workbox
precaches 10 URLs.

## Deviations and decisions

1. **Single file, not a folder.** The handoff also describes a folder picker;
   M2's exit criterion only needs one playable track. Folder pickup and its
   ordering rules move to M4/M5. `accept` covers both audio and video.
2. **Native controls only.** `controls`, `preload="metadata"`, `playsinline`
   plus `webkit-playsinline`. The custom overlay and transport arrive at M3;
   using the platform controls here is the point of the milestone.
3. **Audio element is created with `loop = true`.** §6.2 says loop is a
   property of the audio element, set once, never toggled per track. As a
   result audio tracks never fire `ended`, so auto-advance has nothing to
   trigger until the playlist exists (M4).
4. **Native-only classification.** `mediaKind` accepts MIME `audio/*` or
   `video/*`, then a small extension allowlist (`mp3 m4a aac wav aif aiff flac
   ogg oga opus` / `mp4 m4v mov webm`). Anything else gets an "unsupported"
   toast. MIME is not trusted blindly: iOS may hand over
   `application/octet-stream` for known extensions. FormatBridge (M13) replaces
   this with real probing.
5. **iOS picker cancel is inferred.** Safari fires no event when the picker is
   dismissed, so the promise resolves empty one second after focus returns.
   Picking a file settles earlier via `change`; the timer then no-ops. Cancel
   is silent, by design.
6. **One error report per failed load.** `loadTrack` rejects on the first
   `error`/timeout path, and the element's own `error` listener ignores events
   while the session is `loading`. Without that, a failed load produced two
   toasts.
7. **Releasing a source never calls `load()` on an empty element.** The first
   draft did, which can raise `error` in Safari on a fresh element. `#release`
   now returns early when no blob URL exists for that slot.
8. **Blob URL lifecycle.** One object URL per element slot (`audioClean`,
   `video`). Replacing a track, switching kind, or a failed load pauses,
   clears `src`, calls `load()` to abort in-flight reads, then revokes. The
   invariant is unit-tested. Loading a new URL *before* revoking would be a
   leak; revoking *before* clearing would break Safari's range reads.
9. **Session id is the literal `main`.** Multi-session tabs and persistence are
   M9. The broker's map already keys by session id, so M9 adds ids, not a
   rewrite.
10. **Version bumped to 0.2.0.** The footer is the quickest on-device proof that
    the new build is active after **Apply update**.
11. **No console output added.** Errors surface as toasts; boot-time console
    calls from M1 are unchanged.
12. **`npm test` ESM warning.** Node prints "reparsing as ES module" for the
    M2 tests because `package.json` has no `"type": "module"` and the M1 tests
    use `require`. Harmless; the alternative is renaming the M1 test to `.cjs`,
    which buys nothing.

## Verification on device (installed PWA)

- [ ] Footer reads `v0.2.0` after **Apply update** and reload.
- [ ] **Open file** opens the iOS document picker; choosing an `.mp3` shows
      native controls, the file name, and `0:00 / <duration>`.
- [ ] Play, pause, scrub, and volume work through native controls.
- [ ] Track name replaces "No file open"; no toast on a successful load.
- [ ] Cancelling the picker changes nothing and shows no error.
- [ ] Choosing an unsupported file (e.g. `.mkv`, `.avi`) shows
      "That file type is not supported yet." and leaves the previous track
      untouched.
- [ ] Choosing an `.mp4`/`.mov` plays inline in the stage (no fullscreen
      hijack, no separate player).
- [ ] While one track plays, choosing another stops the first, resets the time
      line, and plays the new one.
- [ ] Switching audio → video → audio keeps a single visible player.
- [ ] An audio track loops at the end (native loop, §6.2 amendment).
- [ ] Video reaching the end stops (it does not loop).
- [ ] Airplane mode on: the picker and local playback still work (the file is
      local; only the known `sw.js` probe dialog may appear).
- [ ] `scrollHeight / innerHeight` still equal with the view mounted; the
      document itself does not scroll, `.app-main` does if needed.
- [ ] Precache returns to `10` entries after applying the update; `format-bridge`
      stays `0`.

Not device-verifiable: blob URL revocation. It is covered by the unit test
above; the diagnostics panel has no broker handle by design.

Device: iPadOS 18.3 installed PWA (26.x deferred, see M1 Deviation 16).

## Out of scope (next milestones)

- Playlist/queue, multi-file selection, folder import — M4/M5.
- Custom transport and progress UI — M3.
- Session tabs/persistence — M9.
- Theme switching — M10.
- Format conversion, WASM bridge — M13+.
