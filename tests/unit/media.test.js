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
    queueMicrotask(() => this.emit('loadedmetadata'));
  }

  get src() {
    return this._src;
  }
}

const created = [];
const revoked = [];
globalThis.document = {
  createElement: (tag) => new FakeMedia(tag),
  dispatchEvent: () => {},
};
URL.createObjectURL = () => {
  const url = `blob:${created.length + 1}`;
  created.push(url);
  return url;
};
URL.revokeObjectURL = (url) => revoked.push(url);

const track = (id, type) => ({ id, name: `${id}.${type === 'video' ? 'mp4' : 'mp3'}`, type });

test('broker revokes every replaced blob URL and pauses across sessions', async () => {
  created.length = 0;
  revoked.length = 0;
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
