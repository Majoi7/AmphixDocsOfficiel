import type { DocumentItem, UploadDocumentRequest, UploadFailureKind, UploadStage } from './supabase';
import type { UploadProgress } from './upload-transport';
import { logDevelopmentError, userError } from './errors';
import { assertPreviewIdentity, needsDocumentPreview } from './preview-completion';

export type BatchEntryStatus = 'pending' | 'working' | 'confirmed' | 'error';
export interface UploadBatchEntry {
  request: UploadDocumentRequest;
  file?: File;
  attempted: boolean;
  status: BatchEntryStatus;
  stage: UploadStage | 'preparation';
  progress: UploadProgress | null;
  document: DocumentItem | null;
  error: string | null;
  failureKind: UploadFailureKind | null;
}
// Contrat historique V1, conservé seulement pour vérifier une reprise. Il ne
// déclenche plus aucune création, lecture ou suppression de classement.
interface LegacyRequest {
  identity: { id: string; filePath: string };
  userId: string;
  title: string;
  description: string;
  fileName: string;
  fileSize: number;
  fileType: UploadDocumentRequest['fileType'];
  sha256: string;
  folderId: string | null;
  categoryId: string | null;
}
interface LegacyJournal {
  version: 1;
  id: string;
  userId: string;
  projectUrl: string;
  folderRequest: { id: string; userId: string; name: string; categoryId: string | null } | null;
  requests: LegacyRequest[];
}
export interface UploadBatch {
  id: string;
  userId: string;
  projectUrl: string;
  legacySource: LegacyJournal | null;
  notificationError: string | null;
  entries: UploadBatchEntry[];
}
export interface UploadBatchReport {
  userId: string;
  projectUrl: string;
  generation: number;
  documents: DocumentItem[];
  entries: UploadBatchEntry[];
  complete: boolean;
}
export interface UploadBatchDependencies {
  generation: number;
  isCurrent: () => boolean;
  uploadDocument: (
    request: UploadDocumentRequest, file: File | undefined,
    onStage: (stage: UploadStage) => void, projectUrl: string,
    mode: 'initial' | 'resume', onProgress: (progress: UploadProgress) => void
  ) => Promise<DocumentItem>;
  completePreview?: (document: DocumentItem, file: File | undefined) => Promise<DocumentItem>;
}
export interface UploadJournalStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}
export const UPLOAD_STAGE_LABELS: Record<UploadBatchEntry['stage'], string> = {
  preparation: 'Préparation du fichier',
  transfert: 'Envoi du fichier',
  enregistrement: 'Enregistrement du fichier',
  verification: 'Vérification de l’envoi',
  termine: 'Fichier envoyé',
};

export function createUploadBatch(
  userId: string, projectUrl: string,
  prepared: { request: UploadDocumentRequest; file: File }[], id = crypto.randomUUID()
): UploadBatch {
  if (prepared.length === 0) throw new Error('Sélectionnez au moins un fichier.');
  if (prepared.some(({ request }) => request.legacyClassification)) throw new Error('Une identité historique doit provenir de sa trace de reprise, pas d’un nouveau lot.');
  const batch: UploadBatch = {
    id, userId, projectUrl, legacySource: null, notificationError: null,
    entries: prepared.map(({ request, file }) => ({
      request, file, attempted: false, status: 'pending', stage: 'preparation', progress: null,
      document: null, error: null, failureKind: null,
    })),
  };
  parseJournal(JSON.stringify(journalData(batch)), userId, projectUrl);
  return batch;
}
export function isUploadBatchComplete(batch: UploadBatch): boolean {
  return batch.entries.length > 0 && batch.entries.every((entry) => entry.status === 'confirmed');
}
export function canRetryUploadBatch(batch: UploadBatch): boolean {
  return batch.entries.some((entry) => entry.status !== 'confirmed' && entry.failureKind !== 'conflict');
}
export function needsLegacyClassification(batch: UploadBatch): boolean {
  return batch.entries.some((entry) => entry.status !== 'confirmed'
    && !!entry.request.legacyClassification && entry.request.schoolName === null && entry.request.subjectName === null);
}
export function completeLegacyClassification(batch: UploadBatch, schoolName: string, subjectName: string): UploadBatch {
  if (!validLabel(schoolName.trim()) || !validLabel(subjectName.trim())) throw new Error('Renseignez une école et une matière de 1 à 120 caractères.');
  return {
    ...batch,
    entries: batch.entries.map((entry) => entry.status !== 'confirmed' && entry.request.legacyClassification
      && entry.request.schoolName === null && entry.request.subjectName === null
      ? { ...entry, request: { ...entry.request, schoolName: schoolName.trim(), subjectName: subjectName.trim() } }
      : entry),
  };
}
function failureKind(error: unknown): UploadFailureKind {
  if (typeof error === 'object' && error !== null && 'kind' in error
    && (error.kind === 'retryable' || error.kind === 'uncertain' || error.kind === 'conflict' || error.kind === 'scope')) return error.kind;
  return 'uncertain';
}
const scopeError = () => Object.assign(new Error(
  'Le compte ou le projet a changé. Rétablissez le compte et le projet d’origine pour vérifier ce lot sous les mêmes identifiants.'
), { kind: 'scope' as const });

// Séquentiel au LOT 1. Chaque succès réel est conservé ; la parallélisation
// limitée relève du LOT 5. Les exceptions d'affichage ne rejouent pas un effet.
export async function runUploadBatch(
  batch: UploadBatch, dependencies: UploadBatchDependencies,
  onChange: (batch: UploadBatch) => void, onReport: (report: UploadBatchReport) => void
): Promise<UploadBatch> {
  let current: UploadBatch = { ...batch, notificationError: null };
  const rememberNotificationError = (error: unknown) => {
    current = { ...current, notificationError: userError(error, 'La liste n’a pas pu être actualisée. Vos fichiers envoyés sont conservés. Actualisez la bibliothèque.') };
  };
  const publish = () => {
    try { onChange(current); } catch (error) { rememberNotificationError(error); }
  };
  const report = () => {
    if (!dependencies.isCurrent()) return;
    try {
      onReport({ userId: current.userId, projectUrl: current.projectUrl, generation: dependencies.generation,
        documents: current.entries.flatMap((entry) => entry.document ? [entry.document] : []),
        entries: current.entries, complete: isUploadBatchComplete(current) });
    } catch (error) { rememberNotificationError(error); publish(); }
  };
  const checkScope = () => { if (!dependencies.isCurrent()) throw scopeError(); };
  const updateEntry = (index: number, patch: Partial<UploadBatchEntry>) => {
    current = { ...current, entries: current.entries.map((entry, position) => position === index ? { ...entry, ...patch } : entry) };
    publish();
  };
  for (let index = 0; index < current.entries.length; index++) {
    const entry = current.entries[index];
    if (entry.status === 'confirmed' || entry.failureKind === 'conflict') continue;
    const mode = entry.attempted ? 'resume' : 'initial';
    updateEntry(index, { status: 'working', attempted: true, stage: 'verification', progress: null, error: null, failureKind: null });
    try {
      checkScope();
      const document = await dependencies.uploadDocument(entry.request, entry.file,
        (stage) => { if (dependencies.isCurrent()) updateEntry(index, { stage }); }, current.projectUrl, mode,
        (progress) => {
          if (!dependencies.isCurrent() || current.entries[index].status !== 'working'
            || !Number.isFinite(progress.uploadedBytes) || progress.uploadedBytes < 0
            || progress.totalBytes !== entry.request.fileSize
            || !['standard', 'tus'].includes(progress.transport)) return;
          updateEntry(index, { progress: { ...progress, uploadedBytes: Math.min(progress.uploadedBytes, progress.totalBytes) } });
        });
      checkScope();
      if (document.id !== entry.request.identity.id || document.user_id !== entry.request.userId
        || document.file_path !== entry.request.identity.filePath) {
        throw Object.assign(new Error('La confirmation ne correspond pas à l’identité du fichier. Aucun succès n’est annoncé.'), { kind: 'conflict' });
      }
      updateEntry(index, { status: 'confirmed', stage: 'termine', document, error: null, failureKind: null });
    } catch (error) {
      const kind = failureKind(error);
      const message = kind === 'scope'
        ? 'Votre connexion a changé. Reconnectez-vous au compte utilisé pour ce dépôt.'
        : kind === 'conflict'
          ? 'Ce fichier ne peut pas être repris. Demandez de l’aide à une personne administratrice.'
          : !entry.file
            ? 'Choisissez à nouveau ce fichier pour reprendre l’envoi.'
            : 'L’envoi n’a pas pu être terminé. Réessayez ; les fichiers déjà envoyés sont conservés.';
      updateEntry(index, { status: 'error', document: null, error: userError(error, message), failureKind: kind });
      if (kind === 'scope') break;
    }
    // Le document principal est déjà confirmé. Une erreur d'aperçu ne passe
    // jamais dans le catch de l'envoi et ne recrée pas une identité au réessai.
    const confirmed = current.entries[index].document;
    if (confirmed && dependencies.completePreview && dependencies.isCurrent() && needsDocumentPreview(confirmed)) {
      try {
        const previewed = await dependencies.completePreview(confirmed, entry.file);
        if (!dependencies.isCurrent()) break;
        assertPreviewIdentity(confirmed, previewed);
        if (needsDocumentPreview(previewed)) throw new Error('Aperçu non confirmé.');
        updateEntry(index, { document: previewed });
      } catch (error) { logDevelopmentError(error, 'Aperçu facultatif'); }
      if (!dependencies.isCurrent()) break;
    }
    report();
  }
  report();
  publish();
  return current;
}
export async function attachUploadFiles(
  batch: UploadBatch, incoming: File[], hashFile: (file: Blob) => Promise<string>
): Promise<UploadBatch> {
  const attachments = new Map<string, File>();
  for (const file of incoming) {
    const candidates = batch.entries.filter((entry) => entry.status !== 'confirmed'
      && entry.request.fileName === file.name && entry.request.fileSize === file.size);
    if (candidates.length === 0) throw new Error(`« ${file.name} » ne correspond à aucun fichier restant de ce lot.`);
    const hash = await hashFile(file);
    const matches = candidates.filter((entry) => entry.request.sha256 === hash);
    if (matches.length === 0) throw new Error(`Le contenu de « ${file.name} » diffère du fichier d’origine. Aucun fichier n’a été remplacé.`);
    for (const entry of matches) attachments.set(entry.request.identity.id, file);
  }
  return { ...batch, entries: batch.entries.map((entry) => ({ ...entry, file: attachments.get(entry.request.identity.id) || entry.file })) };
}
export function mergeUploadReport(
  library: { documents: DocumentItem[] }, report: UploadBatchReport
): { documents: DocumentItem[] } {
  const receivedIds = new Set(report.documents.map((document) => document.id));
  return { documents: [
    ...Array.from(new Map(report.documents.map((document) => [document.id, document])).values()),
    ...library.documents.filter((document) => !receivedIds.has(document.id)),
  ] };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value);
const nullableUuid = (value: unknown): value is string | null => value === null || uuid(value);
// Clé stable pour découvrir aussi les traces V1. Le contenu est désormais V2.
const journalKey = (userId: string, projectUrl: string) => `amphixdocs-upload-v1:${encodeURIComponent(projectUrl)}:${userId}`;
const validLabel = (value: unknown): value is string => typeof value === 'string'
  && value === value.trim() && [...value].length >= 1 && [...value].length <= 120;
function validIdentity(value: unknown): value is Record<string, unknown> & Pick<UploadDocumentRequest,
  'identity' | 'userId' | 'fileName' | 'title' | 'description' | 'fileSize' | 'fileType' | 'sha256'> {
  if (!record(value) || !record(value.identity) || !uuid(value.identity.id) || !uuid(value.userId)
    || typeof value.fileName !== 'string' || !value.fileName || typeof value.identity.filePath !== 'string'
    || typeof value.title !== 'string' || !value.title.trim() || typeof value.description !== 'string'
    || [...value.description].length > 200 || typeof value.fileSize !== 'number'
    || !Number.isSafeInteger(value.fileSize) || value.fileSize < 0 || value.fileSize > 20 * 1024 * 1024
    || !['pdf', 'image', 'doc', 'autre'].includes(String(value.fileType))
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) return false;
  return value.identity.filePath === `${value.userId}/${value.identity.id}-${value.fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
}
function identityData(request: Pick<UploadDocumentRequest,
  'identity' | 'userId' | 'title' | 'description' | 'fileName' | 'fileSize' | 'fileType' | 'sha256'>) {
  return { identity: { id: request.identity.id, filePath: request.identity.filePath },
    userId: request.userId, title: request.title, description: request.description,
    fileName: request.fileName, fileSize: request.fileSize, fileType: request.fileType, sha256: request.sha256 };
}
function parseLegacy(value: unknown, userId: string, projectUrl: string): LegacyJournal {
  if (!record(value) || value.version !== 1 || !uuid(value.id) || value.userId !== userId
    || value.projectUrl !== projectUrl || !Array.isArray(value.requests) || value.requests.length === 0) throw new Error('Trace V1 incompatible.');
  const requests = value.requests.map((request): LegacyRequest => {
    if (!validIdentity(request) || request.userId !== userId || !nullableUuid(request.folderId) || !nullableUuid(request.categoryId)) throw new Error('Identité V1 incompatible.');
    return { ...identityData(request), folderId: request.folderId, categoryId: request.categoryId };
  });
  let folderRequest: LegacyJournal['folderRequest'] = null;
  if (value.folderRequest !== null) {
    const target = value.folderRequest;
    if (!record(target) || !uuid(target.id) || target.userId !== userId || typeof target.name !== 'string'
      || !target.name.trim() || !nullableUuid(target.categoryId) || requests.some((request) => request.folderId !== target.id)) throw new Error('Périmètre V1 incompatible.');
    folderRequest = { id: target.id, userId, name: target.name, categoryId: target.categoryId };
  }
  if (new Set(requests.map((request) => request.identity.id)).size !== requests.length) throw new Error('Identités V1 répétées.');
  return { version: 1, id: value.id, userId, projectUrl, folderRequest, requests };
}
function requestData(request: UploadDocumentRequest) {
  return { ...identityData(request), schoolName: request.schoolName, subjectName: request.subjectName,
    ...(request.legacyClassification ? { legacyClassification: {
      folderId: request.legacyClassification.folderId, categoryId: request.legacyClassification.categoryId,
    } } : {}) };
}
function journalData(batch: UploadBatch) {
  // Liste blanche : aucune clé, session, profil, donnée binaire ou confirmation.
  return { version: 2, id: batch.id, userId: batch.userId, projectUrl: batch.projectUrl,
    legacySource: batch.legacySource ? parseLegacy(batch.legacySource, batch.userId, batch.projectUrl) : null,
    requests: batch.entries.map((entry) => requestData(entry.request)) };
}
function parseJournal(raw: string, userId: string, projectUrl: string): UploadBatch {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !uuid(userId) || !uuid(value.id) || value.userId !== userId || value.projectUrl !== projectUrl) throw new Error('Périmètre de trace incompatible.');
  let legacySource: LegacyJournal | null;
  let requests: UploadDocumentRequest[];
  if (value.version === 1) {
    legacySource = parseLegacy(value, userId, projectUrl);
    requests = legacySource.requests.map((request) => ({ ...identityData(request), schoolName: null, subjectName: null,
      legacyClassification: { folderId: request.folderId, categoryId: request.categoryId } }));
  } else if (value.version === 2 && Array.isArray(value.requests) && value.requests.length > 0) {
    legacySource = value.legacySource === null ? null : parseLegacy(value.legacySource, userId, projectUrl);
    if (legacySource && (legacySource.id !== value.id || legacySource.requests.length !== value.requests.length)) throw new Error('Source historique incompatible.');
    requests = value.requests.map((request, index): UploadDocumentRequest => {
      if (!validIdentity(request) || request.userId !== userId) throw new Error('Identité V2 incompatible.');
      let legacyClassification: UploadDocumentRequest['legacyClassification'];
      if (legacySource) {
        const legacy = legacySource.requests[index];
        const target = request.legacyClassification;
        if (!record(target) || target.folderId !== legacy.folderId || target.categoryId !== legacy.categoryId
          || JSON.stringify(identityData(request)) !== JSON.stringify(identityData(legacy))) throw new Error('Identité historique altérée.');
        legacyClassification = { folderId: legacy.folderId, categoryId: legacy.categoryId };
      } else if (request.legacyClassification !== undefined) throw new Error('Source historique manquante.');
      const legacyWithoutLabels = !!legacyClassification && request.schoolName === null && request.subjectName === null;
      if (!legacyWithoutLabels && (!validLabel(request.schoolName) || !validLabel(request.subjectName))) throw new Error('École ou matière incompatible.');
      return { ...identityData(request), schoolName: legacyWithoutLabels ? null : request.schoolName as string,
        subjectName: legacyWithoutLabels ? null : request.subjectName as string,
        ...(legacyClassification ? { legacyClassification } : {}) };
    });
  } else throw new Error('Version de trace incompatible.');
  if (new Set(requests.map((request) => request.identity.id)).size !== requests.length) throw new Error('Identités répétées.');
  return { id: value.id, userId, projectUrl, legacySource, notificationError: null,
    // Aucune confirmation distante n'est supposée après un rechargement.
    entries: requests.map((request) => ({ request, attempted: true, status: 'pending', stage: 'verification', progress: null,
      document: null, error: null, failureKind: null })) };
}
// Le brouillon IndexedDB conserve exactement le même contrat de reprise que
// le journal historique : ni session, ni jeton, ni confirmation supposée.
export function serializeUploadBatch(batch: UploadBatch): string {
  const raw = JSON.stringify(journalData(batch));
  parseJournal(raw, batch.userId, batch.projectUrl);
  return raw;
}
export function restoreUploadBatch(raw: string, userId: string, projectUrl: string): UploadBatch {
  return parseJournal(raw, userId, projectUrl);
}
export function preservesUploadBatch(previousRaw: string, next: UploadBatch): boolean {
  const expected = serializeUploadBatch(next);
  return matchesUploadJournal(previousRaw, expected, next) || allowsLegacyCompletion(previousRaw, next);
}
export function readUploadJournal(storage: UploadJournalStorage, userId: string, projectUrl: string): UploadBatch | null {
  let raw: string | null;
  try { raw = storage.getItem(journalKey(userId, projectUrl)); }
  catch { throw new Error('Le stockage de reprise est inaccessible. Aucun nouveau dépôt ne sera démarré tant que ses identifiants ne peuvent pas être conservés.'); }
  if (raw === null) return null;
  try { return parseJournal(raw, userId, projectUrl); }
  catch { throw new Error('La trace d’un dépôt précédent est illisible ou incompatible. Ne l’effacez pas pour recommencer : faites vérifier ce dépôt avant de créer un nouveau lot.'); }
}
function matchesUploadJournal(raw: string, expected: string, batch: UploadBatch): boolean {
  try { return JSON.stringify(journalData(parseJournal(raw, batch.userId, batch.projectUrl))) === expected; }
  catch { return false; }
}
function allowsLegacyCompletion(raw: string, batch: UploadBatch): boolean {
  try {
    const previous = parseJournal(raw, batch.userId, batch.projectUrl);
    if (!previous.legacySource || !batch.legacySource) return false;
    const expected = JSON.stringify(journalData(batch));
    const completed: UploadBatch = { ...previous, entries: previous.entries.map((entry, index) => {
      const proposed = batch.entries[index]?.request;
      if (entry.request.schoolName !== null || entry.request.subjectName !== null || !proposed
        || !validLabel(proposed.schoolName) || !validLabel(proposed.subjectName)) return entry;
      return { ...entry, request: { ...entry.request, schoolName: proposed.schoolName, subjectName: proposed.subjectName } };
    }) };
    return JSON.stringify(journalData(completed)) === expected;
  } catch { return false; }
}
export function saveUploadJournal(storage: UploadJournalStorage, batch: UploadBatch): void {
  const raw = JSON.stringify(journalData(batch));
  parseJournal(raw, batch.userId, batch.projectUrl);
  const key = journalKey(batch.userId, batch.projectUrl);
  const failure = 'Les identifiants de reprise n’ont pas pu être enregistrés. Aucun nouvel envoi n’a été démarré ; autorisez le stockage de ce site puis réessayez.';
  let previous: string | null;
  try { previous = storage.getItem(key); } catch { throw new Error(failure); }
  // Seule extension autorisée : compléter une fois les deux libellés manquants
  // d'une trace V1. UUID, chemin, empreinte et métadonnées d'origine restent figés.
  if (previous !== null && !matchesUploadJournal(previous, raw, batch) && !allowsLegacyCompletion(previous, batch)) {
    throw new Error('Une autre trace de dépôt est présente ou la trace est incompatible. Elle est conservée et aucun nouvel envoi n’a été démarré ; faites vérifier ce dépôt avant de recommencer.');
  }
  try { storage.setItem(key, raw); if (storage.getItem(key) !== raw) throw new Error('Écriture non confirmée.'); }
  catch { throw new Error(failure); }
}
export function clearCompletedUploadJournal(storage: UploadJournalStorage, batch: UploadBatch): void {
  if (!isUploadBatchComplete(batch)) throw new Error('Un lot non confirmé ne peut pas être effacé du journal de reprise.');
  const expected = JSON.stringify(journalData(batch));
  parseJournal(expected, batch.userId, batch.projectUrl);
  const key = journalKey(batch.userId, batch.projectUrl);
  const failure = 'Le lot est confirmé, mais sa trace locale n’a pas pu être retirée. À la prochaine ouverture, elle sera vérifiée sans dupliquer les fichiers.';
  let previous: string | null;
  try { previous = storage.getItem(key); } catch { throw new Error(failure); }
  if (previous === null) return;
  if (!matchesUploadJournal(previous, expected, batch)) throw new Error('Une autre trace de dépôt est présente ou la trace est incompatible. Elle est conservée : le lot confirmé n’autorise pas son retrait.');
  try { storage.removeItem(key); if (storage.getItem(key) !== null) throw new Error('Retrait non confirmé.'); }
  catch { throw new Error(failure); }
}
