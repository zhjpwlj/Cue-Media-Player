/**
 * Owns every media element. Milestone 2 slice: native files, one track per
 * session, no FormatBridge, no loop-wrap auto-advance (M4/M6).
 *
 * Invariant: every src-clear is followed by revoking the previous blob URL.
 */
export type TrackKind = 'audio' | 'video';

export interface Track {
  id: string;
  name: string;
  type: TrackKind;
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

  async loadTrack(
    sessionId: string,
    track: Track,
    file: Blob,
  ): Promise<HTMLMediaElement | null> {
    const rec = this.#record(sessionId);
    const kind: TrackKind = track.type === 'video' ? 'video' : 'audio';
    const loadId = ++rec.loadId;
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
    rec.urls.set(kind, url);
    element.src = url;
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
    el.setAttribute('controls', ''); // M2 only; custom overlay replaces this in M3
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
      dispatch('time-update', { sessionId, currentTime: el.currentTime, duration: el.duration });
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
    el.addEventListener('ended', () => {
      this.#setState(sessionId, 'ended');
      dispatch('track-ended', { sessionId });
    });
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
    element.removeAttribute('src');
    element.load(); // aborts any in-flight fetch for the old source
    URL.revokeObjectURL(prev);
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
