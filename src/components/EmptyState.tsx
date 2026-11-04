import React from 'react';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';

interface EmptyStateProps {
  onOpenUpload: () => void;
  isSearching?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onOpenUpload, isSearching }) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 15 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-md mx-auto py-16 px-6 text-center flex flex-col items-center"
    >
      {/* Illustration en SVG : document souriant avec sticker slap */}
      <motion.div
        animate={{ y: [-4, 4, -4], rotate: [-1.5, 1.5, -1.5] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="relative mb-6"
      >
        <svg
          width="130"
          height="150"
          viewBox="0 0 130 150"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="drop-shadow-[0_10px_20px_rgba(20,20,20,0.08)]"
        >
          {/* Ombre portée découpée */}
          <rect x="14" y="14" width="102" height="126" rx="18" fill="#141414" />
          
          {/* Corps de la feuille papier */}
          <rect x="10" y="10" width="102" height="126" rx="18" fill="#ffffff" stroke="#141414" strokeWidth="3" />
          
          {/* Coin replié ludique */}
          <path
            d="M86 10L112 36H96C90.4772 36 86 31.5228 86 26V10Z"
            fill="#ffd23f"
            stroke="#141414"
            strokeWidth="3"
            strokeLinejoin="round"
          />

          {/* Lignes stylisées de document */}
          <rect x="26" y="44" width="36" height="4" rx="2" fill="#ff6a2b" />
          <rect x="26" y="56" width="60" height="3" rx="1.5" fill="#e5dfd5" />
          <rect x="26" y="65" width="48" height="3" rx="1.5" fill="#e5dfd5" />

          {/* Visage souriant mignon */}
          {/* Yeux */}
          <circle cx="48" cy="88" r="4.5" fill="#141414" />
          <circle cx="72" cy="88" r="4.5" fill="#141414" />
          <circle cx="50" cy="86" r="1.5" fill="#ffffff" />
          <circle cx="74" cy="86" r="1.5" fill="#ffffff" />

          {/* Joues roses */}
          <circle cx="40" cy="94" r="5" fill="#ffb6e1" opacity="0.8" />
          <circle cx="80" cy="94" r="5" fill="#ffb6e1" opacity="0.8" />

          {/* Sourire joyeux */}
          <path
            d="M52 98C56 105 64 105 68 98"
            stroke="#141414"
            strokeWidth="3.5"
            strokeLinecap="round"
          />

          {/* Petit clin d'œil sticker étoile */}
          <path
            d="M26 114L28 108L34 108L29 104L31 98L26 102L21 98L23 104L18 108L24 108Z"
            fill="#9ab8ff"
          />
        </svg>

        {/* Badge slap sticker */}
        <div className="absolute -bottom-2 -right-3 bg-[#ffd23f] border-2 border-[#141414] rounded-full px-2.5 py-0.5 text-[10px] font-black rotate-12 shadow-sm text-[#141414]">
          {isSearching ? 'Rien trouvé' : 'Tout propre !'}
        </div>
      </motion.div>

      <h3 className="font-[800] text-2xl text-[#141414] tracking-tight mb-2">
        {isSearching ? 'Aucun résultat trouvé' : 'Aucun document pour l\'instant'}
      </h3>
      <p className="text-sm text-[#141414]/70 mb-8 max-w-xs font-medium">
        {isSearching
          ? 'Essaie d\'autres termes ou efface ta recherche pour afficher tous tes documents.'
          : 'Dépose ton premier fichier pour commencer à constituer ta bibliothèque sécurisée.'}
      </p>

      {!isSearching && (
        <motion.button
          type="button"
          onClick={onOpenUpload}
          whileHover={{ scale: 1.04, rotate: -2 }}
          whileTap={{ scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#ff6a2b] text-white font-extrabold text-sm shadow-[0_6px_20px_rgba(255,106,43,0.35)] hover:bg-[#ff8a4c] transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>+ Déposer un document</span>
        </motion.button>
      )}
    </motion.div>
  );
};
