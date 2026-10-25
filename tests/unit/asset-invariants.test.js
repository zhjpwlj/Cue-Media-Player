// Invariants that broke or nearly broke during M1. Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('diagnostics panel inspects the same four converter assets the SW precaches', () => {
  const urls = new Set(read('src/sw.js').match(/\/assets\/wasm\/[\w.-]+/g) ?? []);
  assert.equal(urls.size, 4, 'sw.js should reference exactly four converter assets');
  const diagnostics = read('src/diagnostics.js');
  for (const url of urls) {
    assert.ok(diagnostics.includes(url), `diagnostics.js is missing ${url}`);
  }
});

test('public/404.html exists', () => {
  // Without it Cloudflare Pages serves index.html (200) for any missing path,
  // including /assets/wasm/*, which the SW would then cache as a converter binary.
  assert.ok(existsSync(join(root, 'public', '404.html')));
});
