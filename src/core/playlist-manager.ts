import { mediaKind } from './file-handler.ts';
import type PlayerBroker from './player-broker';
import type { Track } from './player-broker';
import type SessionManager from './session-manager';
import { debug } from '../utils/debug.ts';

type PlaylistBroker = Pick<
  PlayerBroker,
  'loadTrack' | 'play' | 'pause' | 'getState' | 'markEnded'
>;

interface TrackEndedDetail {
  sessionId: string;
}

/**
 * Queue owner for Milestone 4. Replaces the queue on every pick, loads the
 * chosen index, and advances on `track-ended`. File objects live in memory
 * only — the browser sandbox cannot persist them.
 */
export default class PlaylistManager {
  #sessions: SessionManager;
  #broker: PlaylistBroker;
  #files = new Map<string, File>();

  constructor(sessions: SessionManager, broker: PlaylistBroker) {
    this.#sessions = sessions;
    this.#broker = broker;

    document.addEventListener('track-ended', (event) => {
      const { sessionId } = (event as CustomEvent<TrackEndedDetail>).detail;
      const session = this.#sessions.getActive();
      if (sessionId !== session.id) return;

      if (session.currentIndex >= session.playlist.length - 1) {
        // Last track: `audioClean.loop = true` would otherwise loop forever.
        this.#broker.pause(sessionId);
        this.#broker.markEnded(sessionId);
        document.dispatchEvent(
          new CustomEvent('playlist-finished', { detail: { sessionId } }),
        );
        return;
      }
      void this.playIndex(session.currentIndex + 1, true);
    });
  }

  /**
   * Replaces the queue with every supported file and loads the first track.
   * Returns the loaded track, or null when nothing playable was supplied.
   */
  async addFiles(files: readonly File[]): Promise<Track | null> {
    const media = files.filter((file) => mediaKind(file));
    if (media.length === 0) return null;

    const tracks: Track[] = media.map((file) => ({
      id: crypto.randomUUID(),
      name: stripExtension(file.name),
      type: mediaKind(file) === 'video' ? 'video' : 'audio',
      fileSize: file.size,
      fileLastModified: file.lastModified,
    }));

    this.#files.clear();
    media.forEach((file, index) => {
      const track = tracks[index];
      if (track) this.#files.set(track.id, file);
    });

    const session = this.#sessions.getActive();
    session.playlist = tracks;
    session.currentIndex = 0;
    document.dispatchEvent(
      new CustomEvent('playlist-updated', { detail: { sessionId: session.id } }),
    );

    return this.playIndex(0, false);
  }

  async playIndex(index: number, autoplay = false): Promise<Track | null> {
    const session = this.#sessions.getActive();
    const track = session.playlist[index];
    if (!track) return null;
    // Rapid taps must not start two loads; the last one would win unpredictably.
    if (this.#broker.getState(session.id) === 'loading') return null;

    const file = this.#files.get(track.id);
    if (!file) {
      document.dispatchEvent(
        new CustomEvent('track-file-missing', {
          detail: { sessionId: session.id, index },
        }),
      );
      return null;
    }

    session.currentIndex = index;
    debug('playlist', 'advancing to index', index, track.name);
    try {
      await this.#broker.loadTrack(session.id, track, file);
    } catch {
      document.dispatchEvent(
        new CustomEvent('toast', {
          detail: { message: `Could not play ${track.name}.` },
        }),
      );
      return null;
    }

    document.dispatchEvent(
      new CustomEvent('playlist-updated', { detail: { sessionId: session.id } }),
    );

    if (autoplay) {
      await this.#broker.play(session.id)?.catch(() => {
        document.dispatchEvent(
          new CustomEvent('toast', {
            detail: { message: 'Playback was blocked by the browser.' },
          }),
        );
      });
    }
    return track;
  }

  next(): void {
    const session = this.#sessions.getActive();
    if (session.currentIndex < session.playlist.length - 1) {
      void this.playIndex(session.currentIndex + 1, true);
    }
  }

  /** At index 0 this is a no-op, mirroring next() on the last track. */
  prev(): void {
    const session = this.#sessions.getActive();
    if (session.currentIndex > 0) {
      void this.playIndex(session.currentIndex - 1, true);
    }
  }

  getFile(id: string): File | null {
    return this.#files.get(id) ?? null;
  }
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}
