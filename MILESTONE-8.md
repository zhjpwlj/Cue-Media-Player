# Milestone 8 — Theme System

Status: implemented, unit-tested (66), built. Awaiting device verification.

Five video themes and five audio themes from `public/assets/themes/`, per
session selection, live swap. Audio skins are layout frameworks only: the
canvas is empty until the waveform (M12) and live analyser (M18).

## Delivered

### `public/assets/themes/`

- `manifest.json`: 5 video + 5 audio entries, each with `id`, `name`, `path`
  and a picker swatch `color`.
- `video/*.css`: `:root` variable contract per §8.4. `custom.css` carries the
  full set; `youtube`, `netflix`, `disney-plus`, `prime-video` override
  backgrounds, accent, radius, font and sizes. Unset variables fall back to
  `src/css/base.css`.
- `audio/*.css`: scoped `.audio-skin-<id>` rules only. No `:root` edits, so
  audio themes never leak into the global chrome.
- All 11 files (manifest + 10 CSS) are in the injected precache manifest:
  build precaches 21 URLs, 74.2 kB.

### `src/core/theme-manager.ts` (new)

- `init()` fetches the manifest once.
- `getVideoThemes()` / `getAudioThemes()`.
- `applyVideoTheme(id)` / `applyAudioTheme(id)`:
  - one `<link>` per theme, created lazily and never removed;
  - waits for `link.sheet` (load or error) before promoting, so a swap cannot
    flash unstyled;
  - promotes with `media="all"`, demotes every other the
    `link media="not all"` technique;
  - updates `meta[name="theme-color"]` from `--bg-primary`;
  - dispatches `theme-changed` with `{ type, id }`.
- `applyForSession(session)` applies both stored ids in parallel.
- Audio themes hand the id to `AudioSkinController.load(id)`.

### `src/core/audio-skin-controller.ts` (new)

- `load(skinId)` builds `#audio-skin-root.audio-skin.audio-skin-<id>` with
  `data-skin`, `.as-info > .as-title + .as-artist`, and an empty
  `canvas.as-canvas`.
- `unload()` removes the surface.
- `setMetadata({ title, artist, album })` writes the text lines.
- `setPeaks()` and `setMode()` are documented no-ops for M12/M18.

### `src/ui/theme-picker.ts` (new)

- One sheet with "Video themes" and "Audio themes"; buttons built from the
  manifest with a colour swatch and `aria-pressed` on the active theme.
- Selecting applies live, writes the id onto the session
  (`videoThemeId` / `audioThemeId`), and closes.
- Opens from the top-bar ◐ button; closes on Close or backdrop tap.

### `src/views/videos-view.ts`

- `track-changed` swaps the surface: video shows `#player-media-slot`, audio
  hides it and shows `#audio-skin-mount`.
- Audio tracks load the session's audio skin and set title = file name,
  artist = session name. M11 replaces this with embedded metadata.

### `src/index.html` / CSS

- `#btn-theme` enabled with a label.
- `#audio-skin-mount` added as a sibling of the media slot, hidden by default.
- Theme picker sheet markup.
- Base `.audio-skin` layout, `.theme-options` grid, `.theme-swatch`,
  `aria-pressed` styling, `.modal-content h3`.

### Tests

66 total. New `m8.test.js` covers manifest loading, video link promotion and
demotion, meta theme-color, audio skin mount/replace, metadata text, unknown
ids, and `applyForSession`. `asset-invariants.test.js` asserts the manifest has
5+5 unique themes, every file exists, video themes set `:root`, audio themes are
scoped and never touch `:root`, the CSS glob is precached, and the picker DOM
exists.

## Deviations / notes

1. **Manifest gained a `color` field** for the picker swatch. The spec asks for
   preview colours but does not define where they come from.
2. **Video themes rely on `base.css` for unset variables.** Since links are
   mutually exclusive, missing variables fall back to base, not to
   `custom.css`; every theme still sets the variables that matter for its look.
3. **The audio skin surface is rebuilt on every audio track change.** It keeps
   the DOM in sync with the session theme; M12 can move to updating metadata
   only once the canvas holds state.
4. **Theme links are added on first use**, not all at boot, so a fresh install
   downloads only the two default themes until the picker is used.
5. **No animations in any theme**, so `prefers-reduced-motion` has nothing to
   gate yet.

## Verification on device (installed PWA)

- [ ] Footer reads `v0.8.0`.
- [ ] ◐ opens the sheet; 5 video and 5 audio options with swatches.
- [ ] Video theme swap is instant, no flash, chrome colours change.
- [ ] Audio theme swap changes only the audio surface, not the app chrome.
- [ ] Audio track shows the selected skin with title + session name; canvas is
      blank (expected).
- [ ] Video track shows the video; no skin over it.
- [ ] Reopening the sheet marks the active theme.
- [ ] Airplane mode: theme CSS still applies from precache.
- [ ] No `filter` / `backdrop-filter` / `mix-blend-mode` on media elements.

Not device-verifiable here: no iPad available in this session.

## Out of scope (next milestones)

- Waveform peaks — M12. Live analyser — M18.
- Theme persistence across launches — M9 (session store).
- Visual polish pass — after M8, as agreed.
