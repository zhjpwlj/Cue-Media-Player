# Milestone 6 — Background Audio Verification (B1, B2)

Status: **blocked on device verification.** Instrumentation shipped as `v0.6.1`;
B1/B2 must pass on the iPad before M7 starts.

M6 is a proof milestone, not a feature milestone. It verifies that M4's
auto-advance and M5's Media Session survive a locked screen. No playback logic
changed in this milestone.

## Shipped for this milestone

- `src/utils/debug.ts`: gated logging (`?debug=1`, persisted, or the diagnostics
  toggle). Keeps the newest 24 lines in memory.
- Debug points:
  - `[broker] loadTrack started for <name>`
  - `[broker] track-changed emitted for <name>`
  - `[broker] track-ended emitted for session <id>`
  - `[playlist] advancing to index <i> <name>`
  - `[mediaSession] metadata updated to <name>`
- Diagnostics: `Debug: on/off` button and a `debug log (newest last)` section.
  This is the log surface on an untethered iPad. No Mac required.
- Production stays quiet: `console.debug` only runs while the flag is on.

## Procedure — B1

Setup: queue of 3 audio tracks, each at least 60 seconds.

1. Open diagnostics and tap **Debug: on**. Close the panel.
2. Pick the 3 tracks, press Play.
3. Lock the iPad with about 10 s left on track 1. Wait 5 s (iOS needs a moment
   to enter background audio mode).
4. Expect: track 2 starts audibly while locked; lock-screen title updates.
5. Repeat for track 2 → 3.
6. On the last track, expect playback to stop and stay stopped (no silent loop).
7. Unlock, open diagnostics, copy the debug log.

Expected order for one advance:

```
[broker] track-ended emitted for session default
[playlist] advancing to index 1 <name>
[broker] loadTrack started for <name>
[broker] track-changed emitted for <name>
[mediaSession] metadata updated to <name>
```

If timeupdate also fired, the guard prevents a second `track-ended`; seeing two
`track-ended` lines is a failure.

## Procedure — B2

1. Play track 1, lock, confirm it plays.
2. Unlock, tap track 2 in the sidebar (or Next).
3. Expect track 1 to stop immediately; only track 2 plays.

Formal two-session concurrency is deferred until after M9.

## Acceptance criteria

- [ ] B1 passes: 3-track play-through advances while locked, metadata updates
- [ ] B1 last-track termination: playback stops, no loop
- [ ] B2 single-session exclusivity: track 2 pauses track 1
- [ ] Keepalive not enabled
- [ ] Debug log shows the expected sequence

## Results

Pending iPad run. Paste the debug log and the lock-screen observations.

## Follow-ups if B1 fails

| Symptom | Likely cause | Where |
|---|---|---|
| Track 2 never starts | `track-ended` not fired or not consumed | M4 |
| Track 2 loads but silent | `play()` rejected after load | M4 |
| Track 2 plays, metadata stale | `track-changed` / listener | M5 |
| Audio stops, metadata still track 1 | detach fired wrongly | M5 |
| Last track loops silently | pause missing on finish | M4 |

Keepalive stays off unless audio vanishes entirely with no events (session kill).
