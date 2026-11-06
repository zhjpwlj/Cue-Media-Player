import test from 'node:test';
import assert from 'node:assert';

const events = [];
globalThis.document = { dispatchEvent: (e) => events.push(e) };

const file = (name, type = '') => ({ name, type, size: 10, lastModified: 1 });

test('SessionManager creates one default session', async () => {
  const { default: SessionManager } = await import('../../src/core/session-manager.ts');
  const sessions = new SessionManager();
  await sessions.init();
  const session = sessions.getActive();
  assert.equal(session.name, 'Cue 1');
  assert.equal(session.playlist.length, 0);
  assert.equal(session.muted, false);
  assert.deepEqual(sessions.getOrdered(), [session]);
});

test('PlaylistManager loads only the first media file and emits playlist-updated', async () => {
  events.length = 0;
  const { default: SessionManager } = await import('../../src/core/session-manager.ts');
  const { default: PlaylistManager } = await import('../../src/core/playlist-manager.ts');
  const sessions = new SessionManager();
  await sessions.init();
  const loaded = [];
  const broker = { loadTrack: async (_id, track) => { loaded.push(track); return null; } };
  const playlist = new PlaylistManager(sessions, broker);

  const track = await playlist.addFiles([file('a.mp3', 'audio/mpeg'), file('b.mp4', 'video/mp4')]);
  assert.equal(loaded.length, 1);
  assert.equal(track.name, 'a');
  assert.equal(track.type, 'audio');
  assert.equal(playlist.getFile(track.id).name, 'a.mp3');
  assert.equal(sessions.getActive().currentIndex, 0);
  const updates = events.filter((e) => e.type === 'playlist-updated');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].detail.sessionId, sessions.activeSessionId);
});

test('PlaylistManager rejects non-media and keeps the previous state', async () => {
  const { default: SessionManager } = await import('../../src/core/session-manager.ts');
  const { default: PlaylistManager } = await import('../../src/core/playlist-manager.ts');
  const sessions = new SessionManager();
  await sessions.init();
  const playlist = new PlaylistManager(sessions, { loadTrack: async () => null });
  assert.equal(await playlist.addFiles([file('a.txt', 'text/plain')]), null);
  assert.equal(sessions.getActive().playlist.length, 0);
  assert.equal(sessions.getActive().currentIndex, -1);
});

test('PlaylistManager keeps the previous state when loadTrack rejects', async () => {
  events.length = 0;
  const { default: SessionManager } = await import('../../src/core/session-manager.ts');
  const { default: PlaylistManager } = await import('../../src/core/playlist-manager.ts');
  const sessions = new SessionManager();
  await sessions.init();
  const session = sessions.getActive();
  const previous = { id: 'old', name: 'old', type: 'audio', fileSize: 1, fileLastModified: 1 };
  session.playlist = [previous];
  session.currentIndex = 0;

  const playlist = new PlaylistManager(sessions, {
    loadTrack: async () => { throw new Error('load failed'); },
  });
  assert.equal(await playlist.addFiles([file('bad.mp3', 'audio/mpeg')]), null);
  assert.deepEqual(session.playlist, [previous]);
  assert.equal(session.currentIndex, 0);

  const toasts = events.filter((e) => e.type === 'toast');
  assert.equal(toasts.length, 1);
  assert.match(toasts[0].detail.message, /Could not load bad\.mp3/);
  assert.equal(events.filter((e) => e.type === 'playlist-updated').length, 0);
});

test('mediaFiles filters folders to supported media', async () => {
  const { mediaFiles } = await import('../../src/core/file-handler.ts');
  const kept = mediaFiles([file('a.mp3', 'audio/mpeg'), file('b.txt', 'text/plain'), file('c.mov', '')]);
  assert.deepEqual(kept.map((f) => f.name), ['a.mp3', 'c.mov']);
});

test('openFolderPicker filters non-media and resets the input', async () => {
  events.length = 0;
  const appended = [];
  const input = {
    type: '',
    webkitdirectory: false,
    multiple: false,
    hidden: false,
    value: '',
    files: [],
    listeners: {},
    clicks: 0,
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    click() {
      this.clicks += 1;
    },
    emit(type) {
      for (const fn of this.listeners[type] ?? []) fn();
    },
  };
  const original = globalThis.document;
  globalThis.document = {
    dispatchEvent: (e) => events.push(e),
    createElement: (tag) => {
      assert.equal(tag, 'input');
      return input;
    },
    body: { append: (node) => appended.push(node) },
  };

  try {
    const { default: FileHandler } = await import('../../src/core/file-handler.ts');
    const added = [];
    const playlist = { addFiles: async (files) => { added.push(files); return null; } };
    new FileHandler(playlist).openFolderPicker();

    assert.equal(appended.length, 1);
    assert.equal(input.clicks, 1);

    input.value = 'C:\\fakepath';
    input.files = [file('a.mp3', 'audio/mpeg'), file('b.txt', 'text/plain'), file('c.mov', '')];
    input.emit('change');
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(added.length, 1);
    assert.deepEqual(added[0].map((f) => f.name), ['a.mp3', 'c.mov']);
    assert.equal(input.value, '');
  } finally {
    globalThis.document = original;
  }
});

test('openFolderPicker does nothing without webkitdirectory support', async () => {
  events.length = 0;
  const appended = [];
  let clicked = 0;
  // No `webkitdirectory` key: simulates a platform without folder picking.
  const input = {
    type: '',
    multiple: false,
    hidden: false,
    value: '',
    files: [],
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    click() {
      clicked += 1;
    },
  };
  const original = globalThis.document;
  globalThis.document = {
    dispatchEvent: (e) => events.push(e),
    createElement: () => input,
    body: { append: (node) => appended.push(node) },
  };

  try {
    const { default: FileHandler } = await import('../../src/core/file-handler.ts');
    new FileHandler({ addFiles: async () => null }).openFolderPicker();
    assert.equal(appended.length, 0);
    assert.equal(clicked, 0);
  } finally {
    globalThis.document = original;
  }
});
