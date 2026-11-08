// Platform facts that M23 will replace with a proper module. Kept pure so the
// gates are unit-testable without a browser.

export interface IOSVersion {
  major: number;
  minor: number;
}

/** iOS/iPadOS reports itself as a Mac with touch in desktop mode. */
export function isIOSDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iP(hone|ad|od)/.test(userAgent)) return true;
  return maxTouchPoints > 1 && /Macintosh/.test(userAgent);
}

/**
 * Safari version on an iOS device. iPadOS desktop-mode UAs carry the real
 * version in `Version/x.y`; older ones carry `OS x_y`.
 */
export function iosVersion(userAgent: string): IOSVersion | null {
  const version = /Version\/(\d+)(?:\.(\d+))?/.exec(userAgent);
  if (version?.[1]) {
    return { major: Number(version[1]), minor: Number(version[2] ?? 0) };
  }
  const os = /OS (\d+)[_.](\d+)/.exec(userAgent);
  if (os?.[1]) {
    return { major: Number(os[1]), minor: Number(os[2] ?? 0) };
  }
  return null;
}

/**
 * `webkitdirectory` exists in the input IDL on iOS well before the picker
 * honors it. iPadOS only gained real directory selection in Safari 18.4
 * (WebKit bug 271705).
 */
export function supportsDirectoryPicker(
  userAgent: string,
  hasWebkitDirectory: boolean,
  isIOS: boolean,
): boolean {
  if (!hasWebkitDirectory) return false;
  if (!isIOS) return true;
  const version = iosVersion(userAgent);
  if (!version) return false;
  return version.major > 18 || (version.major === 18 && version.minor >= 4);
}
