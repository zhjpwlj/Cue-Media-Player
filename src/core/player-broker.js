/**
 * Owns every media element. Milestone 2 slice: native files, one track per
 * session, no FormatBridge, no loop-wrap auto-advance (M4/M6).
 *
 * Invariant: every src-clear is followed by revoking the previous blob URL.
 */
const KIND_TO_ELEMENT = { audio: 'audioClean', video: 'video' };
const ELEMENT_TO_KIND = { audioClean: 'audio', video: 'video' };
// Sixteen-core iPad storage can stall on an iCloud placeholder; do not wait forever.
const LOAD_TIMEOUT_MS = 30_000;

export default class PlayerBroker {
  constructor() {
    /** @type {Map<string, object>} */
    this.sessions = new Map();
  }

  /**
   * @param {string} sessionId
   * @param {{id:string,name:string,type:'audio'|'video'}} track
   * @param {File} file
   */
  async loadTrack(sessionId, track, file) {
    const rec = this.#record(sessionId);
    const kind = track.type === 'video' ? 'video' : 'audio';
    const loadId = ++rec.loadId;
    this.#setState(sessionId, 'loading');

    // Step 3: every element not being loaded this round is released.
    for (const [elementName, otherKind] of Object.entries(ELEMENT_TO_KIND)) {
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

  play(sessionId) {
    return this.#current(sessionId)?.play();
  }

  pause(sessionId) {
    this.#current(sessionId)?.pause();
  }

  seek(sessionId, seconds) {
    const el = this.#current(sessionId);
    if (el && Number.isFinite(seconds)) el.currentTime = seconds;
  }

  getState(sessionId) {
    return this.#record(sessionId).state;
  }

  getCurrentElement(sessionId) {
    return this.#current(sessionId) ?? null;
  }

  /**
   * Puts the active element into the view's stage. Safe to call before a load.
   */
  attachTo(sessionId, container) {
    const rec = this.#record(sessionId);
    rec.container = container;
    const el = this.#current(sessionId);
    if (el) container.replaceChildren(el);
  }

  #record(sessionId) {
    let rec = this.sessions.get(sessionId);
    if (!rec) {
      rec = { audioClean: null, video: null, urls: new Map(), container: null, currentType: null, track: null, state: 'idle', lastGood: null, loadId: 0 };
      this.sessions.set(sessionId, rec);
    }
    return rec;
  }

  #current(sessionId) {
    const rec = this.sessions.get(sessionId);
    if (!rec?.currentType) return null;
    return rec[KIND_TO_ELEMENT[rec.currentType]] ?? null;
  }

  #ensureElement(sessionId, kind) {
    const rec = this.#record(sessionId);
    const name = KIND_TO_ELEMENT[kind];
    if (rec[name]) return rec[name];

    const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
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

  #bind(el, sessionId, kind) {
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

  #pauseOthers(playingElement) {
    for (const rec of this.sessions.values()) {
      for (const name of Object.keys(ELEMENT_TO_KIND)) {
        const el = rec[name];
        if (el && el !== playingElement && !el.paused) el.pause();
      }
    }
  }

  #release(rec, kind, element) {
    const prev = rec.urls.get(kind);
    // Nothing loaded yet: load() on an empty src can raise error in Safari.
    if (!prev) return;
    element.pause();
    element.removeAttribute('src');
    element.load(); // aborts any in-flight fetch for the old source
    URL.revokeObjectURL(prev);
    rec.urls.delete(kind);
  }

  #mount(sessionId, element) {
    const rec = this.sessions.get(sessionId);
    if (!rec.container) return;
    if (rec.container.firstChild !== element) rec.container.replaceChildren(element);
  }

  #setState(sessionId, state) {
    const rec = this.#record(sessionId);
    if (rec.state === state) return;
    rec.state = state;
    dispatch('state-changed', { sessionId, state });
  }
}

function onceLoaded(el, timeoutMs = LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let timer;
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('Media element failed to load'));
    };
    const cleanup = () => {
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

function dispatch(type, detail) {
  document.dispatchEvent(new CustomEvent(type, { detail }));
}
