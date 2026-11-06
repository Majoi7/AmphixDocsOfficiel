import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertCircle, Check, CheckCheck, ExternalLink, FileText, Loader2, X } from 'lucide-react';
import { approveAllPendingItems, compareDates, formatDateFrench, formatFileSize, setItemApprovalStatus } from '../lib/supabase';
import type { DocumentItem } from '../lib/supabase';
import type { AdminLibraryData } from '../lib/admin-library';
import { inspectModerationResult, type ModerationIntent } from '../lib/admin-confirmations';
import { errorMessage } from '../lib/errors';
import { useDocumentLink } from '../hooks/useDocumentLink';
import { BottomSheet } from './mobile/BottomSheet';

interface PendingListProps {
  documents: DocumentItem[];
  onRefresh: () => Promise<AdminLibraryData>;
  currentUserId: string;
  isCurrent: () => boolean;
  disabled?: boolean;
  onInteractionChange: (active: boolean) => void;
}
interface ModerationAction {
  intent: ModerationIntent;
  title: string;
  collective: boolean;
  attempted: boolean;
  mutationConfirmed: boolean;
}
const buttonClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:cursor-not-allowed disabled:opacity-50';

function PendingDocumentRow({ document, disabled, onApprove, onReject }: {
  document: DocumentItem;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const { url, isPreparing, linkError, prepareLink } = useDocumentLink(document.file_path);
  return (
    <motion.article layout={!reducedMotion} initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0 }}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 350, damping: 30 }}
      className="min-w-0 rounded-2xl border-2 border-[#141414]/15 bg-white p-4 shadow-2xs sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#4a6cf0] bg-[#4a6cf0]/10">
          <FileText className="h-5 w-5 text-[#4a6cf0]" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-extrabold">{document.title}</h3>
          <p className="mt-1 break-words text-xs text-[#141414]/65">{document.file_name}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
            <span className="max-w-full break-words rounded-lg bg-[#9ab8ff]/25 px-2 py-1">{document.school_name || 'École non renseignée'}</span>
            <span className="max-w-full break-words rounded-lg bg-[#ffd23f]/25 px-2 py-1">{document.subject_name || 'Matière non renseignée'}</span>
          </div>
          {document.description && <p className="mt-2 break-words text-sm text-[#141414]/75">{document.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#141414]/65">
            <span className="flex min-w-0 max-w-full items-center gap-1.5">
              {document.author_avatar && <img src={document.author_avatar} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />}
              <span className="break-words font-bold">{document.author_name || 'Utilisateur'}</span>
            </span>
            <span>{formatDateFrench(document.created_at)}</span>
            <span>{formatFileSize(document.file_size)}</span>
          </div>
        </div>
      </div>
      <div className="mt-4 grid min-w-0 grid-cols-2 gap-2 border-t border-[#141414]/10 pt-3 sm:flex sm:flex-wrap sm:justify-end">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className={`${buttonClass} col-span-2 bg-[#f1ece4] text-[#141414] hover:bg-[#ffd23f]`}
            aria-label={`Ouvrir l’aperçu de ${document.title} dans un nouvel onglet`}>
            <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" /> Ouvrir l’aperçu
          </a>
        ) : (
          <button type="button" disabled={disabled || isPreparing} onClick={() => void prepareLink()}
            className={`${buttonClass} col-span-2 bg-[#f1ece4] hover:bg-[#ffd23f]`} aria-label={`Préparer l’aperçu de ${document.title}`}>
            {isPreparing ? <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />}
            {isPreparing ? 'Préparation…' : 'Préparer l’aperçu'}
          </button>
        )}
        <button type="button" disabled={disabled} onClick={onApprove} className={`${buttonClass} bg-emerald-700 text-white hover:bg-emerald-800`}>
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> Approuver
        </button>
        <button type="button" disabled={disabled} onClick={onReject} className={`${buttonClass} border border-rose-300 text-rose-700 hover:bg-rose-50`}>
          <X className="h-4 w-4 shrink-0" aria-hidden="true" /> Refuser
        </button>
      </div>
      {linkError && <p role="alert" className="mt-3 break-words text-sm text-red-700">{linkError} Réessayez la préparation.</p>}
    </motion.article>
  );
}

export function PendingList({ documents, onRefresh, currentUserId, isCurrent, disabled = false, onInteractionChange }: PendingListProps) {
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [action, setAction] = useState<ModerationAction | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operationRef = useRef(false);
  const mountedRef = useRef(false);
  const sortId = useId();
  const reasonId = useId();
  const hasInteraction = action !== null;
  const pendingDocuments = documents.filter((document) => document.status === 'pending' && document.deleted_at === null)
    .sort((a, b) => compareDates(a.created_at, b.created_at, sortOrder));

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    onInteractionChange(hasInteraction);
    return () => onInteractionChange(false);
  }, [hasInteraction, onInteractionChange]);

  const closeAction = () => {
    if (!operationRef.current) { setAction(null); setActionError(null); }
  };
  const openAction = (documentIds: string[], status: 'approved' | 'rejected', title: string, collective = false) => {
    if (disabled || operationRef.current || !isCurrent() || documentIds.length === 0) return;
    setNotice(null);
    setActionError(null);
    // La sélection est figée : un nouveau fichier arrivé pendant la confirmation
    // ne rejoint pas silencieusement une approbation collective.
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
    let mutationError: string | null = null;
    operationRef.current = true;
    setIsWorking(true);
    setActionError(null);
    try {
      if (!action.attempted) {
        // Une fois envoyée, seule une relecture est proposée par ce dialogue.
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
          mutationError = errorMessage(cause, 'La modération n’a pas été confirmée.');
        }
      }
      try {
        const data = await onRefresh();
        if (!current()) return;
        const result = inspectModerationResult(intent, data.documents);
        if (result.complete) {
          setNotice(mutationConfirmed
            ? `${result.confirmedIds.length} fichier(s) ${intent.status === 'approved' ? 'approuvé(s)' : 'refusé(s)'} : confirmation reçue et liste actualisée.`
            : `La relecture confirme l’état ${intent.status === 'approved' ? 'approuvé' : 'refusé'} des ${result.confirmedIds.length} fichier(s). Elle ne permet pas d’attribuer la modification à ce clic.`);
          setAction(null);
        } else {
          const details = `${result.confirmedIds.length} à l’état demandé, ${result.pendingIds.length} encore en attente, ${result.differentIds.length} modéré(s) autrement, ${result.unavailableIds.length} absent(s) ou en corbeille.`;
          setActionError(`${mutationConfirmed ? 'La mutation a été confirmée, mais l’état a ensuite changé pour certains fichiers.' : 'La relecture ne confirme pas toute l’action.'} ${details} Aucune nouvelle mutation n’est envoyée. Fermez ce dialogue pour vérifier la liste avant une nouvelle action.`);
        }
      } catch (cause) {
        if (!current()) return;
        const readError = errorMessage(cause, 'La liste n’a pas pu être actualisée.');
        setActionError(mutationConfirmed
          ? `La modération a été enregistrée, mais la liste n’a pas pu être actualisée : ${readError} Réessayez l’actualisation, pas la modification.`
          : `Le résultat reste incertain. ${mutationError ? `${mutationError} ` : ''}${readError} Relisez l’état avant toute nouvelle action.`);
      }
    } finally {
      operationRef.current = false;
      if (current()) setIsWorking(false);
    }
  };

  return (
    <div className="min-w-0 space-y-5">
      {notice && <p role="status" className="break-words rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
      <div className="flex min-w-0 flex-col gap-3 rounded-2xl border-2 border-[#141414]/15 bg-white p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-sm font-bold">{pendingDocuments.length} fichier(s) en attente</p>
          <label htmlFor={sortId} className="mb-1 block text-xs font-bold text-[#141414]/70">Ordre d’affichage</label>
          <select id={sortId} value={sortOrder} disabled={hasInteraction || disabled}
            onChange={(event) => setSortOrder(event.target.value === 'asc' ? 'asc' : 'desc')}
            className="min-h-11 w-full min-w-0 rounded-xl border border-[#141414]/20 bg-[#f1ece4] px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:opacity-50">
            <option value="desc">Plus récents d’abord</option><option value="asc">Plus anciens d’abord</option>
          </select>
        </div>
        {pendingDocuments.length > 0 && <button type="button" disabled={disabled || hasInteraction}
          onClick={() => openAction(pendingDocuments.map((document) => document.id), 'approved', 'Approbation collective', true)}
          className={`${buttonClass} bg-emerald-700 text-white hover:bg-emerald-800`}>
          <CheckCheck className="h-4 w-4 shrink-0" aria-hidden="true" /> Tout approuver ({pendingDocuments.length})
        </button>}
      </div>
      {pendingDocuments.length === 0 ? (
        <div className="rounded-3xl border-2 border-[#141414]/15 bg-white px-4 py-10 text-center">
          <Check className="mx-auto mb-3 h-8 w-8 text-emerald-700" aria-hidden="true" />
          <h3 className="text-xl font-extrabold">Aucun fichier en attente</h3>
          <p className="mt-2 text-sm text-[#141414]/65">Tous les fichiers actifs visibles ont un statut de modération.</p>
        </div>
      ) : (
        <div className="min-w-0 space-y-3"><AnimatePresence>
          {pendingDocuments.map((document) => <PendingDocumentRow key={document.id} document={document} disabled={disabled || hasInteraction}
            onApprove={() => openAction([document.id], 'approved', document.title)}
            onReject={() => openAction([document.id], 'rejected', document.title)} />)}
        </AnimatePresence></div>
      )}
      <BottomSheet isOpen={action !== null} onClose={closeAction} canClose={!isWorking} title={action?.collective ? 'Tout approuver' : action?.intent.status === 'rejected' ? 'Refuser un fichier' : 'Approuver un fichier'}>
        {action && <form onSubmit={(event) => { event.preventDefault(); void performAction(); }} className="min-w-0 space-y-4">
          <p className="break-words text-base font-bold">{action.collective ? `Approuver les ${action.intent.documentIds.length} fichiers sélectionnés ?` : action.title}</p>
          <p className="text-sm text-[#141414]/75">{action.intent.status === 'approved'
            ? 'Les fichiers approuvés seront accessibles aux autres membres tant qu’ils restent hors de la corbeille.'
            : 'Le fichier restera visible par son auteur avec le statut refusé et votre motif.'}</p>
          {action.intent.status === 'rejected' && <div>
            <label htmlFor={reasonId} className="mb-2 block text-sm font-bold">Motif du refus</label>
            <textarea id={reasonId} required readOnly={action.attempted} disabled={isWorking} rows={3} value={action.intent.rejectionReason || ''}
              onChange={(event) => setAction({ ...action, intent: { ...action.intent, rejectionReason: event.target.value } })}
              className="min-h-28 w-full min-w-0 resize-y rounded-2xl border border-[#141414]/25 bg-white p-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] read-only:bg-[#f1ece4]" />
            {action.attempted && <p className="mt-1 text-xs text-[#141414]/65">Le motif envoyé est figé pendant la vérification.</p>}
          </div>}
          {actionError && <div role="alert" className="flex min-w-0 items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" /><p className="min-w-0 break-words">{actionError}</p>
          </div>}
          {isWorking && <p role="status" className="text-sm">Envoi ou vérification en cours…</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="submit" disabled={isWorking || (!action.attempted && disabled)}
              className={`${buttonClass} flex-1 bg-[#ff6a2b] text-[#141414] hover:bg-[#ff8a4c]`}>
              {isWorking && <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {isWorking ? 'Vérification…' : action.attempted ? 'Réessayer l’actualisation' : 'Confirmer'}
            </button>
            <button type="button" data-autofocus disabled={isWorking} onClick={closeAction} className={`${buttonClass} flex-1 border border-[#141414]/20 bg-white`}>
              {action.attempted ? 'Fermer et vérifier la liste' : 'Annuler'}
            </button>
          </div>
        </form>}
      </BottomSheet>
    </div>
  );
}
