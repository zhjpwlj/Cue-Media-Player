/**
 * Barebones settings sheet for M7: the only preference is the fullscreen mode.
 * M19 expands it; keep this DOM small and the wiring local.
 */
import type SessionManager from '../core/session-manager.ts';

export default class SettingsModal {
  #sessions: SessionManager;
  #root!: HTMLElement;
  #toggle!: HTMLInputElement;
  #closeButton!: HTMLButtonElement;
  #opener: HTMLButtonElement | null;

  constructor(sessions: SessionManager, opener?: HTMLButtonElement) {
    this.#sessions = sessions;
    this.#opener = opener ?? null;
  }

  mount(): void {
    this.#root = element('settings-modal');
    this.#toggle = element<HTMLInputElement>('pref-simulated-fs');
    this.#closeButton = element<HTMLButtonElement>('btn-settings-close');

    this.#syncFromSession();
    this.#toggle.addEventListener('change', () => {
      const session = this.#sessions.getActive();
      session.fullscreenMode = this.#toggle.checked ? 'simulated' : 'native';
    });
    this.#closeButton.addEventListener('click', () => this.close());
    this.#opener?.addEventListener('click', () => this.open());

    // Tap the backdrop, not the sheet, to dismiss.
    this.#root.addEventListener('click', (event) => {
      if (event.target === this.#root) this.close();
    });
    this.#root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.close();
      }
    });
  }

  open(): void {
    this.#syncFromSession();
    this.#root.classList.remove('hidden');
    this.#closeButton.focus();
  }

  close(): void {
    this.#root.classList.add('hidden');
  }

  get isOpen(): boolean {
    return !this.#root.classList.contains('hidden');
  }

  #syncFromSession(): void {
    this.#toggle.checked = this.#sessions.getActive().fullscreenMode === 'simulated';
  }
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}
