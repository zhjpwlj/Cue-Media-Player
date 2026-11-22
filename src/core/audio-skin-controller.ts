/**
 * Renders the audio surface (M8). The canvas is intentionally empty until the
 * waveform lands in M12 and the live analyser in M18; those milestones only
 * fill in setPeaks() and setMode().
 */
export interface SkinMetadata {
  title: string;
  artist: string;
  album: string;
}

export default class AudioSkinController {
  #mount: HTMLElement;
  #root: HTMLElement | null = null;
  #title: HTMLElement | null = null;
  #artist: HTMLElement | null = null;
  #canvas: HTMLCanvasElement | null = null;

  constructor(mount: HTMLElement) {
    this.#mount = mount;
  }

  load(skinId: string): HTMLElement {
    this.unload();

    const root = document.createElement('div');
    root.id = 'audio-skin-root';
    root.className = `audio-skin audio-skin-${skinId}`;
    root.dataset.skin = skinId;

    const info = document.createElement('div');
    info.className = 'as-info';
    const title = document.createElement('div');
    title.className = 'as-title';
    title.textContent = 'No track';
    const artist = document.createElement('div');
    artist.className = 'as-artist';
    artist.textContent = '';
    info.append(title, artist);

    const canvas = document.createElement('canvas');
    canvas.className = 'as-canvas';
    canvas.setAttribute('aria-hidden', 'true');

    root.append(info, canvas);
    this.#mount.append(root);

    this.#root = root;
    this.#title = title;
    this.#artist = artist;
    this.#canvas = canvas;
    return root;
  }

  unload(): void {
    this.#root?.remove();
    this.#root = null;
    this.#title = null;
    this.#artist = null;
    this.#canvas = null;
  }

  setMetadata({ title, artist, album }: SkinMetadata): void {
    if (this.#title) this.#title.textContent = title;
    if (this.#artist) {
      this.#artist.textContent = album && artist ? `${artist} · ${album}` : artist || album;
    }
  }

  /** M12: waveform peaks. Nothing renders yet. */
  setPeaks(): void {}

  /** M18: waveform | live. Nothing renders yet. */
  setMode(): void {}

  get root(): HTMLElement | null {
    return this.#root;
  }

  get canvas(): HTMLCanvasElement | null {
    return this.#canvas;
  }
}
