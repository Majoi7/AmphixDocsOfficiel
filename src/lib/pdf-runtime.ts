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
  const [pdf, buffer] = await Promise.all([loadPdfRuntime(), blob.arrayBuffer()]);
  checkPreviewSignal(signal);
  let task: PDFDocumentLoadingTask | undefined;
  let closing: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    signal?.removeEventListener('abort', abort);
    if (closing) return closing;
    const pending: Promise<void> = task ? task.destroy() : Promise.resolve();
    closing = pending;
    return pending;
  };
  const abort = () => { void dispose().catch(() => undefined); };
  task = pdf.getDocument({
    data: new Uint8Array(buffer), enableXfa: false,
    useSystemFonts: true, maxImageSize: 16_000_000,
  });
  // Pas de mot de passe collecté ou mémorisé : téléchargement toujours proposé.
  task.onPassword = () => { void dispose().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const document = await task.promise;
    checkPreviewSignal(signal);
    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1) throw new Error('PDF sans page lisible.');
    return { document, dispose };
  } catch (error) {
    await dispose().catch(() => undefined);
    throw error;
  }
}
