import test from 'node:test';
import assert from 'node:assert';

const events = [];
const listeners = new Map();

globalThis.document = {
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
};

const file = (name, type = '') => ({ name, type, size: 10, lastModified: 1 });
const tracks = (count) =>
  Array.from({ length: count }, (_, i) => file(`track-${i + 1}.mp3`, 'audio/mpeg'));

function reset() {
  events.length = 0;
  listeners.clear();
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function makeBroker() {
  const loaded = [];
  const plays = [];
  let state = 'idle';
  return {
    loaded,
    plays,
    setState: (next) => { state = next; },
    loadTrack: async (_id, track) => {
      state = 'paused';
      loaded.push(track.name);
      return null;
    },
    play: async () => {
      plays.push(loaded.at(-1));
    },
    pause: () => { state = 'paused'; },
    getState: () => state,
    markEnded: () => { state = 'ended'; },
  };
}

async function setup(count = 3) {
  reset();
  const { default: SessionManager } = await import('../../src/core/session-manager.ts');
  const { default: PlaylistManager } = await import('../../src/core/playlist-manager.ts');
  const sessions = new SessionManager();
  await sessions.init();
  const broker = makeBroker();
  const playlist = new PlaylistManager(sessions, broker);
  await playlist.addFiles(tracks(count));
  return { sessions, broker, playlist };
}

test('next and prev load adjacent tracks and autoplay', async () => {
  const { sessions, broker, playlist } = await setup(3);
  assert.deepEqual(broker.loaded, ['track-1']);

  playlist.next();
  await tick();
  assert.deepEqual(broker.loaded, ['track-1', 'track-2']);
  assert.deepEqual(broker.plays, ['track-2']);
  assert.equal(sessions.getActive().currentIndex, 1);

  playlist.prev();
  await tick();
  assert.deepEqual(broker.loaded.at(-1), 'track-1');
  assert.equal(sessions.getActive().currentIndex, 0);
});

test('prev at the first track and next at the last are no-ops', async () => {
  const { sessions, broker, playlist } = await setup(2);
  playlist.prev();
  await tick();
  assert.deepEqual(broker.loaded, ['track-1']);

  sessions.getActive().currentIndex = 1;
  playlist.next();
  await tick();
  assert.deepEqual(broker.loaded, ['track-1']);
});

test('track-ended advances once and highlights move with playlist-updated', async () => {
  const { sessions, playlist } = await setup(3);
  events.length = 0;
  document.dispatchEvent(new CustomEvent('track-ended', { detail: { sessionId: sessions.activeSessionId } }));
  await tick();
  assert.equal(sessions.getActive().currentIndex, 1);
  assert.equal(events.filter((e) => e.type === 'playlist-updated').length, 1);
});

test('last track ends with playlist-finished and pauses, no loop', async () => {
  const { sessions, broker } = await setup(2);
  const session = sessions.getActive();
  session.currentIndex = 1;
  events.length = 0;
  let paused = 0;
  broker.pause = () => { paused += 1; };
  document.dispatchEvent(new CustomEvent('track-ended', { detail: { sessionId: session.id } }));
  await tick();

  assert.equal(paused, 1);
  assert.equal(events.filter((e) => e.type === 'playlist-finished').length, 1);
  assert.equal(broker.getState(), 'ended');
  assert.equal(broker.loaded.length, 1, 'no further load');
});

test('loading state guards rapid playIndex calls', async () => {
  const { broker, playlist } = await setup(3);
  broker.setState('loading');
  assert.equal(await playlist.playIndex(2, true), null);
  assert.deepEqual(broker.loaded, ['track-1']);
});

test('missing File reports track-file-missing instead of loading', async () => {
  const { sessions, playlist } = await setup(1);
  const session = sessions.getActive();
  session.playlist.push({ id: 'ghost', name: 'ghost', type: 'audio', fileSize: 1, fileLastModified: 1 });
  events.length = 0;
  assert.equal(await playlist.playIndex(1, true), null);
  assert.equal(events.filter((e) => e.type === 'track-file-missing').length, 1);
  assert.deepEqual(events.filter((e) => e.type === 'toast'), []);
});
