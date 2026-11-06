// Garder une erreur utile sans recopier un jeton éventuellement inclus dans
// le message d'un fournisseur. Aucune erreur n'est journalisée ici.
export function errorMessage(error: unknown, fallback = 'Une erreur inattendue est survenue.'): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : fallback;
  return (message || fallback)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[jeton masqué]')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, '[clé masquée]')
    .replace(/((?:access_token|refresh_token|api_key|apikey|client_secret)=)[^\s&]+/gi, '$1[masqué]');
}
