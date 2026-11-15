// Debug logging gated behind `?debug=1` (then persisted in localStorage) so a
// production build never spams the console. Recent lines also feed the
// diagnostics panel, which is the only log surface on an untethered iPad.

const MAX_LINES = 24;
const lines: string[] = [];
let cached: boolean | null = null;

export function debugLogging(): boolean {
  if (cached !== null) return cached;
  try {
    const params = new URLSearchParams(
      typeof location !== 'undefined' ? location.search : '',
    );
    const fromQuery = params.has('debug');
    if (fromQuery) localStorage.setItem('cue-debug', '1');
    cached = fromQuery || localStorage.getItem('cue-debug') === '1';
  } catch {
    cached = false;
  }
  return cached;
}

export function debug(tag: string, ...args: unknown[]): void {
  if (!debugLogging()) return;
  const line = `[${tag}] ${args.map((arg) => String(arg)).join(' ')}`;
  console.debug(line);
  lines.push(line);
  if (lines.length > MAX_LINES) lines.shift();
}

export function debugLogLines(): readonly string[] {
  return lines;
}

export function setDebugLogging(on: boolean): void {
  cached = on;
  try {
    if (on) localStorage.setItem('cue-debug', '1');
    else localStorage.removeItem('cue-debug');
  } catch {
    // Private mode: the in-memory flag still works for this session.
  }
}

export function clearDebugLog(): void {
  lines.length = 0;
}
