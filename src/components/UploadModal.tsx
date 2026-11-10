import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
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
import { userError } from '../lib/errors';
import { prepareMobileUploadFile, UPLOAD_FILE_ACCEPT, UPLOAD_IMAGE_ACCEPT } from '../lib/upload-files';
import { createUploadDraftPersistence, reconcileUploadDraftBatch, UploadDraftConflictError, type UploadDraftInput } from '../lib/upload-draft';
import { useAuth } from '../context/AuthContext';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';
import { useDialogViewport } from '../hooks/useDialogViewport';
import { useIsMobile } from '../hooks/useIsMobile';
import { PendingNavigationGuard } from '../hooks/usePendingNavigation';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  documents: DocumentItem[];
  onSuccess: (report: UploadBatchReport) => void;
}
const fieldClass = 'w-full min-w-0 min-h-11 rounded-2xl border-0 bg-[#e9e3da] px-3 py-2.5 text-base text-[#141414] caret-[#141414] placeholder:text-[#141414]/45 outline-none ring-0 focus:bg-[#dfd8ce] focus:outline-none focus:ring-0 disabled:opacity-60';
const buttonClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b] disabled:cursor-not-allowed disabled:opacity-50';
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
  const [draftStatus, setDraftStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [isRetryingDraft, setIsRetryingDraft] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [draftScope, setDraftScope] = useState<string | null>(null);
  const [draftReadAttempt, setDraftReadAttempt] = useState(0);
  const pickerId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const batchRef = useRef<UploadBatch | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const lastOpeningRef = useRef<string | null>(null);
  const closedSinceReadRef = useRef(true);
  const draftScopeKeyRef = useRef<string | null>(null);
  const draftRef = useRef<ReturnType<typeof createUploadDraftPersistence> | null>(null);
  const draftSnapshotRef = useRef<UploadDraftInput>({ files: [], titles: [], description: '', schoolName: '', subjectName: '', batch: null });
  const draftSequenceRef = useRef(0);
  const draftRetryRef = useRef(false);
  const currentUserIdRef = useRef(user?.id);
  const isOpenRef = useRef(isOpen);
  currentUserIdRef.current = user?.id;
  isOpenRef.current = isOpen;
  const reportRef = useRef(onSuccess);
  reportRef.current = onSuccess;
  draftSnapshotRef.current = { files, titles, description, schoolName, subjectName, batch };

  const publishBatch = useCallback((next: UploadBatch | null) => {
    batchRef.current = next;
    draftSnapshotRef.current = { ...draftSnapshotRef.current, batch: next };
    if (mountedRef.current) setBatch(next);
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const uploadSuccess = !!batch && isUploadBatchComplete(batch);
  const scopeMatches = !!user && !!clientState.client && draftScope === `${clientState.generation}:${user.id}` && (!batch
    || (batch.userId === user.id && batch.projectUrl === clientState.config.url));
  const fieldsLocked = isBusy || isRetryingDraft || !!batch || !journalReady || !scopeMatches;
  const legacyLabelsNeeded = !!batch && needsLegacyClassification(batch);
  const confirmedCount = batch?.entries.filter((entry) => entry.status === 'confirmed').length || 0;
  const suggestions = uploadSuggestions(scopeMatches ? documents : [], schoolName, scopeMatches ? preference : null);
  useDialogAccessibility(modalRef, isOpen, onClose, !isBusy);
  useDialogViewport(viewportRef, isOpen);
  // Un seul blocker monté à la fois : le panneau de détail en possède aussi un.
  // Le dépôt reste monté (journal et sélection), mais son blocker ne l'est que
  // pendant son ouverture.

  // Le brouillon et le journal historique sont lus avant toute sauvegarde ou
  // nouveau dépôt. Une ancienne fenêtre ne peut pas écraser une autre reprise.
  useEffect(() => {
    if (!isOpen) { lastOpeningRef.current = null; closedSinceReadRef.current = true; return; }
    const opening = `${clientState.generation}:${user?.id || ''}`;
    if (lastOpeningRef.current === opening || busyRef.current) return;
    lastOpeningRef.current = opening;
    const wasClosed = closedSinceReadRef.current;
    closedSinceReadRef.current = false;
    if (draftScopeKeyRef.current === opening && draftRef.current
      && !(wasClosed && batchRef.current && isUploadBatchComplete(batchRef.current))) return;
    setErrorMessage(null);
    setJournalWarning(null);
    setPreferenceWarning(null);
    setJournalReady(false);
    setDraftScope(null);
    setDraftStatus('loading');
    draftRetryRef.current = false;
    setIsRetryingDraft(false);
    setRestoredDraft(false);
    setLegacyChoicesConfirmed(false);
    draftRef.current = null;
    draftScopeKeyRef.current = null;
    draftSequenceRef.current++;
    if (!user || !clientState.client) {
      setErrorMessage('Reconnectez-vous pour déposer ou reprendre vos fichiers.');
      setDraftStatus('error');
      return;
    }
    const memoryBatch = batchRef.current;
    if (memoryBatch && !isUploadBatchComplete(memoryBatch) && (memoryBatch.userId !== user.id
      || memoryBatch.projectUrl !== clientState.config.url)) {
      setErrorMessage('Reconnectez-vous au compte utilisé pour ce dépôt afin de le reprendre.');
      setDraftStatus('error');
      return;
    }
    const scope = { userId: user.id, projectUrl: clientState.config.url };
    const persistence = createUploadDraftPersistence(scope);
    draftRef.current = persistence;
    const isCurrent = () => mountedRef.current && isOpenRef.current
      && currentUserIdRef.current === scope.userId && draftRef.current === persistence
      && getSupabaseClientState().generation === clientState.generation;
    void (async () => {
      try {
        const storage = journalStorage();
        const savedBatch = readUploadJournal(storage, scope.userId, scope.projectUrl);
        const last = readUploadPreference(storage, scope.userId, scope.projectUrl);
        const savedDraft = await persistence.read();
        if (!isCurrent()) return;
        let formDraft = savedDraft;
        const incompleteMemory = memoryBatch && !isUploadBatchComplete(memoryBatch) ? memoryBatch : null;
        let restoredBatch = await reconcileUploadDraftBatch(scope, savedDraft, savedBatch, incompleteMemory, hashUploadFile);
        if (!isCurrent()) return;
        // Une fin confirmée ne devient un nouveau formulaire qu'après retrait
        // effectif des deux copies. Si le retrait échoue, conserver la reprise.
        if (memoryBatch && isUploadBatchComplete(memoryBatch)
          && memoryBatch.userId === scope.userId && memoryBatch.projectUrl === scope.projectUrl
          && (savedBatch || savedDraft?.batch)) {
          restoredBatch = await reconcileUploadDraftBatch(scope, savedDraft, savedBatch, memoryBatch, hashUploadFile);
          if (!isCurrent()) return;
          if (restoredBatch && isUploadBatchComplete(restoredBatch)) {
            await persistence.clear(restoredBatch);
            clearCompletedUploadJournal(storage, restoredBatch);
            if (!isCurrent()) return;
            restoredBatch = null;
            formDraft = null;
          }
        }
        const labels = restoredBatch?.entries.find((entry) => entry.request.schoolName && entry.request.subjectName)?.request;
        const snapshot: UploadDraftInput = {
          files: restoredBatch ? [] : formDraft?.files || [],
          titles: restoredBatch ? [] : formDraft?.titles || [],
          description: formDraft?.description || '',
          schoolName: labels?.schoolName || formDraft?.schoolName || last?.schoolName || '',
          subjectName: labels?.subjectName || formDraft?.subjectName || last?.subjectName || '',
          batch: restoredBatch,
        };
        draftSnapshotRef.current = snapshot;
        publishBatch(restoredBatch);
        setPreference(last);
        setFiles(snapshot.files);
        setTitles(snapshot.titles);
        setDescription(snapshot.description);
        setSchoolName(snapshot.schoolName);
        setSubjectName(snapshot.subjectName);
        setRestoredDraft(!!restoredBatch || !!formDraft && formDraft.files.length > 0);
        setDraftStatus(formDraft ? 'saved' : 'saving');
        draftScopeKeyRef.current = opening;
        setDraftScope(opening);
        setJournalReady(true);
      } catch (error) {
        if (!isCurrent()) return;
        setDraftStatus('error');
        setErrorMessage(userError(error, 'Votre dépôt conservé ne peut pas être ouvert. Fermez les autres onglets puis réessayez ; ne supprimez pas les données du site.'));
      }
    })();
    return () => { if (lastOpeningRef.current === opening) lastOpeningRef.current = null; };
  }, [isOpen, user?.id, clientState.client, clientState.config.url, clientState.generation, draftReadAttempt, isBusy, publishBatch]);

  const persistDraft = useCallback(async (snapshot: UploadDraftInput, retry = false): Promise<void> => {
    const persistence = draftRef.current;
    const userId = currentUserIdRef.current;
    const origin = getSupabaseClientState();
    if (!persistence || !userId || !origin.client) throw new Error('Le brouillon n’est pas encore disponible.');
    if (retry && draftRetryRef.current) return;
    const scopeKey = `${origin.generation}:${userId}`;
    const sequence = ++draftSequenceRef.current;
    // La file FIFO doit pouvoir finir les saisies du même compte. Le numéro de
    // séquence protège seulement leur retour à l'écran, pas leur persistance.
    const isScopeCurrent = () => mountedRef.current && draftRef.current === persistence
      && draftScopeKeyRef.current === scopeKey && currentUserIdRef.current === userId
      && getSupabaseClientState().generation === origin.generation && getSupabaseClientState().client === origin.client;
    const isCurrent = () => isScopeCurrent() && sequence === draftSequenceRef.current;
    if (isCurrent()) {
      setDraftStatus('saving');
      if (retry) { draftRetryRef.current = true; setIsRetryingDraft(true); }
    }
    try {
      const saved = retry
        ? await persistence.retry(snapshot, {
          readJournal: () => readUploadJournal(journalStorage(), userId, origin.config.url),
          hashFile: hashUploadFile, isCurrent: isScopeCurrent,
        })
        : await persistence.save(snapshot, isScopeCurrent);
      if (!isCurrent()) return;
      if (retry) {
        // Conserver les saisies locales. Seuls le lot rapproché et une éventuelle
        // classification historique déjà figée remplacent leur copie en mémoire.
        draftSnapshotRef.current = { ...snapshot, batch: saved.batch,
          schoolName: saved.schoolName, subjectName: saved.subjectName };
        publishBatch(saved.batch);
        setSchoolName(saved.schoolName);
        setSubjectName(saved.subjectName);
      }
      setDraftStatus('saved');
    } catch (error) {
      if (isCurrent()) setDraftStatus('error');
      throw error;
    } finally {
      if (retry && isScopeCurrent()) { draftRetryRef.current = false; setIsRetryingDraft(false); }
    }
  }, [publishBatch]);
  const saveDraftWithFeedback = useCallback((snapshot: UploadDraftInput, retry = false): Promise<void> => {
    const persistence = draftRef.current;
    const pending = persistDraft(snapshot, retry);
    const sequence = draftSequenceRef.current;
    const userId = currentUserIdRef.current;
    const generation = getSupabaseClientState().generation;
    return pending.catch((error) => {
      if (mountedRef.current && draftRef.current === persistence && sequence === draftSequenceRef.current
        && currentUserIdRef.current === userId && getSupabaseClientState().generation === generation) {
        setErrorMessage(userError(error, error instanceof UploadDraftConflictError
          ? 'Un autre dépôt est conservé sur cet appareil. Vos saisies restent dans cette page ; vérifiez les autres onglets puis réessayez sans effacer les données du site.'
          : 'Le brouillon n’a pas pu être conservé. Vérifiez l’espace disponible puis réessayez avant de quitter cette page.'));
      }
    });
  }, [persistDraft]);
  // Sauvegarde immédiate et ordonnée, aussi quand le panneau vient d'être fermé.
  // Une suspension Android laisse au pire une sauvegarde non confirmée : le
  // statut reste honnête et le sélecteur attend cette confirmation.
  useEffect(() => {
    if (!journalReady || !scopeMatches || isBusy || draftRetryRef.current || uploadSuccess) return;
    void saveDraftWithFeedback(draftSnapshotRef.current);
  }, [files, titles, description, schoolName, subjectName, journalReady, scopeMatches, isBusy, uploadSuccess, batch?.id, saveDraftWithFeedback]);

  useEffect(() => {
    const onPageHide = () => {
      const persistence = draftRef.current;
      const userId = currentUserIdRef.current;
      const origin = getSupabaseClientState();
      if (!journalReady || !scopeMatches || uploadSuccess || !persistence || !userId || !origin.client) return;
      const scopeKey = `${origin.generation}:${userId}`;
      const isCurrent = () => mountedRef.current && draftRef.current === persistence
        && draftScopeKeyRef.current === scopeKey && currentUserIdRef.current === userId
        && getSupabaseClientState().generation === origin.generation && getSupabaseClientState().client === origin.client;
      // Best effort seulement : IndexedDB est déjà alimenté après chaque saisie.
      void persistence.save(draftSnapshotRef.current, isCurrent).catch(() => undefined);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [journalReady, scopeMatches, uploadSuccess]);

  const handleFilesChosen = async (incoming: FileList | File[]) => {
    if (busyRef.current || draftRetryRef.current || !journalReady || !scopeMatches || uploadSuccess || draftStatus !== 'saved') return;
    const selected = Array.from(incoming);
    if (!selected.length) return;
    setErrorMessage(null);
    if (selected.some((file) => file.size > MAX_DOCUMENT_SIZE)) {
      setErrorMessage('Chaque fichier est limité à 20 Mo. Choisissez un fichier plus léger ; la sélection précédente est conservée.');
      return;
    }
    const existing = batchRef.current;
    const origin = getSupabaseClientState();
    const userId = user?.id;
    const persistence = draftRef.current;
    const isCurrent = () => mountedRef.current && currentUserIdRef.current === userId
      && getSupabaseClientState().generation === origin.generation && getSupabaseClientState().client === origin.client
      && draftRef.current === persistence;
    busyRef.current = true;
    setIsBusy(true);
    setPreparationLabel(existing ? 'Vérification de votre sélection' : 'Préparation des fichiers…');
    try {
      if (existing) {
        // Les octets d'une reprise ne sont jamais recompressés.
        const updated = await attachUploadFiles(existing, selected, hashUploadFile);
        if (!isCurrent()) throw new Error('Le compte du dépôt a changé pendant la sélection.');
        await persistDraft({ ...draftSnapshotRef.current, batch: updated });
        if (!isCurrent()) throw new Error('Le compte du dépôt a changé pendant la sauvegarde.');
        publishBatch(updated);
      } else {
        const prepared: File[] = [];
        for (let index = 0; index < selected.length; index++) {
          setPreparationLabel(`Préparation du fichier ${index + 1} sur ${selected.length}`);
          prepared.push(await prepareMobileUploadFile(selected[index]));
          if (!isCurrent()) throw new Error('Le compte du dépôt a changé pendant la préparation.');
        }
        const nextTitles = prepared.map((file) => documentTitleFromName(file.name));
        const snapshot = { ...draftSnapshotRef.current, files: prepared, titles: nextTitles, batch: null };
        await persistDraft(snapshot);
        if (!isCurrent()) throw new Error('Le compte du dépôt a changé pendant la sauvegarde.');
        draftSnapshotRef.current = snapshot;
        setFiles(prepared);
        setTitles(nextTitles);
        setRestoredDraft(false);
      }
    } catch (error) {
      if (isCurrent()) setErrorMessage(userError(error, existing
        ? 'Ces fichiers n’ont pas pu être repris. Choisissez les mêmes fichiers que lors du premier envoi, puis réessayez.'
        : 'Ces fichiers n’ont pas pu être préparés ou conservés. Vérifiez leur format et l’espace disponible, puis réessayez ; votre sélection précédente est conservée.'));
    } finally {
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
    if (busyRef.current || draftRetryRef.current || !journalReady || !user || !scopeMatches || (!uploadSuccess && draftStatus !== 'saved')) return;
    if (uploadSuccess) {
      // Actualiser l'affichage ou finir le nettoyage ne recrée pas le brouillon
      // d'un lot dont la confirmation a déjà été reçue.
      const completed = batchRef.current;
      const persistence = draftRef.current;
      const origin = getSupabaseClientState();
      if (!completed || !persistence) return;
      const isCurrent = () => mountedRef.current && currentUserIdRef.current === completed.userId
        && draftRef.current === persistence && getSupabaseClientState().generation === origin.generation;
      busyRef.current = true;
      setIsBusy(true);
      setErrorMessage(null);
      try {
        reportRef.current({ userId: completed.userId, projectUrl: completed.projectUrl, generation: origin.generation,
          documents: completed.entries.flatMap((entry) => entry.document ? [entry.document] : []),
          entries: completed.entries, complete: true });
        await persistence.clear(completed);
        if (!isCurrent()) return;
        clearCompletedUploadJournal(journalStorage(), completed);
        publishBatch({ ...completed, notificationError: null });
        setJournalWarning(null);
      } catch (error) {
        if (isCurrent()) setErrorMessage(userError(error, 'Vos fichiers sont envoyés. La liste ou le brouillon n’a pas pu être actualisé ; réessayez sans renvoyer les fichiers.'));
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setIsBusy(false);
      }
      return;
    }
    if (!batchRef.current && !files.length) { setErrorMessage('Sélectionnez au moins un fichier.'); return; }
    if (!navigator.onLine) {
      setErrorMessage('Vous êtes hors ligne. Retrouvez une connexion puis réessayez ; votre dépôt reste conservé sur cet appareil.');
      return;
    }
    if (!batchRef.current && (!schoolName.trim() || !subjectName.trim())) {
      setErrorMessage('Renseignez une école et une matière.');
      return;
    }
    if (!batchRef.current && titles.some((title) => !title.trim())) {
      setErrorMessage('Donnez un titre à chaque fichier.');
      return;
    }
    const origin = getSupabaseClientState();
    const userId = user.id;
    const persistence = draftRef.current;
    const isCurrent = () => mountedRef.current && currentUserIdRef.current === userId
      && getSupabaseClientState().generation === origin.generation && getSupabaseClientState().client === origin.client
      && draftRef.current === persistence;
    busyRef.current = true;
    setIsBusy(true);
    setErrorMessage(null);
    setJournalWarning(null);
    try {
      // Le brouillon complet (octets compris) est confirmé avant de préparer
      // l'identité et avant le moindre transfert distant.
      await persistDraft(draftSnapshotRef.current);
      if (!isCurrent()) throw new Error('Le compte du dépôt a changé.');
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
      } else if (needsLegacyClassification(working) && legacyChoicesConfirmed) {
        validateClassification(schoolName, subjectName);
        working = completeLegacyClassification(working, schoolName, subjectName);
      }
      // Les choix legacy ne sont figés en mémoire qu'après confirmation de leur
      // extension autorisée dans la trace. Aucun effet distant ne la précède.
      const storage = journalStorage();
      saveUploadJournal(storage, working);
      // Figer l'identité dès que le journal est confirmé. Un échec IndexedDB
      // doit ensuite reprendre ce lot, pas créer de nouveaux UUID.
      publishBatch(working);
      await persistDraft({ ...draftSnapshotRef.current, batch: working });
      if (!isCurrent()) throw new Error('Le compte du dépôt a changé avant l’envoi.');
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
        try {
          await persistence?.clear(result);
          clearCompletedUploadJournal(storage, result);
        } catch (error) {
          if (isCurrent()) setJournalWarning(userError(error, 'Vos fichiers sont envoyés, mais leur brouillon est encore conservé. Il sera vérifié lors de votre prochaine ouverture.'));
        }
      }
    } catch (error) {
      if (isCurrent()) setErrorMessage(userError(error, 'L’envoi n’a pas pu être terminé. Les fichiers déjà reçus ne seront pas renvoyés. Réessayez avant de quitter cette page ; les dernières saisies ne sont conservées sur l’appareil qu’après confirmation du brouillon.'));
    }
    finally {
      busyRef.current = false;
      if (mountedRef.current) { setIsBusy(false); setPreparationLabel(null); }
    }
  };
  const chooseInput = (event: ChangeEvent<HTMLInputElement>) => {
    // Copier FileList avant de vider l'input : certains navigateurs invalident
    // la liste native aussitôt après, notamment après la caméra.
    const selected = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = '';
    void handleFilesChosen(selected);
  };
  const pickerLocked = isBusy || isRetryingDraft || !journalReady || !scopeMatches || uploadSuccess
    || draftStatus !== 'saved' || (!!batch && !canRetryUploadBatch(batch));

  return (
    <>
      {isOpen && <PendingNavigationGuard busy={isBusy} />}
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
                  {batch ? 'Reprenez votre envoi sans renvoyer les fichiers déjà reçus.' : 'Pour vous dès confirmation, pour les autres après approbation.'}
                </p>
              </div>
              <button type="button" onClick={onClose} disabled={isBusy} aria-label="Fermer le dépôt" className={`${buttonClass} shrink-0 px-2 hover:bg-[#141414]/5`}><X aria-hidden="true" size={20} /></button>
            </header>
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
              <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 md:px-6">
                {errorMessage && <div role="alert" className="space-y-2 rounded-2xl bg-[#e9e3da] p-3 text-sm text-[#b0245e]">
                  <p className="flex items-start gap-2"><AlertCircle aria-hidden="true" size={18} className="mt-0.5 shrink-0" /><span className="min-w-0 break-words">{errorMessage}</span></p>
                  {(!journalReady || draftStatus === 'error') && <button type="button" disabled={isBusy || isRetryingDraft || draftStatus === 'saving'} className={`${buttonClass} bg-white/65 text-[#141414]`}
                    onClick={() => {
                      if (busyRef.current || draftRetryRef.current || draftStatus === 'saving') return;
                      setErrorMessage(null);
                      if (journalReady && scopeMatches) {
                        void saveDraftWithFeedback(draftSnapshotRef.current, true);
                      } else {
                        lastOpeningRef.current = null;
                        draftScopeKeyRef.current = null;
                        setDraftReadAttempt((attempt) => attempt + 1);
                      }
                    }}>Réessayer</button>}
                </div>}
                {journalWarning && <p role="status" className="break-words text-sm text-[#141414]/75">{journalWarning}</p>}
                {preferenceWarning && <p role="status" className="text-sm text-[#141414]/75">{preferenceWarning}</p>}
                {batch?.notificationError && <p role="alert" className="break-words text-sm text-[#b0245e]">{batch.notificationError}</p>}
                {!scopeMatches && batch && <p role="alert" className="text-sm text-[#b0245e]">Reconnectez-vous au compte utilisé pour ce dépôt afin de le reprendre.</p>}
                {restoredDraft && <p role="status" className="rounded-2xl bg-[#ffd23f]/20 p-3 text-sm">Votre brouillon a été retrouvé. Vérifiez vos choix puis reprenez l’envoi.</p>}
                {journalReady && !uploadSuccess && <p role="status" className="text-xs text-[#141414]/65">
                  {draftStatus === 'saved' ? 'Brouillon conservé sur cet appareil.' : draftStatus === 'saving' ? 'Sauvegarde du brouillon…' : draftStatus === 'error' ? 'Le brouillon n’a pas pu être sauvegardé.' : 'Ouverture du brouillon…'}
                </p>}

                <div onDragOver={(event) => { event.preventDefault(); if (!pickerLocked) setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}
                  className={`min-w-0 rounded-[24px] border-2 border-dashed p-4 ${isDragging ? 'border-[#4a6cf0] bg-[#4a6cf0]/10' : 'border-[#141414]/20 bg-white/65'}`}>
                  {batch ? (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">{batch.entries.length} fichier(s) dans votre dépôt</p>
                      {!uploadSuccess && <>
                        <p className="text-sm text-[#141414]/65">Les fichiers déjà reçus ne seront pas renvoyés. Choisissez à nouveau les mêmes fichiers seulement si la reprise vous le demande.</p>
                        <div>
                          <input id={`${pickerId}-files`} type="file" multiple accept={UPLOAD_FILE_ACCEPT} className="peer sr-only"
                            aria-label="Choisir à nouveau les fichiers du dépôt" onChange={chooseInput} disabled={pickerLocked} />
                          <label htmlFor={`${pickerId}-files`} aria-disabled={pickerLocked}
                            className={`${buttonClass} w-full touch-manipulation border border-[#141414]/20 bg-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#ff6a2b] peer-disabled:cursor-not-allowed peer-disabled:opacity-50`}>Choisir à nouveau les fichiers</label>
                        </div>
                      </>}
                    </div>
                  ) : (
                    <div className="space-y-3 text-center">
                      <UploadCloud aria-hidden="true" className="mx-auto text-[#ff6a2b]" size={30} />
                      <p className="text-sm font-semibold">{files.length ? `${files.length} fichier(s) sélectionné(s)` : 'Choisissez ou glissez vos fichiers'}</p>
                      <p className="text-xs text-[#141414]/65">PDF, images, Word, PowerPoint et texte · 20 Mo par fichier</p>
                      <div>
                        <input id={`${pickerId}-files`} type="file" multiple accept={UPLOAD_FILE_ACCEPT} className="peer sr-only"
                          aria-label="Choisir un fichier" onChange={chooseInput} disabled={pickerLocked} />
                        <label htmlFor={`${pickerId}-files`} aria-disabled={pickerLocked}
                          className={`${buttonClass} w-full touch-manipulation border border-[#141414]/20 bg-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#ff6a2b] peer-disabled:cursor-not-allowed peer-disabled:opacity-50`}>
                          {files.length ? 'Changer la sélection' : 'Choisir un fichier'}
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:hidden">
                        <div className="min-w-0">
                          <input id={`${pickerId}-gallery`} type="file" accept={UPLOAD_IMAGE_ACCEPT} multiple className="peer sr-only"
                            aria-label="Choisir des images de la galerie" onChange={chooseInput} disabled={pickerLocked} />
                          <label htmlFor={`${pickerId}-gallery`} aria-disabled={pickerLocked}
                            className={`${buttonClass} w-full touch-manipulation border border-[#141414]/20 bg-white px-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#ff6a2b] peer-disabled:cursor-not-allowed peer-disabled:opacity-50`}>
                            <Images aria-hidden="true" size={18} className="shrink-0" />Galerie
                          </label>
                        </div>
                        <div className="min-w-0">
                          <input id={`${pickerId}-camera`} type="file" accept={UPLOAD_IMAGE_ACCEPT} capture="environment" className="peer sr-only"
                            aria-label="Prendre une photo" onChange={chooseInput} disabled={pickerLocked} />
                          <label htmlFor={`${pickerId}-camera`} aria-disabled={pickerLocked}
                            className={`${buttonClass} w-full touch-manipulation border border-[#141414]/20 bg-white px-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#ff6a2b] peer-disabled:cursor-not-allowed peer-disabled:opacity-50`}>
                            <Camera aria-hidden="true" size={18} className="shrink-0" /><span className="min-w-0">Prendre une photo</span>
                          </label>
                        </div>
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
                  <fieldset disabled={isBusy || isRetryingDraft || !journalReady || !scopeMatches} className="min-w-0 space-y-3">
                    <legend className="sr-only">École et matière</legend>
                    {legacyLabelsNeeded && <p className="rounded-2xl bg-[#ffd23f]/20 p-3 text-sm">Vous pouvez vérifier les fichiers déjà reçus. Pour terminer les autres, choisissez leur école et leur matière.</p>}
                    <div>
                      <label htmlFor="upload-school" className="mb-1.5 block text-sm font-semibold">École</label>
                      <input id="upload-school" type="text" list="upload-schools" autoComplete="off" maxLength={120} required={!batch || legacyChoicesConfirmed} value={schoolName}
                        onChange={(event) => setSchoolName(event.target.value)} aria-describedby="upload-label-help" className={fieldClass} placeholder="Nom de votre école" />
                      <datalist id="upload-schools">{suggestions.schools.map((name) => <option key={name} value={name} />)}</datalist>
                    </div>
                    <div>
                      <label htmlFor="upload-subject" className="mb-1.5 block text-sm font-semibold">Matière</label>
                      <input id="upload-subject" type="text" list="upload-subjects" autoComplete="off" maxLength={120} required={!batch || legacyChoicesConfirmed} value={subjectName}
                        onChange={(event) => setSubjectName(event.target.value)} aria-describedby="upload-label-help" className={fieldClass} placeholder="Ex. Mathématiques" />
                      <datalist id="upload-subjects">{suggestions.subjects.map((name) => <option key={name} value={name} />)}</datalist>
                    </div>
                    <p id="upload-label-help" className="text-xs text-[#141414]/65">Choisissez une suggestion ou saisissez un nom, jusqu’à 120 caractères. Ces choix seront conservés pour votre prochain dépôt.</p>
                    {legacyLabelsNeeded && <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-[#141414]/20 bg-white p-3 text-sm">
                      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#4a6cf0]" checked={legacyChoicesConfirmed} onChange={(event) => setLegacyChoicesConfirmed(event.target.checked)} />
                      <span>Utiliser ces choix pour les fichiers restant à envoyer.</span>
                    </label>}
                  </fieldset>
                )}
                {!batch && (
                  <details className="min-w-0 rounded-2xl border border-[#141414]/15 bg-white/60">
                    <summary className="flex min-h-11 cursor-pointer items-center px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[#ff6a2b]">Ajouter une description (facultatif)</summary>
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
                      {confirmedCount} sur {batch.entries.length} fichier(s) reçu(s).
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
                            {entry.error && <p role="alert" className="mt-2 break-words text-sm text-[#b0245e]">{entry.error}</p>}
                            {entry.failureKind === 'conflict' && <p className="mt-1 text-xs text-[#b0245e]">Demandez de l’aide à une personne administratrice avant de renvoyer ce fichier.</p>}
                            {entry.failureKind === 'uncertain' && <p className="mt-1 text-xs text-[#141414]/75">La reprise vérifiera si ce fichier a déjà été reçu avant de poursuivre.</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {!uploadSuccess && <p className="text-xs text-[#141414]/65">Les fichiers déjà reçus ne seront pas renvoyés. Pour reprendre, utilisez ce navigateur et le même compte, sans effacer les données du site.</p>}
                  </section>
                )}
              </div>
              <footer className="safe-bottom flex shrink-0 flex-wrap items-center gap-2 border-t border-[#141414]/10 bg-[#f1ece4] px-4 pt-3 md:px-6">
                <button type="button" disabled={isBusy} onClick={onClose} className={`${buttonClass} bg-white/65`}>Fermer</button>
                {(!uploadSuccess || batch?.notificationError || journalWarning || errorMessage) && <button type="submit"
                  disabled={isBusy || !journalReady || !scopeMatches || (!uploadSuccess && draftStatus !== 'saved') || (batch ? !uploadSuccess && !canRetryUploadBatch(batch) : !files.length)}
                  className={`${buttonClass} min-w-0 flex-1 bg-[#ff6a2b] text-[#141414] hover:bg-[#ff8a4c]`}>
                  {isBusy ? 'Envoi en cours…' : uploadSuccess ? 'Réessayer' : restoredDraft ? 'Reprendre l’envoi' : batch ? 'Réessayer' : 'Déposer'}
                </button>}
              </footer>
            </form>
          </motion.div>
        </div>
      )}
      </AnimatePresence>
    </>
  );
}
