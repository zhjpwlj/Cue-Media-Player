/**
 * Launch-time update policy (post-M7).
 *
 * The page always starts from the precached app shell, so startup never waits
 * on the network. In parallel the browser checks `/sw.js`; when a newly
 * deployed worker finishes installing it activates immediately and this module
 * reloads the page once, so the running app is always the newest build.
 *
 * No prompt, no "update available" toast. The reload is skipped on the very
 * first install: there is no older shell to replace, and the running assets
 * already match the worker.
 */

interface UpdateRegistration {
  installing: ServiceWorker | null;
  waiting: ServiceWorker | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

interface UpdateContainer {
  readonly controller: ServiceWorker | null;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

export default function installAutoUpdate(
  registration: UpdateRegistration,
  container: UpdateContainer,
  reload: () => void,
): void {
  const replacing = container.controller !== null;
  let reloading = false;

  container.addEventListener('controllerchange', () => {
    if (!replacing || reloading) return;
    reloading = true;
    reload();
  });

  const activate = (): void => {
    // The worker installs with skipWaiting(), so this is usually a no-op. It
    // still covers a worker that reached `waiting` before this policy ran, or
    // one built before auto-activation existed.
    const worker = registration.waiting ?? registration.installing;
    worker?.postMessage({ type: 'SKIP_WAITING' });
  };

  registration.addEventListener('updatefound', () => {
    const incoming = registration.installing;
    if (!incoming) return;
    incoming.addEventListener('statechange', () => {
      if (incoming.state === 'installed') activate();
    });
  });

  if (registration.waiting) activate();
}
