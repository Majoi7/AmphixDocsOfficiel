import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FolderItem, DocumentItem } from '../lib/supabase';
import { FileCard } from './FileCard';
import { StatusBadge } from './StatusBadge';
import { ArrowLeft, Plus, FolderOpen, FileText } from 'lucide-react';

import { PanInfo } from 'motion/react';
import { useIsMobile } from '../hooks/useIsMobile';

interface FolderViewProps {
  folder: FolderItem;
  documents: DocumentItem[];
  onBack: () => void;
  onOpenUpload: (folderId: string) => void;
  onUpdateDocument: (id: string, title: string, desc: string) => Promise<void>;
  onDeleteDocument: (id: string, filePath: string) => Promise<void>;
  currentUserId: string;
  isAdmin: boolean;
}

export const FolderView: React.FC<FolderViewProps> = ({
  folder,
  documents,
  onBack,
  onOpenUpload,
  onUpdateDocument,
  onDeleteDocument,
  currentUserId,
  isAdmin,
}) => {
  const isMobile = useIsMobile();
  const folderDocs = documents.filter((d) => d.folder_id === folder.id);

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    // Si l'utilisateur swipe vers la droite de plus de 80px
    if (isMobile && (info.offset.x > 80 || info.velocity.x > 400)) {
      onBack();
    }
  };

  return (
    <motion.div
      layoutId={`folder-${folder.id}`}
      drag={isMobile ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ right: 0.25, left: 0 }}
      onDragEnd={handleDragEnd}
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ type: 'spring', damping: 25, stiffness: 280 }}
      className="w-full bg-white rounded-[24px] sm:rounded-[28px] border-2 sm:border-3 border-[#141414] shadow-lg sm:shadow-[8px_12px_0px_#141414] p-4 sm:p-8 touch-pan-y"
    >
      {/* Fil d'Ariane & Bouton Retour */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b-2 border-[#f1ece4] mb-8">
        <div className="flex items-center gap-3">
          <motion.button
            type="button"
            onClick={onBack}
            whileHover={{ scale: 1.05, x: -2 }}
            whileTap={{ scale: 0.95 }}
            className="w-10 h-10 rounded-full bg-[#f1ece4] hover:bg-[#ff6a2b] hover:text-white text-[#141414] flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Retour"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
          </motion.button>

          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-[#141414]/50 mb-0.5">
              <button
                type="button"
                onClick={onBack}
                className="hover:text-[#ff6a2b] transition-colors cursor-pointer"
              >
                Accueil
              </button>
              <span>&gt;</span>
              <span className="text-[#141414]">{folder.name}</span>
            </div>

            <div className="flex items-center gap-2.5">
              <FolderOpen className="w-6 h-6 text-[#ff6a2b]" />
              <h2 className="font-[800] text-2xl sm:text-3xl text-[#141414] tracking-tight">
                {folder.name}
              </h2>
              <StatusBadge status={folder.status} rejectionReason={folder.rejection_reason} />
            </div>
          </div>
        </div>

        {/* Bouton pour ajouter directement un document dans ce dossier */}
        <motion.button
          type="button"
          onClick={() => onOpenUpload(folder.id)}
          whileHover={{ scale: 1.04, rotate: -1.5 }}
          whileTap={{ scale: 0.96 }}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#ff6a2b] text-white text-xs sm:text-sm font-extrabold shadow-md hover:bg-[#ff8a4c] transition-colors cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>Déposer dans ce dossier</span>
        </motion.button>
      </div>

      {/* Contenu du dossier */}
      {folderDocs.length === 0 ? (
        <div className="py-16 text-center flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-[#ffd23f]/25 border-2 border-[#141414] flex items-center justify-center mb-3">
            <FileText className="w-7 h-7 text-[#141414]" />
          </div>
          <h4 className="font-extrabold text-lg text-[#141414] mb-1">
            Ce dossier est encore vide
          </h4>
          <p className="text-xs text-[#141414]/60 max-w-xs mb-6">
            Dépose tes fichiers pour les regrouper dans ce dossier.
          </p>
          <button
            type="button"
            onClick={() => onOpenUpload(folder.id)}
            className="px-5 py-2 rounded-full bg-[#141414] text-[#f1ece4] text-xs font-bold hover:bg-[#333] transition-colors"
          >
            + Ajouter un document
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-[#141414]/60">
              {folderDocs.length} {folderDocs.length === 1 ? 'fichier' : 'fichiers'} dans ce dossier
            </span>
          </div>

          <motion.div
            layout
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
          >
            <AnimatePresence mode="popLayout">
              {folderDocs.map((doc) => (
                <FileCard
                  key={doc.id}
                  doc={doc}
                  onUpdate={onUpdateDocument}
                  onDelete={onDeleteDocument}
                  canManage={isAdmin || doc.user_id === currentUserId}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
};
