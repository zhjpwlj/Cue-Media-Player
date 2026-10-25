import { mediaKind } from '../core/file-handler.js';
import { formatTime } from '../utils/time.js';

// Milestone 2 is single-session. Session tabs arrive at M9.
const SESSION_ID = 'main';

/**
 * Single-track view: pick a file, hand it to the broker, show native controls.
 */
export default class VideosView {
  #broker;
  #fileHandler;
  #toasts;
  #stage;
  #status;
  #time;
  #empty;

  constructor({ broker, fileHandler, toasts }) {
    this.#broker = broker;
    this.#fileHandler = fileHandler;
    this.#toasts = toasts;
  }

  mount(container) {
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

    const $ = (role) => container.querySelector(`[data-role="${role}"]`);
    const openButton = $('open');
    this.#stage = $('stage');
    this.#status = $('status');
    this.#time = $('time');
    this.#empty = $('empty');

    openButton.addEventListener('click', () => this.#open());
    this.#broker.attachTo(SESSION_ID, this.#stage);

    document.addEventListener('track-changed', (e) => {
      if (e.detail.sessionId !== SESSION_ID) return;
      this.#status.textContent = e.detail.track.name;
    });

    document.addEventListener('time-update', (e) => {
      if (e.detail.sessionId !== SESSION_ID) return;
      this.#time.textContent = `${formatTime(e.detail.currentTime)} / ${formatTime(e.detail.duration)}`;
    });

    document.addEventListener('playback-error', (e) => {
      if (e.detail.sessionId !== SESSION_ID) return;
      this.#toasts.show(e.detail.message);
    });
  }

  async #open() {
    const files = await this.#fileHandler.openFilePicker();
    if (files.length === 0) return;

    const file = files.find((f) => mediaKind(f));
    if (!file) {
      this.#toasts.show('That file type is not supported yet.');
      return;
    }

    const type = mediaKind(file);
    this.#status.textContent = `Loading ${file.name}…`;
    try {
      await this.#broker.loadTrack(
        SESSION_ID,
        { id: `${Date.now()}`, name: file.name, type },
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
