import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DocumentItem, FILE_BADGES, formatDateFrench, getDocumentSignedUrl } from '../lib/supabase';
import { MoreHorizontal, ExternalLink, Edit3, Trash2, Check, X, Loader2, AlertCircle } from 'lucide-react';

interface DocumentCardProps {
  doc: DocumentItem;
  isNew?: boolean;
  onUpdate: (id: string, title: string, description: string) => Promise<void>;
  onDelete: (id: string, filePath: string) => Promise<void>;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({
  doc,
  isNew,
  onUpdate,
  onDelete,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(doc.title);
  const [editDesc, setEditDesc] = useState(doc.description || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isOpening, setIsOpening] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const badgeInfo = FILE_BADGES[doc.file_type] || FILE_BADGES.autre;

  // Fermer le menu lors d'un clic en dehors
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
        setShowDeleteConfirm(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOpenDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    try {
      setIsOpening(true);
      const url = await getDocumentSignedUrl(doc.file_path, doc.file_blob_url);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('Erreur ouverture document:', err);
    } finally {
      setIsOpening(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) return;
    try {
      setIsSaving(true);
      await onUpdate(doc.id, editTitle, editDesc);
      setIsEditing(false);
    } catch (err) {
      console.error('Erreur mise à jour document:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    try {
      setIsDeleting(true);
      await onDelete(doc.id, doc.file_path);
    } catch (err) {
      console.error('Erreur suppression document:', err);
      setIsDeleting(false);
    }
  };

  // Rotation déterministe légère au survol (±1°)
  const hoverRotate = ((doc.title.charCodeAt(0) % 2 === 0 ? 1 : -1) * 1.2);

  return (
    <motion.div
      layout
      initial={
        isNew
          ? { scale: 1.3, rotate: 8, opacity: 0 }
          : { scale: 0.9, y: 20, opacity: 0 }
      }
      animate={{
        scale: 1,
        y: 0,
        rotate: 0,
        opacity: 1,
      }}
      exit={{
        scale: 0,
        rotate: -10,
        opacity: 0,
        transition: { duration: 0.45, ease: [0.32, 0, 0.67, 0] },
      }}
      transition={{
        type: 'spring',
        stiffness: isNew ? 280 : 320,
        damping: isNew ? 18 : 24,
      }}
      whileHover={
        !isEditing && !isMenuOpen
          ? {
              y: -4,
              rotate: hoverRotate,
              boxShadow: '0 16px 28px -8px rgba(20, 20, 20, 0.1)',
            }
          : {}
      }
      className="perspective-1000 relative group"
    >
      <motion.div
        animate={{ rotateY: isEditing ? 180 : 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="transform-style-3d relative w-full rounded-[22px] bg-white border-2 border-[#141414]/10 p-6 min-h-[170px] flex flex-col justify-between shadow-xs transition-colors hover:border-[#141414]/25"
      >
        {/* FACE AVANT (Consultation normale) */}
        <div className={`backface-hidden w-full flex flex-col justify-between flex-1 ${isEditing ? 'pointer-events-none' : ''}`}>
          <div>
            {/* Haut de carte : Pastille de type de fichier + Menu "⋯" */}
            <div className="flex items-center justify-between gap-2 mb-3">
              {/* Pastille colorée selon le type de fichier (pdf=orange, image=rose, doc=bleu clair, autre=jaune) */}
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border"
                style={{
                  backgroundColor: doc.file_type === 'pdf' ? 'rgba(255, 106, 43, 0.12)' :
                                   doc.file_type === 'image' ? 'rgba(255, 182, 225, 0.35)' :
                                   doc.file_type === 'doc' ? 'rgba(154, 184, 255, 0.28)' : 'rgba(255, 210, 63, 0.3)',
                  borderColor: doc.file_type === 'pdf' ? '#ff6a2b' :
                               doc.file_type === 'image' ? '#ffb6e1' :
                               doc.file_type === 'doc' ? '#9ab8ff' : '#ffd23f',
                  color: doc.file_type === 'pdf' ? '#ff6a2b' :
                         doc.file_type === 'image' ? '#a11b61' :
                         doc.file_type === 'doc' ? '#2a4cb8' : '#8a6800',
                }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: doc.file_type === 'pdf' ? '#ff6a2b' :
                                     doc.file_type === 'image' ? '#ffb6e1' :
                                     doc.file_type === 'doc' ? '#4a6cf0' : '#ffd23f',
                  }}
                />
                <span className="uppercase text-[11px] font-black tracking-wide">
                  {badgeInfo.label}
                </span>
              </div>

              {/* Menu "⋯" */}
              <div className="relative" ref={menuRef}>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.92 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMenuOpen((prev) => !prev);
                    setShowDeleteConfirm(false);
                  }}
                  aria-label="Options du document"
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[#141414]/60 hover:text-[#141414] hover:bg-[#f1ece4] transition-colors cursor-pointer"
                >
                  <MoreHorizontal className="w-5 h-5" />
                </motion.button>

                {/* Popover du menu */}
                <AnimatePresence>
                  {isMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.85, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.85, y: -4 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      className="absolute right-0 top-9 z-30 w-52 bg-white rounded-2xl border-2 border-[#141414] shadow-xl p-1.5 flex flex-col gap-0.5"
                    >
                      {/* Ouvrir / Télécharger */}
                      <button
                        type="button"
                        onClick={handleOpenDownload}
                        disabled={isOpening}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold text-[#141414] rounded-xl hover:bg-[#f1ece4] transition-colors text-left cursor-pointer"
                      >
                        {isOpening ? (
                          <Loader2 className="w-4 h-4 animate-spin text-[#4a6cf0]" />
                        ) : (
                          <ExternalLink className="w-4 h-4 text-[#4a6cf0]" />
                        )}
                        <span>Ouvrir / Télécharger</span>
                      </button>

                      {/* Modifier titre et description */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsMenuOpen(false);
                          setIsEditing(true);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold text-[#141414] rounded-xl hover:bg-[#f1ece4] transition-colors text-left cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4 text-[#ff6a2b]" />
                        <span>Modifier les infos</span>
                      </button>

                      <div className="h-[1px] bg-[#f1ece4] my-1" />

                      {/* Supprimer avec popover confirmation intégré */}
                      {!showDeleteConfirm ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowDeleteConfirm(true);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold text-[#e11d48] rounded-xl hover:bg-[#e11d48]/10 transition-colors text-left cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Supprimer</span>
                        </button>
                      ) : (
                        <div className="p-2 bg-[#f1ece4]/80 rounded-xl flex flex-col gap-2">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#141414]">
                            <AlertCircle className="w-3.5 h-3.5 text-[#e11d48]" />
                            <span>Confirmer la suppression ?</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={handleConfirmDelete}
                              disabled={isDeleting}
                              className="flex-1 py-1 px-2 rounded-lg bg-[#e11d48] text-white text-[11px] font-bold hover:bg-[#be123c] transition-colors flex items-center justify-center gap-1"
                            >
                              {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Oui, effacer'}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowDeleteConfirm(false);
                              }}
                              className="py-1 px-2 rounded-lg bg-white border border-[#141414]/20 text-[11px] font-bold hover:bg-gray-50"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Titre (gras) */}
            <h4
              onClick={handleOpenDownload}
              className="font-[800] text-lg text-[#141414] tracking-tight leading-snug line-clamp-1 hover:text-[#ff6a2b] transition-colors cursor-pointer"
              title={doc.title}
            >
              {doc.title}
            </h4>

            {/* Description (2 lignes max, tronquée) */}
            {doc.description ? (
              <p className="text-xs sm:text-sm text-[#141414]/70 mt-1 line-clamp-2 leading-relaxed font-medium">
                {doc.description}
              </p>
            ) : (
              <p className="text-xs text-[#141414]/40 mt-1 italic">
                Aucune description fournie
              </p>
            )}
          </div>

          {/* Date d'ajout en petit */}
          <div className="pt-4 mt-3 border-t border-[#f1ece4] flex items-center justify-between text-xs text-[#141414]/50 font-medium">
            <span>Ajouté le {formatDateFrench(doc.created_at)}</span>
            <span className="font-mono text-[11px] opacity-75">{doc.file_name}</span>
          </div>
        </div>

        {/* FACE ARRIÈRE (Formulaire de modification 3D Flip) */}
        <div className={`rotate-y-180 backface-hidden absolute inset-0 rounded-[22px] bg-white p-5 flex flex-col justify-between ${!isEditing ? 'pointer-events-none' : ''}`}>
          <form onSubmit={handleSaveEdit} className="h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-black text-[#ff6a2b] uppercase tracking-wider flex items-center gap-1">
                  <Edit3 className="w-3.5 h-3.5" />
                  Modifier le document
                </span>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-[#f1ece4] text-[#141414]/60"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-[#141414] mb-1">
                    Titre *
                  </label>
                  <input
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full text-xs font-bold px-2.5 py-1.5 rounded-xl bg-[#f1ece4]/60 border border-[#141414]/20 focus:border-[#ff6a2b] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#141414] mb-1">
                    Description (max 200 car.)
                  </label>
                  <textarea
                    rows={2}
                    maxLength={200}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 rounded-xl bg-[#f1ece4]/60 border border-[#141414]/20 focus:border-[#ff6a2b] focus:outline-hidden resize-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f1ece4]">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 rounded-full text-xs font-bold text-[#141414]/70 hover:bg-[#f1ece4] transition-colors"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isSaving || !editTitle.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#ff6a2b] text-white text-xs font-bold shadow-xs hover:bg-[#ff8a4c] transition-colors disabled:opacity-60"
              >
                {isSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>Enregistrer</span>
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </motion.div>
  );
};
