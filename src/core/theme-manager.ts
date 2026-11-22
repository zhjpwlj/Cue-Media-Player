/**
 * Video themes swap one <link media="all"> at a time; audio themes are scoped
 * CSS plus the audio skin surface. Waiting for link.sheet before promoting a
 * theme is what prevents a flash of unstyled chrome.
 */
import type AudioSkinController from './audio-skin-controller.ts';
import type { Session } from './session-manager.ts';

export interface ThemeEntry {
  id: string;
  name: string;
  path: string;
  color: string;
}

interface ThemeManifest {
  video: ThemeEntry[];
  audio: ThemeEntry[];
}

const MANIFEST_URL = '/assets/themes/manifest.json';
const FALLBACK_ID = 'custom';

export default class ThemeManager {
  #manifest: ThemeManifest = { video: [], audio: [] };
  #videoLinks = new Map<string, HTMLLinkElement>();
  #audioLinks = new Map<string, HTMLLinkElement>();
  #skin: AudioSkinController | null;
  #currentVideoId = FALLBACK_ID;
  #currentAudioId = FALLBACK_ID;

  constructor(skin?: AudioSkinController) {
    this.#skin = skin ?? null;
  }

  async init(): Promise<void> {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) throw new Error(`Theme manifest failed: HTTP ${response.status}`);
    const manifest = (await response.json()) as Partial<ThemeManifest>;
    this.#manifest = {
      video: Array.isArray(manifest.video) ? manifest.video : [],
      audio: Array.isArray(manifest.audio) ? manifest.audio : [],
    };
  }

  getVideoThemes(): readonly ThemeEntry[] {
    return this.#manifest.video;
  }

  getAudioThemes(): readonly ThemeEntry[] {
    return this.#manifest.audio;
  }

  get currentVideoId(): string {
    return this.#currentVideoId;
  }

  get currentAudioId(): string {
    return this.#currentAudioId;
  }

  async applyForSession(session: Pick<Session, 'videoThemeId' | 'audioThemeId'>): Promise<void> {
    await Promise.all([
      this.applyVideoTheme(session.videoThemeId),
      this.applyAudioTheme(session.audioThemeId),
    ]);
  }

  async applyVideoTheme(id: string): Promise<void> {
    const theme = this.#manifest.video.find((entry) => entry.id === id);
    if (!theme) return;

    const link = this.#linkFor(this.#videoLinks, theme);
    await whenLoaded(link);

    for (const [otherId, other] of this.#videoLinks) {
      other.media = otherId === id ? 'all' : 'not all';
    }

    this.#currentVideoId = id;
    this.#updateThemeColorMeta();
    dispatch('theme-changed', { type: 'video', id });
  }

  async applyAudioTheme(id: string): Promise<void> {
    const theme = this.#manifest.audio.find((entry) => entry.id === id);
    if (!theme) return;

    const link = this.#linkFor(this.#audioLinks, theme);
    await whenLoaded(link);

    for (const [otherId, other] of this.#audioLinks) {
      other.media = otherId === id ? 'all' : 'not all';
    }

    this.#currentAudioId = id;
    this.#skin?.load(id);
    dispatch('theme-changed', { type: 'audio', id });
  }

  /** One link per theme, created lazily, never removed at swap time. */
  #linkFor(links: Map<string, HTMLLinkElement>, theme: ThemeEntry): HTMLLinkElement {
    const existing = links.get(theme.id);
    if (existing) return existing;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = theme.path;
    // Inert until this theme is applied.
    link.media = 'not all';
    document.head.append(link);
    links.set(theme.id, link);
    return link;
  }

  #updateThemeColorMeta(): void {
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-primary')
      .trim();
    if (!bg) return;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  }
}

function whenLoaded(link: HTMLLinkElement): Promise<void> {
  if (link.sheet) return Promise.resolve();
  return new Promise((resolve) => {
    link.addEventListener('load', () => resolve(), { once: true });
    // A failed theme must not stall the swap; the old theme stays visible.
    link.addEventListener('error', () => resolve(), { once: true });
  });
}

function dispatch(type: string, detail: unknown): void {
  document.dispatchEvent(new CustomEvent(type, { detail }));
}
