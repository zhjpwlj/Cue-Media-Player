/**
 * Theme picker: one sheet, two groups. Selection applies immediately, writes
 * the ids onto the session (M9 persists them), and closes.
 */
import type ThemeManager from '../core/theme-manager.ts';
import type { ThemeEntry } from '../core/theme-manager.ts';
import type SessionManager from '../core/session-manager.ts';

export default class ThemePicker {
  #themes: ThemeManager;
  #sessions: SessionManager;
  #root!: HTMLElement;
  #videoList!: HTMLElement;
  #audioList!: HTMLElement;
  #closeButton!: HTMLButtonElement;

  constructor(themes: ThemeManager, sessions: SessionManager) {
    this.#themes = themes;
    this.#sessions = sessions;
  }

  mount(): void {
    this.#root = element('theme-picker');
    this.#videoList = element('video-theme-options');
    this.#audioList = element('audio-theme-options');
    this.#closeButton = element<HTMLButtonElement>('btn-theme-close');

    element<HTMLButtonElement>('btn-theme').addEventListener('click', () => this.open());
    this.#closeButton.addEventListener('click', () => this.close());
    this.#root.addEventListener('click', (event) => {
      if (event.target === this.#root) this.close();
    });
  }

  open(): void {
    const session = this.#sessions.getActive();
    this.#render(this.#videoList, this.#themes.getVideoThemes(), session.videoThemeId, 'video');
    this.#render(this.#audioList, this.#themes.getAudioThemes(), session.audioThemeId, 'audio');
    this.#root.classList.remove('hidden');
    this.#closeButton.focus();
  }

  close(): void {
    this.#root.classList.add('hidden');
  }

  #render(
    list: HTMLElement,
    entries: readonly ThemeEntry[],
    activeId: string,
    kind: 'video' | 'audio',
  ): void {
    list.replaceChildren();
    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-option';
      button.dataset.themeId = entry.id;
      button.setAttribute('aria-pressed', String(entry.id === activeId));

      const swatch = document.createElement('span');
      swatch.className = 'theme-swatch';
      swatch.style.background = entry.color;
      swatch.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = entry.name;
      button.append(swatch, label);
      if (entry.id === activeId) {
        const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        check.setAttribute('class', 'icon theme-check');
        check.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#i-check');
        check.append(use);
        button.append(check);
      }

      button.addEventListener('click', () => {
        void this.#select(kind, entry.id);
      });
      list.append(button);
    }
  }

  async #select(kind: 'video' | 'audio', id: string): Promise<void> {
    const session = this.#sessions.getActive();
    if (kind === 'video') {
      session.videoThemeId = id;
      await this.#themes.applyVideoTheme(id);
    } else {
      session.audioThemeId = id;
      await this.#themes.applyAudioTheme(id);
    }
    this.close();
  }
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}
