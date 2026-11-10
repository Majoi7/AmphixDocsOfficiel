import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { Loader2, RotateCcw } from 'lucide-react';
import { openPdf } from '../lib/pdf-runtime';
import { createTaskLimiter, rasterSize } from '../lib/preview-resources';
import { userError } from '../lib/errors';

const renderPage = createTaskLimiter(2);
export const PREVIEW_ERROR = 'Impossible d’afficher l’aperçu. Tu peux télécharger le fichier.';
const retryClass = 'inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0]';

function PdfPage({ pdf, number, width, active, initialRatio }: {
  pdf: PDFDocumentProxy; number: number; width: number; active: boolean; initialRatio: number;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(initialRatio);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setReady(false);
    setError(null);
    const host = canvasRef.current;
    if (!active || !host || width < 1) return;
    // Un canvas par rendu : le nettoyage d’une ancienne largeur ne touche
    // jamais au canvas du rendu suivant (rotation, fermeture, StrictMode).
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Page ${number} du document PDF`);
    canvas.className = 'block h-full w-full';
    host.append(canvas);
    const controller = new AbortController();
    let rendering: RenderTask | undefined;
    let finished = false;
    const cancel = () => rendering?.cancel();
    controller.signal.addEventListener('abort', cancel, { once: true });
    void renderPage(async () => {
      let page: PDFPageProxy | undefined;
      try {
        if (controller.signal.aborted) return;
        page = await pdf.getPage(number);
        if (controller.signal.aborted) return;
        const original = page.getViewport({ scale: 1 });
        setRatio(original.width / original.height);
        const size = rasterSize(original.width, original.height, width, globalThis.devicePixelRatio || 1);
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas indisponible.');
        rendering = page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale: size.scale }), background: '#ffffff' });
        await rendering.promise;
        if (!controller.signal.aborted) setReady(true);
      } finally {
        // cleanup après la fin (ou l’annulation) du render, jamais pendant son utilisation.
        finished = true;
        page?.cleanup();
        if (controller.signal.aborted) { canvas.width = 0; canvas.height = 0; }
      }
    }, controller.signal).catch((cause) => {
      if (!controller.signal.aborted) setError(userError(cause, PREVIEW_ERROR));
    });
    return () => {
      controller.abort();
      canvas.remove();
      // Si la tâche était encore en attente, aucun render ne libérera ses pixels.
      if (finished || !rendering) { canvas.width = 0; canvas.height = 0; }
      controller.signal.removeEventListener('abort', cancel);
    };
  }, [pdf, number, width, active, revision]);
  return <section data-pdf-page={number} aria-label={`Page ${number}`} className="relative w-full shrink-0 overflow-hidden rounded-xl bg-white shadow-sm"
    style={{ aspectRatio: ratio, minHeight: 80 }}>
    {active && <div ref={canvasRef} className={`absolute inset-0 ${ready ? '' : 'invisible'}`} />}
    {(!active || !ready) && !error && <div className="absolute inset-0 flex items-center justify-center gap-2 p-3 text-sm text-[#141414]/60">
      {active && <Loader2 size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}Page {number}
    </div>}
    {error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto bg-[#f1ece4] p-3 text-center text-sm">
      <p role="alert">{error}</p><button type="button" onClick={() => setRevision((value) => value + 1)} className={retryClass}>Réessayer cette page</button>
    </div>}
  </section>;
}

function PdfPages({ pdf, initialRatio }: { pdf: PDFDocumentProxy; initialRatio: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [current, setCurrent] = useState(1);
  const [nearby, setNearby] = useState([1]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => setWidth(Math.max(1, root.clientWidth - 16));
    measure();
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    resize?.observe(root);
    window.addEventListener('resize', measure);
    const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-pdf-page]'));
    const near = new Set<HTMLElement>([pages[0]]);
    let frame = 0;
    const select = () => {
      frame = 0;
      const bounds = root.getBoundingClientRect();
      const focus = bounds.top + root.clientHeight / 3;
      const candidates = [...near].map((element) => {
        const rect = element.getBoundingClientRect();
        const distance = focus < rect.top ? rect.top - focus : focus > rect.bottom ? focus - rect.bottom : 0;
        return { number: Number(element.dataset.pdfPage), distance };
      }).sort((a, b) => a.distance - b.distance || a.number - b.number);
      if (!candidates.length) return;
      const selected = candidates.slice(0, 3).map((page) => page.number).sort((a, b) => a - b);
      setCurrent(candidates[0].number);
      setNearby((previous) => previous.join(',') === selected.join(',') ? previous : selected);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(select); };
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) near.add(entry.target as HTMLElement); else near.delete(entry.target as HTMLElement);
      }
      schedule();
    }, { root, rootMargin: '100% 0px', threshold: 0 }) : null;
    pages.forEach((page) => observer?.observe(page));
    // Secours sans IntersectionObserver : géométrie des placeholders, aucun rendu intégral.
    const scroll = () => {
      if (!observer) {
        const bounds = root.getBoundingClientRect();
        near.clear();
        pages.forEach((page) => {
          const rect = page.getBoundingClientRect();
          if (rect.bottom >= bounds.top - root.clientHeight && rect.top <= bounds.bottom + root.clientHeight) near.add(page);
        });
      }
      schedule();
    };
    root.addEventListener('scroll', scroll, { passive: true });
    scroll();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', measure);
      root.removeEventListener('scroll', scroll);
    };
  }, [pdf]);
  return <div className="min-w-0 space-y-2">
    <p role="status" aria-live="polite" aria-atomic="true" className="text-center text-sm font-bold tabular-nums">Page {current} / {pdf.numPages}</p>
    <div ref={rootRef} role="region" aria-label="Pages du document PDF" tabIndex={0}
      className="flex h-[60dvh] max-h-[680px] min-h-48 min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain rounded-2xl bg-[#141414]/10 p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0]">
      {Array.from({ length: pdf.numPages }, (_, index) => <PdfPage key={index + 1} pdf={pdf} number={index + 1} width={width} active={nearby.includes(index + 1)} initialRatio={initialRatio} />)}
    </div>
    <p className="text-xs text-[#141414]/65">Fais défiler les pages. Le téléchargement conserve le document original.</p>
  </div>;
}

export function PdfDocumentViewer({ source }: { source: Blob }) {
  const [loaded, setLoaded] = useState<{ document: PDFDocumentProxy; ratio: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let opened: Awaited<ReturnType<typeof openPdf>> | undefined;
    setLoaded(null);
    setError(null);
    void (async () => {
      try {
        opened = await openPdf(source, controller.signal);
        // Un PDF malformé peut annoncer des millions de pages dans quelques Ko.
        if (opened.document.numPages > 10_000) throw new Error('Document trop long pour le lecteur mobile.');
        const first = await opened.document.getPage(1);
        const viewport = first.getViewport({ scale: 1 });
        first.cleanup();
        if (!controller.signal.aborted) setLoaded({ document: opened.document, ratio: viewport.width / viewport.height });
      } catch (cause) {
        await opened?.dispose().catch(() => undefined);
        if (!controller.signal.aborted) setError(userError(cause, PREVIEW_ERROR));
      }
    })();
    return () => { controller.abort(); void opened?.dispose().catch(() => undefined); };
  }, [source, revision]);
  if (error) return <div className="space-y-3 rounded-2xl bg-[#f1ece4] p-4 text-sm"><p role="alert">{error}</p><button type="button" className={retryClass} onClick={() => setRevision((value) => value + 1)}><RotateCcw size={18} aria-hidden="true" />Réessayer</button></div>;
  if (!loaded) return <p role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm"><Loader2 size={20} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Ouverture du PDF…</p>;
  return <PdfPages key={revision} pdf={loaded.document} initialRatio={loaded.ratio} />;
}
