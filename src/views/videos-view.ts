import { mediaKind } from '../core/file-handler';
import type FileHandler from '../core/file-handler';
import type PlayerBroker from '../core/player-broker';
import type Toasts from '../ui/toasts';
import { formatTime } from '../utils/time';

// Milestone 2 is single-session. Session tabs arrive at M9.
export const SESSION_ID = 'main';

interface VideosViewDeps {
  broker: PlayerBroker;
  fileHandler: FileHandler;
  toasts: Toasts;
}

interface TrackChangedDetail {
  sessionId: string;
  track: { name: string };
}
interface TimeUpdateDetail {
  sessionId: string;
  currentTime: number;
  duration: number;
}
interface PlaybackErrorDetail {
  sessionId: string;
  message: string;
}

/**
 * Single-track view: pick a file, hand it to the broker, show native controls.
 */
export default class VideosView {
  #broker: PlayerBroker;
  #fileHandler: FileHandler;
  #toasts: Toasts;
  #stage!: HTMLElement;
  #status!: HTMLElement;
  #time!: HTMLElement;
  #empty!: HTMLElement;

  constructor({ broker, fileHandler, toasts }: VideosViewDeps) {
    this.#broker = broker;
    this.#fileHandler = fileHandler;
    this.#toasts = toasts;
  }

  mount(container: HTMLElement): void {
    container.innerHTML = `
      <section class="videos-view">
        <div class="videos-toolbar">
          <div class="videos-heading">
            <h1 class="videos-title">Videos</h1>
            <p class="videos-subtitle" data-role="status">No file open</p>
          </div>
          <button class="btn btn-primary" type="button" data-role="open">Open file</button>
        </div>
        <div class="player-stage" data-role="stage">
          <p class="player-empty" data-role="empty">Choose an audio or video file.</p>
        </div>
        <p class="player-time" data-role="time"></p>
      </section>`;

    const el = (role: string): HTMLElement => {
      const node = container.querySelector(`[data-role="${role}"]`);
      if (!node) throw new Error(`missing [data-role="${role}"]`);
      return node as HTMLElement;
    };
    const openButton = el('open');
    this.#stage = el('stage');
    this.#status = el('status');
    this.#time = el('time');
    this.#empty = el('empty');

    openButton.addEventListener('click', () => void this.#open());
    this.#broker.attachTo(SESSION_ID, this.#stage);

    document.addEventListener('track-changed', (e) => {
      const detail = (e as CustomEvent<TrackChangedDetail>).detail;
      if (detail.sessionId !== SESSION_ID) return;
      this.#status.textContent = detail.track.name;
    });

    document.addEventListener('time-update', (e) => {
      const detail = (e as CustomEvent<TimeUpdateDetail>).detail;
      if (detail.sessionId !== SESSION_ID) return;
      this.#time.textContent = `${formatTime(detail.currentTime)} / ${formatTime(detail.duration)}`;
    });

    document.addEventListener('playback-error', (e) => {
      const detail = (e as CustomEvent<PlaybackErrorDetail>).detail;
      if (detail.sessionId !== SESSION_ID) return;
      this.#toasts.show(detail.message);
    });
  }

  async #open(): Promise<void> {
    const files = await this.#fileHandler.openFilePicker();
    if (files.length === 0) return;

    const file = files.find((f) => mediaKind(f));
    if (!file) {
      this.#toasts.show('That file type is not supported yet.');
      return;
    }

    const type = mediaKind(file);
    if (!type) return;
    this.#status.textContent = `Loading ${file.name}…`;
    try {
      await this.#broker.loadTrack(
        SESSION_ID,
        {
          id: `${Date.now()}`,
          name: file.name,
          type,
          fileSize: file.size,
          fileLastModified: file.lastModified,
        },
        file,
      );
    } catch {
      // The broker restores the last good track; only clear the stage when
      // there is nothing left to show.
      if (!this.#broker.getCurrentElement(SESSION_ID)) {
        this.#stage.replaceChildren(this.#empty);
        this.#status.textContent = 'No file open';
        this.#time.textContent = '';
      }
      this.#toasts.show(`Could not load ${file.name}.`);
    }
  }
}
