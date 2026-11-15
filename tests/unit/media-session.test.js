import test from 'node:test';
import assert from 'node:assert';

const events = [];
const listeners = new Map();
let visibility = 'visible';

globalThis.document = {
  get visibilityState() {
    return visibility;
  },
  dispatchEvent: (e) => {
    events.push(e);
    for (const fn of listeners.get(e.type) ?? []) fn(e);
    return true;
  },
  addEventListener: (type, fn) => {
    const list = listeners.get(type) ?? [];
    list.push(fn);
    listeners.set(type, list);
  },
  createElement: (tag) => {
    assert.equal(tag, 'canvas');
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
        fillRect() {},
        fillText() {},
      }),
      toDataURL: () => 'data:image/png;base64,art',
    };
  },
};

const handlers = new Map();
const mediaSession = {
  metadata: null,
  playbackState: 'none',
  setActionHandler(action, handler) {
    handlers.set(action, handler);
  },
};

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { mediaSession },
});

globalThis.MediaMetadata = class {
  constructor(init) {
    Object.assign(this, init);
  }
};

const fire = (type, detail = {}) =>
  document.dispatchEvent(new CustomEvent(type, { detail }));

const { default: SessionManager } = await import('../../src/core/session-manager.ts');
const { default: MediaSessionController } = await import('../../src/core/media-session.ts');

const track = (name) => ({
  id: name,
  name,
  type: 'audio',
  fileSize: 1,
  fileLastModified: 1,
});

async function setup() {
  handlers.clear();
  listeners.clear();
  events.length = 0;
  visibility = 'visible';
  mediaSession.metadata = null;
  mediaSession.playbackState = 'none';

  const sessions = new SessionManager();
  await sessions.init();
  const session = sessions.getActive();
  session.playlist = [track('one'), track('two')];
  session.currentIndex = 0;
  session.currentTrackType = 'audio';

  const calls = { plays: 0, pauses: 0, next: 0, prev: 0 };
  const state = { value: 'paused' };
  const broker = {
    play: () => { calls.plays += 1; return Promise.resolve(); },
    pause: () => { calls.pauses += 1; },
    getState: () => state.value,
  };
  const registries = new Map([[
    sessions.activeSessionId,
    { next: () => { calls.next += 1; }, prev: () => { calls.prev += 1; } },
  ]]);

  const controller = new MediaSessionController(broker, sessions, registries);
  controller.init();
  return { sessions, session, calls, state, controller };
}

test('init registers handlers, metadata and artwork', async () => {
  await setup();
  assert.equal(mediaSession.metadata.title, 'one');
  assert.equal(mediaSession.metadata.artist, 'Cue 1');
  assert.equal(mediaSession.metadata.artwork[0].src, 'data:image/png;base64,art');
  for (const action of ['play', 'pause', 'previoustrack', 'nexttrack']) {
    assert.equal(typeof handlers.get(action), 'function', `${action} missing`);
  }
  assert.equal(handlers.get('seekbackward'), null);
  assert.equal(handlers.get('seekforward'), null);
});

test('track-changed swaps metadata and keeps playback state in sync', async () => {
  const { session } = await setup();
  session.currentIndex = 1;
  fire('track-changed', { sessionId: session.id, track: track('two') });
  assert.equal(mediaSession.metadata.title, 'two');

  fire('state-changed', { sessionId: session.id, state: 'playing' });
  assert.equal(mediaSession.playbackState, 'playing');
  fire('state-changed', { sessionId: session.id, state: 'ended' });
  assert.equal(mediaSession.playbackState, 'paused');
});

test('lock-screen play, pause, prev and next reach the app', async () => {
  const { calls } = await setup();
  handlers.get('play')();
  handlers.get('pause')();
  handlers.get('previoustrack')();
  handlers.get('nexttrack')();
  assert.equal(calls.plays, 1);
  assert.equal(calls.pauses, 1);
  assert.equal(calls.prev, 1);
  assert.equal(calls.next, 1);
});

test('hiding while a video plays detaches; returning re-attaches', async () => {
  const { session, calls } = await setup();
  session.currentTrackType = 'video';

  visibility = 'hidden';
  fire('visibilitychange');
  assert.equal(calls.pauses, 1);
  assert.equal(mediaSession.metadata, null);
  assert.equal(handlers.get('nexttrack'), null, 'handlers unregistered');
  assert.equal(mediaSession.playbackState, 'paused');

  visibility = 'visible';
  fire('visibilitychange');
  assert.equal(mediaSession.metadata.title, 'one');
  assert.equal(typeof handlers.get('nexttrack'), 'function');
});

test('hiding while audio plays keeps metadata attached', async () => {
  await setup();
  visibility = 'hidden';
  fire('visibilitychange');
  assert.equal(mediaSession.metadata.title, 'one');
  assert.equal(typeof handlers.get('play'), 'function');
});
