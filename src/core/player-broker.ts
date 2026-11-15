/**
 * Owns every media element. Milestone 2 slice: native files, one track per
 * session, no FormatBridge, no loop-wrap auto-advance (M4/M6).
 *
 * Invariant: every src-clear is followed by revoking the previous blob URL.
 */
import { debug } from '../utils/debug.ts';

export type TrackKind = 'audio' | 'video';
export type FullscreenMode = 'simulated' | 'native';

/** iOS exposes the WebKit-prefixed fullscreen and PiP entry points. */
type FullscreenElement = HTMLMediaElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
  requestPictureInPicture?: () => Promise<unknown>;
  webkitSetPresentationMode?: (mode: 'picture-in-picture' | 'inline' | 'fullscreen') => void;
};

export interface Track {
  id: string;
  name: string;
  type: TrackKind;
  fileSize: number;
  fileLastModified: number;
}

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended';

interface SessionRecord {
  audioClean: HTMLMediaElement | null;
  video: HTMLMediaElement | null;
  urls: Map<TrackKind, string>;
  container: HTMLElement | null;
  currentType: TrackKind | null;
  track: Track | null;
  state: PlayerState;
  lastGood: { track: Track; file: Blob } | null;
  loadId: number;
}

const KIND_TO_ELEMENT = { audio: 'audioClean', video: 'video' } as const;
type ElementName = (typeof KIND_TO_ELEMENT)[TrackKind];
const ELEMENT_NAMES: readonly ElementName[] = ['audioClean', 'video'];
const ELEMENT_TO_KIND: Record<ElementName, TrackKind> = {
  audioClean: 'audio',
  video: 'video',
};
// Sixteen-core iPad storage can stall on an iCloud placeholder; do not wait forever.
const LOAD_TIMEOUT_MS = 30_000;

export default class PlayerBroker {
  #sessions = new Map<string, SessionRecord>();
  // Auto-advance fires once per track even when `ended`, `timeupdate`, and the
  // audio loop-wrap path overlap.
  #advanced = new WeakSet<HTMLMediaElement>();
  #lastTime = new WeakMap<HTMLMediaElement, number>();
  #createdUrls = 0;
  #revokedUrls = 0;
  #simulatedFs: string | null = null;
  #fullscreenMode: (() => FullscreenMode) | null;

  constructor(getFullscreenMode?: () => FullscreenMode) {
    latestBroker = this;
    this.#fullscreenMode = getFullscreenMode ?? null;
    document.addEventListener?.('keydown', (event) => {
      if (event.key !== 'Escape' || !this.#simulatedFs) return;
      // A modal must not close at the same time as fullscreen.
      event.stopPropagation();
      this.exitFullscreen(this.#simulatedFs);
    });
  }

  get simulatedFsActive(): string | null {
    return this.#simulatedFs;
  }

  /**
   * Simulated mode is pure CSS: the player container is promoted to a fixed
   * viewport layer. Native mode hands the element to the platform player.
   */
  async enterFullscreen(sessionId: string): Promise<void> {
    const mode = this.#fullscreenMode?.() ?? 'simulated';
    if (mode === 'native') {
      await this.#enterNativeFullscreen(sessionId);
      return;
    }
    document.body.classList.add('simulated-fs-active');
    document.getElementById('player-container')?.classList.add('fs-root');
    this.#simulatedFs = sessionId;
    dispatch('fullscreen-changed', { sessionId, active: true, mode: 'simulated' });
  }

  exitFullscreen(sessionId: string): void {
    document.body.classList.remove('simulated-fs-active');
    document.getElementById('player-container')?.classList.remove('fs-root');
    if (this.#simulatedFs) {
      this.#simulatedFs = null;
      dispatch('fullscreen-changed', { sessionId, active: false, mode: 'simulated' });
    }
    const el = this.getCurrentElement(sessionId) as FullscreenElement | null;
    if (el?.webkitDisplayingFullscreen) el.webkitExitFullscreen?.();
    if (document.fullscreenElement) void document.exitFullscreen?.();
  }

  /** PiP is video-only; entering it leaves simulated fullscreen first. */
  async enterPiP(sessionId: string): Promise<boolean> {
    const el = this.getCurrentElement(sessionId) as FullscreenElement | null;
    if (!el || el.tagName !== 'VIDEO') return false;
    if (this.#simulatedFs) this.exitFullscreen(this.#simulatedFs);

    // Safari/iPadOS expose PiP through the presentation-mode setter only.
    if (typeof el.webkitSetPresentationMode === 'function') {
      el.webkitSetPresentationMode('picture-in-picture');
      return true;
    }
    if (typeof el.requestPictureInPicture !== 'function') return false;
    try {
      await el.requestPictureInPicture();
      return true;
    } catch (err) {
      // Rejects when the video is not loaded or the platform disabled PiP.
      debug('broker', 'PiP failed', err);
      return false;
    }
  }

  /** True when this element can enter picture in picture on this platform. */
  supportsPiP(sessionId: string): boolean {
    const el = this.getCurrentElement(sessionId) as FullscreenElement | null;
    if (!el || el.tagName !== 'VIDEO') return false;
    return (
      typeof el.webkitSetPresentationMode === 'function' ||
      typeof el.requestPictureInPicture === 'function'
    );
  }

  async #enterNativeFullscreen(sessionId: string): Promise<void> {
    const el = this.getCurrentElement(sessionId) as FullscreenElement | null;
    if (!el) return;
    if (typeof el.webkitEnterFullscreen === 'function') {
      el.webkitEnterFullscreen();
      return;
    }
    if (typeof el.requestFullscreen === 'function') {
      try {
        await el.requestFullscreen();
      } catch (err) {
        debug('broker', 'native fullscreen failed', err);
      }
    }
  }

  async loadTrack(
    sessionId: string,
    track: Track,
    file: Blob,
  ): Promise<HTMLMediaElement | null> {
    const rec = this.#record(sessionId);
    const kind: TrackKind = track.type === 'video' ? 'video' : 'audio';
    // Simulated fullscreen has nothing to show for audio; drop back to the view.
    if (kind === 'audio' && this.#simulatedFs === sessionId) this.exitFullscreen(sessionId);
    const loadId = ++rec.loadId;
    debug('broker', 'loadTrack started for', track.name);
    this.#setState(sessionId, 'loading');

    // Step 3: every element not being loaded this round is released.
    for (const elementName of ELEMENT_NAMES) {
      const otherKind = ELEMENT_TO_KIND[elementName];
      if (otherKind === kind) continue;
      const other = rec[elementName];
      if (other) this.#release(rec, otherKind, other);
    }

    const element = this.#ensureElement(sessionId, kind);
    this.#release(rec, kind, element);

    rec.track = track;
    rec.currentType = kind;
    const url = URL.createObjectURL(file);
    this.#createdUrls += 1;
    rec.urls.set(kind, url);
    element.src = url;
    this.#lastTime.set(element, 0);
    // Deliberately do NOT clear #advanced here: the previous track's queued
    // `ended` event can arrive after the swap and must not advance the new one.
    this.#mount(sessionId, element);

    try {
      await onceLoaded(element);
    } catch (err) {
      // A newer load owns the element now; this one must not roll it back.
      if (rec.loadId !== loadId) return null;
      this.#release(rec, kind, element);
      rec.currentType = null;
      rec.track = null;
      this.#setState(sessionId, 'idle');

      const restore = rec.lastGood;
      if (restore) {
        rec.lastGood = null;
        try {
          const restored = await this.loadTrack(sessionId, restore.track, restore.file);
          if (restored) rec.lastGood = restore;
        } catch {
          // The original failure is the one the caller reports.
        }
      }
      throw err;
    }

    if (rec.loadId !== loadId) return null;

    rec.lastGood = { track, file };
    this.#setState(sessionId, 'paused');
    dispatch('track-changed', { sessionId, track });
    debug('broker', 'track-changed emitted for', track.name);
    return element;
  }

  play(sessionId: string): Promise<void> | undefined {
    return this.#current(sessionId)?.play();
  }

  pause(sessionId: string): void {
    this.#current(sessionId)?.pause();
  }

  seek(sessionId: string, seconds: number): void {
    const el = this.#current(sessionId);
    if (el && Number.isFinite(seconds)) el.currentTime = seconds;
  }

  getState(sessionId: string): PlayerState {
    return this.#record(sessionId).state;
  }

  getCurrentElement(sessionId: string): HTMLMediaElement | null {
    return this.#current(sessionId);
  }

  /** Forces the session into the terminal state without another media event. */
  markEnded(sessionId: string): void {
    this.#setState(sessionId, 'ended');
  }

  /** createObjectURL - revokeObjectURL; at rest this should equal live sources. */
  blobUrlStats(): { created: number; revoked: number } {
    return { created: this.#createdUrls, revoked: this.#revokedUrls };
  }

  /**
   * Aborts an in-flight load and restores the last good track, paused. The
   * superseded loadTrack() sees a stale loadId and rolls nothing back.
   */
  async cancelLoad(sessionId: string): Promise<void> {
    const rec = this.#sessions.get(sessionId);
    if (!rec || rec.state !== 'loading') return;
    ++rec.loadId;

    const element = this.getCurrentElement(sessionId);
    if (element && rec.currentType) {
      element.pause();
      this.#release(rec, rec.currentType, element);
    }
    rec.currentType = null;
    rec.track = null;

    const restore = rec.lastGood;
    rec.lastGood = null;
    if (!restore) {
      this.#setState(sessionId, 'idle');
      return;
    }
    try {
      await this.loadTrack(sessionId, restore.track, restore.file);
      this.pause(sessionId);
    } catch {
      this.#setState(sessionId, 'idle');
    }
  }

  /**
   * Puts the active element into the view's stage. Safe to call before a load.
   */
  attachTo(sessionId: string, container: HTMLElement): void {
    const rec = this.#record(sessionId);
    rec.container = container;
    const el = this.#current(sessionId);
    if (el) container.replaceChildren(el);
  }

  #record(sessionId: string): SessionRecord {
    let rec = this.#sessions.get(sessionId);
    if (!rec) {
      rec = {
        audioClean: null,
        video: null,
        urls: new Map(),
        container: null,
        currentType: null,
        track: null,
        state: 'idle',
        lastGood: null,
        loadId: 0,
      };
      this.#sessions.set(sessionId, rec);
    }
    return rec;
  }

  #current(sessionId: string): HTMLMediaElement | null {
    const rec = this.#sessions.get(sessionId);
    if (!rec?.currentType) return null;
    return rec[KIND_TO_ELEMENT[rec.currentType]] ?? null;
  }

  #ensureElement(sessionId: string, kind: TrackKind): HTMLMediaElement {
    const rec = this.#record(sessionId);
    const name = KIND_TO_ELEMENT[kind];
    const existing = rec[name];
    if (existing) return existing;

    const el: HTMLMediaElement = document.createElement(kind === 'audio' ? 'audio' : 'video');
    el.preload = 'metadata';
    // No native controls: the Videos view owns the transport overlay.
    el.setAttribute('playsinline', ''); // iOS: otherwise video hijacks fullscreen
    el.setAttribute('webkit-playsinline', '');
    el.setAttribute('x-webkit-airplay', 'allow');
    if (kind === 'audio') {
      el.loop = true; // §6.2: set once at creation, never toggled per track
    }
    this.#bind(el, sessionId, kind);
    rec[name] = el;
    return el;
  }

  #bind(el: HTMLMediaElement, sessionId: string, kind: TrackKind): void {
    el.addEventListener('loadedmetadata', () => {
      if (this.#current(sessionId) !== el) return;
      dispatch('time-update', { sessionId, currentTime: el.currentTime, duration: el.duration });
    });
    el.addEventListener('timeupdate', () => {
      if (this.#current(sessionId) !== el) return;
      this.#lastTime.set(el, el.currentTime);
      dispatch('time-update', { sessionId, currentTime: el.currentTime, duration: el.duration });
      this.#checkEnd(sessionId, el);
    });
    el.addEventListener('play', () => {
      this.#pauseOthers(el);
      this.#setState(sessionId, 'playing');
      dispatch('playback-started', { sessionId });
    });
    el.addEventListener('pause', () => {
      const state = this.getState(sessionId);
      // Releasing a source pauses it; do not let that overwrite loading/ended.
      if (state === 'ended' || state === 'loading') return;
      this.#setState(sessionId, 'paused');
      dispatch('playback-paused', { sessionId });
    });
    // Audio never fires `ended` while loop is true: catch the wrap instead.
    if (kind === 'audio') {
      el.addEventListener('seeking', () => {
        if (this.#current(sessionId) !== el) return;
        const previous = this.#lastTime.get(el) ?? 0;
        const duration = el.duration;
        const wrapped =
          Number.isFinite(duration) &&
          duration > 0 &&
          previous > duration - 1 &&
          el.currentTime < 0.5;
        if (wrapped && !this.#advanced.has(el)) {
          this.#markAdvanced(el);
          el.pause();
          this.#emitTrackEnded(sessionId);
        }
        this.#lastTime.set(el, el.currentTime);
      });
    } else {
      el.addEventListener('ended', () => {
        if (this.#current(sessionId) !== el) return;
        if (this.#advanced.has(el)) return;
        this.#markAdvanced(el);
        this.#emitTrackEnded(sessionId);
      });
    }
    el.addEventListener('error', () => {
      // A load failure rejects loadTrack; report it once from there.
      if (this.getState(sessionId) === 'loading') return;
      // A released element can still emit error; it must not speak for the session.
      if (this.#current(sessionId) !== el) return;
      this.#setState(sessionId, 'paused');
      const message = el.error?.code === 4 ? 'Format not supported' : 'Playback failed';
      dispatch('playback-error', { sessionId, message, kind });
    });
  }

  #checkEnd(sessionId: string, el: HTMLMediaElement): void {
    if (this.#advanced.has(el)) return;
    const duration = el.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const threshold = duration > 2 ? 0.5 : duration * 0.25;
    if (el.currentTime < duration - threshold) return;
    this.#markAdvanced(el);
    this.#emitTrackEnded(sessionId);
  }

  #emitTrackEnded(sessionId: string): void {
    debug('broker', 'track-ended emitted for session', sessionId);
    dispatch('track-ended', { sessionId });
  }

  #markAdvanced(el: HTMLMediaElement): void {
    this.#advanced.add(el);
    setTimeout(() => this.#advanced.delete(el), 2000);
  }

  #pauseOthers(playingElement: HTMLMediaElement): void {
    for (const rec of this.#sessions.values()) {
      for (const name of ELEMENT_NAMES) {
        const el = rec[name];
        if (el && el !== playingElement && !el.paused) el.pause();
      }
    }
  }

  #release(rec: SessionRecord, kind: TrackKind, element: HTMLMediaElement): void {
    const prev = rec.urls.get(kind);
    // Nothing loaded yet: load() on an empty src can raise error in Safari.
    if (!prev) return;
    element.pause();
    // Reset the wrap detector before the src reset, or the resulting seek from
    // near-end to 0 looks like a loop and fires a false track-ended.
    this.#lastTime.set(element, 0);
    element.removeAttribute('src');
    element.load(); // aborts any in-flight fetch for the old source
    URL.revokeObjectURL(prev);
    this.#revokedUrls += 1;
    rec.urls.delete(kind);
  }

  #mount(sessionId: string, element: HTMLMediaElement): void {
    const rec = this.#record(sessionId);
    if (!rec.container) return;
    if (rec.container.firstChild !== element) rec.container.replaceChildren(element);
  }

  #setState(sessionId: string, state: PlayerState): void {
    const rec = this.#record(sessionId);
    if (rec.state === state) return;
    rec.state = state;
    dispatch('state-changed', { sessionId, state });
  }
}

function onceLoaded(el: HTMLMediaElement, timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const ok = (): void => {
      cleanup();
      resolve();
    };
    const fail = (): void => {
      cleanup();
      reject(new Error('Media element failed to load'));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      el.removeEventListener('loadedmetadata', ok);
      el.removeEventListener('error', fail);
    };
    el.addEventListener('loadedmetadata', ok, { once: true });
    el.addEventListener('error', fail, { once: true });
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Media metadata timed out'));
    }, timeoutMs);
  });
}

function dispatch(type: string, detail: unknown): void {
  document.dispatchEvent(new CustomEvent(type, { detail }));
}

let latestBroker: PlayerBroker | null = null;

/** Diagnostics hook; the panel has no reference to the broker instance. */
export function blobUrlDiagnostics(): string {
  if (!latestBroker) return 'no player yet';
  const { created, revoked } = latestBroker.blobUrlStats();
  return `created=${created} revoked=${revoked} delta=${created - revoked}`;
}
