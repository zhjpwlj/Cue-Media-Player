// Invariants that broke or nearly broke during M1. Run with: npm test
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('diagnostics panel inspects the same four converter assets the SW precaches', () => {
  const urls = new Set(read('src/sw.ts').match(/\/assets\/wasm\/[\w.-]+/g) ?? []);
  assert.equal(urls.size, 4, 'sw.ts should reference exactly four converter assets');
  const diagnostics = read('src/diagnostics.ts');
  for (const url of urls) {
    assert.ok(diagnostics.includes(url), `diagnostics.ts is missing ${url}`);
  }
});

test('public/404.html exists', () => {
  // Without it Cloudflare Pages serves index.html (200) for any missing path,
  // including /assets/wasm/*, which the SW would then cache as a converter binary.
  assert.ok(existsSync(join(root, 'public', '404.html')));
});

test('footer version matches package.json', () => {
  const { version } = JSON.parse(read('package.json'));
  assert.ok(read('src/index.html').includes(`>v${version}<`), 'footer version drifted from package.json');
});

test('no 100vh and no userAgent sniffing in app sources', () => {
  for (const file of ['src/css/base.css', 'src/css/components.css']) {
    assert.ok(!/\b100vh\b/.test(read(file)), `${file} uses 100vh; use 100dvh`);
  }
  assert.ok(!/navigator\.userAgent/.test(read('src/main.ts')));
});

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
  for (const id of ['btn-menu', 'btn-subtitles']) {
    const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
    assert.ok(tag.includes('disabled'), `${id} must be disabled`);
    assert.ok(tag.includes('title='), `${id} must explain when it is enabled`);
  }
  // M8 enabled the theme picker.
  {
    const tag = html.match(/<button[^>]*id="btn-theme"[^>]*>/)?.[0] ?? '';
    assert.ok(!tag.includes('disabled'), 'btn-theme must be enabled in M8');
    assert.ok(tag.includes('aria-label='), 'btn-theme needs a label');
  }
  // M7 enabled fullscreen and PiP; they ship hidden until a video loads.
  for (const id of ['btn-fullscreen', 'btn-pip']) {
    const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
    assert.ok(!tag.includes('disabled'), `${id} must be enabled in M7`);
    assert.ok(tag.includes('hidden'), `${id} must start hidden (no video yet)`);
    assert.ok(tag.includes('aria-label='), `${id} needs a label`);
  }
  // M7 settings sheet owns the fullscreen-mode toggle.
  for (const id of ['btn-settings', 'settings-modal', 'pref-simulated-fs', 'btn-settings-close']) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  // M4 enabled these; they must carry a label instead of a milestone tooltip.
  for (const id of ['btn-prev', 'btn-next']) {
    const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
    assert.ok(!tag.includes('disabled'), `${id} must be enabled in M4`);
    assert.ok(tag.includes('aria-label='), `${id} needs a label`);
  }
});

test('layout CSS never uses 100vh and keeps safe-area off the view', () => {
  const css = read('src/css/layout-videos.css');
  assert.ok(!/\b100vh\b/.test(css));
  assert.ok(!/safe-area-inset/.test(css), 'safe-area belongs to body');
  assert.ok(!/100dvh/.test(css), 'view must not claim viewport height');
});

test('simulated fullscreen insets the controls, not the video', () => {
  const css = read('src/css/components.css');
  assert.match(css, /body\.simulated-fs-active #player-container \{[^}]*100dvh/s);
  assert.match(
    css,
    /body\.simulated-fs-active #controls-overlay \{[^}]*safe-area-inset-bottom/s,
    'fullscreen controls must clear the home indicator',
  );
});

test('updates activate silently and bypass the HTTP cache', () => {
  assert.match(read('src/sw.ts'), /self\.skipWaiting\(\)/, 'worker must auto-activate updates');
  const main = read('src/main.ts');
  assert.ok(main.includes("updateViaCache: 'none'"), 'sw.js must not come from HTTP cache');
  assert.ok(main.includes('reg.update()'), 'launch must check for a new deployment');
  assert.ok(!main.includes('sw-update-available'), 'no manual update prompt remains');
});

test('theme manifest lists five video and five audio themes, files present', () => {
  const manifest = JSON.parse(read('public/assets/themes/manifest.json'));
  assert.equal(manifest.video.length, 5);
  assert.equal(manifest.audio.length, 5);
  for (const kind of ['video', 'audio']) {
    const ids = manifest[kind].map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, `${kind} theme ids must be unique`);
    for (const entry of manifest[kind]) {
      assert.ok(entry.color, `${entry.id} needs a picker swatch`);
      const file = `public${entry.path}`;
      assert.ok(existsSync(join(root, file)), `missing ${file}`);
      const css = read(file);
      if (kind === 'video') {
        assert.ok(css.includes(':root'), `${entry.id} must set the variable contract`);
      } else {
        assert.ok(
          css.includes(`.audio-skin-${entry.id}`),
          `${entry.id} audio theme must be scoped to its class`,
        );
        assert.ok(!css.includes(':root'), `${entry.id} audio theme must not touch global vars`);
      }
    }
  }
});

test('theme CSS is inside the precache glob', () => {
  const config = read('workbox-config.cjs');
  assert.ok(config.includes('css'), 'theme CSS must be precached with the shell');
});

test('audio skin surface and theme picker DOM exist', () => {
  const html = read('src/index.html');
  for (const id of [
    'audio-skin-mount', 'theme-picker', 'video-theme-options',
    'audio-theme-options', 'btn-theme-close',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /id="audio-skin-mount"[^>]*hidden/, 'skin stays hidden until audio plays');
});
