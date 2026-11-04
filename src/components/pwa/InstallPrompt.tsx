import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, Share, PlusSquare, X } from 'lucide-react';
import { usePWA } from '../../hooks/usePWA';

export const InstallPrompt: React.FC = () => {
  const { isInstallable, isStandalone, isIOS, isDismissed, promptInstall, dismissPrompt } = usePWA();
  const [showIOSModal, setShowIOSModal] = useState<boolean>(false);

  // Ne pas afficher si déjà en mode autonome PWA ou si l'utilisateur a cliqué "Plus tard"
  if (isStandalone || isDismissed || !isInstallable) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSModal(true);
    } else {
      await promptInstall();
    }
  };

  return (
    <>
      <AnimatePresence>
        <motion.div
          initial={{ y: 100, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 100, opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', damping: 24, stiffness: 280 }}
          role="region"
          aria-label="Installer l'application"
          className="fixed z-50 left-4 right-4 max-w-sm mx-auto bottom-[calc(88px+env(safe-area-inset-bottom,16px))] md:bottom-6 md:right-6 md:left-auto bg-[#141414] text-[#f1ece4] p-4 rounded-3xl shadow-2xl border-2 border-[#ff6a2b]/40 backdrop-blur-md"
        >
          <div className="flex items-start gap-3.5">
            {/* Logo icône A */}
            <div className="w-12 h-12 rounded-2xl bg-[#ff6a2b] flex items-center justify-center text-white font-extrabold text-2xl shadow-md shrink-0">
              A
            </div>

            <div className="flex-1 min-w-0 pr-6">
              <h4 className="text-sm font-extrabold text-[#f1ece4] tracking-tight">
                Installer AmphixDocs
              </h4>
              <p className="text-xs text-[#f1ece4]/75 mt-0.5 leading-snug">
                Accède à tes documents hors-ligne et en plein écran comme une vraie application.
              </p>

              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="px-3.5 py-1.5 rounded-full bg-[#ff6a2b] hover:bg-[#ff8a4c] text-white text-xs font-extrabold flex items-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Installer</span>
                </button>
                <button
                  type="button"
                  onClick={dismissPrompt}
                  className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-[#f1ece4]/80 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  Plus tard
                </button>
              </div>
            </div>

            {/* Bouton fermeture */}
            <button
              type="button"
              onClick={dismissPrompt}
              className="absolute top-3 right-3 p-1 rounded-full text-[#f1ece4]/50 hover:text-[#f1ece4] hover:bg-white/10 transition-colors"
              aria-label="Fermer la bannière"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Modal explicatif iOS Safari */}
      <AnimatePresence>
        {showIOSModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm bg-[#f1ece4] text-[#141414] rounded-3xl p-6 shadow-2xl border-2 border-[#141414]"
            >
              <div className="w-12 h-12 rounded-2xl bg-[#ff6a2b] text-white flex items-center justify-center text-2xl font-black mx-auto mb-4">
                A
              </div>
              <h3 className="text-lg font-black text-center text-[#141414]">
                Installer sur iPhone ou iPad
              </h3>
              <p className="text-xs text-center text-[#141414]/70 mt-1 mb-5">
                Deux petites étapes dans Safari :
              </p>

              <div className="flex flex-col gap-3 bg-white/80 p-4 rounded-2xl border border-[#141414]/10 text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#4a6cf0]/15 text-[#4a6cf0] flex items-center justify-center shrink-0">
                    <Share className="w-4 h-4" />
                  </div>
                  <p>1. Touche le bouton <strong>Partager</strong> en bas de Safari.</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#ff6a2b]/15 text-[#ff6a2b] flex items-center justify-center shrink-0">
                    <PlusSquare className="w-4 h-4" />
                  </div>
                  <p>2. Fais défiler puis touche <strong>Sur l'écran d'accueil</strong>.</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowIOSModal(false);
                  dismissPrompt();
                }}
                className="mt-5 w-full py-2.5 rounded-full bg-[#141414] text-[#f1ece4] font-bold text-xs uppercase tracking-wider transition-transform active:scale-95 cursor-pointer"
              >
                C'est compris !
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
