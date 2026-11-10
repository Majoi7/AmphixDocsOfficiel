import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Check, CheckCheck, Loader2 } from 'lucide-react';
import { approveAllPendingItems, fetchDocumentTargets, setItemApprovalStatus } from '../lib/supabase';
import type { DocumentItem } from '../lib/supabase';
import type { AdminLibraryData } from '../lib/admin-library';
import { inspectModerationResult, type ModerationIntent } from '../lib/admin-confirmations';
import { errorMessage } from '../lib/errors';
import { useDocumentThumbnails } from '../hooks/useDocumentThumbnails';
import { useLibraryNavigation } from '../hooks/useLibraryNavigation';
import { PendingNavigationGuard } from '../hooks/usePendingNavigation';
import { DocumentGrid } from './DocumentGrid';
import { DocumentDetails } from './DocumentDetails';
import { LoadMoreDocuments } from './LoadMoreDocuments';
import { BottomSheet } from './mobile/BottomSheet';

interface PendingListProps {
  documents: DocumentItem[];
  onRefresh: () => Promise<AdminLibraryData>;
  onLoadMore: () => Promise<void>;
  currentUserId: string;
  isCurrent: () => boolean;
  disabled?: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  hasError: boolean;
  onInteractionChange: (active: boolean) => void;
  sortOrder: 'asc' | 'desc';
  onSortChange: (order: 'asc' | 'desc') => void;
}
interface ModerationAction {
  intent: ModerationIntent;
  title: string;
  collective: boolean;
  attempted: boolean;
  mutationConfirmed: boolean;
}
const buttonClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:cursor-not-allowed disabled:opacity-50';

export function PendingList({ documents, onRefresh, onLoadMore, currentUserId, isCurrent, disabled = false, loading, loadingMore, hasMore, hasError, onInteractionChange, sortOrder, onSortChange }: PendingListProps) {
  const navigation = useLibraryNavigation();
  const previews = useDocumentThumbnails(documents);
  const [action, setAction] = useState<ModerationAction | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const operationRef = useRef(false);
  const mountedRef = useRef(false);
  const closeDetailAfterWork = useRef(false);
  const headingRef = useRef<HTMLParagraphElement>(null);
  const previousDocument = useRef(navigation.documentId);
  const sortId = useId();
  const reasonId = useId();
  const hasInteraction = action !== null || !!navigation.documentId;
  const pendingDocuments = documents.filter((document) => document.status === 'pending' && document.deleted_at === null);
  const selected = documents.find((document) => document.id === navigation.documentId);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    onInteractionChange(hasInteraction);
    return () => onInteractionChange(false);
  }, [hasInteraction, onInteractionChange]);
  useEffect(() => {
    if (!isWorking && closeDetailAfterWork.current) {
      closeDetailAfterWork.current = false;
      navigation.closeDocument();
    }
  }, [isWorking, navigation.closeDocument]);
  useEffect(() => {
    const wasOpen = previousDocument.current;
    previousDocument.current = navigation.documentId;
    if (!wasOpen || navigation.documentId) return;
    if (!operationRef.current) { setAction(null); setActionError(null); }
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body) headingRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation.documentId]);

  const closeAction = () => {
    if (!operationRef.current) { setAction(null); setActionError(null); setDetailVersion((value) => value + 1); }
  };
  const openAction = (documentIds: string[], status: 'approved' | 'rejected', title: string, collective = false) => {
    if (disabled || operationRef.current || !isCurrent() || documentIds.length === 0) return;
    setNotice(null);
    setActionError(null);
    // La sélection est figée : les arrivées suivantes ne rejoignent pas l'action.
    setAction({ intent: { documentIds: [...documentIds], status, rejectionReason: '' }, title, collective, attempted: false, mutationConfirmed: false });
  };
  const performAction = async () => {
    if (!action || operationRef.current || !isCurrent()) return;
    if (!action.attempted && disabled) return;
    const reason = action.intent.rejectionReason?.trim() || '';
    if (!action.attempted && action.intent.status === 'rejected' && !reason) {
      setActionError('Indiquez un motif de refus avant de confirmer.');
      return;
    }
    const intent = { ...action.intent, rejectionReason: reason };
    const current = () => mountedRef.current && isCurrent();
    let mutationConfirmed = action.mutationConfirmed;
    operationRef.current = true;
    setIsWorking(true);
    setActionError(null);
    try {
      if (!action.attempted) {
        // Une réponse perdue ne déclenche jamais une seconde mutation automatique.
        setAction({ ...action, intent, attempted: true });
        try {
          if (action.collective) await approveAllPendingItems({ documentIds: [...intent.documentIds] }, currentUserId);
          else await setItemApprovalStatus(intent.documentIds[0], intent.status, intent.rejectionReason, currentUserId);
          if (!current()) return;
          mutationConfirmed = true;
          setAction({ ...action, intent, attempted: true, mutationConfirmed: true });
        } catch (cause) {
          if (!current()) return;
          errorMessage(cause, 'La modération n’a pas été confirmée.');
        }
      }
      try {
        const targets = await fetchDocumentTargets(intent.documentIds, currentUserId);
        if (!current()) return;
        const result = inspectModerationResult(intent, targets);
        // La disparition d'une page pending n'est pas une preuve de modération.
        await onRefresh();
        if (!current()) return;
        setDetailVersion((value) => value + 1);
        if (result.complete) {
          setNotice(mutationConfirmed
            ? `${result.confirmedIds.length} fichier(s) ${intent.status === 'approved' ? 'approuvé(s)' : 'refusé(s)'}. Liste actualisée.`
            : `${result.confirmedIds.length} fichier(s) désormais ${intent.status === 'approved' ? 'approuvé(s)' : 'refusé(s)'}, d’après la vérification.`);
          closeDetailAfterWork.current = !!navigation.documentId;
          setAction(null);
        } else {
          const details = `${result.confirmedIds.length} confirmé(s), ${result.pendingIds.length} en attente, ${result.differentIds.length} traité(s) autrement, ${result.unavailableIds.length} indisponible(s).`;
          setActionError(`${details} Fermez pour vérifier la liste. Aucune action ne sera renvoyée automatiquement.`);
        }
      } catch (cause) {
        if (!current()) return;
        errorMessage(cause, 'La liste n’a pas pu être actualisée.');
        setActionError(mutationConfirmed
          ? 'La modération est enregistrée. Réessayez l’actualisation pour vérifier la liste.'
          : 'Le résultat reste incertain. Réessayez la vérification avant toute nouvelle action.');
      }
    } finally {
      operationRef.current = false;
      if (current()) setIsWorking(false);
    }
  };

  return <div className="min-w-0 space-y-5">
    {notice && <p role="status" className="break-words rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-[#141414]/15 bg-white p-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p ref={headingRef} tabIndex={-1} className="mb-2 rounded text-sm font-bold focus-visible:outline-2 focus-visible:outline-[#4a6cf0]">{loading ? 'Chargement…' : `${pendingDocuments.length} fichier(s) en attente chargé(s)${hasMore ? ' · la liste continue' : ''}`}</p>
        <label htmlFor={sortId} className="mb-1 block text-xs font-bold text-[#141414]/70">Ordre d’affichage</label>
        <select id={sortId} value={sortOrder} disabled={hasInteraction || disabled || loadingMore}
          onChange={(event) => onSortChange(event.target.value === 'asc' ? 'asc' : 'desc')}
          className="min-h-11 w-full min-w-0 rounded-xl border border-[#141414]/20 bg-[#f1ece4] px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:opacity-50">
          <option value="desc">Plus récents d’abord</option><option value="asc">Plus anciens d’abord</option>
        </select>
      </div>
      {pendingDocuments.length > 0 && <button type="button" disabled={disabled || hasInteraction || loadingMore}
        onClick={() => openAction(pendingDocuments.map((document) => document.id), 'approved', 'Approbation collective', true)}
        className={`${buttonClass} bg-emerald-700 text-white hover:bg-emerald-800`}>
        <CheckCheck className="h-4 w-4 shrink-0" aria-hidden="true" />Approuver les fichiers chargés ({pendingDocuments.length})
      </button>}
    </div>
    {previews.error && <div className="rounded-2xl bg-white/60 p-3 text-sm"><p role="status">{previews.error}</p><button type="button" onClick={previews.retry} className={`${buttonClass} mt-2 bg-white`}>Recharger les aperçus</button></div>}
    {pendingDocuments.length === 0 && !loading && !hasError ? <div className="rounded-3xl border border-[#141414]/15 bg-white px-4 py-10 text-center">
      <Check className="mx-auto mb-3 h-8 w-8 text-emerald-700" aria-hidden="true" />
      <h3 className="text-xl font-extrabold">Aucun fichier en attente</h3>
      <p className="mt-2 text-sm text-[#141414]/65">Actualisez pour vérifier les nouveaux dépôts.</p>
    </div> : <DocumentGrid compact documents={pendingDocuments} urls={previews.urls} loading={loading} loadingPreviews={previews.loading}
      disabled={isWorking || !!action} onOpen={(document) => navigation.openDocument(document.id)} />}
    <LoadMoreDocuments hasMore={hasMore} loading={loadingMore} disabled={loading || hasInteraction || !!navigation.panel}
      error={hasError} onLoad={onLoadMore} />
    {/* Un seul blocker : le détail, ou cette garde pour l'action collective. */}
    {!navigation.documentId && action && <PendingNavigationGuard busy={isWorking} />}
    {navigation.documentId && <DocumentDetails documentId={navigation.documentId}
      thumbnailUrl={selected?.thumbnail_path ? previews.urls[selected.thumbnail_path] : undefined}
      refreshVersion={detailVersion} onClose={navigation.closeDocument} disabled={disabled || !!action} blocked={isWorking}
      onPreviewCompleted={() => {
        // La modération en cours fait déjà sa propre relecture autoritaire.
        // Hors mutation, le contrôleur parent expose toute erreur de cette lecture.
        if (mountedRef.current && isCurrent() && !operationRef.current) void onRefresh().catch(() => undefined);
      }}
      onModerate={(document, status) => openAction([document.id], status, document.title)} />}
    <BottomSheet isOpen={action !== null} onClose={closeAction} canClose={!isWorking} title={action?.collective ? 'Approbation collective' : action?.intent.status === 'rejected' ? 'Refuser un fichier' : 'Approuver un fichier'}>
      {action && <form onSubmit={(event) => { event.preventDefault(); void performAction(); }} className="min-w-0 space-y-4">
        <p className="break-words text-base font-bold">{action.collective ? `Approuver ces ${action.intent.documentIds.length} fichiers chargés ?` : action.title}</p>
        <p className="text-sm text-[#141414]/75">{action.intent.status === 'approved'
          ? 'Les fichiers approuvés seront accessibles aux autres membres tant qu’ils restent hors de la corbeille.'
          : 'Le fichier restera visible par son auteur avec le statut refusé et votre motif.'}</p>
        {action.intent.status === 'rejected' && <div>
          <label htmlFor={reasonId} className="mb-2 block text-sm font-bold">Motif du refus</label>
          <textarea id={reasonId} required readOnly={action.attempted} disabled={isWorking} rows={3} value={action.intent.rejectionReason || ''}
            onChange={(event) => setAction({ ...action, intent: { ...action.intent, rejectionReason: event.target.value } })}
            className="min-h-28 w-full min-w-0 resize-y rounded-2xl border border-[#141414]/25 bg-white p-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] read-only:bg-[#f1ece4]" />
          {action.attempted && <p className="mt-1 text-xs text-[#141414]/65">Le motif envoyé est conservé pendant la vérification.</p>}
        </div>}
        {actionError && <div role="alert" className="flex min-w-0 items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" /><p className="min-w-0 break-words">{actionError}</p>
        </div>}
        {isWorking && <p role="status" className="text-sm">Envoi ou vérification en cours…</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="submit" disabled={isWorking || (!action.attempted && disabled)} className={`${buttonClass} flex-1 bg-[#ff6a2b] text-[#141414] hover:bg-[#ff8a4c]`}>
            {isWorking && <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {isWorking ? 'Vérification…' : action.attempted ? 'Réessayer l’actualisation' : 'Confirmer'}
          </button>
          <button type="button" data-autofocus disabled={isWorking} onClick={closeAction} className={`${buttonClass} flex-1 border border-[#141414]/20 bg-white`}>
            {action.attempted ? 'Fermer et vérifier la liste' : 'Annuler'}
          </button>
        </div>
      </form>}
    </BottomSheet>
  </div>;
}
