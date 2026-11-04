import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence, PanInfo } from 'motion/react';
import { X } from 'lucide-react';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxHeight?: string;
  showCloseButton?: boolean;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  children,
  maxHeight = '90dvh',
  showCloseButton = true,
}) => {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    // Si glissé vers le bas de plus de 120px ou avec une vitesse positive forte
    if (info.offset.y > 120 || info.velocity.y > 600) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop avec fondu et léger flou */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-xs"
            aria-hidden="true"
          />

          {/* Feuille coulissante */}
          <motion.div
            ref={sheetRef}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            dragSnapToOrigin={false}
            onDragEnd={handleDragEnd}
            style={{ maxHeight }}
            role="dialog"
            aria-modal="true"
            aria-label={title || 'Feuille contextuelle'}
            className="relative w-full max-w-lg mx-auto bg-[#f1ece4] text-[#141414] rounded-t-[32px] shadow-2xl flex flex-col overflow-hidden border-t-2 border-[#141414]/10 touch-pan-y"
          >
            {/* Poignée de glissement interactive */}
            <div className="pt-3.5 pb-2 flex justify-center cursor-grab active:cursor-grabbing w-full">
              <div className="w-12 h-1.5 rounded-full bg-[#141414]/25 hover:bg-[#141414]/40 transition-colors" />
            </div>

            {/* En-tête */}
            {(title || showCloseButton) && (
              <div className="px-6 py-2 flex items-center justify-between border-b border-[#141414]/10">
                {title ? (
                  <h3 className="text-lg font-extrabold text-[#141414] tracking-tight">{title}</h3>
                ) : (
                  <div />
                )}
                {showCloseButton && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-2 -mr-2 rounded-full text-[#141414]/60 hover:text-[#141414] hover:bg-[#141414]/5 transition-colors"
                    aria-label="Fermer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}

            {/* Corps du contenu défilable */}
            <div className="flex-1 overflow-y-auto px-6 py-4 safe-bottom">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
