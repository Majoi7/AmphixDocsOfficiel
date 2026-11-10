// Annulation portable : une dépendance lente ne retient pas l'appelant indéfiniment.
// L'opération reçoit toujours aussi le signal pour interrompre son travail réseau.
export function withLeoSignal<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Interrompu', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new DOMException('Interrompu', 'AbortError'));
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
