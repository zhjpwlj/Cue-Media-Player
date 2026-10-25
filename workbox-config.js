// workbox-config.js
// Mode: injectManifest.
// swSrc is the source SW template; swDest is the built output.
// src/sw.js contains runtime routes and the format-bridge cache logic.
// This config only controls the injected precache manifest.
//
// WASM binaries are NOT in the injected manifest — they are precached by
// src/sw.js's precacheFormatBridge() on demand. Putting them here too
// would cache them twice (~40MB) and break the install-completes-fast contract.

module.exports = {
  globDirectory: 'dist/',
  globPatterns: [
    '**/*.{html,css,js,json,png,svg,webp,woff2}',
    'assets/silent.mp3',
  ],
  globIgnores: [
    'assets/wasm/**', // precached by src/sw.js, not here
    'sw.js',
    'workbox-*.js',
  ],
  swDest: 'dist/sw.js',
  // Pre-bundled by the esbuild step in npm run build. workbox-cli's
  // injectManifest only injects the manifest; it does not resolve the bare
  // workbox-* imports, so a classic service worker would throw at register time.
  swSrc: '.build/sw.js',
  // 5MB cap on the app-shell manifest. If a future app-shell asset crosses
  // this, Workbox silently drops it from precache — the app will "work"
  // online and fail offline with no obvious error. Bump this value and
  // re-verify offline behavior any time a new app-shell dependency is added.
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
};
