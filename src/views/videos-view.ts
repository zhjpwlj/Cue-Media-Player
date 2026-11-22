import AudioVolume from '../core/audio-volume';
import type AudioSkinController from '../core/audio-skin-controller';
import { mediaKind } from '../core/file-handler';
import type FileHandler from '../core/file-handler';
import type PlaylistManager from '../core/playlist-manager';
import type PlayerBroker from '../core/player-broker';
import type { PlayerState, Track } from '../core/player-broker';
import type SessionManager from '../core/session-manager';
import type { Session } from '../core/session-manager';
import type Toasts from '../ui/toasts';
import { isIOSDevice, supportsDirectoryPicker } from '../utils/platform';
import { formatTime } from '../utils/time';

interface VideosViewDeps {
  broker: PlayerBroker;
  fileHandler: FileHandler;
  playlist: PlaylistManager;
  toasts: Toasts;
  sessions: SessionManager;
  audioSkin: AudioSkinController;
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

// iPadOS reports itself as a Mac with touch. Folder selection needs Safari
// 18.4+ there; programmatic volume is always ignored. M23 owns this properly.

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
  #audioSkin: AudioSkinController;

  #playerContainer!: HTMLElement;
  #mediaSlot!: HTMLElement;
  #audioSkinMount!: HTMLElement;
  #sessionTitle!: HTMLElement;
  #trackName!: HTMLElement;
  #trackBadge!: HTMLElement;
  #playPause!: HTMLButtonElement;
  #prevButton!: HTMLButtonElement;
  #nextButton!: HTMLButtonElement;
  #seekBar!: HTMLInputElement;
  #timeDisplay!: HTMLElement;
  #volumeButton!: HTMLButtonElement;
  #volumeSlider!: HTMLInputElement;
  #playlistItems!: HTMLElement;
  #airplayButton!: HTMLButtonElement;
  #folderButton!: HTMLButtonElement;
  #fullscreenButton!: HTMLButtonElement;
  #pipButton!: HTMLButtonElement;

  // Session has no volume field in M3: volume is view state, mute is session state.
  #volume = 1;
  #isIOS = isIOSDevice(navigator.userAgent, navigator.maxTouchPoints);
  #audioVolume = new AudioVolume(this.#isIOS);
  #scrubbing = false;

  constructor({ broker, fileHandler, playlist, toasts, sessions, audioSkin }: VideosViewDeps) {
    this.#broker = broker;
    this.#fileHandler = fileHandler;
    this.#playlist = playlist;
    this.#toasts = toasts;
    this.#sessions = sessions;
    this.#audioSkin = audioSkin;
  }

  mount(container: HTMLElement): void {
    this.#playerContainer = this.#el('player-container');
    this.#mediaSlot = this.#el('player-media-slot');
    this.#audioSkinMount = this.#el('audio-skin-mount');
    this.#sessionTitle = this.#el('session-title');
    this.#trackName = this.#el('track-name');
    this.#trackBadge = this.#el('track-type-badge');
    this.#playPause = this.#el<HTMLButtonElement>('btn-play-pause');
    this.#prevButton = this.#el<HTMLButtonElement>('btn-prev');
    this.#nextButton = this.#el<HTMLButtonElement>('btn-next');
    this.#seekBar = this.#el<HTMLInputElement>('seek-bar');
    this.#timeDisplay = this.#el('time-display');
    this.#volumeButton = this.#el<HTMLButtonElement>('btn-volume');
    this.#volumeSlider = this.#el<HTMLInputElement>('volume-slider');
    this.#playlistItems = this.#el('playlist-items');
    this.#airplayButton = this.#el<HTMLButtonElement>('btn-airplay');
    this.#folderButton = this.#el<HTMLButtonElement>('btn-select-folder');
    this.#fullscreenButton = this.#el<HTMLButtonElement>('btn-fullscreen');
    this.#pipButton = this.#el<HTMLButtonElement>('btn-pip');

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
    this.#prevButton.addEventListener('click', () => this.#playlist.prev());
    this.#nextButton.addEventListener('click', () => this.#playlist.next());
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
      this.#audioVolume.prepare(this.#broker.getCurrentElement(session.id));
    });
    // Safari grants activation on touch release, not always during the drag.
    this.#volumeSlider.addEventListener('change', () => {
      this.#applyVolume();
      this.#audioVolume.prepare(
        this.#broker.getCurrentElement(this.#sessions.activeSessionId),
      );
    });

    this.#volumeButton.addEventListener('click', () => {
      const session = this.#sessions.getActive();
      session.muted = !session.muted;
      this.#applyVolume();
    });

    this.#el<HTMLButtonElement>('btn-select-file').addEventListener('click', () => {
      void this.#open();
    });

    const ua = navigator.userAgent;
    const hasDirectory = 'webkitdirectory' in document.createElement('input');
    if (supportsDirectoryPicker(ua, hasDirectory, this.#isIOS)) {
      this.#folderButton.addEventListener('click', () => this.#fileHandler.openFolderPicker());
    } else {
      this.#folderButton.hidden = true;
      this.#folderButton.title = 'Folder selection is unavailable in this browser';
    }

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

    this.#fullscreenButton.addEventListener('click', () => {
      const sessionId = this.#sessions.activeSessionId;
      if (this.#broker.simulatedFsActive) {
        this.#broker.exitFullscreen(sessionId);
        return;
      }
      void this.#broker.enterFullscreen(sessionId);
    });

    this.#pipButton.addEventListener('click', () => {
      void this.#broker.enterPiP(this.#sessions.activeSessionId).then((entered) => {
        if (!entered) this.#toasts.show('Picture in picture is unavailable for this video.');
      });
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

    document.addEventListener('fullscreen-changed', (event) => {
      const detail = (event as CustomEvent<{ sessionId: string; active: boolean }>).detail;
      if (!this.#isActive(detail.sessionId)) return;
      this.#fullscreenButton.textContent = detail.active ? '⤢' : '⛶';
      this.#fullscreenButton.setAttribute(
        'aria-label',
        detail.active ? 'Exit fullscreen' : 'Fullscreen',
      );
    });
  }

  #isActive(sessionId: string): boolean {
    return sessionId === this.#sessions.activeSessionId;
  }

  async #open(): Promise<void> {
    const files = await this.#fileHandler.openFilePicker();
    if (files.length === 0) return;

    const first = files.find((candidate) => mediaKind(candidate));
    if (!first) {
      this.#toasts.show('That file type is not supported yet.');
      return;
    }

    this.#trackName.textContent = `Loading ${first.name}…`;
    const track = await this.#playlist.addFiles(files);
    if (track) return;

    // PlaylistManager already toasted; keep the current queue entry visible.
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
    this.#refreshDisplayButtons(detail.track.type);
    this.#showAudioSurface(detail.track, session);
  }

  /** Audio swaps the media element out for the themed skin surface (M8). */
  #showAudioSurface(track: Track, session: Session): void {
    const isAudio = track.type === 'audio';
    this.#mediaSlot.classList.toggle('hidden', isAudio);
    this.#audioSkinMount.hidden = !isAudio;
    if (!isAudio) return;

    this.#audioSkin.load(session.audioThemeId);
    this.#audioSkin.setMetadata({
      title: track.name,
      artist: session.name,
      album: '',
    });
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
    // Must happen inside the tap gesture or iOS keeps the audio context suspended.
    this.#audioVolume.prepare(this.#broker.getCurrentElement(session.id));
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
    this.#audioVolume.apply(this.#broker.getCurrentElement(session.id), this.#volume);
    const el = this.#broker.getCurrentElement(session.id);
    if (el) el.muted = session.muted;
    this.#volumeSlider.value = String(this.#volume);
    this.#volumeButton.textContent = session.muted ? '🔇' : '🔊';
    this.#volumeButton.setAttribute('aria-label', session.muted ? 'Unmute' : 'Mute');
  }

  /**
   * Fullscreen and PiP are meaningless for audio: the element has no picture
   * and native fullscreen is unavailable. Hide rather than disable, per M7.
   */
  #refreshDisplayButtons(kind: Track['type']): void {
    const isVideo = kind === 'video';
    this.#fullscreenButton.hidden = !isVideo;
    this.#pipButton.hidden = !isVideo || !this.#broker.supportsPiP(this.#sessions.activeSessionId);
  }

  #refreshAirplay(): void {    const el = this.#broker.getCurrentElement(this.#sessions.activeSessionId) as AirPlayElement | null;
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
      item.addEventListener('click', () => {
        void this.#playlist.playIndex(index, true);
      });
      this.#playlistItems.append(item);
    });
  }

}
