# Milestone 3 — Videos View Layout

Status: implemented, self-reviewed, built and deployed. Awaiting device verification.

Scope: the full YouTube-style Videos chrome on the working M2 player — top bar,
player stage with a custom transport overlay, track info, action row, "Up Next"
sidebar, and a footer with file/folder pickers. Queue behavior, theming,
fullscreen, PiP, subtitles and sessions stay disabled for their milestones.

## Delivered

### New and changed modules

- `src/core/session-manager.ts` — one default session (`Cue 1`), in memory.
  `init()`, `getActive()`, `getOrdered()`, `activeSessionId`. No persistence, no
  switching (M9).
- `src/core/playlist-manager.ts` — `addFiles([file])` takes the first media
  file only, stores the `File`, writes `session.playlist` / `currentIndex` and
  emits `playlist-updated` **after** `loadTrack` succeeds. On failure the
  previous track stays current and a `toast` event fires.
- `src/core/file-handler.ts` — `mediaFiles()` filter plus `openFolderPicker()`
  (`<input webkitdirectory multiple>`), feature-detected. Non-media files never
  reach the playlist.
- `src/core/player-broker.ts` — `Track` gained `fileSize` / `fileLastModified`;
  the native `controls` attribute is gone (the overlay owns transport).
- `src/views/videos-view.ts` — binds the static DOM: play/pause, seek (with a
  scrub guard so `timeupdate` cannot fight the thumb), time display,
  volume/mute reapplied after every audio↔video swap, AirPlay when the platform
  exposes it, folder button, playlist list, tap-to-toggle controls.
- `src/index.html` — full static Videos DOM. Future controls carry `disabled`,
  `aria-disabled="true"` and a `title` naming their milestone.
- `src/css/layout-videos.css` — layout, 16:9 landscape / 4:3 portrait, sidebar
  stacked below 900 px, overlay, disabled styling, narrow-phone trimming.
- `src/css/components.css` — M2 view styles removed; buttons and toasts remain.
- `src/css/base.css` — global version stamp renamed `.app-version` so the view
  footer can own `#app-footer`.
- `src/main.ts` — constructs session, playlist, file handler, toasts and view;
  one global `toast` listener; start failure surfaces as a toast.

### Tests

`npm test` → 20/20 (`node --test`): the previous 11 plus nine M3 checks —
session defaults, first-file-only loading, `playlist-updated` emitted once,
non-media rejection keeps state, failed load keeps the previous track,
`getFile`, folder filtering, folder-picker input reuse/reset, unsupported
`webkitdirectory` early-return, layout DOM ids, overlay starts visible,
disabled controls have titles, layout CSS has no `100vh`/`100dvh`/safe-area.

Build: `npm run build` exit 0, 10 precached URLs, one CSS asset.

## Deviations and decisions

1. **Static DOM in `index.html`.** The spec is ambiguous (it shows both an
   `index.html` structure and a view that builds DOM). Followed the static
   version: one source of truth, and the diagnostics header listener finds its
   element at parse time.
2. **Safe-area stays on `body`.** The spec puts `height: 100dvh` plus
   `env(safe-area-inset-*)` on `#view-videos`; that recreates the M1 double
   count (20 px scroll). The view uses `min-height: 100%` inside `.app-main`.
3. **State modules arrive one milestone early.** The spec assumes
   `SessionManager` and `PlaylistManager` exist from M2; they were not in the
   shipped M2. Added as thin stubs, single session, in memory.
4. **Session state is written only on a successful load.** Prevents the view
   and broker disagreeing after a decode failure; a failed pick leaves the
   previous track visible, and the broker restores it.
5. **No native media controls.** Overlay only. M2's "native audio UI" line is
   superseded.
6. **`Info` opens a toast, not a panel.** Metadata is M11; a placeholder panel
   would be dead UI.
7. **Folder picker is feature-detected** (`'webkitdirectory' in input`), not
   iPhone-sniffed. Unsupported browsers hide the button with a tooltip.
8. **Volume is view state; mute is session state.** M9 persists it; nothing is
   written to IndexedDB yet.
9. **Seek drag guard.** `timeupdate` is ignored while the seek bar is being
   dragged, then applied on `change`.
10. **Version 0.4.0.** Footer and `package.json` agree; the footer test pins it.
11. **Subagent quota.** The planned independent task review for M3 could not be
    dispatched (free-model limit). Task 2 was self-reviewed against the same
    checklist: overlay visibility, safe-area, disabled styling, scrub conflict,
    narrow-width clipping, volume reapplication.

## Verification on device (installed PWA)

- [x] Footer reads `v0.4.1` after **Apply update** and reload.
- [x] Layout renders: top bar, player, track info, action row, sidebar, footer.
- [x] Landscape: 16:9 player, sidebar right. Portrait: 4:3 player, sidebar below.
- [x] No horizontal scroll at either orientation; document does not scroll.
- [x] Safe-area: nothing under the status bar or home indicator.
- [x] Controls overlay is visible on open; tapping the player hides/shows it.
- [x] Disabled buttons (menu, theme, prev/next, CC, PiP, fullscreen, favorite)
      look dimmed and do nothing when tapped.
- [ ] **Select file** plays audio and video; name, badge, time line update. Note: audio selection does not work (mp3), some video formats are unselectable (mkv)
- [ ] Play/pause, seek drag, volume slider and mute work. Note: volume slider does not work, but mute works.
- [ ] Switching MP4 → MP3 keeps one visible control set; volume and mute carry
      over; no double audio.
- [ ] **Select folder** opens the iPad folder picker; only media files appear 
      as tracks; non-media are filtered out. Note: cannot select folders.
- [x] Selecting a new file mid-playback stops the old one; no autoplay.
- [x] AirPlay button is enabled when a media element exists (Safari), or dimmed
      with its tooltip elsewhere.
- [x] `scrollHeight / innerHeight` still equal in the diagnostics panel.
- [x] Precache returns to `10` after applying the update.

Not device-verifiable here: no iPad available in this session.

## Out of scope (next milestones)

- Queue, `next`/`prev`, auto-advance, folder import of all files — M4.
- Fullscreen, PiP — M7. Themes — M8. Sessions/tabs — M9. Subtitles — M11.
- Format conversion — M13+.

## Device results (iPadOS 18.3, 2026-11-08)

Passing: install/update with `v0.4.1`, full layout, 16:9 landscape and 4:3
portrait, sidebar stacking, no horizontal scroll, safe-area clear, overlay
toggle, disabled controls dimmed and inert, mid-playback switch stops the old
file, AirPlay state, `scrollHeight / innerHeight` equal, precache back to 10.

Failing, with root cause:

1. **Top-bar text selectable (regression).** M3 renamed the header element to
   `.top-bar`, but `base.css` still targeted `.app-header`, so
   `user-select: none` and `touch-action: manipulation` no longer applied.
   Fixed: the base rule now targets `.top-bar` (id `app-header` unchanged for
   the diagnostics trigger).
2. **Volume slider dead.** iOS Safari ignores programmatic
   `HTMLMediaElement.volume`; only `muted` is honored (mute worked on device).
   Fixed: the slider hides on iOS/iPadOS instead of pretending to work. Real
   volume control on iOS is hardware-only; revisit if M23 finds a supported
   path.
3. **Folder picker cannot pick folders.** iPadOS exposes `webkitdirectory` on
   the input, so feature detection passed, but its document picker offers no
   folder selection. Fixed: the folder button hides on iOS/iPadOS; folder
   import returns on desktop Chromium (M24 / M27) via `showDirectoryPicker`.
4. **MKV not selectable.** The picker's `accept` list offered only
   `audio/*,video/*`, so Files greyed MKV/AVI out. Fixed: `.mkv,.avi` added to
   `accept`; they are now selectable and produce the existing "not supported
   yet" toast. Native decoding is M13's job.
5. **MP3 selection reported broken.** Not yet diagnosed; needs the symptom
   (name update? toast? silence on play?) before changing code. MKV/AVI now
   at least fail with a message, which isolates the remaining report.

Note: `isIOS()` reads `navigator.userAgent` in the view; the M23 platform
module replaces it. Until then this is the only UA read outside diagnostics.
