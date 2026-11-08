import test from 'node:test';
import assert from 'node:assert';

const { isIOSDevice, iosVersion, supportsDirectoryPicker } = await import(
  '../../src/utils/platform.ts'
);

const IPAD_18_3 =
  'Mozilla/5.0 (iPad; CPU OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_18_5 =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/605.1.15';
const IPAD_26 =
  'Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

test('isIOSDevice detects iPad, iPhone, and desktop-mode iPad', () => {
  assert.equal(isIOSDevice(IPAD_18_3, 5), true);
  assert.equal(isIOSDevice(IPAD_DESKTOP_18_5, 5), true);
  assert.equal(isIOSDevice(DESKTOP, 0), false);
});

test('iosVersion reads both UA shapes', () => {
  assert.deepEqual(iosVersion(IPAD_18_3), { major: 18, minor: 3 });
  assert.deepEqual(iosVersion(IPAD_DESKTOP_18_5), { major: 18, minor: 5 });
  assert.deepEqual(iosVersion(IPAD_26), { major: 26, minor: 0 });
  assert.equal(iosVersion(DESKTOP), null);
});

test('directory picker needs webkitdirectory and Safari 18.4 on iOS', () => {
  assert.equal(supportsDirectoryPicker(IPAD_18_3, true, true), false);
  assert.equal(supportsDirectoryPicker(IPAD_DESKTOP_18_5, true, true), true);
  assert.equal(supportsDirectoryPicker(IPAD_26, true, true), true);
  assert.equal(supportsDirectoryPicker(IPAD_26, false, true), false);
  assert.equal(supportsDirectoryPicker(DESKTOP, true, false), true);
  assert.equal(supportsDirectoryPicker(DESKTOP, false, false), false);
});
