// Native-only media detection for Milestone 2. FormatBridge (M13) owns the
// real classification; until then, anything not natively playable is rejected.
import type PlaylistManager from './playlist-manager';

export type TrackKind = 'audio' | 'video';

const AUDIO_EXTS = ['mp3', 'm4a', 'aac', 'wav', 'aif', 'aiff', 'flac', 'ogg', 'oga', 'opus'] as const;
const VIDEO_EXTS = ['mp4', 'm4v', 'mov', 'webm'] as const;
// Extensions the picker offers but the player refuses until M13.
const FUTURE_EXTS = ['mkv', 'avi'] as const;

const AUDIO_EXT = new RegExp(`\\.(${AUDIO_EXTS.join('|')})$`, 'i');
const VIDEO_EXT = new RegExp(`\\.(${VIDEO_EXTS.join('|')})$`, 'i');

// iPadOS greys files out by UTI, not by MIME wildcard: `audio/*` alone left MP3
// unselectable in Files. List every extension explicitly as well.
export const PICKER_ACCEPT = [
  'audio/*',
  'video/*',
  ...[...AUDIO_EXTS, ...VIDEO_EXTS, ...FUTURE_EXTS].map((ext) => `.${ext}`),
].join(',');

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
  #playlist: PlaylistManager;
  #folderInput: HTMLInputElement | null = null;

  constructor(playlist: PlaylistManager) {
    this.#playlist = playlist;
  }

  /**
   * Opens the native picker. Must be called from a user gesture.
   * Resolves with an empty array when cancelled.
   */
  openFilePicker(): Promise<File[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = PICKER_ACCEPT;
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
      // Unsupported platforms skip the picker rather than opening an empty one.
      if (!('webkitdirectory' in input)) return;
      input.type = 'file';
      input.webkitdirectory = true;
      input.multiple = true;
      input.hidden = true;
      input.addEventListener('change', () => {
        const files = mediaFiles([...(input.files ?? [])]);
        void this.#playlist.addFiles(files).catch(() => {
          document.dispatchEvent(
            new CustomEvent('toast', { detail: { message: 'Could not load that folder.' } }),
          );
        });
        input.value = ''; // reset for same-folder re-pick
      });
      document.body.append(input);
      this.#folderInput = input;
    }
    this.#folderInput.click();
  }
}
