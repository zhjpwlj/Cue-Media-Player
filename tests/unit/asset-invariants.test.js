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
  for (const id of ['btn-menu', 'btn-theme', 'btn-subtitles']) {
    const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
    assert.ok(tag.includes('disabled'), `${id} must be disabled`);
    assert.ok(tag.includes('title='), `${id} must explain when it is enabled`);
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
