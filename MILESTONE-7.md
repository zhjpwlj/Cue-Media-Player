# Milestone 7 — Simulated Fullscreen + PiP

Status: implemented, unit-tested (52), built. Awaiting device verification.

Two display modes, chosen per session: simulated (CSS, default) and native
(platform player). PiP for video. `Escape` leaves simulated fullscreen. PiP
leaves simulated fullscreen automatically.

## Delivered

### `src/core/player-broker.ts`

- `enterFullscreen(sessionId)`:
  - `simulated` → `body.simulated-fs-active` + `#player-container.fs-root`,
    records the session in `simulatedFsActive`, emits `fullscreen-changed`.
  - `native` → `webkitEnterFullscreen()` on iPadOS, `requestFullscreen()` on
    desktop.
- `exitFullscreen(sessionId)`: removes both classes, clears the record, exits
  WebKit fullscreen when active, exits standard fullscreen when present.
  Idempotent.
- `enterPiP(sessionId)`: video-only. Exits simulated fullscreen first, then uses
  `webkitSetPresentationMode('picture-in-picture')` (iPadOS) or
  `requestPictureInPicture()` (desktop). Returns `false` on rejection so the
  view can toast.
- `supportsPiP(sessionId)`: element-level feature check, so the button reflects
  the platform actually in use.
- `Escape` listener registered once in the constructor: exits simulated
  fullscreen and calls `stopPropagation()` so a modal cannot close in the same
  keypress. It does nothing when no simulated fullscreen is active.
- Loading an audio track while its session is in simulated fullscreen exits
  fullscreen: there is no picture to show.

The mode comes from a getter passed by `main.ts`
(`() => sessions.getActive().fullscreenMode`), so the broker never owns session
state and tests can construct it with no arguments.

### `src/ui/settings-modal.ts` (new)

- Reads `#settings-modal`, `#pref-simulated-fs`, `#btn-settings-close`,
  `#btn-settings`.
- Checkbox writes `session.fullscreenMode` (`simulated` / `native`).
- Closes on the Close button, backdrop tap, or `Escape` (stopped before the
  fullscreen handler).
- `#btn-settings` in the top bar opens it with the current value.

### `src/views/videos-view.ts`

- Fullscreen button toggles enter/exit for the active session; the icon and
  label switch (`⛶` / `⤢`).
- PiP button calls `enterPiP`; a rejected request shows a toast instead of
  failing silently.
- Both buttons follow `track-changed`: hidden for audio, shown for video. PiP
  also stays hidden when the element has no PiP API.

### `src/index.html`

- `#btn-fullscreen` and `#btn-pip` enabled, labelled, and `hidden` until a
  video loads (no tooltip pointing at M7 any more).
- `#btn-settings` added to the top bar.
- Settings sheet markup; `.hidden` handles visibility.

### `src/css/components.css`

- `.hidden`, `.modal`, `.modal-content`, `.modal-option` styles.
- `body.simulated-fs-active` rules: hides top bar, track info, action row,
  sidebar, footer and the version label; collapses the grid; promotes
  `#player-container` to `position: fixed; inset: 0; 100dvh`; keeps the video
  edge to edge; insets only the controls overlay with
  `env(safe-area-inset-*)`.

### Tests

52 total. New `m7.test.js` covers simulated enter/exit, Escape (including
propagation), native handoff to WebKit and to standard fullscreen, PiP as
video-only, PiP leaving simulated fullscreen, Safari presentation-mode PiP, and
audio load exiting fullscreen. `asset-invariants.test.js` now asserts the M7
buttons are enabled but start hidden, the settings sheet exists, and the
fullscreen CSS uses `100dvh` with safe-area padding on the controls.

Build: typecheck pass, 10 precached URLs.

## Deviations / notes

1. **Spec's DOM selectors were written for a flat document.** Our layout nests
   `#view-videos` inside `.app-shell > .app-main`, so the "hide everything but
   the view" rule is expressed as a list of chrome selectors instead of
   `body > *:not(#view-videos)`.
2. **PiP uses the WebKit presentation-mode API when present.** iPadOS has no
   `requestPictureInPicture`, and this milestone's primary device is the iPad.
3. **The broker reads the mode through a getter** rather than importing
   `SessionManager`, avoiding a core-to-core dependency and letting unit tests
   build a broker with no sessions.
4. **Native mode is per session** as specified; the settings sheet only exists
   to flip it for testing.
5. **`fs-root` is applied but currently unused by CSS.** The body class drives
   the layout; the extra class is kept for M8 theming.

## Verification on device (installed PWA)

- [ ] Footer reads `v0.7.0`.
- [ ] Video in simulated fullscreen fills the viewport; controls visible.
- [ ] Controls clear the home indicator and notch.
- [ ] Hardware `Escape` (keyboard) exits simulated fullscreen.
- [ ] PiP from simulated fullscreen: overlay video appears, fullscreen exits.
- [ ] PiP from a paused video: frozen frame, play/pause works in the PiP window.
- [ ] Settings → uncheck "Use simulated fullscreen" → fullscreen button hands
      off to the iOS player.
- [ ] Re-check the box → CSS fullscreen works again.
- [ ] Audio track: fullscreen and PiP buttons are gone.
- [ ] Video track: both buttons return.

Not device-verifiable here: no iPad available in this session.

## Out of scope (next milestones)

- Themes and the theme picker — M8.
- Full settings sheet (sessions, playback, storage) — M19.
- Subtitles warning before native handoff — placeholder waits for M11.
