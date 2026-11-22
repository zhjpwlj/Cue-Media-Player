// M8: theme manifest, link media swapping, skin surface and metadata.
import test from 'node:test';
import assert from 'node:assert';

const manifest = {
  video: [
    { id: 'youtube', name: 'YouTube', path: '/assets/themes/video/youtube.css', color: '#ff0000' },
    { id: 'netflix', name: 'Netflix', path: '/assets/themes/video/netflix.css', color: '#e50914' },
  ],
  audio: [
    { id: 'spotify', name: 'Spotify', path: '/assets/themes/audio/spotify.css', color: '#1db954' },
    { id: 'soundcloud', name: 'SoundCloud', path: '/assets/themes/audio/soundcloud.css', color: '#ff5500' },
  ],
};

const events = [];
let metaContent = '#0f0f0f';

function fakeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    parentNode: null,
    id: '',
    className: '',
    textContent: '',
    dataset: {},
    style: {},
    attributes: {},
    rel: '',
    href: '',
    media: '',
    sheet: null,
    setAttribute(name, value) {
      el.attributes[name] = value;
    },
    append(...nodes) {
      for (const node of nodes) {
        node.parentNode = el;
        el.children.push(node);
      }
    },
    remove() {
      const parent = el.parentNode;
      if (!parent) return;
      parent.children = parent.children.filter((child) => child !== el);
      el.parentNode = null;
    },
    addEventListener(type, fn) {
      if (type === 'load') {
        el.sheet = {}; // pretend the stylesheet arrived
        fn();
      }
    },
  };
  return el;
}

const head = fakeElement('head');

globalThis.document = {
  head,
  documentElement: {},
  createElement: (tag) => fakeElement(tag),
  querySelector: (selector) =>
    selector === 'meta[name="theme-color"]'
      ? { setAttribute: (_name, value) => { metaContent = value; } }
      : null,
  dispatchEvent: (event) => {
    events.push(event);
    return true;
  },
};

globalThis.fetch = async () => ({ ok: true, json: async () => manifest });
globalThis.getComputedStyle = () => ({ getPropertyValue: () => ' #101010 ' });
globalThis.CustomEvent ??= class {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};

const { default: AudioSkinController } = await import('../../src/core/audio-skin-controller.ts');
const { default: ThemeManager } = await import('../../src/core/theme-manager.ts');

async function setup() {
  events.length = 0;
  const mount = fakeElement('div');
  const skin = new AudioSkinController(mount);
  const themes = new ThemeManager(skin);
  await themes.init();
  return { mount, skin, themes };
}

test('manifest loads both theme groups', async () => {
  const { themes } = await setup();
  assert.deepEqual(themes.getVideoThemes().map((t) => t.id), ['youtube', 'netflix']);
  assert.deepEqual(themes.getAudioThemes().map((t) => t.id), ['spotify', 'soundcloud']);
});

test('video theme swap promotes one link and demotes the rest', async () => {
  const { themes } = await setup();
  await themes.applyVideoTheme('youtube');
  await themes.applyVideoTheme('netflix');

  const links = head.children.filter((node) => node.rel === 'stylesheet');
  assert.equal(links.length, 2, 'one link per theme, no churn');
  const byPath = new Map(links.map((link) => [link.href, link]));
  assert.equal(byPath.get('/assets/themes/video/youtube.css').media, 'not all');
  assert.equal(byPath.get('/assets/themes/video/netflix.css').media, 'all');
  assert.equal(themes.currentVideoId, 'netflix');
  assert.equal(metaContent, '#101010', 'theme-color meta follows --bg-primary');

  const change = events.at(-1);
  assert.equal(change.type, 'theme-changed');
  assert.deepEqual(change.detail, { type: 'video', id: 'netflix' });
});

test('audio theme swap mounts the scoped skin and replaces on change', async () => {
  const { mount, themes, skin } = await setup();
  await themes.applyAudioTheme('spotify');

  const first = mount.children.at(-1);
  assert.equal(first.id, 'audio-skin-root');
  assert.equal(first.className, 'audio-skin audio-skin-spotify');
  assert.equal(first.dataset.skin, 'spotify');
  assert.equal(skin.root, first);

  await themes.applyAudioTheme('soundcloud');
  const second = mount.children.at(-1);
  assert.equal(second.className, 'audio-skin audio-skin-soundcloud');
  assert.ok(!mount.children.includes(first), 'old skin removed');
  assert.equal(themes.currentAudioId, 'soundcloud');
});

test('skin metadata writes title and artist/album into the surface', async () => {
  const { skin } = await setup();
  skin.load('custom');
  skin.setMetadata({ title: 'Track', artist: 'Cue 1', album: '' });

  const info = skin.root.children[0];
  assert.equal(info.children[0].textContent, 'Track');
  assert.equal(info.children[1].textContent, 'Cue 1');

  skin.setMetadata({ title: 'Track', artist: 'Cue 1', album: 'Album' });
  assert.equal(info.children[1].textContent, 'Cue 1 · Album');
});

test('unknown theme ids are ignored without throwing', async () => {
  const { themes, mount } = await setup();
  await themes.applyVideoTheme('nope');
  await themes.applyAudioTheme('nope');
  assert.equal(themes.currentVideoId, 'custom');
  assert.equal(themes.currentAudioId, 'custom');
  assert.equal(mount.children.length, 0);
});

test('applyForSession applies both stored ids', async () => {
  const { themes, mount } = await setup();
  await themes.applyForSession({ videoThemeId: 'youtube', audioThemeId: 'soundcloud' });
  assert.equal(themes.currentVideoId, 'youtube');
  assert.equal(themes.currentAudioId, 'soundcloud');
  assert.equal(mount.children.at(-1).className, 'audio-skin audio-skin-soundcloud');
});
