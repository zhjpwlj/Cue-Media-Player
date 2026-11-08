/**
 * iOS ignores `HTMLMediaElement.volume`: the setter is accepted, the value
 * stays 1. Route the element through a Web Audio GainNode instead, the same
 * path Essential Media Player uses.
 *
 * The graph is created from a gesture (tap Play, or the volume slider) because
 * iOS otherwise leaves the AudioContext suspended. Once created, all iOS
 * playback for that element is routed through the gain node.
 */
export default class AudioVolume {
  /** True on iOS/iPadOS, where the native setter does nothing. */
  readonly needsGain: boolean;

  #ratio = 1;
  #ctx: AudioContext | null = null;
  #gains = new WeakMap<HTMLMediaElement, GainNode>();
  #lastError = '';

  constructor(needsGain: boolean) {
    this.needsGain = needsGain;
    latest = this;
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
    this.prepare(element);
  }

  /**
   * Builds and resumes the graph. Must be reached from a user gesture: Play,
   * slider input, or slider release all qualify. Safe to call repeatedly.
   */
  prepare(element: HTMLMediaElement | null): void {
    if (!element || !this.needsGain) return;
    if (!this.#gains.has(element)) this.#route(element);
    this.resume();
  }

  /** Call from a user gesture; resumes a context iOS suspended. */
  resume(): void {
    if (this.#ctx && this.#ctx.state !== 'running') {
      void this.#ctx.resume().catch((err: unknown) => {
        this.#lastError = err instanceof Error ? err.message : String(err);
      });
    }
  }

  describe(): string {
    if (!this.needsGain) return 'native (no gain needed)';
    if (!this.#ctx) return 'no context yet';
    const gain = currentElement(this.#gains);
    return [
      `ctx=${this.#ctx.state}`,
      `ratio=${this.#ratio.toFixed(2)}`,
      `gain=${gain ? gain.gain.value.toFixed(2) : 'none'}`,
      `error=${this.#lastError || 'none'}`,
    ].join(' ');
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
    } catch (err) {
      this.#lastError = err instanceof Error ? err.message : String(err);
    }
  }
}

let latest: AudioVolume | null = null;

/** Diagnostics hook; the panel has no access to the view instance. */
export function audioDiagnostics(): string {
  return latest?.describe() ?? 'no player yet';
}

function currentElement(gains: WeakMap<HTMLMediaElement, GainNode>): GainNode | null {
  const el = document.querySelector<HTMLMediaElement>('#player-media-slot audio, #player-media-slot video');
  return el ? (gains.get(el) ?? null) : null;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}
