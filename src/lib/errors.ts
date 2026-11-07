// Les détails des fournisseurs restent séparés des textes destinés à l’interface.
// Ne jamais journaliser un objet complet : il peut contenir une session ou des clés.
export function errorMessage(error: unknown, fallback = 'Une erreur inattendue est survenue.'): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : fallback;
  return (message || fallback)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[jeton masqué]')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, '[clé masquée]')
    .replace(/((?:access_token|refresh_token|api_key|apikey|client_secret)=)[^\s&]+/gi, '$1[masqué]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [jeton masqué]')
    .replace(/([?&](?:token|signature|key)=)[^\s&]+/gi, '$1[masqué]');
}

export function logDevelopmentError(error: unknown, context = 'AmphixDocs'): void {
  if (import.meta.env.DEV) console.warn(`[${context}] ${errorMessage(error)}`);
}

// Le fallback est un texte français maîtrisé, jamais un message SQL/HTTP/OAuth.
export function userError(error: unknown, fallback = 'Une erreur est survenue. Réessayez.'): string {
  logDevelopmentError(error);
  return fallback;
}
