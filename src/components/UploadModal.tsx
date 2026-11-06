import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertCircle, Camera, CheckCircle2, FileText, Images, UploadCloud, X } from 'lucide-react';
import {
  type DocumentItem, MAX_DOCUMENT_SIZE, STATUS_CONFIG, formatFileSize,
  hashUploadFile, prepareUploadDocument, resumeUserDocument, validateClassification,
} from '../lib/supabase';
import {
  attachUploadFiles, canRetryUploadBatch, clearCompletedUploadJournal,
  completeLegacyClassification, createUploadBatch, isUploadBatchComplete,
  needsLegacyClassification, readUploadJournal, runUploadBatch, saveUploadJournal,
  UPLOAD_STAGE_LABELS, type UploadBatch, type UploadBatchReport,
} from '../lib/upload-batch';
import {
  documentTitleFromName, readUploadPreference, saveUploadPreference, uploadSuggestions,
  type UploadClassification,
} from '../lib/upload-preferences';
import { getSupabaseClientState, subscribeSupabaseClient } from '../lib/supabase-config';
import { errorMessage as readableError } from '../lib/errors';
import { useAuth } from '../context/AuthContext';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';
import { useDialogViewport } from '../hooks/useDialogViewport';
import { useIsMobile } from '../hooks/useIsMobile';
import { usePendingNavigation } from '../hooks/usePendingNavigation';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  documents: DocumentItem[];
  onSuccess: (report: UploadBatchReport) => void;
}
const fieldClass = 'w-full min-w-0 min-h-11 rounded-2xl border border-[#141414]/20 bg-white px-3 py-2.5 text-base text-[#141414] placeholder:text-[#141414]/45 focus:border-[#4a6cf0] focus:outline-2 focus:outline-offset-2 focus:outline-[#4a6cf0] disabled:bg-[#f1ece4] disabled:opacity-60';
const buttonClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:cursor-not-allowed disabled:opacity-50';
const journalStorage = () => {
  try { return window.localStorage; }
  catch { throw new Error('Le stockage du navigateur est inaccessible. Autorisez-le puis réessayez ; aucun nouvel envoi n’a été démarré.'); }
};

export function UploadModal({ isOpen, onClose, documents, onSuccess }: UploadModalProps) {
  const { user } = useAuth();
  const clientState = useSyncExternalStore(subscribeSupabaseClient, getSupabaseClientState, getSupabaseClientState);
  const reduceMotion = useReducedMotion();
  const isMobile = useIsMobile();
  const [files, setFiles] = useState<File[]>([]);
  const [titles, setTitles] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [preference, setPreference] = useState<UploadClassification | null>(null);
  const [legacyChoicesConfirmed, setLegacyChoicesConfirmed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [journalWarning, setJournalWarning] = useState<string | null>(null);
  const [preferenceWarning, setPreferenceWarning] = useState<string | null>(null);
  const [journalReady, setJournalReady] = useState(false);
  const [preparationLabel, setPreparationLabel] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const batchRef = useRef<UploadBatch | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const lastOpeningRef = useRef<string | null>(null);
  const currentUserIdRef = useRef(user?.id);
  currentUserIdRef.current = user?.id;
  const reportRef = useRef(onSuccess);
  reportRef.current = onSuccess;

  const publishBatch = (next: UploadBatch | null) => {
    batchRef.current = next;
    if (mountedRef.current) setBatch(next);
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const uploadSuccess = !!batch && isUploadBatchComplete(batch);
  const scopeMatches = !!user && !!clientState.client && (!batch
    || (batch.userId === user.id && batch.projectUrl === clientState.config.url));
  const fieldsLocked = isBusy || !!batch || !journalReady || !scopeMatches;
  const legacyLabelsNeeded = !!batch && needsLegacyClassification(batch);
  const confirmedCount = batch?.entries.filter((entry) => entry.status === 'confirmed').length || 0;
  const suggestions = uploadSuggestions(scopeMatches ? documents : [], schoolName, scopeMatches ? preference : null);
  useDialogAccessibility(modalRef, isOpen, onClose, !isBusy);
  useDialogViewport(viewportRef, isOpen);
  usePendingNavigation(isOpen && isBusy);

  // Une trace incomplète prime sur un nouveau dépôt, même après changement de
  // compte. Aucun changement de props ne réinitialise un formulaire en cours.
  useEffect(() => {
    if (!isOpen) { lastOpeningRef.current = null; return; }
    const opening = `${clientState.generation}:${user?.id || ''}`;
    if (lastOpeningRef.current === opening || busyRef.current) return;
    lastOpeningRef.current = opening;
    setErrorMessage(null);
    setJournalWarning(null);
    setPreferenceWarning(null);
    setJournalReady(false);
    setLegacyChoicesConfirmed(false);
    if (!user || !clientState.client) {
      setErrorMessage('Connectez-vous à un projet configuré avant de déposer ou de reprendre un lot.');
      return;
    }
    const memoryBatch = batchRef.current;
    if (memoryBatch && !isUploadBatchComplete(memoryBatch)) {
      setJournalReady(true);
      return;
    }
    try {
      const storage = journalStorage();
      const saved = readUploadJournal(storage, user.id, clientState.config.url);
      const last = readUploadPreference(storage, user.id, clientState.config.url);
      publishBatch(saved);
      setPreference(last);
      setSchoolName(last?.schoolName || '');
      setSubjectName(last?.subjectName || '');
      setFiles([]);
      setTitles([]);
      setDescription('');
      setJournalReady(true);
    } catch (error) { setErrorMessage(readableError(error)); }
  }, [isOpen, user?.id, clientState.client, clientState.generation, isBusy]);

  const handleFilesChosen = async (incoming: FileList | File[]) => {
    if (busyRef.current || !journalReady || !scopeMatches || uploadSuccess) return;
    const selected = Array.from(incoming);
    if (!selected.length) return;
    setErrorMessage(null);
    if (selected.some((file) => file.size > MAX_DOCUMENT_SIZE)) {
      setErrorMessage('Chaque fichier doit respecter la limite de 20 Mo. La sélection précédente est conservée.');
      return;
    }
    const existing = batchRef.current;
    if (!existing) {
      setFiles(selected);
      setTitles(selected.map((file) => documentTitleFromName(file.name)));
      return;
    }
    const origin = getSupabaseClientState();
    const userId = user?.id;
    busyRef.current = true;
    setIsBusy(true);
    setPreparationLabel('Vérification des fichiers resélectionnés');
    try {
      const updated = await attachUploadFiles(existing, selected, hashUploadFile);
      if (!mountedRef.current || currentUserIdRef.current !== userId
        || getSupabaseClientState().generation !== origin.generation || getSupabaseClientState().client !== origin.client) {
        throw new Error('Le compte ou le projet a changé. Les identifiants d’origine restent conservés.');
      }
      publishBatch(updated);
    } catch (error) { if (mountedRef.current) setErrorMessage(readableError(error)); }
    finally {
      busyRef.current = false;
      if (mountedRef.current) { setIsBusy(false); setPreparationLabel(null); }
    }
  };
  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    void handleFilesChosen(event.dataTransfer.files);
  };
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current || !journalReady || !user || !scopeMatches) return;
    if (!batchRef.current && !files.length) { setErrorMessage('Sélectionnez au moins un fichier.'); return; }
    const origin = getSupabaseClientState();
    const userId = user.id;
    const isCurrent = () => mountedRef.current && currentUserIdRef.current === userId
      && getSupabaseClientState().generation === origin.generation && getSupabaseClientState().client === origin.client;
    busyRef.current = true;
    setIsBusy(true);
    setErrorMessage(null);
    setJournalWarning(null);
    try {
      let working = batchRef.current;
      if (!working) {
        validateClassification(schoolName, subjectName);
        if ([...description].length > 200) throw new Error('La description ne doit pas dépasser 200 caractères.');
        const prepared = [];
        for (let index = 0; index < files.length; index++) {
          setPreparationLabel(`Préparation du fichier ${index + 1} sur ${files.length}`);
          const request = await prepareUploadDocument(files[index], titles[index], description, userId, schoolName, subjectName);
          if (!isCurrent()) throw new Error('Le compte ou le projet a changé pendant la préparation. Aucun nouvel envoi n’a été démarré.');
          prepared.push({ request, file: files[index] });
        }
        working = createUploadBatch(userId, origin.config.url, prepared);
        publishBatch(working);
      } else if (needsLegacyClassification(working) && legacyChoicesConfirmed) {
        validateClassification(schoolName, subjectName);
        working = completeLegacyClassification(working, schoolName, subjectName);
      }
      // Les choix legacy ne sont figés en mémoire qu'après confirmation de leur
      // extension autorisée dans la trace. Aucun effet distant ne la précède.
      const storage = journalStorage();
      saveUploadJournal(storage, working);
      publishBatch(working);
      const labels = working.entries.find((entry) => entry.request.schoolName !== null && entry.request.subjectName !== null)?.request;
      if (labels?.schoolName && labels.subjectName) {
        const last = { schoolName: labels.schoolName, subjectName: labels.subjectName };
        setPreference(last);
        if (!saveUploadPreference(storage, userId, origin.config.url, last)) {
          setPreferenceWarning('Le dépôt peut continuer, mais le dernier choix d’école et de matière n’a pas pu être mémorisé.');
        }
      }
      setPreparationLabel(null);
      const result = await runUploadBatch(working, { generation: origin.generation, isCurrent, uploadDocument: resumeUserDocument },
        publishBatch, (report) => { if (isCurrent()) reportRef.current(report); });
      publishBatch(result);
      if (isUploadBatchComplete(result)) {
        try { clearCompletedUploadJournal(storage, result); }
        catch (error) { if (mountedRef.current) setJournalWarning(readableError(error)); }
      }
    } catch (error) { if (mountedRef.current) setErrorMessage(readableError(error)); }
    finally {
      busyRef.current = false;
      if (mountedRef.current) { setIsBusy(false); setPreparationLabel(null); }
    }
  };
  const chooseInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void handleFilesChosen(event.target.files);
    event.target.value = '';
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div ref={viewportRef} className="fixed left-0 right-0 z-50 flex items-end justify-center overflow-hidden pt-4 md:items-center md:p-6"
          style={{ top: 'var(--dialog-viewport-top, 0px)', height: 'var(--dialog-viewport-height, 100dvh)' }}>
          <motion.div aria-hidden="true" className="fixed inset-0 bg-[#141414]/45 backdrop-blur-xs"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18 }}
            onClick={() => { if (!busyRef.current) onClose(); }} />
          <motion.div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="upload-title" aria-describedby="upload-help" aria-busy={isBusy} tabIndex={-1}
            initial={reduceMotion ? { opacity: 1 } : isMobile ? { y: '100%' } : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 1 } : isMobile ? { y: '100%' } : { opacity: 0, y: 8 }}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }}
            className="relative z-10 flex w-full min-w-0 max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-[#f1ece4] shadow-[0_18px_40px_rgba(10,16,60,0.35)] md:rounded-[28px]"
            style={{ maxHeight: 'calc(var(--dialog-viewport-height, 100dvh) - 16px)' }}>
            <header className="flex shrink-0 items-start justify-between gap-2 border-b border-[#141414]/10 px-4 py-3 md:px-6">
              <div className="min-w-0">
                <h2 id="upload-title" className="text-xl font-extrabold tracking-tight">{batch ? 'Votre dépôt' : 'Déposer un fichier'}</h2>
                <p id="upload-help" className="mt-1 text-sm text-[#141414]/65">
                  {batch ? 'Vos identifiants d’origine sont conservés pour la reprise.' : 'Pour vous dès confirmation, pour les autres après approbation.'}
                </p>
              </div>
              <button type="button" onClick={onClose} disabled={isBusy} aria-label="Fermer le dépôt" className={`${buttonClass} shrink-0 px-2 hover:bg-[#141414]/5`}><X aria-hidden="true" size={20} /></button>
            </header>
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
              <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 md:px-6">
                {errorMessage && <p role="alert" className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle aria-hidden="true" size={18} className="mt-0.5 shrink-0" /><span className="min-w-0 break-words">{errorMessage}</span></p>}
                {journalWarning && <p role="status" className="break-words text-sm text-[#946200]">{journalWarning}</p>}
                {preferenceWarning && <p role="status" className="text-sm text-[#141414]/75">{preferenceWarning}</p>}
                {batch?.notificationError && <p role="alert" className="break-words text-sm text-red-700">{batch.notificationError}</p>}
                {!scopeMatches && batch && <p role="alert" className="text-sm text-red-700">Ce lot appartient à un autre compte ou projet. Rétablissez sa session d’origine ; aucun nouveau lot ne remplacera sa trace.</p>}
                {!journalReady && <button type="button" disabled={isBusy} onClick={onClose} className={`${buttonClass} w-full bg-white text-[#4a6cf0]`}>Fermer et réessayer après autorisation du stockage</button>}

                <input ref={fileInputRef} type="file" multiple className="hidden" aria-label="Choisir les fichiers" onChange={chooseInput} disabled={isBusy || !journalReady || !scopeMatches || uploadSuccess} />
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Prendre une photo" onChange={chooseInput} disabled={fieldsLocked} />
                <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden" aria-label="Choisir des images de la galerie" onChange={chooseInput} disabled={fieldsLocked} />
                <div onDragOver={(event) => { event.preventDefault(); if (!isBusy && journalReady && scopeMatches && !uploadSuccess) setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}
                  className={`min-w-0 rounded-[24px] border-2 border-dashed p-4 ${isDragging ? 'border-[#4a6cf0] bg-[#4a6cf0]/10' : 'border-[#141414]/20 bg-white/65'}`}>
                  {batch ? (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">{batch.entries.length} fichier(s) dans le lot conservé</p>
                      {!uploadSuccess && <>
                        <p className="text-sm text-[#141414]/65">La reprise vérifie d’abord ce qui est déjà présent. Resélectionnez les originaux uniquement si nécessaire.</p>
                        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy || !journalReady || !scopeMatches || !canRetryUploadBatch(batch)} className={`${buttonClass} w-full border border-[#141414]/20 bg-white`}>Resélectionner les originaux</button>
                      </>}
                    </div>
                  ) : (
                    <div className="space-y-3 text-center">
                      <UploadCloud aria-hidden="true" className="mx-auto text-[#ff6a2b]" size={30} />
                      <p className="text-sm font-semibold">{files.length ? `${files.length} fichier(s) sélectionné(s)` : 'Choisissez ou glissez vos fichiers'}</p>
                      <p className="text-xs text-[#141414]/65">PDF, images et documents · 20 Mo par fichier</p>
                      <button type="button" data-autofocus disabled={fieldsLocked} onClick={() => fileInputRef.current?.click()} className={`${buttonClass} w-full border border-[#141414]/20 bg-white`}>
                        {files.length ? 'Changer la sélection' : 'Choisir des fichiers'}
                      </button>
                      <div className="grid grid-cols-2 gap-2 md:hidden">
                        <button type="button" disabled={fieldsLocked} onClick={() => cameraInputRef.current?.click()} className={`${buttonClass} border border-[#141414]/20 bg-white px-2`}><Camera aria-hidden="true" size={18} className="shrink-0" />Photo</button>
                        <button type="button" disabled={fieldsLocked} onClick={() => galleryInputRef.current?.click()} className={`${buttonClass} border border-[#141414]/20 bg-white px-2`}><Images aria-hidden="true" size={18} className="shrink-0" />Galerie</button>
                      </div>
                    </div>
                  )}
                </div>

                {!batch && files.length > 0 && (
                  <fieldset disabled={fieldsLocked} className="min-w-0 space-y-3">
                    <legend className="sr-only">Titres des fichiers</legend>
                    {files.map((file, index) => (
                      <div key={index} className="min-w-0">
                        <label htmlFor={`upload-file-title-${index}`} className="mb-1.5 block text-sm font-semibold">{files.length === 1 ? 'Titre' : `Titre du fichier ${index + 1}`}</label>
                        <input id={`upload-file-title-${index}`} type="text" required value={titles[index] || ''}
                          onChange={(event) => setTitles((current) => current.map((title, position) => position === index ? event.target.value : title))} className={fieldClass} />
                        <p className="mt-1 flex min-w-0 items-start gap-1 text-xs text-[#141414]/60"><FileText aria-hidden="true" size={14} className="mt-0.5 shrink-0" /><span className="min-w-0 break-all">{file.name} · {formatFileSize(file.size)}</span></p>
                      </div>
                    ))}
                  </fieldset>
                )}
                {(!batch || legacyLabelsNeeded) && (
                  <fieldset disabled={isBusy || !journalReady || !scopeMatches} className="min-w-0 space-y-3">
                    <legend className="sr-only">École et matière</legend>
                    {legacyLabelsNeeded && <p className="rounded-2xl bg-[#ffd23f]/20 p-3 text-sm">Vous pouvez d’abord vérifier les fichiers déjà enregistrés sans leur attribuer de nouveaux libellés. Pour terminer les fichiers encore absents, choisissez explicitement une école et une matière.</p>}
                    <div>
                      <label htmlFor="upload-school" className="mb-1.5 block text-sm font-semibold">École</label>
                      <input id="upload-school" type="text" list="upload-schools" autoComplete="off" required={!batch || legacyChoicesConfirmed} value={schoolName}
                        onChange={(event) => setSchoolName(event.target.value)} aria-describedby="upload-label-help" className={fieldClass} placeholder="Nom de votre école" />
                      <datalist id="upload-schools">{suggestions.schools.map((name) => <option key={name} value={name} />)}</datalist>
                    </div>
                    <div>
                      <label htmlFor="upload-subject" className="mb-1.5 block text-sm font-semibold">Matière</label>
                      <input id="upload-subject" type="text" list="upload-subjects" autoComplete="off" required={!batch || legacyChoicesConfirmed} value={subjectName}
                        onChange={(event) => setSubjectName(event.target.value)} aria-describedby="upload-label-help" className={fieldClass} placeholder="Ex. Mathématiques" />
                      <datalist id="upload-subjects">{suggestions.subjects.map((name) => <option key={name} value={name} />)}</datalist>
                    </div>
                    <p id="upload-label-help" className="text-xs text-[#141414]/65">Choisissez une suggestion ou saisissez un nom, jusqu’à 120 caractères. Ces choix seront conservés pour votre prochain dépôt.</p>
                    {legacyLabelsNeeded && <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-[#141414]/20 bg-white p-3 text-sm">
                      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#4a6cf0]" checked={legacyChoicesConfirmed} onChange={(event) => setLegacyChoicesConfirmed(event.target.checked)} />
                      <span>Utiliser ces choix pour terminer les fichiers encore absents. Ils seront ensuite figés dans la trace de reprise.</span>
                    </label>}
                  </fieldset>
                )}
                {!batch && (
                  <details className="min-w-0 rounded-2xl border border-[#141414]/15 bg-white/60">
                    <summary className="flex min-h-11 cursor-pointer items-center px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[#4a6cf0]">Ajouter une description (facultatif)</summary>
                    <div className="space-y-1.5 px-3 pb-3">
                      <label htmlFor="upload-description" className="sr-only">Description facultative</label>
                      <textarea id="upload-description" rows={3} disabled={fieldsLocked} value={description} aria-describedby="upload-description-count"
                        onChange={(event) => setDescription([...event.target.value].slice(0, 200).join(''))} className={`${fieldClass} resize-y`} placeholder="Contexte ou mots-clés" />
                      <p id="upload-description-count" className="text-right text-xs text-[#141414]/65">{[...description].length}/200 caractères</p>
                    </div>
                  </details>
                )}
                {preparationLabel && <p role="status" className="text-sm text-[#141414]/75">{preparationLabel}</p>}
                {batch && (
                  <section aria-labelledby="upload-report-title" className="space-y-3">
                    <h3 id="upload-report-title" className="text-sm font-bold">Bilan du dépôt</h3>
                    <p role="status" aria-live="polite" className={`rounded-2xl p-3 text-sm ${uploadSuccess ? 'bg-emerald-50 font-semibold text-emerald-800' : 'bg-white/60 text-[#141414]/80'}`}>
                      {confirmedCount} sur {batch.entries.length} fichier(s) confirmé(s), fichier et métadonnées.
                      {uploadSuccess && ' Votre dépôt est confirmé. Vous pouvez fermer.'}
                    </p>
                    <ul className="space-y-2">
                      {batch.entries.map((entry) => (
                        <li key={entry.request.identity.id} className="flex min-w-0 items-start gap-2 rounded-2xl border border-[#141414]/15 bg-white/65 p-3">
                          {entry.status === 'confirmed' && <CheckCircle2 aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-emerald-700" />}
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm font-semibold">{entry.request.title}</p>
                            <p className="break-all text-xs text-[#141414]/65">{entry.request.fileName} · {formatFileSize(entry.request.fileSize)}</p>
                            {entry.request.schoolName && <p className="mt-1 break-words text-xs text-[#141414]/65">{entry.request.schoolName} · {entry.request.subjectName}</p>}
                            <p className="mt-1 text-xs text-[#141414]/75">{entry.status === 'pending' ? 'En attente de vérification' : UPLOAD_STAGE_LABELS[entry.stage]}</p>
                            {entry.document && <p className="mt-1 text-xs font-semibold">{entry.document.deleted_at ? 'Dans la corbeille' : STATUS_CONFIG[entry.document.status].label}</p>}
                            {entry.error && <p role="alert" className="mt-2 break-words text-sm text-red-700">{entry.error}</p>}
                            {entry.failureKind === 'conflict' && <p className="mt-1 text-xs text-red-700">Ce conflit doit être vérifié avant toute autre écriture. Ce fichier ne sera pas relancé automatiquement.</p>}
                            {entry.failureKind === 'uncertain' && <p className="mt-1 text-xs text-[#141414]/75">La reprise vérifiera les mêmes identifiants, sans écrasement ni suppression aveugle.</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {!uploadSuccess && <p className="text-xs text-[#141414]/65">Les réussites ne seront pas renvoyées. Vous pouvez fermer puis reprendre avec ce navigateur, le compte et le projet d’origine. La trace locale n’est pas un journal serveur : ne supprimez pas les données du site.</p>}
                  </section>
                )}
              </div>
              <footer className="safe-bottom flex shrink-0 flex-wrap items-center gap-2 border-t border-[#141414]/10 bg-[#f1ece4] px-4 pt-3 md:px-6">
                <button type="button" disabled={isBusy} onClick={onClose} className={`${buttonClass} bg-white/65`}>{batch ? 'Fermer' : 'Annuler'}</button>
                {(!uploadSuccess || batch?.notificationError || journalWarning) && <button type="submit"
                  disabled={isBusy || !journalReady || !scopeMatches || (batch ? !uploadSuccess && !canRetryUploadBatch(batch) : !files.length)}
                  className={`${buttonClass} min-w-0 flex-1 bg-[#ff6a2b] text-[#141414] hover:bg-[#ff8a4c]`}>
                  {isBusy ? 'Vérification en cours…' : uploadSuccess ? 'Actualiser le bilan' : batch ? 'Vérifier et reprendre' : 'Déposer'}
                </button>}
              </footer>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
