import { useId, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { useDialogAccessibility } from '../../hooks/useDialogAccessibility';
import { useDialogViewport } from '../../hooks/useDialogViewport';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  maxHeight?: string;
  showCloseButton?: boolean;
  canClose?: boolean;
}

export function BottomSheet({ isOpen, onClose, title, children, maxHeight = '90dvh', showCloseButton = true, canClose = true }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const reducedMotion = useReducedMotion();
  useDialogAccessibility(sheetRef, isOpen, onClose, canClose);
  useDialogViewport(viewportRef, isOpen);

  return <AnimatePresence>{isOpen && <div ref={viewportRef} className="fixed right-0 left-0 z-50 flex min-w-0 items-end justify-center overflow-hidden pt-4"
    style={{ top: 'var(--dialog-viewport-top, 0px)', height: 'var(--dialog-viewport-height, 100dvh)' }}>
    <motion.div aria-hidden="true" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.15 }}
      onClick={() => { if (canClose) onClose(); }} className="absolute inset-0 bg-black/50 backdrop-blur-xs" />
    <motion.div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined} aria-label={title ? undefined : 'Feuille contextuelle'} aria-busy={!canClose} tabIndex={-1}
      initial={reducedMotion ? false : { y: '100%' }} animate={{ y: 0 }} exit={reducedMotion ? { opacity: 0 } : { y: '100%' }}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 320 }}
      style={{ maxHeight: `min(${maxHeight}, calc(var(--dialog-viewport-height, 100dvh) - 16px))` }}
      className="relative mx-auto flex w-full min-w-0 max-w-lg flex-col overflow-hidden rounded-t-[32px] border-t-2 border-[#141414]/10 bg-[#f1ece4] text-[#141414] shadow-2xl">
      <div aria-hidden="true" className="flex justify-center pt-3 pb-2"><span className="h-1.5 w-12 rounded-full bg-[#141414]/25" /></div>
      {(title || showCloseButton) && <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#141414]/10 px-4 py-2">
        {title ? <h2 id={id} tabIndex={-1} data-autofocus className="min-w-0 rounded-lg text-lg font-extrabold focus-visible:outline-2 focus-visible:outline-[#4a6cf0]">{title}</h2> : <span />}
        {showCloseButton && <button type="button" disabled={!canClose} onClick={onClose} aria-label="Fermer" className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-[#141414]/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:cursor-not-allowed disabled:opacity-50"><X aria-hidden="true" size={22} /></button>}
      </div>}
      <div className="safe-bottom min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
    </motion.div>
  </div>}</AnimatePresence>;
}
