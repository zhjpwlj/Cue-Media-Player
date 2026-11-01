// workbox-config.cjs — CommonJS on purpose: package.json is "type": "module",
// and workbox-cli loads this file with require(), which cannot load ESM.
//
// Mode: injectManifest.
// swSrc is the esbuild output from scripts/build-sw.mjs; swDest is the final SW.
// src/sw.ts contains runtime routes and the format-bridge cache logic.
// This config only controls the injected precache manifest.
//
// WASM binaries are NOT in the injected manifest — they are precached by
// src/sw.ts's precacheFormatBridge() on demand. Putting them here too
// would cache them twice (~40MB) and break the install-completes-fast contract.

module.exports = {
  globDirectory: 'dist/',
  globPatterns: [
    '**/*.{html,css,js,json,png,svg,webp,woff2}',
    'assets/silent.mp3',
  ],
  globIgnores: [
    'assets/wasm/**', // precached by src/sw.ts, not here
    'sw.js',
    'workbox-*.js',
  ],
  swDest: 'dist/sw.js',
  swSrc: '.build/sw.js',
  // 5MB cap on the app-shell manifest. If a future app-shell asset crosses
  // this, Workbox silently drops it from precache — the app will "work"
  // online and fail offline with no obvious error. Bump this value and
  // re-verify offline behavior any time a new app-shell dependency is added.
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
};
