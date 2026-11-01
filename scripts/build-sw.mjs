// Compiles src/sw.ts → .build/sw.js via esbuild.
//
// iife, not esm: the SW is registered as a classic worker, and Safari does not
// run a module service worker via the plain `type`-less registration used here.
// Bundling keeps every workbox-* import inside the file; workbox-cli's
// injectManifest only injects the precache manifest and never resolves imports.

import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('.build', { recursive: true });

await build({
  entryPoints: ['src/sw.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: '.build/sw.js',
  minify: false, // readable stack traces on the device
});

console.log('sw.ts compiled to .build/sw.js');
