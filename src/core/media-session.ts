import type PlayerBroker from './player-broker';
import type SessionManager from './session-manager';
import type { Session } from './session-manager';

type MediaSessionBroker = Pick<PlayerBroker, 'play' | 'pause' | 'getState'>;
type NavigationTarget = { next(): void; prev(): void };

const ACTIONS = [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
  'seekbackward',
  'seekforward',
] as const;

/**
 * Lock-screen / control-centre integration (M5). One session for now; M9 makes
 * the registry per session. Video detaches on hide so no stale entry survives;
 * audio stays attached so background playback keeps its controls (M6).
 */
export default class MediaSessionController {
  #broker: MediaSessionBroker;
  #sessions: SessionManager;
  #registries: Map<string, NavigationTarget>;
  #attached = false;
  #initialized = false;
  #artworkByColor = new Map<string, string>();

  constructor(
    broker: MediaSessionBroker,
    sessions: SessionManager,
    registries: Map<string, NavigationTarget>,
  ) {
    this.#broker = broker;
    this.#sessions = sessions;
    this.#registries = registries;
  }

  init(): void {
    if (this.#initialized || !('mediaSession' in navigator)) return;
    this.#initialized = true;

    this.attachToSession(this.#sessions.activeSessionId);
    this.#installListeners();
  }

  /** Idempotent: safe to call on every visibility return. */
  attachToSession(sessionId: string): void {
    if (!('mediaSession' in navigator)) return;
    const session = this.#sessions.getActive();
    if (session.id !== sessionId) return;

    this.#registerHandlers();
    this.#updateMetadata(session);
    this.#syncPlaybackState(session.id);
    this.#attached = true;
  }

  detach(): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    for (const action of ACTIONS) {
      navigator.mediaSession.setActionHandler(action, null);
    }
    this.#attached = false;
  }

  #registerHandlers(): void {
    const media = navigator.mediaSession;
    // Explicit null is what makes iOS show prev/next instead of seek buttons.
    media.setActionHandler('seekbackward', null);
    media.setActionHandler('seekforward', null);

    media.setActionHandler('play', () => {
      const id = this.#sessions.activeSessionId;
      void this.#broker.play(id)?.catch(() => undefined);
      media.playbackState = 'playing';
    });
    media.setActionHandler('pause', () => {
      this.#broker.pause(this.#sessions.activeSessionId);
      media.playbackState = 'paused';
    });
    media.setActionHandler('previoustrack', () => {
      this.#registries.get(this.#sessions.activeSessionId)?.prev();
    });
    media.setActionHandler('nexttrack', () => {
      this.#registries.get(this.#sessions.activeSessionId)?.next();
    });
  }

  #updateMetadata(session: Session): void {
    if (!('mediaSession' in navigator)) return;
    const track = session.playlist[session.currentIndex];
    if (!track) {
      navigator.mediaSession.metadata = null;
      return;
    }

    const artwork = this.#artworkFor(session.color);
    const init: MediaMetadataInit = {
      title: track.name,
      artist: session.name,
      album: session.name,
    };
    if (artwork) {
      init.artwork = [{ src: artwork, sizes: '512x512', type: 'image/png' }];
    }
    navigator.mediaSession.metadata = new MediaMetadata(init);
  }

  /** Placeholder cover; iOS hides the widget when artwork is missing. */
  #artworkFor(color: string): string | null {
    const cached = this.#artworkByColor.get(color);
    if (cached) return cached;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = color || '#5b8def';
      ctx.fillRect(0, 0, 512, 512);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 96px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Cue', 256, 256);
      const url = canvas.toDataURL('image/png');
      this.#artworkByColor.set(color, url);
      return url;
    } catch {
      return null;
    }
  }

  #syncPlaybackState(sessionId: string): void {
    if (!('mediaSession' in navigator)) return;
    const state = this.#broker.getState(sessionId);
    navigator.mediaSession.playbackState = state === 'playing' ? 'playing' : 'paused';
  }

  #installListeners(): void {
    document.addEventListener('track-changed', (event) => {
      const { sessionId } = (event as CustomEvent<{ sessionId: string }>).detail;
      if (sessionId !== this.#sessions.activeSessionId || !this.#attached) return;
      this.#updateMetadata(this.#sessions.getActive());
      this.#syncPlaybackState(sessionId);
    });

    document.addEventListener('state-changed', (event) => {
      const { sessionId, state } = (
        event as CustomEvent<{ sessionId: string; state: string }>
      ).detail;
      if (sessionId !== this.#sessions.activeSessionId || !this.#attached) return;
      if (state === 'playing') navigator.mediaSession.playbackState = 'playing';
      else if (state === 'paused' || state === 'ended') {
        navigator.mediaSession.playbackState = 'paused';
      }
    });

    document.addEventListener('visibilitychange', () => {
      const session = this.#sessions.getActive();
      if (document.visibilityState === 'hidden') {
        if (session.activeView === 'shorts' || session.currentTrackType === 'video') {
          this.#broker.pause(session.id);
          this.detach();
          if (session.currentTrackType === 'video') {
            navigator.mediaSession.playbackState = 'paused';
          }
        }
        // Audio in the videos view stays attached: background is M6's job.
        return;
      }

      if (session.currentIndex >= 0 && session.currentTrackType) {
        this.attachToSession(session.id);
      }
    });
  }
}
