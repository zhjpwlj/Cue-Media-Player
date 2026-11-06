// Native-only media detection for Milestone 2. FormatBridge (M13) owns the
// real classification; until then, anything not natively playable is rejected.
import type PlaylistManager from './playlist-manager';

export type TrackKind = 'audio' | 'video';

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|aif|aiff|flac|ogg|oga|opus)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i;

export function mediaKind(file: Pick<File, 'type' | 'name'>): TrackKind | null {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  if (AUDIO_EXT.test(file.name)) return 'audio';
  if (VIDEO_EXT.test(file.name)) return 'video';
  return null;
}

/** Keeps only files the native player can open. Folders arrive unsorted. */
export function mediaFiles(files: File[]): File[] {
  return files.filter((file) => mediaKind(file));
}

export default class FileHandler {
  #playlist: PlaylistManager | null;
  #folderInput: HTMLInputElement | null = null;

  constructor(playlist?: PlaylistManager) {
    this.#playlist = playlist ?? null;
  }

  /**
   * Opens the native picker. Must be called from a user gesture.
   * Resolves with an empty array when cancelled.
   */
  openFilePicker(): Promise<File[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*,video/*';
      input.hidden = true;
      // iOS fires no event on cancel; the input is simply never heard from
      // again, so the promise also settles on the next task after focus returns.
      let settled = false;
      const settle = (files: File[]): void => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(files);
      };
      input.addEventListener('change', () => settle([...(input.files ?? [])]));
      document.body.append(input);
      // Register before click(): the dialog can take focus and return it fast.
      window.addEventListener('focus', () => setTimeout(() => settle([]), 1000), { once: true });
      input.click();
    });
  }

  /**
   * Folder picker. `webkitdirectory` is unsupported on some platforms; the
   * caller feature-detects it and hides the button (M3 spec §6.9).
   */
  openFolderPicker(): void {
    if (!this.#folderInput) {
      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.multiple = true;
      input.hidden = true;
      input.addEventListener('change', () => {
        const files = mediaFiles([...(input.files ?? [])]);
        if (this.#playlist) void this.#playlist.addFiles(files);
        input.value = ''; // reset for same-folder re-pick
      });
      document.body.append(input);
      this.#folderInput = input;
    }
    this.#folderInput.click();
  }
}
