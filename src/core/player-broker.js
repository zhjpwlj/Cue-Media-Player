/**
 * Owns every media element. Milestone 2 slice: native files, one track per
 * session, no FormatBridge, no loop-wrap auto-advance (M4/M6).
 *
 * Invariant: every src-clear is followed by revoking the previous blob URL.
 */
const KIND_TO_ELEMENT = { audio: 'audioClean', video: 'video' };
const ELEMENT_TO_KIND = { audioClean: 'audio', video: 'video' };

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
      this.#release(rec, kind, element);
      rec.currentType = null;
      rec.track = null;
      this.#setState(sessionId, 'idle');
      throw err;
    }

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
      rec = { audioClean: null, video: null, urls: new Map(), container: null, currentType: null, track: null, state: 'idle' };
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
      dispatch('time-update', { sessionId, currentTime: el.currentTime, duration: el.duration });
    });
    el.addEventListener('timeupdate', () => {
      dispatch('time-update', { sessionId, currentTime: el.currentTime, duration: el.duration });
    });
    el.addEventListener('play', () => {
      this.#pauseOthers(sessionId, el);
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
      const message = el.error?.code === 4 ? 'Format not supported' : 'Playback failed';
      dispatch('playback-error', { sessionId, message, kind });
    });
  }

  #pauseOthers(sessionId, playingElement) {
    for (const [id, rec] of this.sessions) {
      for (const name of Object.keys(ELEMENT_TO_KIND)) {
        const el = rec[name];
        if (el && el !== playingElement && !el.paused) el.pause();
      }
      if (id === sessionId) continue;
      // State is driven by each element's own pause event.
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

function onceLoaded(el) {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('Media element failed to load'));
    };
    const cleanup = () => {
      el.removeEventListener('loadedmetadata', ok);
      el.removeEventListener('error', fail);
    };
    el.addEventListener('loadedmetadata', ok, { once: true });
    el.addEventListener('error', fail, { once: true });
  });
}

function dispatch(type, detail) {
  document.dispatchEvent(new CustomEvent(type, { detail }));
}
