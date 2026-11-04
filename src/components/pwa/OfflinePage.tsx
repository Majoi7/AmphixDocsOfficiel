import React from 'react';
import { motion } from 'motion/react';
import { WifiOff, RefreshCw } from 'lucide-react';

interface OfflinePageProps {
  onRetry?: () => void;
}

export const OfflinePage: React.FC<OfflinePageProps> = ({ onRetry }) => {
  const handleReload = () => {
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen bg-[#f1ece4] flex flex-col items-center justify-center p-6 text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0, rotate: -6 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', damping: 20, stiffness: 280 }}
        className="max-w-md w-full bg-white/80 backdrop-blur-md p-8 rounded-[32px] border-2 border-[#141414] shadow-2xl flex flex-col items-center"
      >
        {/* Illustration animée WifiOff */}
        <motion.div
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="relative w-24 h-24 rounded-3xl bg-[#ffd23f] flex items-center justify-center border-2 border-[#141414] shadow-md mb-6"
        >
          <WifiOff className="w-12 h-12 text-[#141414]" />
          {/* Sticker étoile décoratif */}
          <span className="absolute -top-3 -right-3 text-2xl animate-spin" style={{ animationDuration: '8s' }}>
            ✦
          </span>
        </motion.div>

        <h2 className="text-2xl font-black text-[#141414] tracking-tight">
          Tu es hors ligne
        </h2>
        <p className="text-sm text-[#141414]/70 mt-2 leading-relaxed">
          Il semble que ta connexion Internet soit interrompue. Dès que le réseau sera rétabli, tes documents se synchroniseront automatiquement.
        </p>

        <motion.button
          type="button"
          onClick={handleReload}
          whileTap={{ scale: 0.94 }}
          whileHover={{ scale: 1.04 }}
          className="mt-6 px-6 py-3 rounded-full bg-[#ff6a2b] hover:bg-[#ff8a4c] text-white font-extrabold text-sm flex items-center gap-2 shadow-lg shadow-[#ff6a2b]/30 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4 animate-spin-reverse" />
          <span>Réessayer</span>
        </motion.button>
      </motion.div>
    </div>
  );
};
