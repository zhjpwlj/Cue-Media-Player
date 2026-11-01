// src/types/platform.ts
// Minimal platform type for M1. Populated fully at M23.

export type PlatformTier = '1A' | '1B' | '2' | '3';

export interface PlatformFeatures {
  serviceWorker: boolean;
  storagePersist: boolean;
  sharedArrayBuffer: boolean;
  fileSystemAccess: boolean;
  launchQueue: boolean;
  mediaSession: boolean;
  nativeFullscreen: boolean;
  pictureInPicture: boolean;
  windowControlsOverlay: boolean;
  webGL2: boolean;
  hoverPointerFine: boolean;
}

export interface PlatformContext {
  iOS: boolean;
  iPadOS: boolean;
  macOS: boolean;
  android: boolean;
  windows: boolean;
  linux: boolean;
  chromeOS: boolean;
  safari: boolean;
  chrome: boolean;
  edge: boolean;
  firefox: boolean;
  touch: boolean;
  label: string;
  browserLabel: string;
}

export interface Platform {
  features: PlatformFeatures;
  context: PlatformContext;
  tier: PlatformTier;
  fullscreenDefault: 'simulated' | 'native';
}
