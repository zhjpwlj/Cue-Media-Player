# Milestone 4 — Playlist Queue & Auto-Advance

Status: implemented, unit-tested (38), built. Awaiting device verification.

Scope: multi-file queue, folder import, sidebar selection, prev/next, foreground
auto-advance for audio and video, last-track termination, blob-URL accounting.

## Delivered

### `src/core/playlist-manager.ts` (rewritten)

- `addFiles(files)` filters non-media, replaces the queue, stores every `File`,
  emits `playlist-updated`, then loads index 0.
- `playIndex(index, autoplay)` sets `session.currentIndex`, loads through the
  broker, emits `playlist-updated` after a successful load, and optionally
  starts playback. Refuses while the broker reports `loading`.
- `next()` / `prev()` walk the queue; both are no-ops at their boundary.
- `track-ended` listener: advances to the next index, or on the last track
  pauses the element, marks the session `ended`, and emits `playlist-finished`.
- Missing `File` emits `track-file-missing`.

### `src/core/player-broker.ts`

- Audio auto-advance: `timeupdate` threshold (0.5 s, or 25% under 2 s) plus the
  `seeking` loop-wrap detector. Audio has no `ended` listener (`loop = true`).
- Video auto-advance: `timeupdate` threshold plus `ended`.
- `advancedWeakSet` guard: one `track-ended` per element per end, kept across a
  track swap so a queued `ended` from the old source cannot advance the new one.
- `markEnded(sessionId)` gives the playlist a terminal state without fabricating
  a second media event.
- `cancelLoad(sessionId)` invalidates the in-flight load, releases its URL, and
  restores the last good track, paused.
- Blob counters (`created` / `revoked`); diagnostics prints the delta.

### `src/core/file-handler.ts`

- File input is now `multiple`.
- Folder picks are sorted with `name.localeCompare()` before queueing.

### `src/views/videos-view.ts` / `src/index.html`

- Prev/next enabled and wired; milestone tooltips removed.
- Sidebar item click plays that index (any item, not just the current one).
- File picker passes every selected file to the queue, not just the first.

### Diagnostics

Two new lines: `blob URLs` (`created / revoked / delta`) and the existing
`audio graph`; `media volume / muted` remains.

### Tests

38 total (`node --test`): M3 suite updated to queue semantics, plus M4 tests for
multi-file queueing, next/prev boundaries, track-ended advance, last-track
termination, loading guard, missing file, single-fire guard, stale `ended`,
short-track threshold, and blob delta.

Build: typecheck pass, 10 precached URLs.

## Deviations

1. **No autoplay on a new pick.** The spec's `loadTrack` step 10 autoplays every
   load; M3 shipped "select a file, then press Play" and the device checklist
   confirmed it. Autoplay now happens only on auto-advance and sidebar/prev/next.
2. **Queue replacement on every pick**, per the M4 note. A failed first load
   leaves the new queue in place with a toast; the previous queue is not
   restored. M3's "keep previous state on failure" is superseded.
3. **Terminal state lives in the broker.** Spec dispatches `state-changed`
   directly; `markEnded` keeps the broker's internal state in sync instead.
4. **`cancelLoad` has no UI trigger.** It is implemented and available for M5/M6
   but no visible control cancels a load.
5. **Folder sorting only.** Multi-file picks keep selection order; folder picks
   sort alphabetically, as specified.
6. **`Track.metadataId` deferred** to M11; the current `Track` shape is enough.

## Verification on device (installed PWA)

- [ ] Footer reads `v0.5.0`.
- [ ] Select 3+ files: sidebar lists all, first shown in track info.
- [ ] Folder picker loads all media files, alphabetical (iOS 18.4+ only).
- [ ] Sidebar click plays the tapped track; highlight moves.
- [ ] Next/prev buttons move one track; prev at first and next at last do
      nothing.
- [ ] Play a 5-track audio queue: advances once per track, no skips.
- [ ] Play a video queue: advances at `ended`.
- [ ] Last track, audio: stops at the end, does not loop.
- [ ] Last track, video: stays ended; Play does not restart the queue
      unexpectedly (note result).
- [ ] Locked playback of track 1 → track 2: does not advance (M6).
- [ ] Diagnostics `blob URLs`: delta `1` after a play-through.
- [ ] `scrollHeight / innerHeight` still equal.

Not device-verifiable here: no iPad available in this session.

## Out of scope (next milestones)

- Media Session / lock screen metadata — M5.
- Background auto-advance while locked — M6.
- Fullscreen, PiP — M7. Themes — M8. Sessions — M9. Metadata — M11.
