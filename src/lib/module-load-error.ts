export const MODULE_LOAD_ERROR_EVENT = 'amphixdocs:module-load-error';

// Un seul signal, sans URL de chunk ni détail technique à l'écran. Le petit
// secours dans index.html fonctionne aussi avant le démarrage de React.
export function reportModuleLoadError(): void {
  if (typeof window === 'undefined') return;
  document.documentElement.dataset.moduleLoadError = 'true';
  window.dispatchEvent(new Event(MODULE_LOAD_ERROR_EVENT));
}

export function isModuleLoadError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  return /dynamically imported module|importing a module script|loading chunk|chunkloaderror|unable to preload css|failed to load module script|error loading a module/i.test(message);
}

// Un import est tenté une fois par appel. Ni nouvelle tentative automatique,
// ni changement de location dans ce chemin d'erreur.
export async function loadModuleWithNotice<T>(load: () => Promise<T>): Promise<T> {
  try { return await load(); }
  catch (cause) { reportModuleLoadError(); throw cause; }
}

// Réservé aux boutons « Actualiser », jamais appelé par un effet ou un worker.
export function manuallyRefreshApp(): void {
  window.location.reload();
}
