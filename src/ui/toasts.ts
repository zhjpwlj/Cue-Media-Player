/**
 * Non-blocking status messages. No console output by design (§17).
 */
export default class Toasts {
  #root: HTMLDivElement;

  constructor() {
    this.#root = document.createElement('div');
    this.#root.className = 'toasts';
    this.#root.setAttribute('role', 'status');
    this.#root.setAttribute('aria-live', 'polite');
    document.body.append(this.#root);
  }

  show(message: string, timeoutMs = 5000): HTMLParagraphElement {
    const toast = document.createElement('p');
    toast.className = 'toast';
    toast.textContent = message;
    this.#root.append(toast);
    setTimeout(() => toast.remove(), timeoutMs);
    return toast;
  }
}
