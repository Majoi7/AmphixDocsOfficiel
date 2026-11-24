import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { checkPreviewSignal } from './preview-resources';
import { loadModuleWithNotice } from './module-load-error';

// Runtime et worker legacy locaux, compatibles avec davantage de mobiles.
// Un import échoué reste mémorisé jusqu'à l'actualisation manuelle, sans boucle.
let runtime: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | undefined;
export function loadPdfRuntime() {
  runtime ??= Promise.all([
    loadModuleWithNotice(() => import('pdfjs-dist/legacy/build/pdf.mjs')),
    loadModuleWithNotice(() => import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')),
  ]).then(([pdf, worker]) => {
    pdf.GlobalWorkerOptions.workerSrc = worker.default;
    return pdf;
  });
  return runtime;
}

export interface OpenPdf {
  document: PDFDocumentProxy;
  dispose: () => Promise<void>;
}
export async function openPdf(blob: Blob, signal?: AbortSignal): Promise<OpenPdf> {
  checkPreviewSignal(signal);
  const pdf = await loadPdfRuntime();
  checkPreviewSignal(signal);
  // pdf.js lit le Blob via une URL locale : aucune copie complète ArrayBuffer
  // sur le thread principal avant le démarrage du worker.
  const url = URL.createObjectURL(blob);
  let task: PDFDocumentLoadingTask | undefined;
  let closing: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    signal?.removeEventListener('abort', abort);
    if (closing) return closing;
    closing = (async () => {
      try { await task?.destroy(); }
      finally { URL.revokeObjectURL(url); }
    })();
    return closing;
  };
  const abort = () => { void dispose().catch(() => undefined); };
  try {
    task = pdf.getDocument({
      url, enableXfa: false,
      useSystemFonts: true, maxImageSize: 16_000_000,
    });
    // Pas de mot de passe collecté ou mémorisé : téléchargement toujours proposé.
    task.onPassword = () => { void dispose().catch(() => undefined); };
    signal?.addEventListener('abort', abort, { once: true });
    checkPreviewSignal(signal);
    const document = await task.promise;
    checkPreviewSignal(signal);
    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1) throw new Error('PDF sans page lisible.');
    return { document, dispose };
  } catch (error) {
    await dispose().catch(() => undefined);
    throw error;
  }
}
