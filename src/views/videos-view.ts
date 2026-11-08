import { mediaKind } from '../core/file-handler';
import type FileHandler from '../core/file-handler';
import type PlaylistManager from '../core/playlist-manager';
import type PlayerBroker from '../core/player-broker';
import type { PlayerState, Track } from '../core/player-broker';
import type SessionManager from '../core/session-manager';
import type { Session } from '../core/session-manager';
import type Toasts from '../ui/toasts';
import { formatTime } from '../utils/time';

interface VideosViewDeps {
  broker: PlayerBroker;
  fileHandler: FileHandler;
  playlist: PlaylistManager;
  toasts: Toasts;
  sessions: SessionManager;
}

interface TrackChangedDetail {
  sessionId: string;
  track: Track;
}
interface TimeUpdateDetail {
  sessionId: string;
  currentTime: number;
  duration: number;
}
interface StateChangedDetail {
  sessionId: string;
  state: PlayerState;
}
interface PlaybackErrorDetail {
  sessionId: string;
  message: string;
}
interface PlaylistUpdatedDetail {
  sessionId: string;
}

// iPadOS reports itself as a Mac with touch; iPhone/iPad lack the folder picker
// and ignore programmatic volume. The M23 platform module owns this properly.
function isIOS(): boolean {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  );
}

type AirPlayElement = HTMLMediaElement & {
  webkitShowPlaybackTargetPicker?: () => void;
};

/**
 * Videos layout for Milestone 3. The DOM is static in index.html; this class
 * only binds it. Transport, volume, mute, and the folder picker live here so
 * the audio/video element swap keeps a single visible control set.
 */
export default class VideosView {
  #broker: PlayerBroker;
  #fileHandler: FileHandler;
  #playlist: PlaylistManager;
  #toasts: Toasts;
  #sessions: SessionManager;

  #playerContainer!: HTMLElement;
  #mediaSlot!: HTMLElement;
  #sessionTitle!: HTMLElement;
  #trackName!: HTMLElement;
  #trackBadge!: HTMLElement;
  #playPause!: HTMLButtonElement;
  #seekBar!: HTMLInputElement;
  #timeDisplay!: HTMLElement;
  #volumeButton!: HTMLButtonElement;
  #volumeSlider!: HTMLInputElement;
  #playlistItems!: HTMLElement;
  #airplayButton!: HTMLButtonElement;
  #folderButton!: HTMLButtonElement;

  // Session has no volume field in M3: volume is view state, mute is session state.
  #volume = 1;
  #scrubbing = false;

  constructor({ broker, fileHandler, playlist, toasts, sessions }: VideosViewDeps) {
    this.#broker = broker;
    this.#fileHandler = fileHandler;
    this.#playlist = playlist;
    this.#toasts = toasts;
    this.#sessions = sessions;
  }

  mount(container: HTMLElement): void {
    this.#playerContainer = this.#el('player-container');
    this.#mediaSlot = this.#el('player-media-slot');
    this.#sessionTitle = this.#el('session-title');
    this.#trackName = this.#el('track-name');
    this.#trackBadge = this.#el('track-type-badge');
    this.#playPause = this.#el<HTMLButtonElement>('btn-play-pause');
    this.#seekBar = this.#el<HTMLInputElement>('seek-bar');
    this.#timeDisplay = this.#el('time-display');
    this.#volumeButton = this.#el<HTMLButtonElement>('btn-volume');
    this.#volumeSlider = this.#el<HTMLInputElement>('volume-slider');
    this.#playlistItems = this.#el('playlist-items');
    this.#airplayButton = this.#el<HTMLButtonElement>('btn-airplay');
    this.#folderButton = this.#el<HTMLButtonElement>('btn-select-folder');

    this.#broker.attachTo(this.#sessions.activeSessionId, this.#mediaSlot);
    this.#bindControls();
    this.#bindDocumentEvents();

    this.onActivate(this.#sessions.getActive());
    this.onPlaylistUpdated();
    this.#refreshAirplay();
  }

  onActivate(session: Session): void {
    this.#sessionTitle.textContent = session.name;
    this.#renderPlaylist();
    this.#applyVolume();
  }

  onPlaylistUpdated(): void {
    this.#renderPlaylist();
  }

  #el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error(`missing #${id}`);
    return node as T;
  }

  #bindControls(): void {
    this.#playerContainer.addEventListener('pointerdown', (event) => {
      if ((event.target as Element).closest('#controls-overlay')) return;
      this.#playerContainer.classList.toggle('show-controls');
    });

    this.#playPause.addEventListener('click', () => this.#togglePlay());
    this.#seekBar.addEventListener('input', () => {
      // Ignore timeupdate while the finger is on the bar, or the thumb fights back.
      this.#scrubbing = true;
      this.#seekToSlider();
    });
    this.#seekBar.addEventListener('change', () => {
      this.#scrubbing = false;
      this.#seekToSlider();
    });

    this.#volumeSlider.addEventListener('input', () => {
      this.#volume = Number(this.#volumeSlider.value);
      const session = this.#sessions.getActive();
      if (this.#volume > 0 && session.muted) session.muted = false;
      this.#applyVolume();
    });

    this.#volumeButton.addEventListener('click', () => {
      const session = this.#sessions.getActive();
      session.muted = !session.muted;
      this.#applyVolume();
    });

    this.#el<HTMLButtonElement>('btn-select-file').addEventListener('click', () => {
      void this.#open();
    });

    if (!isIOS() && 'webkitdirectory' in document.createElement('input')) {
      this.#folderButton.addEventListener('click', () => this.#fileHandler.openFolderPicker());
    } else {
      this.#folderButton.hidden = true;
      this.#folderButton.title = 'Folder selection is unavailable in this browser';
    }

    // iOS ignores HTMLMediaElement.volume; only mute is honored. Hide the dead slider.
    if (isIOS()) this.#volumeSlider.hidden = true;

    this.#airplayButton.addEventListener('click', () => {
      const el = this.#broker.getCurrentElement(this.#sessions.activeSessionId) as AirPlayElement | null;
      if (typeof el?.webkitShowPlaybackTargetPicker !== 'function') {
        this.#refreshAirplay();
        return;
      }
      el.webkitShowPlaybackTargetPicker();
    });

    this.#el<HTMLButtonElement>('btn-info').addEventListener('click', () => {
      this.#toasts.show('Track details arrive with metadata extraction (M11).');
    });
  }

  #bindDocumentEvents(): void {
    document.addEventListener('track-changed', (event) => {
      const detail = (event as CustomEvent<TrackChangedDetail>).detail;
      if (!this.#isActive(detail.sessionId)) return;
      this.#onTrackChanged(detail);
    });

    document.addEventListener('time-update', (event) => {
      const detail = (event as CustomEvent<TimeUpdateDetail>).detail;
      if (!this.#isActive(detail.sessionId)) return;
      this.#onTimeUpdate(detail);
    });

    document.addEventListener('state-changed', (event) => {
      const detail = (event as CustomEvent<StateChangedDetail>).detail;
      if (!this.#isActive(detail.sessionId)) return;
      this.#onStateChanged(detail.state);
    });

    document.addEventListener('playback-error', (event) => {
      const detail = (event as CustomEvent<PlaybackErrorDetail>).detail;
      if (!this.#isActive(detail.sessionId)) return;
      this.#toasts.show(detail.message);
    });

    document.addEventListener('playlist-updated', (event) => {
      const detail = (event as CustomEvent<PlaylistUpdatedDetail>).detail;
      if (!this.#isActive(detail.sessionId)) return;
      this.onPlaylistUpdated();
    });
  }

  #isActive(sessionId: string): boolean {
    return sessionId === this.#sessions.activeSessionId;
  }

  async #open(): Promise<void> {
    const files = await this.#fileHandler.openFilePicker();
    if (files.length === 0) return;

    const file = files.find((candidate) => mediaKind(candidate));
    if (!file) {
      this.#toasts.show('That file type is not supported yet.');
      return;
    }

    this.#trackName.textContent = `Loading ${file.name}…`;
    const track = await this.#playlist.addFiles([file]);
    if (track) return;

    // PlaylistManager already toasted. Keep the previous track visible: the
    // broker restores it and emits track-changed, or there was none at all.
    const session = this.#sessions.getActive();
    const current = session.playlist[session.currentIndex];
    this.#trackName.textContent = current?.name ?? 'No file open';
  }

  #onTrackChanged(detail: TrackChangedDetail): void {
    const session = this.#sessions.getActive();
    session.currentTrackType = detail.track.type;
    this.#trackName.textContent = detail.track.name;
    this.#trackBadge.textContent = detail.track.type === 'video' ? 'Video' : 'Audio';
    this.#seekBar.value = '0';
    this.#timeDisplay.textContent = '0:00 / 0:00';
    this.#applyVolume();
    this.#refreshAirplay();
  }

  #onTimeUpdate(detail: TimeUpdateDetail): void {
    if (this.#scrubbing) return;
    const fraction = detail.duration > 0 ? detail.currentTime / detail.duration : 0;
    this.#seekBar.value = String(Math.round(Math.min(1, Math.max(0, fraction)) * 1000));
    this.#timeDisplay.textContent = `${formatTime(detail.currentTime)} / ${formatTime(detail.duration)}`;
  }

  #onStateChanged(state: PlayerState): void {
    const playing = state === 'playing';
    this.#playPause.textContent = playing ? '❚❚' : '▶';
    this.#playPause.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  #togglePlay(): void {
    const session = this.#sessions.getActive();
    if (this.#broker.getState(session.id) === 'playing') {
      this.#broker.pause(session.id);
      return;
    }
    void this.#broker
      .play(session.id)
      ?.catch(() => this.#toasts.show('Playback was blocked by the browser.'));
  }

  #seekToSlider(): void {
    const el = this.#broker.getCurrentElement(this.#sessions.activeSessionId);
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const seconds = (Number(this.#seekBar.value) / 1000) * el.duration;
    this.#broker.seek(this.#sessions.activeSessionId, seconds);
  }

  #applyVolume(): void {
    const session = this.#sessions.getActive();
    const el = this.#broker.getCurrentElement(session.id);
    if (el) {
      el.volume = this.#volume;
      el.muted = session.muted;
    }
    this.#volumeSlider.value = String(this.#volume);
    this.#volumeButton.textContent = session.muted ? '🔇' : '🔊';
    this.#volumeButton.setAttribute('aria-label', session.muted ? 'Unmute' : 'Mute');
  }

  #refreshAirplay(): void {
    const el = this.#broker.getCurrentElement(this.#sessions.activeSessionId) as AirPlayElement | null;
    if (typeof el?.webkitShowPlaybackTargetPicker !== 'function') {
      this.#airplayButton.disabled = true;
      this.#airplayButton.setAttribute('aria-disabled', 'true');
      this.#airplayButton.title = 'AirPlay is unavailable in this browser';
      return;
    }
    this.#airplayButton.disabled = false;
    this.#airplayButton.removeAttribute('aria-disabled');
    this.#airplayButton.removeAttribute('title');
  }

  #renderPlaylist(): void {
    const session = this.#sessions.getActive();
    this.#playlistItems.replaceChildren();
    session.playlist.forEach((track, index) => {
      const item = document.createElement('li');
      item.textContent = track.name;
      item.dataset.index = String(index);
      if (index === session.currentIndex) item.classList.add('active');
      item.addEventListener('click', () => this.#reloadActive(index));
      this.#playlistItems.append(item);
    });
  }

  #reloadActive(index: number): void {
    const session = this.#sessions.getActive();
    // M3 has one item per session; M4 adds playIndex and full queue loading.
    if (index !== session.currentIndex) return;
    if (this.#broker.getState(session.id) === 'loading') return;

    const track = session.playlist[index];
    const file = track ? this.#playlist.getFile(track.id) : null;
    if (!track || !file) return;

    void this.#broker.loadTrack(session.id, track, file).catch(() => {
      this.#toasts.show(`Could not load ${track.name}.`);
    });
  }
}
