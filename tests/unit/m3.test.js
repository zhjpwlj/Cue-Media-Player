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
  assert.ok(events.some((e) => e.type === 'playlist-updated'));
});

test('PlaylistManager rejects non-media and keeps the previous state', async () => {
  const { default: SessionManager } = await import('../../src/core/session-manager.ts');
  const { default: PlaylistManager } = await import('../../src/core/playlist-manager.ts');
  const sessions = new SessionManager();
  await sessions.init();
  const playlist = new PlaylistManager(sessions, { loadTrack: async () => null });
  assert.equal(await playlist.addFiles([file('a.txt', 'text/plain')]), null);
  assert.equal(sessions.getActive().playlist.length, 0);
});

test('mediaFiles filters folders to supported media', async () => {
  const { mediaFiles } = await import('../../src/core/file-handler.ts');
  const kept = mediaFiles([file('a.mp3', 'audio/mpeg'), file('b.txt', 'text/plain'), file('c.mov', '')]);
  assert.deepEqual(kept.map((f) => f.name), ['a.mp3', 'c.mov']);
});
