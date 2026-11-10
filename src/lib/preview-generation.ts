import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type { OpenPdf } from './pdf-runtime';
import { checkPreviewSignal, createTaskLimiter, rasterSize } from './preview-resources';

export interface GeneratedPreview { blob: Blob | null; pageCount: number }
interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}
export interface PreviewRenderer {
  canvas: () => HTMLCanvasElement;
  pdf: (source: Blob, signal?: AbortSignal) => Promise<OpenPdf>;
  image: (source: Blob, signal?: AbortSignal) => Promise<DecodedImage>;
}
export interface PreviewOptions {
  signal?: AbortSignal;
  thumbnail?: boolean;
  pixelRatio?: number;
}

async function decodeImage(source: Blob, signal?: AbortSignal): Promise<DecodedImage> {
  checkPreviewSignal(signal);
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(source);
      if (signal?.aborted) { bitmap.close(); checkPreviewSignal(signal); }
      return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch (error) { if (signal?.aborted) throw error; }
  }
  const url = URL.createObjectURL(source);
  const image = new Image();
  const dispose = () => { image.src = ''; URL.revokeObjectURL(url); };
  try {
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => {
        image.onload = null;
        image.onerror = null;
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      const abort = () => done(new DOMException('Opération annulée.', 'AbortError'));
      image.onload = () => done();
      image.onerror = () => done(new Error('Image illisible.'));
      signal?.addEventListener('abort', abort, { once: true });
      image.src = url;
      if (signal?.aborted) abort();
    });
    checkPreviewSignal(signal);
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose };
  } catch (error) { dispose(); throw error; }
}
const browserRenderer: PreviewRenderer = {
  canvas: () => document.createElement('canvas'),
  pdf: async (source, signal) => {
    const { openPdf } = await import('./pdf-runtime');
    checkPreviewSignal(signal);
    return openPdf(source, signal);
  },
  image: decodeImage,
};
const MAX_THUMBNAIL_SIZE = 1024 * 1024;

// Dépendances de rendu injectables pour tester la génération sans réseau ni DOM.
// L'instance de production partage deux places entre upload, détail et rattrapage.
export function createPreviewGenerator(renderer: PreviewRenderer) {
  const limited = createTaskLimiter(2);
  return async function generate(source: Blob, fileType: string | null, options: PreviewOptions = {}): Promise<GeneratedPreview | null> {
    if (fileType !== 'pdf' && fileType !== 'image') return null;
    return limited(async () => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.signal?.aborted) cancel();
      const signal = controller.signal;
      const timeout = setTimeout(cancel, 30_000);
      let pdf: OpenPdf | undefined;
      let page: PDFPageProxy | undefined;
      let image: DecodedImage | undefined;
      let canvas: HTMLCanvasElement | undefined;
      let rendering: RenderTask | undefined;
      const abortRender = () => rendering?.cancel();
      signal.addEventListener('abort', abortRender, { once: true });
      try {
        checkPreviewSignal(signal);
        let pageCount = 1;
        if (fileType === 'pdf') {
          pdf = await renderer.pdf(source, signal);
          checkPreviewSignal(signal);
          pageCount = pdf.document.numPages;
          if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('Nombre de pages illisible.');
          if (options.thumbnail === false) return { blob: null, pageCount };
          page = await pdf.document.getPage(1);
        } else {
          if (options.thumbnail === false) return { blob: null, pageCount };
          image = await renderer.image(source, signal);
        }
        checkPreviewSignal(signal);
        canvas = renderer.canvas();
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Rendu indisponible.');
        const original = page?.getViewport({ scale: 1 });
        const size = original
          ? rasterSize(original.width, original.height, 480, options.pixelRatio ?? globalThis.devicePixelRatio ?? 1)
          : rasterSize(image!.width, image!.height, Math.min(480, image!.width), 1);
        canvas.width = size.width;
        canvas.height = size.height;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (page) {
          rendering = page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale: size.scale }), background: '#ffffff' });
          await rendering.promise;
        } else context.drawImage(image!.source, 0, 0, size.width, size.height);
        checkPreviewSignal(signal);
        const output = canvas;
        const blob = await new Promise<Blob>((resolve, reject) => {
          const abort = () => reject(new DOMException('Opération annulée.', 'AbortError'));
          signal.addEventListener('abort', abort, { once: true });
          output.toBlob((value) => {
            signal.removeEventListener('abort', abort);
            if (value) resolve(value); else reject(new Error('Export de la miniature impossible.'));
          }, 'image/jpeg', 0.8);
          if (signal.aborted) abort();
        });
        checkPreviewSignal(signal);
        if (blob.type !== 'image/jpeg' || blob.size < 1 || blob.size > MAX_THUMBNAIL_SIZE) throw new Error('Miniature incompatible.');
        return { blob, pageCount };
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', cancel);
        signal.removeEventListener('abort', abortRender);
        if (canvas) { canvas.width = 0; canvas.height = 0; }
        image?.dispose();
        page?.cleanup();
        await pdf?.dispose().catch(() => undefined);
      }
    }, options.signal);
  };
}
export const generateDocumentPreview = createPreviewGenerator(browserRenderer);
