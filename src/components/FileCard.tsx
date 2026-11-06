import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type DocumentItem, FILE_BADGES, formatDateFrench, formatFileSize, getFileCategory } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { useDocumentLink } from '../hooks/useDocumentLink';
import { StatusBadge } from './StatusBadge';
import { Check, Edit3, ExternalLink, File, FileCode, FileText, Image as ImageIcon, Loader2, MoreHorizontal, RotateCcw, Trash2, X } from 'lucide-react';

export interface FileCardProps {
  doc: DocumentItem;
  isNew?: boolean;
  onUpdate: (id: string, title: string, description: string) => Promise<void>;
  onTrash: (id: string, deleted: boolean) => Promise<void>;
  canManage?: boolean;
}

export function FileCard({ doc, isNew, onUpdate, onTrash, canManage = false }: FileCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(doc.title);
  const [editDesc, setEditDesc] = useState(doc.description || '');
  const [operation, setOperation] = useState<'saving' | 'trash' | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showTrashConfirm, setShowTrashConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const operationRef = useRef(false);
  const mountedRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const editorWasOpenRef = useRef(false);
  const id = useId();
  const reducedMotion = useReducedMotion();
  const { url, isPreparing, linkError, prepareLink } = useDocumentLink(doc.file_path);
  const category = getFileCategory(doc.file_type);
  const badge = FILE_BADGES[category];
  const Icon = category === 'pdf' ? FileText : category === 'image' ? ImageIcon : category === 'doc' ? FileCode : File;
  const isBusy = operation !== null;
  const isTrashed = doc.deleted_at !== null;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    if (isEditing) titleRef.current?.focus();
    else if (editorWasOpenRef.current) optionsRef.current?.focus({ preventScroll: true });
    editorWasOpenRef.current = isEditing;
  }, [isEditing]);
  useEffect(() => {
    if (!isMenuOpen) return;
    const closeMenu = () => {
      if (operationRef.current) return;
      setIsMenuOpen(false);
      setShowTrashConfirm(false);
    };
    const onOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) closeMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        if (!operationRef.current) optionsRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [isMenuOpen]);

  const closeEditor = () => {
    if (operationRef.current) return;
    setIsEditing(false);
  };
  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (operationRef.current || !canManage || isTrashed) return;
    if (!editTitle.trim()) { setActionError('Le titre est obligatoire.'); return; }
    if ([...editDesc].length > 200) { setActionError('La description ne doit pas dépasser 200 caractères.'); return; }
    operationRef.current = true;
    setOperation('saving');
    setActionError(null);
    try {
      await onUpdate(doc.id, editTitle, editDesc);
      if (mountedRef.current) setIsEditing(false);
    } catch (error) {
      if (mountedRef.current) setActionError(errorMessage(error, 'La modification n’a pas été confirmée. Votre saisie a été conservée.'));
    } finally {
      operationRef.current = false;
      if (mountedRef.current) setOperation(null);
    }
  };
  const handleTrash = async () => {
    if (operationRef.current || !canManage) return;
    operationRef.current = true;
    setOperation('trash');
    setActionError(null);
    try {
      // La vue ne change qu'après l'état confirmé par la RPC. Aucune suppression
      // de ligne ou d'objet Storage, y compris en cas de réponse réseau perdue.
      await onTrash(doc.id, !isTrashed);
      if (mountedRef.current) { setIsMenuOpen(false); setShowTrashConfirm(false); }
    } catch (error) {
      if (mountedRef.current) setActionError(errorMessage(error, 'L’action de corbeille n’a pas été confirmée. Le fichier reste affiché ; réessayez la même action.'));
    } finally {
      operationRef.current = false;
      if (mountedRef.current) setOperation(null);
    }
  };

  const focusClass = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0]';
  const buttonClass = `inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${focusClass}`;
  const fieldClass = 'min-h-11 w-full min-w-0 rounded-xl border border-[#141414]/20 bg-[#f1ece4]/60 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-[#4a6cf0] disabled:opacity-60';

  return (
    <motion.article
      layout={!reducedMotion}
      layoutId={reducedMotion ? undefined : `doc-card-${doc.id}`}
      initial={reducedMotion ? false : isNew ? { scale: 1.1, rotate: 6, opacity: 0 } : { scale: 0.95, y: 12, opacity: 0 }}
      animate={{ scale: 1, y: 0, rotate: 0, opacity: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { scale: 0.8, rotate: -6, opacity: 0 }}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 24 }}
      whileHover={!reducedMotion && !isEditing && !isMenuOpen ? { y: -4, rotate: (doc.title.charCodeAt(0) % 2 === 0 ? 1 : -1) * 1.1 } : undefined}
      aria-label={`Fichier : ${doc.title}`}
      aria-busy={isBusy}
      className="perspective-1000 relative min-w-0"
    >
      <motion.div animate={{ rotateY: !reducedMotion && isEditing ? 180 : 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="transform-style-3d relative min-h-[175px] w-full min-w-0 rounded-[22px] border-2 border-[#141414]/15 bg-white p-4 shadow-xs hover:border-[#141414] sm:p-5">
        {/* Une seule face est montée : aucun contrôle focusable sur la face masquée. */}
        {!isEditing ? <div className="backface-hidden flex min-w-0 flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${badge.bg} ${badge.text} ${badge.border}`} title={badge.label}><Icon className="h-5 w-5" aria-hidden="true" /></span>
              <StatusBadge status={doc.status} rejectionReason={doc.rejection_reason} />
              {isTrashed && <span className="rounded-full bg-[#141414] px-2 py-1 text-xs font-bold text-white">Corbeille</span>}
            </div>
            {canManage && <div className="relative shrink-0" ref={menuRef}>
              <button ref={optionsRef} type="button" disabled={isBusy} aria-label={`Options de ${doc.title}`} aria-expanded={isMenuOpen} aria-controls={`${id}-options`}
                onClick={() => { setIsMenuOpen((value) => !value); setShowTrashConfirm(false); }} className={`flex h-11 w-11 items-center justify-center rounded-full text-[#141414]/70 hover:bg-[#f1ece4] ${focusClass}`}>
                <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              </button>
              <AnimatePresence>
                {isMenuOpen && <motion.div id={`${id}-options`} role="group" aria-label="Actions du fichier"
                  initial={reducedMotion ? false : { opacity: 0, scale: 0.9, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: -4 }} transition={{ duration: reducedMotion ? 0 : 0.16 }}
                  className="absolute right-0 top-12 z-30 flex w-60 max-w-[calc(100vw-64px)] flex-col gap-1 rounded-2xl border-2 border-[#141414] bg-white p-2 shadow-xl">
                  <button type="button" disabled={isPreparing || isBusy} onClick={() => { void prepareLink(); }} className={`${buttonClass} justify-start text-left hover:bg-[#f1ece4]`}><ExternalLink className="h-4 w-4 text-[#4a6cf0]" aria-hidden="true" />Préparer l’ouverture</button>
                  {!isTrashed && <button type="button" disabled={isBusy}
                    onClick={() => { setActionError(null); setEditTitle(doc.title); setEditDesc(doc.description || ''); setIsMenuOpen(false); setIsEditing(true); }}
                    className={`${buttonClass} justify-start text-left hover:bg-[#f1ece4]`}><Edit3 className="h-4 w-4 text-[#ff6a2b]" aria-hidden="true" />Modifier titre / note</button>}
                  {!showTrashConfirm ? <button type="button" disabled={isBusy} onClick={() => setShowTrashConfirm(true)} className={`${buttonClass} justify-start text-left ${isTrashed ? 'text-emerald-800 hover:bg-emerald-50' : 'text-rose-700 hover:bg-rose-50'}`}>
                    {isTrashed ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}{isTrashed ? 'Restaurer' : 'Mettre à la corbeille'}
                  </button> : <div className="space-y-2 rounded-xl bg-[#f1ece4] p-2">
                    <p className="text-xs font-bold">{isTrashed ? 'Restaurer ce fichier ?' : 'Retirer ce fichier de la bibliothèque ?'}</p>
                    <p className="text-xs text-[#141414]/70">{isTrashed ? 'Son statut d’approbation est conservé.' : 'Le fichier sera conservé et pourra être restauré.'}</p>
                    <div className="flex flex-wrap gap-1">
                      <button type="button" disabled={isBusy} onClick={() => { void handleTrash(); }} className={`${buttonClass} flex-1 bg-[#141414] text-white`}>{operation === 'trash' ? 'Confirmation…' : isTrashed ? 'Restaurer' : 'Confirmer'}</button>
                      <button type="button" disabled={isBusy} onClick={() => setShowTrashConfirm(false)} className={`${buttonClass} bg-white`}>Annuler</button>
                    </div>
                  </div>}
                </motion.div>}
              </AnimatePresence>
            </div>}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-extrabold leading-snug tracking-tight sm:text-lg">
              {url ? <a href={url} target="_blank" rel="noopener noreferrer" className={`flex min-h-11 min-w-0 items-center rounded-lg hover:text-[#ff6a2b] ${focusClass}`} title={doc.title}><span className="truncate">{doc.title}</span></a>
                : <button type="button" disabled={isPreparing || isBusy} onClick={() => { void prepareLink(); }} className={`flex min-h-11 w-full min-w-0 items-center rounded-lg text-left hover:text-[#ff6a2b] disabled:opacity-60 ${focusClass}`} title={doc.title}><span className="truncate">{doc.title}</span></button>}
            </h2>
            <p className="break-words text-sm font-semibold text-[#4a6cf0]">{doc.school_name && doc.subject_name ? `${doc.school_name} · ${doc.subject_name}` : 'Classement historique — école et matière non renseignées'}</p>
            <p className={`mt-2 line-clamp-2 text-sm leading-relaxed ${doc.description ? 'text-[#141414]/70' : 'italic text-[#141414]/50'}`}>{doc.description || 'Sans description'}</p>
          </div>
          <div>
            {url ? <a href={url} target="_blank" rel="noopener noreferrer" className={`${buttonClass} justify-start px-0 text-[#4a6cf0]`}><ExternalLink className="h-4 w-4" aria-hidden="true" />Ouvrir / télécharger</a>
              : <button type="button" disabled={isPreparing || isBusy} onClick={() => { void prepareLink(); }} className={`${buttonClass} justify-start px-0 text-[#4a6cf0]`}>
                {isPreparing && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{isPreparing ? 'Préparation du lien…' : linkError ? 'Réessayer l’ouverture' : 'Préparer le lien'}
              </button>}
            {url && <p role="status" className="text-xs text-[#141414]/60">Lien temporaire prêt, ouverture dans un nouvel onglet.</p>}
          </div>
          {linkError && <p role="alert" className="break-words text-sm text-red-700">{linkError}</p>}
          {actionError && <p role="alert" className="break-words text-sm text-red-700">{actionError}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#f1ece4] pt-3 text-xs font-medium text-[#141414]/60"><span>{formatDateFrench(doc.created_at)}</span><span>{formatFileSize(doc.file_size)}</span></div>
          <p className="truncate font-mono text-xs text-[#141414]/60" title={doc.file_name}>{doc.file_name}</p>
        </div> : <form onSubmit={handleSave} className={`backface-hidden space-y-3 ${reducedMotion ? '' : 'rotate-y-180'}`} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeEditor(); } }}>
          <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-extrabold text-[#ff6a2b]">Modifier le fichier</h2><button type="button" disabled={isBusy} aria-label="Annuler la modification" onClick={closeEditor} className={`${buttonClass} p-2 hover:bg-[#f1ece4]`}><X className="h-5 w-5" aria-hidden="true" /></button></div>
          <div><label htmlFor={`${id}-title`} className="mb-1 block text-sm font-bold">Titre *</label><input ref={titleRef} id={`${id}-title`} required disabled={isBusy} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className={fieldClass} /></div>
          <div><label htmlFor={`${id}-description`} className="mb-1 block text-sm font-bold">Description (200 caractères maximum)</label><textarea id={`${id}-description`} rows={3} disabled={isBusy} aria-describedby={`${id}-count`} value={editDesc} onChange={(event) => setEditDesc([...event.target.value].slice(0, 200).join(''))} className={`${fieldClass} resize-none`} /><p id={`${id}-count`} className="mt-1 text-right text-xs text-[#141414]/60">{[...editDesc].length}/200</p></div>
          {actionError && <p role="alert" className="break-words text-sm text-red-700">{actionError}</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-[#f1ece4] pt-3"><button type="button" disabled={isBusy} onClick={closeEditor} className={`${buttonClass} hover:bg-[#f1ece4]`}>Annuler</button><button type="submit" disabled={isBusy || !editTitle.trim()} className={`${buttonClass} bg-[#ff6a2b] text-[#141414] hover:bg-[#ff8a4c]`}>
            {operation === 'saving' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}{operation === 'saving' ? 'Enregistrement…' : 'Enregistrer'}
          </button></div>
        </form>}
      </motion.div>
    </motion.article>
  );
}
