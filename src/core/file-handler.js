// Native-only media detection for Milestone 2. FormatBridge (M13) owns the
// real classification; until then, anything not natively playable is rejected.
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|aif|aiff|flac|ogg|oga|opus)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i;

/**
 * @param {File} file
 * @returns {'audio'|'video'|null}
 */
export function mediaKind(file) {
  if (file.type?.startsWith('audio/')) return 'audio';
  if (file.type?.startsWith('video/')) return 'video';
  if (AUDIO_EXT.test(file.name)) return 'audio';
  if (VIDEO_EXT.test(file.name)) return 'video';
  return null;
}

export default class FileHandler {
  /**
   * Opens the native picker. Must be called from a user gesture.
   * @returns {Promise<File[]>} empty when cancelled
   */
  openFilePicker() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*,video/*';
      input.hidden = true;
      // iOS fires no event on cancel; the input is simply never heard from
      // again, so the promise also settles on the next task after focus returns.
      let settled = false;
      const settle = (files) => {
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
}
