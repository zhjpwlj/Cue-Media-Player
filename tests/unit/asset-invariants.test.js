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
