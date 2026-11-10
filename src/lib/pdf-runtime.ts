import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { checkPreviewSignal } from './preview-resources';

// Les deux imports produisent des ressources locales distinctes. Aucun PDF ni
// aucune URL signée ne passe par un CDN ou par le service worker de l'application.
let runtime: Promise<typeof import('pdfjs-dist')> | undefined;
export function loadPdfRuntime() {
  runtime ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdf, worker]) => {
    pdf.GlobalWorkerOptions.workerSrc = worker.default;
    return pdf;
  }).catch((error) => { runtime = undefined; throw error; });
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
    data: new Uint8Array(buffer), isEvalSupported: false, enableXfa: false,
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
