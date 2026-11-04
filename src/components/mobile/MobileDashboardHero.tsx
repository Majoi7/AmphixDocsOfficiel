import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, SlidersHorizontal, Folder, FileText, ArrowRight, Clock, Plus, Sparkles } from 'lucide-react';
import { DocumentItem, FolderItem, CategoryItem, formatFileSize } from '../../lib/supabase';

interface MobileDashboardHeroProps {
  userFirstName: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onOpenUpload: () => void;
  categories: CategoryItem[];
  selectedCategoryId: string | null;
  onSelectCategory: (id: string | null) => void;
  recentDocuments: DocumentItem[];
  recentFolders: FolderItem[];
  onOpenFolder: (id: string) => void;
}

export const MobileDashboardHero: React.FC<MobileDashboardHeroProps> = ({
  userFirstName,
  searchQuery,
  onSearchChange,
  onOpenUpload,
  categories,
  selectedCategoryId,
  onSelectCategory,
  recentDocuments,
  recentFolders,
  onOpenFolder,
}) => {
  const [showFilterPills, setShowFilterPills] = useState<boolean>(false);

  // Combiner les 3 éléments les plus récents (dossiers ou fichiers)
  const recentItems = [
    ...recentFolders.map((f) => ({
      type: 'folder' as const,
      id: f.id,
      name: f.name,
      detail: `${f.document_count ?? 0} fichier${(f.document_count ?? 0) > 1 ? 's' : ''}`,
      date: f.created_at,
    })),
    ...recentDocuments.map((d) => ({
      type: 'doc' as const,
      id: d.id,
      name: d.title,
      detail: formatFileSize(d.file_size),
      date: d.created_at,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3);

  return (
    <div className="flex flex-col gap-6 py-2 select-none md:hidden">
      {/* 1. Message de bienvenue & Titre */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        <p className="text-xs font-black uppercase tracking-wider text-[#ff6a2b] flex items-center gap-1.5">
          <span>Salut, {userFirstName}</span>
          <Sparkles className="w-3.5 h-3.5" />
        </p>
        <h1 className="text-2xl xs:text-3xl font-[800] text-[#141414] tracking-tight mt-1 leading-[1.15]">
          Comment peut-on t'aider aujourd'hui ?
        </h1>
      </motion.div>

      {/* 2. Barre de recherche pleine largeur avec bouton filtre */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', damping: 22, stiffness: 300, delay: 0.05 }}
        className="flex flex-col gap-2.5"
      >
        <div className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#141414]/40 absolute left-4 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Chercher un document, dossier…"
              className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white border-2 border-[#141414] text-sm font-bold text-[#141414] placeholder-[#141414]/40 focus:outline-none focus:ring-4 focus:ring-[#ff6a2b]/20 shadow-[3px_3px_0px_#141414]"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowFilterPills((prev) => !prev)}
            className={`p-3.5 rounded-2xl border-2 border-[#141414] transition-all cursor-pointer ${
              showFilterPills || selectedCategoryId !== null
                ? 'bg-[#141414] text-[#ffd23f]'
                : 'bg-white text-[#141414] shadow-[3px_3px_0px_#141414]'
            }`}
            aria-label="Filtrer par catégorie"
          >
            <SlidersHorizontal className="w-5 h-5 stroke-[2.3]" />
          </button>
        </div>

        {/* Tiroir déroulant de filtres catégories si ouvert */}
        <AnimatePresence>
          {showFilterPills && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1"
            >
              <button
                type="button"
                onClick={() => onSelectCategory(null)}
                className={`px-3 py-1.5 rounded-full text-xs font-black transition-colors shrink-0 ${
                  selectedCategoryId === null
                    ? 'bg-[#141414] text-white'
                    : 'bg-white border border-[#141414]/15 text-[#141414]/70'
                }`}
              >
                Toutes
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => onSelectCategory(selectedCategoryId === cat.id ? null : cat.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-black transition-colors shrink-0 ${
                    selectedCategoryId === cat.id
                      ? 'bg-[#ff6a2b] text-white'
                      : 'bg-white border border-[#141414]/15 text-[#141414]/70'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* 3. Carte orange arrondie "Récents" */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', damping: 24, stiffness: 280, delay: 0.1 }}
        className="rounded-[28px] bg-[#ff6a2b] text-white p-5 shadow-[4px_6px_0px_#141414] border-2 border-[#141414]"
      >
        <div className="flex items-center justify-between mb-3.5">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-white/90" />
            <h3 className="text-sm font-black uppercase tracking-wider text-white">
              Récents
            </h3>
          </div>
          <button
            type="button"
            onClick={onOpenUpload}
            className="px-2.5 py-1 rounded-full bg-white/20 hover:bg-white/30 text-white text-[11px] font-black flex items-center gap-1 active:scale-95 transition-transform cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3]" />
            <span>Nouveau</span>
          </button>
        </div>

        {recentItems.length === 0 ? (
          <div className="text-center py-5 bg-white/10 rounded-2xl border border-white/20">
            <p className="text-xs font-bold text-white/90">Aucun document pour le moment</p>
            <button
              type="button"
              onClick={onOpenUpload}
              className="mt-2 text-xs font-black underline text-white"
            >
              Dépose ton premier fichier
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {recentItems.map((item) => (
              <motion.div
                key={`${item.type}-${item.id}`}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  if (item.type === 'folder') {
                    onOpenFolder(item.id);
                  }
                }}
                className={`flex items-center justify-between p-3 rounded-2xl bg-white/15 hover:bg-white/25 backdrop-blur-xs border border-white/20 transition-all ${
                  item.type === 'folder' ? 'cursor-pointer' : ''
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div className="w-9 h-9 rounded-xl bg-white text-[#ff6a2b] flex items-center justify-center shrink-0 shadow-xs">
                    {item.type === 'folder' ? (
                      <Folder className="w-5 h-5 fill-[#ff6a2b]/20" />
                    ) : (
                      <FileText className="w-5 h-5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-white truncate">{item.name}</p>
                    <p className="text-[11px] text-white/75 truncate">{item.detail}</p>
                  </div>
                </div>

                {item.type === 'folder' && (
                  <ArrowRight className="w-4 h-4 text-white/80 shrink-0" />
                )}
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
};
