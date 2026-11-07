import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Download, Loader2, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchDocumentTargets, formatDateFrench, formatFileSize, STATUS_CONFIG, type DocumentItem } from '../lib/supabase';
import { getSupabaseClientState, subscribeSupabaseClient } from '../lib/supabase-config';
import { errorMessage } from '../lib/errors';
import { useDocumentLink } from '../hooks/useDocumentLink';
import { useDocumentThumbnails } from '../hooks/useDocumentThumbnails';
import { usePendingNavigation } from '../hooks/usePendingNavigation';
import { BottomSheet } from './mobile/BottomSheet';
import { DocumentPreview } from './DocumentPreview';

interface DocumentDetailsProps {
  documentId: string;
  thumbnailUrl?: string;
  onClose: () => void;
  onUpdate?: (id: string, title: string, description: string) => Promise<void>;
  onTrash?: (id: string, deleted: boolean) => Promise<void>;
  onModerate?: (document: DocumentItem, status: 'approved' | 'rejected') => void;
  disabled?: boolean;
  blocked?: boolean;
  refreshVersion?: number;
}
const buttonClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:cursor-not-allowed disabled:opacity-50';
const fieldClass = 'w-full min-w-0 rounded-2xl border border-[#141414]/25 bg-white px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0]';

// Un lien direct est relu sous les droits courants, même hors de la page chargée.
// Le contenu et les réponses tardives sont invalidés au changement de scope.
export function DocumentDetails(props: DocumentDetailsProps) {
  const { user, isAdmin } = useAuth();
  const { generation } = useSyncExternalStore(subscribeSupabaseClient, getSupabaseClientState, getSupabaseClientState);
  const scope = `${generation}:${user?.id || ''}:${props.documentId}`;
  return <ScopedDocumentDetails key={scope} {...props} actorId={user?.id || ''} generation={generation} isAdmin={isAdmin} />;
}

function ScopedDocumentDetails({ documentId, thumbnailUrl, onClose, onUpdate, onTrash, onModerate, disabled = false, blocked = false, refreshVersion = 0, actorId, generation, isAdmin }: DocumentDetailsProps & {
  actorId: string; generation: number; isAdmin: boolean;
}) {
  const [document, setDocument] = useState<DocumentItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(false);
  const operation = useRef(false);
  const closeAfterWork = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const link = useDocumentLink(document?.file_path || '', document?.file_name);
  const previews = useDocumentThumbnails(document && !thumbnailUrl ? [document] : []);
  const working = busy || blocked;
  usePendingNavigation(working);
  const current = () => mounted.current && getSupabaseClientState().generation === generation;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetchDocumentTargets([documentId], actorId).then((targets) => {
      if (cancelled || getSupabaseClientState().generation !== generation) return;
      setDocument(targets.find((item) => item.id === documentId) || null);
    }).catch((cause) => {
      if (!cancelled && getSupabaseClientState().generation === generation) setLoadError(errorMessage(cause, 'Impossible de charger ce fichier. Réessayez.'));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [documentId, actorId, generation, revision, refreshVersion]);
  useEffect(() => { if (editing) titleInput.current?.focus(); }, [editing]);
  // Le blocker doit être désarmé avant la fermeture qui touche à l’historique.
  useEffect(() => {
    if (!working && closeAfterWork.current) { closeAfterWork.current = false; onClose(); }
  }, [working, onClose]);
  const close = () => { if (!operation.current && !blocked) onClose(); };
  const canManage = !!document && (isAdmin || document.user_id === actorId);
  const run = async (action: () => Promise<void>, fallback: string) => {
    if (operation.current || disabled || !current()) return;
    operation.current = true;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try { await action(); }
    catch (cause) { if (current()) setActionError(errorMessage(cause, fallback)); }
    finally { operation.current = false; if (current()) setBusy(false); }
  };
  const save = () => {
    if (!document || !onUpdate) return;
    if (!title.trim() || description.length > 200) { setActionError('Ajoutez un titre et limitez la description à 200 caractères.'); return; }
    void run(async () => {
      await onUpdate(document.id, title.trim(), description.trim());
      if (!current()) return;
      setDocument({ ...document, title: title.trim(), description: description.trim() || null });
      setEditing(false);
      setNotice('Modifications enregistrées.');
      requestAnimationFrame(() => { if (mounted.current) editButton.current?.focus(); });
    }, 'Les modifications n’ont pas pu être confirmées. Réessayez.');
  };
  const moveToTrash = () => {
    if (!document || !onTrash) return;
    void run(async () => {
      await onTrash(document.id, document.deleted_at === null);
      if (current()) closeAfterWork.current = true;
    }, 'L’action n’a pas pu être confirmée. Réessayez.');
  };
  return <BottomSheet isOpen onClose={close} canClose={!busy} title="Détail du fichier" maxHeight="94dvh">
    {loading ? <p role="status" className="py-8 text-center">Chargement du fichier…</p> : loadError ? <div className="space-y-3">
      <p role="alert" className="text-sm text-red-800">{loadError}</p>
      <button type="button" onClick={() => setRevision((value) => value + 1)} className={`${buttonClass} bg-white`}>Réessayer</button>
    </div> : !document ? <p role="status" className="py-6 text-sm">Ce fichier n’est pas disponible pour votre compte.</p> : <div className="min-w-0 space-y-5">
      <div className="mx-auto w-full max-w-xs"><DocumentPreview document={document} large url={thumbnailUrl || (document.thumbnail_path ? previews.urls[document.thumbnail_path] : undefined)} loading={previews.loading} /></div>
      {previews.error && <div className="text-sm"><p role="status">{previews.error}</p><button type="button" onClick={previews.retry} className={`${buttonClass} mt-2 bg-white`}>Recharger l’aperçu</button></div>}
      <div className="min-w-0"><h3 className="break-words text-xl font-extrabold">{document.title}</h3>
        <p className="mt-1 break-words text-sm text-[#141414]/70">{document.school_name || 'École non renseignée'} · {document.subject_name || 'Matière non renseignée'}</p>
        <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold ${STATUS_CONFIG[document.status].bg} ${STATUS_CONFIG[document.status].text}`}>{STATUS_CONFIG[document.status].label}</span>
        {document.deleted_at && <span className="ml-2 inline-flex rounded-full bg-[#141414]/10 px-3 py-1 text-xs font-bold">Corbeille</span>}
      </div>
      {document.description && <p className="break-words text-sm leading-relaxed">{document.description}</p>}
      {document.rejection_reason && <p className="rounded-2xl bg-[#ffb6e1]/30 p-3 text-sm"><strong>Motif du refus :</strong> {document.rejection_reason}</p>}
      <dl className="space-y-2 text-sm text-[#141414]/70">
        <div className="flex flex-wrap gap-x-2"><dt>Auteur :</dt><dd className="break-words font-semibold">{document.author_name || 'Non renseigné'}</dd></div>
        <div className="flex flex-wrap gap-x-2"><dt>Ajout :</dt><dd>{formatDateFrench(document.created_at)}</dd></div>
        <div className="flex flex-wrap gap-x-2"><dt>Taille :</dt><dd>{formatFileSize(document.file_size)}</dd></div>
        <div><dt>Fichier :</dt><dd className="break-words">{document.file_name}</dd></div>
      </dl>
      {link.url ? <a href={link.url} download={document.file_name} target="_blank" rel="noopener noreferrer" className={`${buttonClass} w-full bg-[#ff6a2b]`}><Download size={18} aria-hidden="true" />Télécharger</a>
        : <button type="button" disabled={busy || link.isPreparing} onClick={() => void link.prepareLink()} className={`${buttonClass} w-full bg-[#ff6a2b]`}>
          {link.isPreparing ? <Loader2 size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Download size={18} aria-hidden="true" />}{link.isPreparing ? 'Préparation…' : 'Préparer le téléchargement'}
        </button>}
      {link.linkError && <p role="alert" className="text-sm text-red-800">{link.linkError}</p>}
      {canManage && onUpdate && document.deleted_at === null && (editing ? <form onSubmit={(event) => { event.preventDefault(); save(); }} className="space-y-3 border-t border-[#141414]/15 pt-4">
        <div><label htmlFor={titleId} className="mb-1 block text-sm font-bold">Titre</label><input ref={titleInput} id={titleId} className={fieldClass} value={title} required disabled={busy} onChange={(event) => setTitle(event.target.value)} /></div>
        <div><label htmlFor={descriptionId} className="mb-1 block text-sm font-bold">Description</label><textarea id={descriptionId} className={fieldClass} value={description} maxLength={200} rows={3} disabled={busy} onChange={(event) => setDescription(event.target.value)} /><p className="text-right text-xs text-[#141414]/60">{description.length}/200</p></div>
        <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || disabled} className={`${buttonClass} bg-[#4a6cf0] text-white`}>Enregistrer</button><button type="button" disabled={busy} className={`${buttonClass} bg-white`} onClick={() => { setEditing(false); setActionError(null); requestAnimationFrame(() => editButton.current?.focus()); }}>Annuler</button></div>
      </form> : <button ref={editButton} type="button" disabled={busy || disabled} className={`${buttonClass} w-full bg-white`} onClick={() => { setTitle(document.title); setDescription(document.description || ''); setEditing(true); setActionError(null); }}><Pencil size={18} aria-hidden="true" />Modifier</button>)}
      {canManage && onTrash && !editing && <button type="button" disabled={busy || disabled} onClick={moveToTrash} className={`${buttonClass} w-full border border-[#141414]/20 bg-white`}>
        {document.deleted_at ? <RotateCcw size={18} aria-hidden="true" /> : <Trash2 size={18} aria-hidden="true" />}{document.deleted_at ? 'Restaurer le fichier' : 'Placer dans la corbeille'}
      </button>}
      {onModerate && isAdmin && document.status === 'pending' && document.deleted_at === null && <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy || disabled} onClick={() => onModerate(document, 'approved')} className={`${buttonClass} bg-emerald-700 text-white`}><Check size={18} aria-hidden="true" />Approuver</button>
        <button type="button" disabled={busy || disabled} onClick={() => onModerate(document, 'rejected')} className={`${buttonClass} bg-white text-rose-700`}><X size={18} aria-hidden="true" />Refuser</button>
      </div>}
      {notice && <p role="status" className="text-sm text-emerald-800">{notice}</p>}
      {actionError && <p role="alert" className="text-sm text-red-800">{actionError}</p>}
      {busy && <p role="status" className="text-sm">Enregistrement en cours…</p>}
    </div>}
  </BottomSheet>;
}
