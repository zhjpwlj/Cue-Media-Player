// Launch-time auto-update policy: shell first, update silently, reload once.
import test from 'node:test';
import assert from 'node:assert';

const { default: installAutoUpdate } = await import('../../src/core/app-update.ts');

function fakeWorker() {
  const listeners = new Map();
  return {
    state: 'installing',
    messages: [],
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    postMessage(message) {
      this.messages.push(message);
    },
    setState(state) {
      this.state = state;
      for (const fn of listeners.get('statechange') ?? []) fn();
    },
  };
}

function fakeRegistration() {
  const listeners = new Map();
  return {
    installing: null,
    waiting: null,
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    emit(type) {
      listeners.get(type)?.();
    },
  };
}

function fakeContainer(controller) {
  const listeners = new Map();
  return {
    controller,
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    emit(type) {
      for (const fn of listeners.get(type) ?? []) fn();
    },
  };
}

test('an installed update activates and the page reloads exactly once', () => {
  const reg = fakeRegistration();
  const sw = fakeContainer({}); // an older worker controls this page
  let reloads = 0;
  installAutoUpdate(reg, sw, () => { reloads += 1; });

  const incoming = fakeWorker();
  reg.installing = incoming;
  reg.emit('updatefound');
  incoming.setState('installed');
  assert.deepEqual(incoming.messages, [{ type: 'SKIP_WAITING' }]);

  sw.emit('controllerchange');
  sw.emit('controllerchange');
  assert.equal(reloads, 1);
});

test('the first install claims the page without a reload', () => {
  const reg = fakeRegistration();
  const sw = fakeContainer(null);
  let reloads = 0;
  installAutoUpdate(reg, sw, () => { reloads += 1; });

  const incoming = fakeWorker();
  reg.installing = incoming;
  reg.emit('updatefound');
  incoming.setState('installed');
  sw.emit('controllerchange');

  assert.equal(reloads, 0);
  assert.deepEqual(incoming.messages, [{ type: 'SKIP_WAITING' }]);
});

test('a worker already waiting when the policy starts is activated', () => {
  const reg = fakeRegistration();
  const waiting = fakeWorker();
  reg.waiting = waiting;
  installAutoUpdate(reg, fakeContainer({}), () => {});

  assert.deepEqual(waiting.messages, [{ type: 'SKIP_WAITING' }]);
});

test('updatefound without an installing worker is ignored', () => {
  const reg = fakeRegistration();
  installAutoUpdate(reg, fakeContainer({}), () => {
    throw new Error('must not reload');
  });
  reg.emit('updatefound');
});
