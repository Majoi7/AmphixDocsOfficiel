import React, { useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Search, Plus, X } from 'lucide-react';

interface SearchHeroProps {
  value: string;
  onChange: (val: string) => void;
  onOpenUpload: () => void;
}

const SUGGESTIONS = ['Contrats', 'Factures', 'Photos', 'Projet'];

export const SearchHero: React.FC<SearchHeroProps> = ({
  value,
  onChange,
  onOpenUpload,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus automatique
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8 py-12 sm:py-20">
      <div className="w-full max-w-2xl flex flex-col items-center text-center">
        <h2 className="text-3xl sm:text-5xl font-extrabold text-[#141414] tracking-[-0.03em] leading-[1.1]">
          Que souhaitez-vous consulter ?
        </h2>
        <p className="text-base sm:text-lg text-[#141414]/60 mt-3 mb-8 max-w-md">
          Recherchez dans vos dossiers et documents, ou déposez un nouveau fichier.
        </p>

        {/* Barre de recherche (partagée avec le header via layoutId) */}
        <motion.div
          layoutId="search-bar-container"
          className="w-full relative"
        >
          <label htmlFor="dashboard-search" className="sr-only">
            Rechercher un document, un dossier ou une catégorie
          </label>
          <div className="relative flex items-center rounded-full bg-white shadow-[0_0_0_4px_#fff,0_12px_32px_rgba(20,20,20,0.10)] focus-within:shadow-[0_0_0_4px_#4a6cf0,0_12px_32px_rgba(20,20,20,0.10)] transition-shadow">
            <Search className="w-5 h-5 text-[#141414]/40 ml-5 shrink-0 pointer-events-none" />
            <input
              id="dashboard-search"
              ref={inputRef}
              type="text"
              autoFocus
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Rechercher un document, un dossier, une catégorie…"
              className="w-full h-14 sm:h-16 px-4 bg-transparent text-base sm:text-lg text-[#141414] placeholder:text-[#141414]/40 focus:outline-hidden"
            />
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                aria-label="Effacer la recherche"
                className="mr-3 w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-[#141414]/55 hover:bg-[#141414]/5 hover:text-[#141414] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </motion.div>

        {/* Suggestions */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onChange(suggestion)}
              className="h-8 px-3.5 rounded-full bg-[#141414]/5 text-sm font-medium text-[#141414]/70 hover:bg-[#141414]/10 hover:text-[#141414] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b]"
            >
              {suggestion}
            </button>
          ))}
        </div>

        {/* Action principale */}
        <button
          type="button"
          onClick={onOpenUpload}
          className="mt-10 inline-flex items-center gap-2 h-12 px-6 rounded-full bg-[#4a6cf0] text-[#f1ece4] text-base font-semibold hover:bg-[#3d5ed8] hover:-rotate-2 active:scale-95 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#ff6a2b]"
        >
          <Plus className="w-5 h-5" />
          <span>Déposer un document</span>
        </button>
      </div>
    </div>
  );
};
