import test from 'node:test';
import assert from 'node:assert';

let contexts = 0;

class FakeAudioContext {
  state = 'suspended';
  destination = {};
  constructor() {
    contexts += 1;
  }
  createMediaElementSource() {
    return { connect() {} };
  }
  createGain() {
    const node = { gain: { value: 1 }, connect() {} };
    this.lastGain = node;
    return node;
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

globalThis.AudioContext = FakeAudioContext;
globalThis.document = { querySelector: () => null };

const { default: AudioVolume } = await import('../../src/core/audio-volume.ts');
const element = () => ({ volume: 1, muted: false });

test('gain path is created on iOS and tracks slider moves', () => {
  contexts = 0;
  const volume = new AudioVolume(true);
  const el = element();

  volume.apply(el, 0.4);
  assert.equal(contexts, 1, 'one AudioContext');
  assert.equal(el.volume, 1, 'native volume forced to 1 on iOS');

  volume.apply(el, 0.2);
  assert.equal(contexts, 1, 'context reused for the same element');
});

test('prepare routes even at full volume, once per element', () => {
  contexts = 0;
  const volume = new AudioVolume(true);
  const el = element();
  volume.prepare(el);
  volume.prepare(el);
  assert.equal(contexts, 1);
  assert.equal(volume.describe().includes('ctx=running'), true);
});

test('no gain graph off iOS: native volume is assigned', () => {
  contexts = 0;
  const volume = new AudioVolume(false);
  const el = element();
  volume.apply(el, 0.35);
  volume.prepare(el);
  assert.equal(contexts, 0);
  assert.equal(el.volume, 0.35);
});
