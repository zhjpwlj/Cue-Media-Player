// @ts-expect-error Node's type stripping requires an explicit .ts extension.
import { mediaKind } from './file-handler.ts';
import type PlayerBroker from './player-broker';
import type { Track } from './player-broker';
import type SessionManager from './session-manager';

/**
 * Single-track playlist for Milestone 3. M4 turns `playlist` into a real queue
 * and loads every selected file; for now only the first file reaches the broker.
 *
 * `File` objects live in memory only — the browser sandbox cannot persist them.
 */
export default class PlaylistManager {
  #sessions: SessionManager;
  #broker: Pick<PlayerBroker, 'loadTrack'>;
  #files = new Map<string, File>();

  constructor(sessions: SessionManager, broker: Pick<PlayerBroker, 'loadTrack'>) {
    this.#sessions = sessions;
    this.#broker = broker;
  }

  async addFiles(files: File[]): Promise<Track | null> {
    const file = files[0];
    if (!file) return null;

    const type = mediaKind(file);
    if (!type) {
      console.warn(`[playlist] Unsupported file type: ${file.name}`);
      return null;
    }

    const track: Track = {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, ''),
      type,
      fileSize: file.size,
      fileLastModified: file.lastModified,
    };

    this.#files.set(track.id, file);
    const session = this.#sessions.getActive();
    session.playlist = [track];
    session.currentIndex = 0;
    document.dispatchEvent(new CustomEvent('playlist-updated', { detail: { sessionId: session.id } }));

    try {
      await this.#broker.loadTrack(session.id, track, file);
    } catch {
      document.dispatchEvent(
        new CustomEvent('toast', { detail: { message: `Could not load ${file.name}.` } }),
      );
    }
    return track;
  }

  getFile(id: string): File | null {
    return this.#files.get(id) ?? null;
  }
}
