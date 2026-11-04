import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { usePWA } from '../../hooks/usePWA';

export const UpdateToast: React.FC = () => {
  const { needRefresh, refreshApp } = usePWA();

  if (!needRefresh) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -60, opacity: 0 }}
        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
        className="fixed top-4 left-4 right-4 max-w-sm mx-auto z-50 bg-[#4a6cf0] text-white p-3.5 rounded-2xl shadow-xl border border-white/20 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-[#ffd23f]" />
          </div>
          <div>
            <p className="text-xs font-bold leading-tight">Nouvelle version disponible</p>
            <p className="text-[11px] text-white/80 leading-tight">Mise à jour d'AmphixDocs prête</p>
          </div>
        </div>

        <button
          type="button"
          onClick={refreshApp}
          className="px-3 py-1.5 rounded-full bg-white text-[#4a6cf0] text-xs font-extrabold flex items-center gap-1 shadow-xs transition-transform active:scale-95 cursor-pointer shrink-0"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Actualiser</span>
        </button>
      </motion.div>
    </AnimatePresence>
  );
};
