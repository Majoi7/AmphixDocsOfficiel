// Une seule file partagée par les générations de vignettes. Une tâche annulée
// en attente ne consomme jamais de canvas/worker.
export function createTaskLimiter(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Limite de tâches invalide.');
  let active = 0;
  const waiting: (() => void)[] = [];
  return function run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const aborted = () => {
        const index = waiting.indexOf(start);
        if (index >= 0) waiting.splice(index, 1);
        reject(new DOMException('Opération annulée.', 'AbortError'));
      };
      const start = () => {
        signal?.removeEventListener('abort', aborted);
        if (signal?.aborted) { aborted(); return; }
        active++;
        void Promise.resolve().then(work).then(resolve, reject).finally(() => {
          active--;
          waiting.shift()?.();
        });
      };
      if (signal?.aborted) { aborted(); return; }
      if (active < limit) start();
      else { waiting.push(start); signal?.addEventListener('abort', aborted, { once: true }); }
    });
  };
}

export function checkPreviewSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Opération annulée.', 'AbortError');
}

// Le budget s'applique aux pixels physiques, donc également aux écrans Retina
// et aux PDF dont la première page est exceptionnellement longue.
export function rasterSize(width: number, height: number, targetWidth: number, pixelRatio: number, maxPixels = 2_000_000) {
  if (![width, height, targetWidth].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Dimensions illisibles.');
  }
  const dpr = Number.isFinite(pixelRatio) ? Math.min(2, Math.max(1, pixelRatio)) : 1;
  const scale = Math.min(targetWidth * dpr / width, Math.sqrt(maxPixels / (width * height)), 8192 / width, 8192 / height);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale };
}
