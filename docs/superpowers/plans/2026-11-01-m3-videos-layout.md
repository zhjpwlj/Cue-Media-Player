# M3 Videos View Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer the full YouTube-style Videos chrome onto the working M2 player, with a folder picker and live volume/mute.

**Architecture:** Static view DOM lives in `src/index.html`; `VideosView` binds it. Two thin state modules (`SessionManager`, `PlaylistManager`) appear now because the spec's M3 wiring assumes them; both stay single-session and in-memory for M4/M9 to extend. No SW, manifest, or header changes.

**Tech Stack:** TypeScript 5.9 (strict), Vite 5, esbuild, Workbox, `node --test`.

**Spec:** `MILESTONE-2~22.md` §M3 (lines 418–687) plus `read after M22.md` §6.9 and §2.9.

## Global Constraints

- No `100vh` anywhere. Use `100dvh` only.
- Safe-area padding stays on `body`; never on `#view-videos` or `.app-main` (M1 deviation 11).
- Blob-URL invariant unchanged: create − revoke equals live elements. Do not touch `#release`.
- `audioClean.loop = true` set once at element creation; `playsinline` on video.
- No `console.log` in production code. No new dependencies.
- Every disabled control: `disabled`, `aria-disabled="true"`, `title` naming the milestone that enables it.
- TypeScript strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`. `npm run typecheck` must pass.
- Footer version must match `package.json` (existing test).
- Version for this milestone: `0.4.0`.

## Review Focus

1. **Touch has no hover.** Spec hides the controls overlay until `:hover`. A touch user would get a black player with no controls. Initial state must show them; tap toggles. Test the class in `index.html`.
2. **Safe-area double count.** Any `100dvh` or inset padding on `#view-videos` re-creates the M1 20px scroll. Checks pin `body`-only padding and the absence of `100dvh` in the new CSS.
3. **Unsupported folder picker.** `webkitdirectory` may be missing. Button hides via feature detection, not OS sniffing.
4. **Volume across element swap.** audio↔video creates a new element; volume/mute must reapply on `track-changed`, not only on slider input.
5. **Disabled controls that look live.** `pointer-events: none` plus `disabled` plus tooltip; a tap must do nothing and must not scroll the page.

---

### Task 1: Core state modules

**Files:**
- Create: `src/core/session-manager.ts`
- Create: `src/core/playlist-manager.ts`
- Modify: `src/core/file-handler.ts`
- Modify: `src/core/player-broker.ts` (Track shape, element creation)
- Test: `tests/unit/m3.test.js`

**Interfaces:**
- Consumes: `PlayerBroker.loadTrack(sessionId: string, track: Track, file: Blob): Promise<HTMLMediaElement | null>`, `mediaKind(file): 'audio' | 'video' | null`.
- Produces:
  - `Session` with `id, name, playlist: Track[], currentIndex, muted, currentTrackType, playbackRate`.
  - `SessionManager.init(): Promise<void>`, `.activeSessionId: string`, `.getActive(): Session`, `.getOrdered(): Session[]`.
  - `PlaylistManager(sessions, broker)`, `.addFiles(files: File[]): Promise<Track | null>`, `.getFile(id): File | null`.
  - `FileHandler(playlist)`, `.openFilePicker(): Promise<File[]>`, `.openFolderPicker(): void`.
  - `mediaFiles(files: File[]): File[]` exported from `file-handler.ts`.
  - `Track` gains `fileSize: number` and `fileLastModified: number`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/m3.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert';

const events = [];
globalThis.document = { dispatchEvent: (e) => events.push(e) };

const file = (name, type = '') => ({ name, type, size: 10, lastModified: 1 });

test('SessionManager creates one default session', async () => {
  const { default: SessionManager } = await import('../../src/core/session-manager.ts');
  const sessions = new SessionManager();
  await sessions.init();
  const session = sessions.getActive();
  assert.equal(session.name, 'Cue 1');
  assert.equal(session.playlist.length, 0);
  assert.equal(session.muted, false);
  assert.deepEqual(sessions.getOrdered(), [session]);
});

test('PlaylistManager loads only the first media file and emits playlist-updated', async () => {
  const { default: SessionManager } = await import('../../src/core/session-manager.ts');
  const { default: PlaylistManager } = await import('../../src/core/playlist-manager.ts');
  const sessions = new SessionManager();
  await sessions.init();
  const loaded = [];
  const broker = { loadTrack: async (_id, track) => { loaded.push(track); return null; } };
  const playlist = new PlaylistManager(sessions, broker);

  const track = await playlist.addFiles([file('a.mp3', 'audio/mpeg'), file('b.mp4', 'video/mp4')]);
  assert.equal(loaded.length, 1);
  assert.equal(track.name, 'a');
  assert.equal(track.type, 'audio');
  assert.equal(playlist.getFile(track.id).name, 'a.mp3');
  assert.equal(sessions.getActive().currentIndex, 0);
  assert.ok(events.some((e) => e.type === 'playlist-updated'));
});

test('PlaylistManager rejects non-media and keeps the previous state', async () => {
  const { default: SessionManager } = await import('../../src/core/session-manager.ts');
  const { default: PlaylistManager } = await import('../../src/core/playlist-manager.ts');
  const sessions = new SessionManager();
  await sessions.init();
  const playlist = new PlaylistManager(sessions, { loadTrack: async () => null });
  assert.equal(await playlist.addFiles([file('a.txt', 'text/plain')]), null);
  assert.equal(sessions.getActive().playlist.length, 0);
});

test('mediaFiles filters folders to supported media', async () => {
  const { mediaFiles } = await import('../../src/core/file-handler.ts');
  const kept = mediaFiles([file('a.mp3', 'audio/mpeg'), file('b.txt', 'text/plain'), file('c.mov', '')]);
  assert.deepEqual(kept.map((f) => f.name), ['a.mp3', 'c.mov']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/m3.test.js`
Expected: FAIL — cannot find module `session-manager.ts`.

- [ ] **Step 3: Implement the modules**

`src/core/session-manager.ts` — interfaces exactly as listed above; default session values from the M2 spec: id `default`, name `Cue 1`, icon `🎵`, color `#f2b544`, themes `custom`, activeView `videos`, empty playlist, `currentIndex: -1`, `currentTime: 0`, `currentTrackType: null`, `playbackRate: 1.0`, `muted: false`, `selectedAudioTrack: 0`. `getActive()` throws `SessionManager.init() was not called` when unset.

`src/core/playlist-manager.ts` — `addFiles` takes `fileList[0]` only. Build track: `crypto.randomUUID()`, name without extension (`file.name.replace(/\.[^.]+$/, '')`), type from `mediaKind`, `fileSize`, `fileLastModified`. Store the File in a private `Map`. Set `session.playlist = [track]`, `session.currentIndex = 0`, dispatch `playlist-updated` with `{ sessionId }`. `await broker.loadTrack(...)`; on rejection dispatch `toast` with `{ message: \`Could not load ${file.name}.\` }` and still return the track. Unknown media: `console.warn` and return `null` without touching session state.

`src/core/file-handler.ts` — add exported `mediaFiles(files: File[]): File[]` = `files.filter((f) => mediaKind(f))`. Constructor takes `PlaylistManager`. `openFolderPicker()` builds a hidden `<input type="file">` with `.webkitdirectory = true` and `.multiple = true`, appends it, on `change` calls `this.#playlist.addFiles(mediaFiles([...(input.files ?? [])]))`, resets `input.value`, then `input.click()`. Open with `void`, not a promise.

`src/core/player-broker.ts` — extend `Track` with `fileSize: number; fileLastModified: number;`. In `#ensureElement`, delete the `controls` attribute line; the custom overlay replaces native controls. Nothing else changes.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: M3 tests pass; existing 11 still pass.

- [ ] **Step 5: Commit**

```bash
git add src/core tests/unit/m3.test.js
git commit -m "feat(m3): session and playlist stubs, folder picker"
```

---

### Task 2: Videos layout, DOM, wiring

**Files:**
- Modify: `src/index.html` (full view DOM, static)
- Create: `src/css/layout-videos.css`
- Modify: `src/css/components.css` (drop M2 view styles, keep buttons/toasts)
- Modify: `src/css/base.css` (`.app-footer` → `.app-version`)
- Rewrite: `src/views/videos-view.ts`
- Modify: `src/main.ts`
- Modify: `tests/unit/asset-invariants.test.js`

**Interfaces:**
- Consumes: everything from Task 1. `PlayerBroker.getCurrentElement(sessionId)`, `.seek(sessionId, seconds)`, `.play`, `.pause`, `.getState`.
- Produces: `VideosView` with `constructor({ broker, fileHandler, toasts, sessions })`, `mount(container: HTMLElement): void`, `onActivate(session: Session): void`, `onPlaylistUpdated(): void`. Events consumed: `track-changed`, `time-update`, `state-changed`, `playback-error`, `toast`, `playlist-updated`.

- [ ] **Step 1: Write the failing checks**

Append to `tests/unit/asset-invariants.test.js`:

```js
test('videos layout DOM exposes required controls', () => {
  const html = read('src/index.html');
  for (const id of [
    'view-videos', 'app-header', 'session-title', 'player-media-slot',
    'controls-overlay', 'btn-play-pause', 'seek-bar', 'time-display',
    'btn-volume', 'volume-slider', 'btn-select-file', 'btn-select-folder',
    'playlist-items', 'track-name',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  // Touch has no hover: the overlay starts visible.
  assert.match(html, /id="player-container"[^>]*class="[^"]*show-controls/);
  // Future-milestone controls must not be silently inert.
  for (const id of ['btn-menu', 'btn-theme', 'btn-prev', 'btn-next', 'btn-subtitles', 'btn-pip', 'btn-fullscreen']) {
    const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
    assert.ok(tag.includes('disabled'), `${id} must be disabled`);
    assert.ok(tag.includes('title='), `${id} must explain when it is enabled`);
  }
});

test('layout CSS never uses 100vh and keeps safe-area off the view', () => {
  const css = read('src/css/layout-videos.css');
  assert.ok(!/\b100vh\b/.test(css));
  assert.ok(!/safe-area-inset/.test(css), 'safe-area belongs to body');
  assert.ok(!/100dvh/.test(css), 'view must not claim viewport height');
});
```

- [ ] **Step 2: Run checks to verify they fail**

Run: `npm test`
Expected: FAIL — missing `#view-videos`, missing `src/css/layout-videos.css`.

- [ ] **Step 3: Write `src/index.html`**

Keep all `<head>` tags, `app-footer`/`app-version`, and script tags. Bump the version stamp to `v0.4.0`. Replace `<header class="app-header" id="app-header">cue</header>` and empty `<main>` with:

```html
<main class="app-main">
  <section id="view-videos">
    <header class="top-bar" id="app-header">
      <button id="btn-menu" type="button" disabled aria-disabled="true" title="Sessions — available in M9">☰</button>
      <span id="session-title">Cue 1</span>
      <button id="btn-theme" type="button" disabled aria-disabled="true" title="Themes — available in M8">◐</button>
    </header>
    <div class="main-layout">
      <div class="video-column">
        <section id="player-container" class="show-controls">
          <div id="player-media-slot"></div>
          <div id="controls-overlay">
            <button id="btn-prev" type="button" disabled aria-disabled="true" title="Previous — available in M4">⏮</button>
            <button id="btn-play-pause" type="button" aria-label="Play">▶</button>
            <button id="btn-next" type="button" disabled aria-disabled="true" title="Next — available in M4">⏭</button>
            <input id="seek-bar" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek">
            <span id="time-display">0:00 / 0:00</span>
            <button id="btn-volume" type="button" aria-label="Mute">🔊</button>
            <input id="volume-slider" type="range" min="0" max="1" value="1" step="0.01" aria-label="Volume">
            <button id="btn-subtitles" type="button" disabled aria-disabled="true" title="Subtitles — available in M11">CC</button>
            <button id="btn-pip" type="button" disabled aria-disabled="true" title="Picture in picture — available in M7">PiP</button>
            <button id="btn-airplay" type="button" aria-label="AirPlay">AirPlay</button>
            <button id="btn-fullscreen" type="button" disabled aria-disabled="true" title="Fullscreen — available in M7">⛶</button>
          </div>
        </section>
        <section id="track-info">
          <span id="track-name">No file open</span>
          <span id="track-type-badge"></span>
        </section>
        <section id="action-row">
          <button id="btn-favorite" type="button" disabled aria-disabled="true" title="Favorites — planned">☆</button>
          <button id="btn-info" type="button">Info</button>
        </section>
      </div>
      <aside id="playlist-sidebar">
        <header>Up Next</header>
        <ul id="playlist-items"></ul>
      </aside>
    </div>
    <footer id="app-footer">
      <button id="btn-select-file" class="btn btn-primary" type="button">Select file</button>
      <button id="btn-select-folder" class="btn" type="button">Select folder</button>
    </footer>
  </section>
</main>
<footer class="app-version">v0.4.0</footer>
```

- [ ] **Step 4: Write the CSS**

`src/css/base.css`: rename the `.app-footer` rule to `.app-version`; keep every value.

`src/css/components.css`: delete `.videos-view`, `.videos-toolbar`, `.videos-heading`, `.videos-title`, `.videos-subtitle`, `.player-stage`, `.player-stage video`, `.player-stage audio`, `.player-empty`, `.player-time`, and the `@media (max-width: 520px)` block. Keep `.btn`, `.btn-primary`, `.toasts`, `.toast`.

`src/css/layout-videos.css` (new), values from the spec with two constraints applied:

```css
#view-videos { display: flex; flex-direction: column; min-height: 100%; }
.top-bar { display: flex; align-items: center; gap: 12px; height: var(--header-height); padding: 0 16px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); }
#session-title { flex: 1; font-size: 16px; font-weight: 600; }
.main-layout { flex: 1; display: grid; grid-template-columns: 1fr var(--sidebar-width); gap: 16px; padding: 16px; }
@media (max-width: 899px) { .main-layout { grid-template-columns: 1fr; } }
.video-column { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
#player-container { position: relative; aspect-ratio: 16 / 9; background: #000; border-radius: var(--border-radius); overflow: hidden; }
@media (max-width: 899px) { #player-container { aspect-ratio: 4 / 3; } }
#player-media-slot { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
#player-media-slot video { width: 100%; height: 100%; object-fit: contain; background: #000; }
#player-media-slot audio { width: calc(100% - 32px); }
#controls-overlay { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: linear-gradient(transparent, rgb(0 0 0 / 0.8)); opacity: 0; transition: opacity 0.2s; }
#player-container:hover #controls-overlay, #player-container.show-controls #controls-overlay { opacity: 1; }
#controls-overlay button { background: none; border: 0; color: var(--text-primary); font: inherit; padding: 6px; }
#controls-overlay button:disabled { opacity: 0.4; pointer-events: none; }
#seek-bar { flex: 1; min-width: 0; }
#time-display { font-family: var(--font-family-mono); font-size: 12px; white-space: nowrap; }
#volume-slider { width: 80px; }
#track-info { display: flex; align-items: center; gap: 8px; min-height: 1.4em; }
#track-name { font-weight: 600; overflow-wrap: anywhere; }
#track-type-badge { color: var(--text-secondary); font-size: 12px; text-transform: uppercase; }
#action-row { display: flex; gap: 8px; }
#action-row button:disabled { opacity: 0.4; pointer-events: none; }
#playlist-sidebar { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--border-radius); padding: 12px; min-width: 0; }
#playlist-sidebar header { font-weight: 600; margin-bottom: 8px; }
#playlist-items { list-style: none; margin: 0; padding: 0; }
#playlist-items li { padding: 8px 12px; border-radius: var(--border-radius); cursor: pointer; overflow-wrap: anywhere; }
#playlist-items li:hover { background: var(--bg-hover); }
#playlist-items li.active { background: var(--playlist-active-bg); border-left: 3px solid var(--playlist-active-border); }
#app-footer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border-color); }
@media (max-width: 520px) { #volume-slider { display: none; } #time-display { font-size: 11px; } }
```

Link it in `src/index.html` after `components.css`.

- [ ] **Step 5: Rewrite `src/views/videos-view.ts`**

Bind every element by id. Behavior:

- `mount()`: `broker.attachTo(session.id, #player-media-slot)`; bind buttons; `onActivate(sessions.getActive())`; `onPlaylistUpdated()`; add document listeners for `track-changed` (name, badge, reset seek, reapply volume), `time-update` (seek value + `m:ss` text), `state-changed` (▶ / ❚❚ and aria-label), `playback-error` and `toast` (toasts.show), `playlist-updated` (render).
- `#open()`: `await fileHandler.openFilePicker()`; empty → return; no media → toast `That file type is not supported yet.`; else set `#track-name` to `Loading ${file.name}…` and `await playlist.addFiles([file])` (errors already toast). Do not clear the previous track on failure; the broker restores it.
- `#renderPlaylist()`: one `<li>` per `session.playlist`, `active` on `currentIndex`, `click` reloads the active item only when `broker.getState() !== 'loading'` (M3 has one file; M4 adds `playIndex`).
- Play/pause: `getState() === 'playing' ? pause() : void play()?.catch(() => toast('Playback was blocked by the browser.'))`.
- Seek: on `input`, `duration > 0` → `broker.seek(session.id, (value / 1000) * duration)`.
- Volume: `#volume` field + `session.muted`; `#applyVolume()` sets `el.volume` and `el.muted`; slider input updates both; mute button flips `session.muted`; update icon (🔊/🔇) and aria-label. Reapply on `track-changed`.
- AirPlay: `const el = broker.getCurrentElement(...) as (HTMLMediaElement & { webkitShowPlaybackTargetPicker?: () => void }) | null`; if the method is missing, disable the button with title `AirPlay is unavailable in this browser`; else call it.
- Folder button: if `!('webkitdirectory' in document.createElement('input'))`, hide it with `hidden = true` and set the title; else `fileHandler.openFolderPicker()`.
- `#btn-info`: toast `Track details arrive with metadata extraction (M11).` (placeholder; recorded as a deviation).
- Tap toggle: `pointerdown` on `#player-container` toggles `show-controls` unless the target is inside `#controls-overlay`.
- `onActivate(session)`: set `#session-title`, render playlist, apply volume/mute.
- `onPlaylistUpdated()`: render playlist.

Audio/video elements get no `controls` attribute (removed in Task 1), so the overlay is the only transport.

- [ ] **Step 6: Wire `src/main.ts`**

After `new SessionManager()`, call `void sessions.init().then(...)` and create `PlayerBroker`, `PlaylistManager(sessions, broker)`, `FileHandler(playlist)`, `Toasts`, `VideosView({ broker, fileHandler, toasts, sessions })`, `mount(document.querySelector('.app-main')!)`. Keep the existing `boot()`/`boot-complete` path unchanged and independent.

- [ ] **Step 7: Run tests, typecheck, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass; Workbox still precaches 10 URLs.

- [ ] **Step 8: Commit**

```bash
git add src tests
git commit -m "feat(m3): full videos layout, controls overlay, folder picker wiring"
```

---

### Task 3: Version, milestone record

**Files:**
- Modify: `package.json` (version `0.4.0`)
- Modify: `src/index.html` (already stamped in Task 2; fix if needed)
- Create: `MILESTONE-3.md`

**Interfaces:** none.

- [ ] **Step 1: Bump version**

`package.json` → `"version": "0.4.0"`. Run `npm test`; the footer-version test must pass.

- [ ] **Step 2: Write `MILESTONE-3.md`**

Same shape as `MILESTONE-2.md`: status, delivered, deviations (TS modules, static DOM, safe-area kept on body, no `100dvh` on the view, Info button is a toast, folder picker feature-detected), device checklist from the spec's acceptance list (layout, 16:9/4:3, sidebar stack, folder picker, disabled controls, no horizontal scroll, volume/mute across switches, no safe-area overlap).

- [ ] **Step 3: Run the full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/index.html MILESTONE-3.md
git commit -m "docs: record M3, bump to 0.4.0"
```
