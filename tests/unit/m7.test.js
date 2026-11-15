// M7: simulated fullscreen, native handoff, PiP, Escape, audio fallback.
import test from 'node:test';
import assert from 'node:assert';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(name) {
    this.values.add(name);
  }
  remove(name) {
    this.values.delete(name);
  }
  contains(name) {
    return this.values.has(name);
  }
}

class FakeMediaElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.listeners = new Map();
    this.currentTime = 0;
    this.duration = 100;
    this.paused = true;
    this.loop = false;
    this.src = '';
    this.error = null;
    this.calls = [];
  }
  addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener() {}
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
  get tag() {
    return this.tagName.toLowerCase();
  }
}

const body = { classList: new FakeClassList() };
const playerContainer = { classList: new FakeClassList() };
const keydown = [];
const events = [];
let lastElement = null;

globalThis.document = {
  body,
  fullscreenElement: null,
  addEventListener(type, fn) {
    if (type === 'keydown') keydown.push(fn);
  },
  getElementById: (id) => (id === 'player-container' ? playerContainer : null),
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

const { default: PlayerBroker } = await import('../../src/core/player-broker.ts');

const track = (type) => ({
  id: 't1',
  name: 'Track',
  type,
  fileSize: 1,
  fileLastModified: 1,
});

async function load(broker, type) {
  const pending = broker.loadTrack('default', track(type), {});
  broker.getCurrentElement('default').emit('loadedmetadata');
  await pending;
  return broker.getCurrentElement('default');
}

function reset() {
  body.classList.values.clear();
  playerContainer.classList.values.clear();
  events.length = 0;
}

function broker(mode = 'simulated') {
  reset();
  return new PlayerBroker(() => mode);
}

function escape() {
  for (const fn of keydown) fn({ key: 'Escape', stopPropagation() {} });
}

test('simulated fullscreen promotes the player and reports the session', async () => {
  const b = broker();
  await load(b, 'video');
  await b.enterFullscreen('default');

  assert.ok(body.classList.contains('simulated-fs-active'));
  assert.ok(playerContainer.classList.contains('fs-root'));
  assert.equal(b.simulatedFsActive, 'default');
  assert.equal(events.at(-1).detail.active, true);
});

test('exit removes every fullscreen marker and is idempotent', async () => {
  const b = broker();
  await load(b, 'video');
  await b.enterFullscreen('default');
  b.exitFullscreen('default');
  b.exitFullscreen('default');

  assert.ok(!body.classList.contains('simulated-fs-active'));
  assert.ok(!playerContainer.classList.contains('fs-root'));
  assert.equal(b.simulatedFsActive, null);
});

test('Escape exits simulated fullscreen and stops propagation', async () => {
  const b = broker();
  await load(b, 'video');
  await b.enterFullscreen('default');

  let stopped = false;
  for (const fn of keydown) fn({ key: 'Escape', stopPropagation: () => { stopped = true; } });

  assert.equal(b.simulatedFsActive, null);
  assert.ok(!body.classList.contains('simulated-fs-active'));
  assert.ok(stopped);

  // No fullscreen active: Escape must pass through to other handlers.
  stopped = false;
  for (const fn of keydown) fn({ key: 'Escape', stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, false);
});

test('native mode hands the element to the platform instead of CSS', async () => {
  const b = broker('native');
  const el = await load(b, 'video');
  let native = 0;
  el.webkitEnterFullscreen = () => { native += 1; };

  await b.enterFullscreen('default');

  assert.equal(native, 1);
  assert.equal(b.simulatedFsActive, null);
  assert.ok(!body.classList.contains('simulated-fs-active'));
});

test('native exit leaves webkit fullscreen and standard fullscreen', async () => {
  const b = broker('native');
  const el = await load(b, 'video');
  let webkitExit = 0;
  let standardExit = 0;
  el.webkitDisplayingFullscreen = true;
  el.webkitExitFullscreen = () => { webkitExit += 1; };
  document.fullscreenElement = {};
  document.exitFullscreen = () => { standardExit += 1; return Promise.resolve(); };

  b.exitFullscreen('default');

  assert.equal(webkitExit, 1);
  assert.equal(standardExit, 1);
  document.fullscreenElement = null;
});

test('PiP is video-only and drops simulated fullscreen first', async () => {
  const b = broker();
  const video = await load(b, 'video');
  let pip = 0;
  video.requestPictureInPicture = () => { pip += 1; return Promise.resolve(); };

  await b.enterFullscreen('default');
  assert.equal(await b.enterPiP('default'), true);
  assert.equal(pip, 1);
  assert.equal(b.simulatedFsActive, null);

  await load(b, 'audio');
  assert.equal(await b.enterPiP('default'), false);
});

test('Safari presentation-mode PiP is used when the standard API is absent', async () => {
  const b = broker();
  const video = await load(b, 'video');
  const modes = [];
  video.webkitSetPresentationMode = (mode) => modes.push(mode);

  assert.equal(b.supportsPiP('default'), true);
  assert.equal(await b.enterPiP('default'), true);
  assert.deepEqual(modes, ['picture-in-picture']);
});

test('loading audio while simulated fullscreen is active exits it', async () => {
  const b = broker();
  await load(b, 'video');
  await b.enterFullscreen('default');

  await load(b, 'audio');

  assert.equal(b.simulatedFsActive, null);
  assert.ok(!body.classList.contains('simulated-fs-active'));
  assert.ok(lastElement, 'audio element created');
});
