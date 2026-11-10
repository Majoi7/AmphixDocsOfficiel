import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';
import { useDialogViewport } from '../hooks/useDialogViewport';
import { boundImageTransform, INITIAL_IMAGE_TRANSFORM, pinchImage, type ImagePoint, type ImageTransform } from '../lib/image-zoom';

const buttonClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full bg-white/90 px-3 py-2 text-sm font-bold text-[#141414] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:opacity-50';

function FullscreenImage({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [transform, setTransform] = useState<ImageTransform>(INITIAL_IMAGE_TRANSFORM);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const pointers = useRef(new Map<number, ImagePoint>());
  const gesture = useRef<{ points: ImagePoint[]; transform: ImageTransform } | null>(null);
  useDialogAccessibility(dialogRef, true, onClose);
  useDialogViewport(dialogRef, true);
  const size = () => ({ width: stageRef.current?.clientWidth || 1, height: stageRef.current?.clientHeight || 1 });
  const apply = (value: ImageTransform) => { transformRef.current = value; setTransform(value); };
  const restartGesture = () => {
    gesture.current = { points: [...pointers.current.values()].slice(0, 2), transform: transformRef.current };
  };
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 };
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, point(event));
    restartGesture();
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, point(event));
    const start = gesture.current;
    const points = [...pointers.current.values()].slice(0, 2);
    const { width, height } = size();
    if (points.length === 2 && start.points.length === 2) {
      const center = (values: ImagePoint[]) => ({ x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 });
      const distance = (values: ImagePoint[]) => Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
      const initialDistance = distance(start.points);
      if (initialDistance > 0) apply(pinchImage(start.transform, center(start.points), center(points), distance(points) / initialDistance, width, height));
    } else if (points.length === 1 && start.points.length === 1) {
      apply(boundImageTransform({ ...start.transform, x: start.transform.x + points[0].x - start.points[0].x,
        y: start.transform.y + points[0].y - start.points[0].y }, width, height));
    }
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    restartGesture();
  };
  const zoom = (factor: number) => {
    const { width, height } = size();
    apply(pinchImage(transformRef.current, { x: 0, y: 0 }, { x: 0, y: 0 }, factor, width, height));
  };
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      pointers.current.clear();
      gesture.current = null;
      const next = boundImageTransform(transformRef.current, stage.clientWidth, stage.clientHeight);
      transformRef.current = next;
      setTransform(next);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  return createPortal(<div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}
    style={{ top: 'var(--dialog-viewport-top, 0px)', height: 'var(--dialog-viewport-height, 100dvh)' }}
    className="fixed inset-x-0 z-[70] flex min-w-0 flex-col overflow-hidden bg-[#141414] text-white">
    <header className="safe-top flex shrink-0 items-center justify-between gap-2 px-4 py-2">
      <h2 id={id} className="min-w-0 truncate text-base font-bold">{title}</h2>
      <button type="button" data-autofocus aria-label="Fermer l’image en plein écran" onClick={onClose} className={buttonClass}><X size={22} aria-hidden="true" /></button>
    </header>
    <div ref={stageRef} role="group" aria-label="Image agrandie, zoom avec deux doigts ou les boutons" tabIndex={0}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
      onDoubleClick={() => transformRef.current.scale > 1 ? apply(INITIAL_IMAGE_TRANSFORM) : zoom(2)}
      onKeyDown={(event) => {
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.25); }
        if (event.key === '-') { event.preventDefault(); zoom(0.8); }
        if (event.key === '0') { event.preventDefault(); apply(INITIAL_IMAGE_TRANSFORM); }
        const offset = ({ ArrowLeft: [32, 0], ArrowRight: [-32, 0], ArrowUp: [0, 32], ArrowDown: [0, -32] } as Record<string, number[]>)[event.key];
        if (offset) {
          event.preventDefault();
          const { width, height } = size();
          apply(boundImageTransform({ ...transformRef.current, x: transformRef.current.x + offset[0], y: transformRef.current.y + offset[1] }, width, height));
        }
      }}
      className="relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden outline-offset-[-3px] focus-visible:outline-2 focus-visible:outline-[#9ab8ff]">
      <img src={url} alt={title} draggable={false} className="pointer-events-none h-full w-full select-none object-contain"
        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }} />
    </div>
    <footer className="safe-bottom shrink-0 space-y-2 px-4 py-3 text-center">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" aria-label="Dézoomer" disabled={transform.scale <= 1} onClick={() => zoom(0.8)} className={buttonClass}><ZoomOut size={20} aria-hidden="true" /></button>
        <span aria-live="polite" className="min-w-14 text-sm tabular-nums">{Math.round(transform.scale * 100)} %</span>
        <button type="button" aria-label="Zoomer" disabled={transform.scale >= 4} onClick={() => zoom(1.25)} className={buttonClass}><ZoomIn size={20} aria-hidden="true" /></button>
        <button type="button" aria-label="Réinitialiser le zoom" onClick={() => apply(INITIAL_IMAGE_TRANSFORM)} className={buttonClass}><RotateCcw size={18} aria-hidden="true" /></button>
      </div>
      <p className="text-xs text-white/70">Pince avec deux doigts pour zoomer, puis fais glisser l’image.</p>
    </footer>
  </div>, document.body);
}

export function ImageDocumentViewer({ source, title, onError }: { source: Blob; title: string; onError: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const next = URL.createObjectURL(source);
    setReady(false);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [source]);
  return <div className="min-w-0 space-y-2">
    {!ready && <p role="status" className="py-4 text-center text-sm">Ouverture de l’image…</p>}
    {url && <button type="button" disabled={!ready} onClick={() => setFullscreen(true)} aria-label="Afficher l’image en plein écran"
      className="relative block min-h-11 w-full overflow-hidden rounded-2xl bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0]">
      <img src={url} alt={title} onLoad={() => setReady(true)} onError={onError} className="max-h-[55dvh] w-full object-contain" />
      {ready && <span className="absolute right-2 bottom-2 flex items-center gap-2 rounded-full bg-[#141414]/90 px-3 py-2 text-xs font-bold text-white"><Maximize2 size={16} aria-hidden="true" />Plein écran</span>}
    </button>}
    {fullscreen && url && <FullscreenImage url={url} title={title} onClose={() => setFullscreen(false)} />}
  </div>;
}
