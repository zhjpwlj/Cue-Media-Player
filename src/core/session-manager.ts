import type { Track, TrackKind } from './player-broker';

/**
 * Single-session stub for Milestone 3. Session tabs and persistence arrive at
 * M9; every field below already matches the §4.1 session shape so M4/M8/M9 can
 * extend it without a migration.
 */
export interface Session {
  id: string;
  name: string;
  icon: string;
  color: string;
  videoThemeId: string;
  audioThemeId: string;
  activeView: 'videos' | 'shorts';
  playlist: Track[];
  currentIndex: number;
  currentTime: number;
  currentTrackType: TrackKind | null;
  playbackRate: number;
  muted: boolean;
  selectedAudioTrack: number;
}

export default class SessionManager {
  #session: Session | null = null;

  get activeSessionId(): string {
    return this.getActive().id;
  }

  async init(): Promise<void> {
    if (this.#session) return;
    this.#session = {
      id: 'default',
      name: 'Cue 1',
      icon: '🎵',
      color: '#f2b544',
      videoThemeId: 'custom',
      audioThemeId: 'custom',
      activeView: 'videos',
      playlist: [],
      currentIndex: -1,
      currentTime: 0,
      currentTrackType: null,
      playbackRate: 1.0,
      muted: false,
      selectedAudioTrack: 0,
    };
  }

  getActive(): Session {
    if (!this.#session) throw new Error('SessionManager.init() was not called');
    return this.#session;
  }

  getOrdered(): Session[] {
    return this.#session ? [this.#session] : [];
  }
}
