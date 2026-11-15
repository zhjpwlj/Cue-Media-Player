import test from 'node:test';
import assert from 'node:assert';

const events = [];
let lastElement = null;

class FakeMediaElement {
  constructor(tag) {
    this.tag = tag;
    this.listeners = new Map();
    this.currentTime = 0;
    this.duration = 100;
    this.paused = true;
    this.volume = 1;
    this.muted = false;
    this.loop = false;
    this.src = '';
    this.error = null;
  }
  addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  setAttribute() {}
  removeAttribute() {}
  load() {}
  play() {
    this.paused = false;
    this.emit('play');
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.emit('pause');
  }
  emit(type) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

globalThis.document = {
  dispatchEvent: (e) => {
    events.push(e);
    return true;
  },
  createElement: (tag) => {
    lastElement = new FakeMediaElement(tag);
    return lastElement;
  },
};

URL.createObjectURL = () => 'blob:fake';
URL.revokeObjectURL = () => undefined;

const { default: PlayerBroker, blobUrlDiagnostics } = await import('../../src/core/player-broker.ts');

const track = (type = 'audio') => ({
  id: 't1',
  name: 'Track',
  type,
  fileSize: 1,
  fileLastModified: 1,
});

async function load(broker, type = 'audio') {
  events.length = 0;
  const pending = broker.loadTrack('default', track(type), {});
  const element = broker.getCurrentElement('default');
  element.emit('loadedmetadata');
  await pending;
  return element;
}

const count = (type) => events.filter((e) => e.type === type).length;

test('audio end fires track-ended once across repeated timeupdate', async () => {
  const broker = new PlayerBroker();
  const el = await load(broker, 'audio');
  el.currentTime = 99.7;
  el.emit('timeupdate');
  el.emit('timeupdate');
  el.emit('timeupdate');
  assert.equal(count('track-ended'), 1);
});

test('video ended fires track-ended once', async () => {
  const broker = new PlayerBroker();
  const el = await load(broker, 'video');
  el.emit('ended');
  el.emit('ended');
  assert.equal(count('track-ended'), 1);
});

test('short track threshold scales below two seconds', async () => {
  const broker = new PlayerBroker();
  const el = await load(broker, 'audio');
  el.duration = 1.6;
  el.currentTime = 1.3;
  el.emit('timeupdate');
  assert.equal(count('track-ended'), 1);
});

test('a queued ended from the old source cannot advance the new track', async () => {
  const broker = new PlayerBroker();
  const first = await load(broker, 'video');
  first.duration = 100;
  first.currentTime = 99.7;
  first.emit('timeupdate');
  assert.equal(count('track-ended'), 1);

  const second = await load(broker, 'video');
  second.duration = 100;
  second.currentTime = 0;
  second.emit('ended'); // stale event from the previous source
  assert.equal(count('track-ended'), 0);
});

test('switching tracks keeps one live blob URL', async () => {
  const broker = new PlayerBroker();
  await load(broker, 'audio');
  await load(broker, 'audio');
  await load(broker, 'video');
  const match = /created=(\d+) revoked=(\d+) delta=(\d+)/.exec(blobUrlDiagnostics());
  assert.ok(match, blobUrlDiagnostics());
  const [, created, revoked, delta] = match.map(Number);
  assert.equal(created, 3);
  assert.equal(revoked, 2);
  assert.equal(delta, 1);
  assert.equal(lastElement.src, 'blob:fake');
});
