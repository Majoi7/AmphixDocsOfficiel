import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';

export const PageTransitionOverlay: React.FC = () => {
  const { isPageTransitioning } = useAuth();

  return (
    <AnimatePresence>
      {isPageTransitioning && (
        <motion.div
          initial={{ clipPath: 'circle(0% at 50% 50%)', opacity: 0.9 }}
          animate={{ clipPath: 'circle(150% at 50% 50%)', opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-50 bg-[#4a6cf0] flex flex-col items-center justify-center text-[#f1ece4] pointer-events-auto"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 1.1, opacity: 0 }}
            transition={{ delay: 0.15, duration: 0.4 }}
            className="flex flex-col items-center gap-4"
          >
            <div className="font-extrabold text-4xl tracking-tighter">
              Amphix<span className="text-[#ffd23f]">Docs</span>
            </div>
            <div className="w-12 h-1.5 bg-[#ff6a2b] rounded-full animate-pulse" />
            <p className="text-sm font-medium text-[#f1ece4]/90">Ouverture de vos documents…</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
