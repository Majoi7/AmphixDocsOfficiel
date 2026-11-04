import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  DocumentItem,
  FolderItem,
  formatDateFrench,
  formatFileSize,
  getDocumentSignedUrl,
  setItemApprovalStatus,
  approveAllPendingItems,
} from '../lib/supabase';
import {
  Check,
  X,
  ExternalLink,
  Folder,
  FileText,
  AlertCircle,
  Loader2,
  CheckCheck,
  Filter,
  Sparkles,
} from 'lucide-react';

interface PendingListProps {
  documents: DocumentItem[];
  folders: FolderItem[];
  onRefresh: () => Promise<void>;
  currentUserId: string;
}

type FilterType = 'all' | 'files' | 'folders';

export const PendingList: React.FC<PendingListProps> = ({
  documents,
  folders,
  onRefresh,
  currentUserId,
}) => {
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [refusingItemId, setRefusingItemId] = useState<string | null>(null);
  const [refusalReason, setRefusalReason] = useState<string>('');
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [shakingId, setShakingId] = useState<string | null>(null);
  const [showApproveAllPopover, setShowApproveAllPopover] = useState(false);
  const [isApprovingAll, setIsApprovingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Éléments pending
  const pendingDocs = documents.filter((d) => d.status === 'pending');
  const pendingFolders = folders.filter((f) => f.status === 'pending');

  type UnifiedItem = {
    kind: 'file' | 'folder';
    id: string;
    title: string;
    description: string | null;
    authorName: string;
    authorAvatar: string;
    authorEmail: string;
    date: string;
    fileType?: string;
    size?: number;
    filePath?: string;
  };

  const unifiedList: UnifiedItem[] = [
    ...pendingFolders.map((f) => ({
      kind: 'folder' as const,
      id: f.id,
      title: f.name,
      description: `Dossier contenant ${f.document_count || 0} document(s)`,
      authorName: f.author_name || 'Utilisateur',
      authorAvatar: f.author_avatar || '',
      authorEmail: f.author_email || '',
      date: f.created_at,
    })),
    ...pendingDocs.map((d) => ({
      kind: 'file' as const,
      id: d.id,
      title: d.title,
      description: d.description,
      authorName: d.author_name || 'Utilisateur',
      authorAvatar: d.author_avatar || '',
      authorEmail: d.author_email || '',
      date: d.created_at,
      fileType: d.file_type,
      size: d.file_size,
      filePath: d.file_path,
    })),
  ];

  const filteredList = unifiedList.filter((item) => {
    if (filterType === 'files') return item.kind === 'file';
    if (filterType === 'folders') return item.kind === 'folder';
    return true;
  }).sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    return sortOrder === 'desc' ? db - da : da - db;
  });

  const handleApprove = async (item: UnifiedItem) => {
    setActionError(null);
    setApprovingId(item.id);
    try {
      await setItemApprovalStatus(
        item.kind === 'file' ? 'document' : 'folder',
        item.id,
        'approved',
        undefined,
        currentUserId
      );
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Impossible d’approuver cet élément. Réessayez.');
    } finally {
      setApprovingId(null);
    }
  };

  const handleRefuse = async (item: UnifiedItem) => {
    setActionError(null);
    setShakingId(item.id);
    try {
      await setItemApprovalStatus(
        item.kind === 'file' ? 'document' : 'folder',
        item.id,
        'rejected',
        refusalReason || 'Non approuvé par l\'administrateur',
        currentUserId
      );
      await onRefresh();
      setRefusingItemId(null);
      setRefusalReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Impossible de refuser cet élément. Réessayez.');
    } finally {
      setShakingId(null);
    }
  };

  const handleApproveAll = async () => {
    setActionError(null);
    setIsApprovingAll(true);
    try {
      await approveAllPendingItems({
        documentIds: filteredList.filter((item) => item.kind === 'file').map((item) => item.id),
        folderIds: filteredList.filter((item) => item.kind === 'folder').map((item) => item.id),
      }, currentUserId);
      await onRefresh();
      setShowApproveAllPopover(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'L’approbation collective a échoué. Actualisez la liste avant de réessayer.');
      // Une table peut avoir réussi alors que l'autre a échoué.
      // Réconcilier la liste, sans transformer un échec en succès global.
      try { await onRefresh(); } catch { /* Le message de l’opération reste affiché. */ }
    } finally {
      setIsApprovingAll(false);
    }
  };

  const handleOpenPreview = async (filePath?: string) => {
    if (!filePath) return;
    setActionError(null);
    try {
      const url = await getDocumentSignedUrl(filePath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Impossible d’ouvrir cet aperçu. Réessayez.');
    }
  };

  return (
    <div className="space-y-6">
      {actionError && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border-2 border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{actionError}</p>
        </div>
      )}
      {/* Barre d'outils et filtres */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border-2 border-[#141414]/15 shadow-2xs">
        {/* Filtres Tous / Fichiers / Dossiers */}
        <div className="flex items-center gap-1.5 p-1 bg-[#f1ece4] rounded-xl self-start">
          {(['all', 'files', 'folders'] as FilterType[]).map((type) => {
            const labels = { all: 'Tous', files: 'Fichiers', folders: 'Dossiers' };
            const isActive = filterType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setFilterType(type)}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-white text-[#141414] shadow-2xs'
                    : 'text-[#141414]/60 hover:text-[#141414]'
                }`}
              >
                {labels[type]}
              </button>
            );
          })}
        </div>

        {/* Tri et Tout approuver */}
        <div className="flex items-center justify-end gap-3">
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as 'desc' | 'asc')}
            className="px-3 py-1.5 rounded-xl bg-[#f1ece4]/70 border border-[#141414]/15 text-xs font-bold text-[#141414] focus:outline-hidden"
          >
            <option value="desc">Plus récents d'abord</option>
            <option value="asc">Plus anciens d'abord</option>
          </select>

          {/* Bouton "Tout approuver" avec popover de confirmation */}
          {filteredList.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowApproveAllPopover((p) => !p)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-600 text-white font-extrabold text-xs shadow-sm hover:bg-emerald-700 transition-colors cursor-pointer"
              >
                <CheckCheck className="w-4 h-4" />
                <span>Tout approuver ({filteredList.length})</span>
              </button>

              {showApproveAllPopover && (
                <div className="absolute right-0 top-11 z-30 w-64 bg-white rounded-2xl border-2 border-[#141414] shadow-xl p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#141414]">
                    <AlertCircle className="w-4 h-4 text-emerald-600" />
                    <span>Approuver les {filteredList.length} éléments ?</span>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isApprovingAll}
                      onClick={handleApproveAll}
                      className="flex-1 py-1 px-2 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 flex items-center justify-center gap-1"
                    >
                      {isApprovingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Oui, valider tout'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowApproveAllPopover(false)}
                      className="py-1 px-2 rounded-lg bg-[#f1ece4] text-[11px] font-bold"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Liste des éléments en attente */}
      {filteredList.length === 0 ? (
        <div className="bg-white rounded-3xl border-2 border-[#141414]/15 p-12 text-center flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-100 border border-emerald-400 flex items-center justify-center mb-3 text-emerald-700">
            <Check className="w-7 h-7 stroke-[3]" />
          </div>
          <h3 className="font-extrabold text-xl text-[#141414] mb-1">
            Tout est à jour !
          </h3>
          <p className="text-xs text-[#141414]/60 max-w-xs">
            Aucun document ni dossier en attente d'approbation pour le moment.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filteredList.map((item) => {
              const isApproving = approvingId === item.id;
              const isShaking = shakingId === item.id;
              const isRefusingThis = refusingItemId === item.id;

              return (
                <motion.div
                  key={`${item.kind}-${item.id}`}
                  layout
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={
                    isApproving
                      ? { backgroundColor: '#dcfce7', scale: 0.98, opacity: 0.9 }
                      : isShaking
                      ? { x: [-8, 8, -6, 6, 0], rotate: -4, opacity: 0.5 }
                      : { opacity: 1, y: 0, scale: 1 }
                  }
                  exit={{
                    scale: 0.8,
                    rotate: -6,
                    opacity: 0,
                    transition: { duration: 0.35 },
                  }}
                  className={`bg-white rounded-2xl border-2 border-[#141414]/15 p-4 sm:p-5 shadow-2xs transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    isApproving ? 'bg-emerald-50 border-emerald-500' : ''
                  }`}
                >
                  {/* Colonne gauche : Icône, Titre, Auteur, Détails */}
                  <div className="flex items-start gap-3.5 flex-1 min-w-0">
                    <div
                      className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border"
                      style={{
                        backgroundColor: item.kind === 'folder' ? '#ffd23f25' : '#4a6cf018',
                        borderColor: item.kind === 'folder' ? '#ffd23f' : '#4a6cf0',
                      }}
                    >
                      {item.kind === 'folder' ? (
                        <Folder className="w-5 h-5 text-[#141414]" />
                      ) : (
                        <FileText className="w-5 h-5 text-[#4a6cf0]" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-[800] text-base text-[#141414] truncate">
                          {item.title}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            item.kind === 'folder'
                              ? 'bg-[#ffd23f]/30 text-[#8a6800]'
                              : 'bg-[#ff6a2b]/20 text-[#ff6a2b]'
                          }`}
                        >
                          {item.kind === 'folder' ? 'Dossier' : item.fileType?.toUpperCase() || 'Fichier'}
                        </span>
                      </div>

                      {item.description && (
                        <p className="text-xs text-[#141414]/70 line-clamp-1 mb-2 font-medium">
                          {item.description}
                        </p>
                      )}

                      {/* Métadonnées de l'auteur */}
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#141414]/60">
                        <div className="flex items-center gap-1.5">
                          {item.authorAvatar ? (
                            <img
                              src={item.authorAvatar}
                              alt=""
                              className="w-4 h-4 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-4 h-4 rounded-full bg-[#141414]/20 flex items-center justify-center text-[9px] font-bold">
                              {item.authorName.charAt(0)}
                            </div>
                          )}
                          <span className="font-bold text-[#141414]">{item.authorName}</span>
                        </div>

                        <span>•</span>
                        <span>{formatDateFrench(item.date)}</span>

                        {item.size !== undefined && (
                          <>
                            <span>•</span>
                            <span className="font-mono">{formatFileSize(item.size)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Colonne droite : Actions (Aperçu, Approuver, Refuser) */}
                  <div className="flex flex-wrap sm:flex-nowrap items-center justify-end gap-2 w-full sm:w-auto shrink-0 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-[#f1ece4]">
                    {item.filePath && (
                      <button
                        type="button"
                        onClick={() => handleOpenPreview(item.filePath)}
                        className="p-2.5 sm:p-2 rounded-xl bg-[#f1ece4] hover:bg-[#141414] hover:text-white text-[#141414] transition-colors"
                        title="Aperçu / Télécharger"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    )}

                    {/* Approuver (Bouton large sur mobile) */}
                    <button
                      type="button"
                      disabled={isApproving}
                      onClick={() => handleApprove(item)}
                      className="flex-1 sm:flex-initial inline-flex justify-center items-center gap-1.5 px-4 py-2.5 sm:py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-2xs transition-colors cursor-pointer"
                    >
                      {isApproving ? (
                        <>
                          <Check className="w-4 h-4 animate-bounce" />
                          <span>Validé</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Approuver</span>
                        </>
                      )}
                    </button>

                    {/* Refuser (Bouton large sur mobile) */}
                    {!isRefusingThis ? (
                      <button
                        type="button"
                        onClick={() => setRefusingItemId(item.id)}
                        className="flex-1 sm:flex-initial inline-flex justify-center items-center gap-1.5 px-4 py-2.5 sm:py-2 rounded-xl bg-white border border-[#e11d48]/40 hover:bg-[#e11d48]/10 text-[#e11d48] text-xs font-extrabold transition-colors cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                        <span>Refuser</span>
                      </button>
                    ) : (
                      <div className="flex flex-1 sm:flex-initial items-center gap-1.5 bg-[#f1ece4] p-1.5 rounded-xl w-full sm:w-auto">
                        <input
                          type="text"
                          placeholder="Motif du refus…"
                          value={refusalReason}
                          onChange={(e) => setRefusalReason(e.target.value)}
                          className="text-xs px-2 py-1 rounded-lg bg-white border border-[#141414]/20 focus:outline-hidden w-36"
                        />
                        <button
                          type="button"
                          onClick={() => handleRefuse(item)}
                          className="px-2 py-1 rounded-lg bg-[#e11d48] text-white text-xs font-bold"
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRefusingItemId(null);
                            setRefusalReason('');
                          }}
                          className="px-1.5 py-1 text-xs text-[#141414]/60"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};
