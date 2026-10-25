// Milestone 2 units: time formatting, native media classification, and the
// broker's blob-URL revocation invariant. Run with: npm test
const test = require('node:test');
const assert = require('node:assert');

test('formatTime handles minutes, hours and junk', async () => {
  const { formatTime } = await import('../../src/utils/time.js');
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(5), '0:05');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(600), '10:00');
  assert.equal(formatTime(3600), '1:00:00');
  assert.equal(formatTime(3661), '1:01:01');
  assert.equal(formatTime(Number.NaN), '0:00');
  assert.equal(formatTime(-1), '0:00');
});

test('mediaKind trusts MIME type, then falls back to extension', async () => {
  const { mediaKind } = await import('../../src/core/file-handler.js');
  assert.equal(mediaKind({ type: 'audio/mpeg', name: 'x.mp3' }), 'audio');
  assert.equal(mediaKind({ type: 'video/mp4', name: 'x.mp4' }), 'video');
  assert.equal(mediaKind({ type: '', name: 'X.FLAC' }), 'audio');
  assert.equal(mediaKind({ type: 'application/octet-stream', name: 'x.MOV' }), 'video');
  assert.equal(mediaKind({ type: '', name: 'x.mkv' }), null);
});

class FakeMedia {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.listeners = new Map();
    this.paused = true;
    this.currentTime = 0;
    this.duration = 100;
    this.error = null;
    this._src = '';
    this.autoLoad = true;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }

  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }

  emit(type) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }

  setAttribute() {}
  removeAttribute(name) {
    if (name === 'src') this._src = '';
  }

  load() {}
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.emit('pause');
  }

  play() {
    this.paused = false;
    this.emit('play');
    return Promise.resolve();
  }

  set src(value) {
    this._src = value;
    if (this.autoLoad) queueMicrotask(() => this.emit('loadedmetadata'));
  }

  get src() {
    return this._src;
  }
}

const created = [];
const revoked = [];
const elements = [];
const events = [];
let silentNext = false;
globalThis.document = {
  createElement: (tag) => {
    const el = new FakeMedia(tag);
    el.autoLoad = !silentNext;
    elements.push(el);
    return el;
  },
  dispatchEvent: (event) => events.push(event),
};
URL.createObjectURL = () => {
  const url = `blob:${created.length + 1}`;
  created.push(url);
  return url;
};
URL.revokeObjectURL = (url) => revoked.push(url);

const track = (id, type) => ({ id, name: `${id}.${type === 'video' ? 'mp4' : 'mp3'}`, type });
const trackChanges = () => events.filter((e) => e.type === 'track-changed');

function resetBrokerTest() {
  created.length = 0;
  revoked.length = 0;
  elements.length = 0;
  events.length = 0;
  silentNext = false;
}

test('broker revokes every replaced blob URL and pauses across sessions', async () => {
  resetBrokerTest();
  const { default: PlayerBroker } = await import('../../src/core/player-broker.js');
  const broker = new PlayerBroker();

  await broker.loadTrack('a', track('one', 'audio'), { name: 'one.mp3' });
  assert.equal(broker.getState('a'), 'paused');
  assert.equal(created.length, 1);

  // Same element, new source: the old URL must be revoked.
  await broker.loadTrack('a', track('two', 'audio'), { name: 'two.mp3' });
  assert.deepEqual(revoked, ['blob:1']);

  // Different element for a video: the audio URL must be revoked too.
  await broker.loadTrack('a', track('three', 'video'), { name: 'three.mp4' });
  assert.deepEqual(revoked, ['blob:1', 'blob:2']);
  assert.equal(created.length, 3);

  // Exclusivity: playing session b pauses session a.
  await broker.loadTrack('b', track('four', 'audio'), { name: 'four.mp3' });
  await broker.play('a');
  assert.equal(broker.getState('a'), 'playing');
  await broker.play('b');
  assert.equal(broker.getState('a'), 'paused');
  assert.equal(broker.getState('b'), 'playing');
});

test('a stale load cannot change the newer track', async () => {
  resetBrokerTest();
  const { default: PlayerBroker } = await import('../../src/core/player-broker.js');
  const broker = new PlayerBroker();

  // The video never finishes loading, so its promise is still pending.
  silentNext = true;
  const videoLoad = broker.loadTrack('a', track('old', 'video'), { name: 'old.mp4' });
  silentNext = false;
  const audioLoad = broker.loadTrack('a', track('new', 'audio'), { name: 'new.mp3' });
  await audioLoad;

  const video = elements.find((el) => el.tagName === 'VIDEO');
  const audio = broker.getCurrentElement('a');
  assert.equal(audio.tagName, 'AUDIO');

  // The abandoned video errors after the audio is already loaded.
  video.error = { code: 4 };
  video.emit('error');

  const staleResult = await videoLoad.catch((err) => err);
  assert.equal(staleResult, null);
  assert.equal(broker.getState('a'), 'paused');
  assert.equal(broker.getCurrentElement('a'), audio);
  assert.equal(audio.src, 'blob:2');
  assert.deepEqual(revoked, ['blob:1']);
  assert.deepEqual(trackChanges().map((e) => e.detail.track.name), ['new.mp3']);
  assert.equal(events.filter((e) => e.type === 'playback-error').length, 0);
});

test('a failed load restores the previous track', async () => {
  resetBrokerTest();
  const { default: PlayerBroker } = await import('../../src/core/player-broker.js');
  const broker = new PlayerBroker();

  await broker.loadTrack('a', track('good', 'audio'), { name: 'good.mp3' });
  const audio = broker.getCurrentElement('a');

  const failed = broker.loadTrack('a', track('bad', 'audio'), { name: 'bad.mp3' });
  audio.error = { code: 4 };
  audio.emit('error');

  await assert.rejects(failed, /failed to load/i);
  assert.equal(broker.getState('a'), 'paused');
  assert.equal(broker.getCurrentElement('a'), audio);
  assert.equal(audio.src, 'blob:3');
  assert.equal(trackChanges().at(-1).detail.track.name, 'good.mp3');
});

test('a stalled load times out instead of staying loading', async (t) => {
  resetBrokerTest();
  const { default: PlayerBroker } = await import('../../src/core/player-broker.js');
  const broker = new PlayerBroker();

  t.mock.timers.enable({ apis: ['setTimeout'] });
  silentNext = true;
  const loading = broker.loadTrack('a', track('slow', 'audio'), { name: 'slow.mp3' });
  silentNext = false;

  t.mock.timers.tick(60_000);
  const result = await Promise.race([
    loading.then(() => 'resolved', (err) => err.message),
    new Promise((resolve) => setImmediate(() => resolve('still loading'))),
  ]);
  assert.match(result, /timed out/i);
  assert.equal(broker.getState('a'), 'idle');
  t.mock.timers.reset();
});

test('a media error pauses the session', async () => {
  resetBrokerTest();
  const { default: PlayerBroker } = await import('../../src/core/player-broker.js');
  const broker = new PlayerBroker();

  await broker.loadTrack('a', track('one', 'audio'), { name: 'one.mp3' });
  await broker.play('a');
  assert.equal(broker.getState('a'), 'playing');

  const audio = broker.getCurrentElement('a');
  audio.error = { code: 4 };
  audio.emit('error');

  assert.equal(broker.getState('a'), 'paused');
  assert.equal(events.filter((e) => e.type === 'playback-error').length, 1);
});
