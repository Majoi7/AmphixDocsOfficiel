import React, { useState } from 'react';
import { motion } from 'motion/react';
import { FolderItem } from '../lib/supabase';
import { StatusBadge } from './StatusBadge';
import { Trash2, Folder as FolderIcon, AlertCircle, Loader2 } from 'lucide-react';

interface FolderCardProps {
  folder: FolderItem;
  onClick: () => void;
  onDelete?: (id: string) => Promise<void>;
  canDelete?: boolean;
}

export const FolderCard: React.FC<FolderCardProps> = ({
  folder,
  onClick,
  onDelete,
  canDelete = false,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete) return;
    try {
      setIsDeleting(true);
      await onDelete(folder.id);
    } finally {
      setIsDeleting(false);
      setShowConfirmDelete(false);
    }
  };

  return (
    <motion.div
      layout
      layoutId={`folder-${folder.id}`}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowConfirmDelete(false);
      }}
      whileHover={{ y: -4, rotate: 0.8 }}
      whileTap={{ scale: 0.98 }}
      className="group relative bg-white rounded-[22px] border-2 border-[#141414]/15 hover:border-[#141414] p-5 shadow-xs hover:shadow-[6px_8px_0px_#141414] transition-all cursor-pointer flex flex-col justify-between min-h-[145px]"
    >
      <div>
        <div className="flex items-start justify-between gap-2 mb-3">
          {/* Icône de dossier interactive (SVG ouverte au hover) */}
          <div className="w-12 h-12 rounded-2xl bg-[#ffd23f]/30 border border-[#ffd23f] flex items-center justify-center text-[#141414] transition-transform group-hover:scale-105">
            <svg
              className="w-7 h-7 text-[#141414]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {isHovered ? (
                /* Icône dossier ouvert */
                <>
                  <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                  <path d="M2 10h20l-2 10H4L2 10Z" fill="#ffd23f" fillOpacity="0.4" />
                </>
              ) : (
                /* Icône dossier fermé */
                <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" fill="#ffd23f" fillOpacity="0.25" />
              )}
            </svg>
          </div>

          <div className="flex items-center gap-1.5">
            <StatusBadge status={folder.status} rejectionReason={folder.rejection_reason} />

            {canDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowConfirmDelete(true);
                }}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#141414]/35 hover:text-[#e11d48] hover:bg-[#e11d48]/10 transition-colors"
                title="Supprimer le dossier"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Nom du dossier */}
        <h4 className="font-[800] text-lg text-[#141414] tracking-tight leading-snug line-clamp-1 group-hover:text-[#ff6a2b] transition-colors">
          {folder.name}
        </h4>
      </div>

      {/* Nombre de fichiers et auteur */}
      <div className="pt-3 mt-2 border-t border-[#f1ece4] flex items-center justify-between text-xs text-[#141414]/60 font-semibold">
        <span>
          {folder.document_count ?? 0} {folder.document_count === 1 ? 'fichier' : 'fichiers'}
        </span>
        <span className="text-[11px] font-mono text-[#141414]/40">
          Ouvrir →
        </span>
      </div>

      {/* Popover confirmation suppression */}
      {showConfirmDelete && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 z-30 bg-white/95 backdrop-blur-xs rounded-[22px] p-4 flex flex-col items-center justify-center text-center gap-2"
        >
          <AlertCircle className="w-5 h-5 text-[#e11d48]" />
          <p className="text-xs font-bold text-[#141414]">Supprimer ce dossier et son contenu ?</p>
          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              disabled={isDeleting}
              onClick={handleDelete}
              className="px-3 py-1 rounded-full bg-[#e11d48] text-white text-[11px] font-extrabold hover:bg-[#be123c]"
            >
              {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Oui, supprimer'}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowConfirmDelete(false);
              }}
              className="px-3 py-1 rounded-full bg-[#f1ece4] text-[#141414] text-[11px] font-bold"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
};
