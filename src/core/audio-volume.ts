/**
 * iOS ignores `HTMLMediaElement.volume`: the setter is accepted, the value
 * stays 1. Route the element through a Web Audio GainNode instead, the same
 * path Essential Media Player uses.
 *
 * Lazy on purpose: the graph is built only after the user actually moves the
 * slider. Normal playback therefore keeps the native media path, and with it
 * the platform's AirPlay and background-audio behavior.
 */
export default class AudioVolume {
  /** False on iOS/iPadOS, where the native setter does nothing. */
  readonly needsGain: boolean;

  #ratio = 1;
  #ctx: AudioContext | null = null;
  #gains = new WeakMap<HTMLMediaElement, GainNode>();

  constructor() {
    this.needsGain = !volumeSetterWorks();
  }

  apply(element: HTMLMediaElement | null, ratio: number): void {
    this.#ratio = clamp(ratio);
    if (!element) return;

    if (!this.needsGain) {
      element.volume = this.#ratio;
      return;
    }

    element.volume = 1; // ignored on iOS; keeps other engines consistent
    const gain = this.#gains.get(element);
    if (gain) {
      gain.gain.value = this.#ratio;
      return;
    }
    // At full volume the native path already plays at 1: no graph needed.
    if (this.#ratio === 1) return;
    this.#route(element);
  }

  /** Call from a user gesture; resumes a context iOS suspended. */
  resume(): void {
    if (this.#ctx && this.#ctx.state !== 'running') {
      void this.#ctx.resume().catch(() => undefined);
    }
  }

  #route(element: HTMLMediaElement): void {
    try {
      this.#ctx ??= new AudioContext();
      const source = this.#ctx.createMediaElementSource(element);
      const gain = this.#ctx.createGain();
      gain.gain.value = this.#ratio;
      source.connect(gain);
      gain.connect(this.#ctx.destination);
      this.#gains.set(element, gain);
      this.resume();
    } catch {
      // No Web Audio: the native setter is the only fallback left.
    }
  }
}

function volumeSetterWorks(): boolean {
  try {
    const probe = document.createElement('audio');
    probe.volume = 0.5;
    return Math.abs(probe.volume - 0.5) < 0.01;
  } catch {
    return true;
  }
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}
