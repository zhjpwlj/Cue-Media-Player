# Milestone 5 — Media Session Integration

Status: implemented, unit-tested (43), built. Awaiting device verification.

Scope: lock-screen / Control Centre metadata, play/pause/next/prev handlers,
detach while a video is hidden, re-attach on return. Background audio behavior
itself is M6.

## Delivered

### `src/core/media-session.ts` (new)

- `init()` registers action handlers once:
  - `play` / `pause` → broker, updates `playbackState` immediately.
  - `previoustrack` / `nexttrack` → the session's playlist manager.
  - `seekbackward` / `seekforward` explicitly `null`, so iOS shows prev/next
    instead of seek buttons.
- `attachToSession()` is idempotent: re-registers handlers, refreshes metadata,
  syncs `playbackState`. Called on init and on every visibility return.
- Metadata: `title` = track name, `artist` / `album` = session name, artwork =
  generated 512×512 "Cue" cover cached per session colour as a data URL (no
  revoke lifecycle).
- `track-changed` refreshes metadata; `state-changed` maps playing → `playing`,
  paused/ended → `paused`.
- `visibilitychange`: hidden + video (or Shorts) pauses the broker and
  `detach()`es (metadata `null`, handlers unregistered, state `none`, then
  `paused` for video); hidden + audio stays attached. Visible re-attaches.
- `detach()` unregisters every action; `attachToSession()` re-registers.

### `src/main.ts`

Constructs one playlist registry (`default` → manager) and starts the
controller after the broker and playlist exist. M9 makes the registry
per-session.

### `src/diagnostics.ts`

New `mediaSession` line: playback state / metadata title.

### Tests

43 total. New `media-session.test.js` covers handler registration, metadata,
artwork presence, track/state updates, lock-screen actions reaching the app,
video detach + re-attach, and audio staying attached while hidden.

Build: typecheck pass, 10 precached URLs.

## Deviations / notes

1. **Video is paused explicitly on hide**, not left to the browser. §2.6 wants
   video to stop; doing it in code makes it deterministic. On return it stays
   paused with metadata visible.
2. **`attachToSession(sessionId)` ignores a mismatched id** instead of looking
   up an arbitrary session; only the active session exists until M9.
3. **Artwork is a data URL**, per spec, generated once per session colour.
4. **Metadata artwork may be absent** only if canvas `2d` is unavailable; iOS
   would then drop the widget. No such platform is targeted.

## Verification on device (installed PWA)

- [ ] Footer reads `v0.6.0`.
- [ ] Play audio, lock: metadata shows track title + "Cue 1", artwork present.
- [ ] Prev/next buttons visible on lock screen (not seek buttons).
- [ ] Tap next from lock: advances; metadata changes.
- [ ] Tap prev from lock: goes back; metadata changes.
- [ ] Tap pause from lock: playback pauses; tap play: resumes.
- [ ] Play video, lock: video pauses, lock-screen entry disappears.
- [ ] Unlock with video paused: metadata returns, state shows paused.
- [ ] Hidden audio: controls stay attached (M6 will test playback).
- [ ] Diagnostics `mediaSession`: state / title match what is playing.

Not device-verifiable here: no iPad available in this session.

## Out of scope (next milestones)

- B1/B2 locked background playback proof — M6.
- Fullscreen, PiP — M7. Themes — M8. Sessions — M9. Real metadata — M11.
