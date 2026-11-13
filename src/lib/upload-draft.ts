import {
  attachUploadFiles, isUploadBatchComplete, preservesUploadBatch, restoreUploadBatch, serializeUploadBatch,
  type UploadBatch,
} from './upload-batch';
import { MAX_UPLOAD_FILE_SIZE } from './upload-files';

export interface UploadDraftScope {
  userId: string;
  projectUrl: string;
}
export type UploadPickerKind = 'files' | 'gallery' | 'camera';
export interface UploadPickerMarker {
  kind: UploadPickerKind;
  openedAt: number;
}
export interface UploadDraftInput {
  files: File[];
  titles: string[];
  description: string;
  schoolName: string;
  subjectName: string;
  batch: UploadBatch | null;
  // Facultatif pour relire les brouillons V1 créés avant le marqueur.
  picker?: UploadPickerMarker | null;
  // Les nouveaux octets sont bruts ; une reprise figée n'est jamais recompressée.
  filesPrepared?: boolean[];
}
export interface UploadDraft extends UploadDraftInput, UploadDraftScope {
  revision: number;
  updatedAt: number;
}
export interface UploadDraftRetryOptions {
  readJournal: () => UploadBatch | null;
  hashFile: (file: Blob) => Promise<string>;
  isCurrent: () => boolean;
}
interface DraftFile {
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
}
interface DraftRecord extends UploadDraftScope {
  key: string;
  version: 1;
  revision: number;
  updatedAt: number;
  files: DraftFile[];
  titles: string[];
  description: string;
  schoolName: string;
  subjectName: string;
  batch: string | null;
  attachments: { id: string; file: DraftFile }[];
  picker?: UploadPickerMarker | null;
  filesPrepared?: boolean[];
}
const DATABASE = 'amphixdocs-upload-drafts';
const STORE = 'drafts';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export class UploadDraftConflictError extends Error {
  constructor() {
    super('Un autre dépôt est conservé sur cet appareil. Fermez les autres onglets puis rouvrez ce dépôt.');
    this.name = 'UploadDraftConflictError';
  }
}
export function uploadDraftKey(scope: UploadDraftScope): string {
  if (!uuidPattern.test(scope.userId) || !scope.projectUrl) throw new Error('Le compte du brouillon ne peut pas être vérifié.');
  return `${encodeURIComponent(scope.projectUrl)}:${scope.userId}`;
}
function storeFile(file: File): DraftFile {
  if (!(file instanceof Blob) || typeof file.name !== 'string' || !file.name
    || file.size > MAX_UPLOAD_FILE_SIZE || typeof file.lastModified !== 'number' || !Number.isFinite(file.lastModified)) {
    throw new Error('Ce fichier ne peut pas être conservé dans le brouillon.');
  }
  return {
    name: file.name, type: file.type, lastModified: file.lastModified,
    // Blob + nom séparé fonctionne aussi quand IndexedDB ne restaure pas File.
    blob: new Blob([file], { type: file.type }),
  };
}
function restoreFile(value: unknown): File {
  if (!record(value) || typeof value.name !== 'string' || !value.name || typeof value.type !== 'string'
    || typeof value.lastModified !== 'number' || !Number.isFinite(value.lastModified)
    || !(value.blob instanceof Blob) || value.blob.size > MAX_UPLOAD_FILE_SIZE) {
    throw new Error('Un fichier du brouillon ne peut pas être lu.');
  }
  return new File([value.blob], value.name, { type: value.type, lastModified: value.lastModified });
}

function pickerMarker(value: unknown): UploadPickerMarker | null {
  if (value === undefined || value === null) return null;
  if (!record(value) || !['files', 'gallery', 'camera'].includes(String(value.kind))
    || typeof value.openedAt !== 'number' || !Number.isFinite(value.openedAt) || value.openedAt <= 0) {
    throw new Error('Le choix de fichier conservé ne peut pas être lu.');
  }
  return { kind: value.kind as UploadPickerKind, openedAt: value.openedAt };
}

function preparationFlags(value: unknown, count: number): boolean[] {
  // Avant ce champ, la préparation précédait toujours la sauvegarde des octets.
  if (value === undefined) return Array.from({ length: count }, () => true);
  if (!Array.isArray(value) || value.length !== count || value.some((flag) => typeof flag !== 'boolean')) {
    throw new Error('La préparation des fichiers du brouillon ne peut pas être lue.');
  }
  return [...value];
}

// Liste blanche explicite : les sessions, jetons, clés et confirmations ne sont
// jamais enregistrés, même s'ils sont ajoutés à un objet par un appelant.
export function encodeUploadDraft(
  scope: UploadDraftScope, input: UploadDraftInput, revision: number, updatedAt = Date.now(),
): DraftRecord {
  if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isFinite(updatedAt)
    || !Array.isArray(input.files) || !Array.isArray(input.titles) || input.files.length !== input.titles.length
    || input.titles.some((title) => typeof title !== 'string') || typeof input.description !== 'string'
    || [...input.description].length > 200 || typeof input.schoolName !== 'string' || [...input.schoolName].length > 120
    || typeof input.subjectName !== 'string' || [...input.subjectName].length > 120) {
    throw new Error('Les saisies du brouillon ne peuvent pas être conservées.');
  }
  if (input.batch && (input.batch.userId !== scope.userId || input.batch.projectUrl !== scope.projectUrl)) {
    throw new UploadDraftConflictError();
  }
  return {
    key: uploadDraftKey(scope), version: 1, userId: scope.userId, projectUrl: scope.projectUrl,
    revision, updatedAt, files: input.files.map(storeFile), titles: [...input.titles],
    description: input.description, schoolName: input.schoolName, subjectName: input.subjectName,
    batch: input.batch ? serializeUploadBatch(input.batch) : null,
    picker: pickerMarker(input.picker),
    filesPrepared: preparationFlags(input.filesPrepared, input.files.length),
    attachments: input.batch?.entries.flatMap((entry) => entry.file
      ? [{ id: entry.request.identity.id, file: storeFile(entry.file) }] : []) || [],
  };
}
export function decodeUploadDraft(scope: UploadDraftScope, value: unknown): UploadDraft {
  if (!record(value) || value.key !== uploadDraftKey(scope) || value.version !== 1
    || value.userId !== scope.userId || value.projectUrl !== scope.projectUrl
    || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1
    || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)
    || !Array.isArray(value.files) || !Array.isArray(value.titles) || value.files.length !== value.titles.length
    || value.titles.some((title) => typeof title !== 'string') || typeof value.description !== 'string'
    || [...value.description].length > 200 || typeof value.schoolName !== 'string' || [...value.schoolName].length > 120
    || typeof value.subjectName !== 'string' || [...value.subjectName].length > 120
    || (value.batch !== null && typeof value.batch !== 'string') || !Array.isArray(value.attachments)) {
    throw new Error('Le brouillon conservé sur cet appareil ne peut pas être lu.');
  }
  const files = value.files.map(restoreFile);
  const batch = value.batch === null ? null : restoreUploadBatch(value.batch as string, scope.userId, scope.projectUrl);
  const attachments = new Map<string, File>();
  for (const attachment of value.attachments) {
    if (!record(attachment) || typeof attachment.id !== 'string' || attachments.has(attachment.id)) {
      throw new Error('Les fichiers du dépôt conservé ne peuvent pas être lus.');
    }
    const entry = batch?.entries.find((item) => item.request.identity.id === attachment.id);
    const file = restoreFile(attachment.file);
    if (!entry || entry.request.fileName !== file.name || entry.request.fileSize !== file.size) {
      throw new UploadDraftConflictError();
    }
    attachments.set(attachment.id, file);
  }
  // Le hash de chaque fichier est revérifié par le protocole d'envoi, avant tout
  // transfert. Une confirmation enregistrée localement ne devient pas un succès.
  if (batch) batch.entries = batch.entries.map((entry) => ({ ...entry, file: attachments.get(entry.request.identity.id) }));
  return {
    userId: scope.userId, projectUrl: scope.projectUrl, revision: value.revision, updatedAt: value.updatedAt,
    files, titles: value.titles as string[], description: value.description,
    schoolName: value.schoolName, subjectName: value.subjectName, batch,
    picker: pickerMarker(value.picker),
    filesPrepared: preparationFlags(value.filesPrepared, files.length),
  };
}

// Rapprocher les deux copies après une coupure, sans remplacer une identité.
// Seule la complétion historique déjà autorisée peut avancer d'une copie à
// l'autre. Les confirmations ne proviennent que du lot encore en mémoire.
export async function reconcileUploadDraftBatch(
  scope: UploadDraftScope, draft: UploadDraft | null, journal: UploadBatch | null,
  memory: UploadBatch | null, hashFile: (file: Blob) => Promise<string>,
): Promise<UploadBatch | null> {
  if (draft && (draft.userId !== scope.userId || draft.projectUrl !== scope.projectUrl)) {
    throw new UploadDraftConflictError();
  }
  const sources = [memory, draft?.batch, journal].filter((source): source is UploadBatch => !!source);
  let selected: UploadBatch | null = null;
  for (const source of sources) {
    if (source.userId !== scope.userId || source.projectUrl !== scope.projectUrl) throw new UploadDraftConflictError();
    if (!selected) { selected = source; continue; }
    const previous = serializeUploadBatch(selected);
    const next = serializeUploadBatch(source);
    if (previous === next) continue;
    if (preservesUploadBatch(previous, source)) selected = source;
    else if (!preservesUploadBatch(next, selected)) throw new UploadDraftConflictError();
  }
  if (!selected) return null;
  let result: UploadBatch = {
    ...selected,
    entries: selected.entries.map((entry) => {
      const remembered = memory?.entries.find((item) => item.request.identity.id === entry.request.identity.id);
      const state = remembered && JSON.stringify(remembered.request) === JSON.stringify(entry.request) ? remembered : entry;
      const file = sources.map((source) => source.entries.find((item) => item.request.identity.id === entry.request.identity.id)?.file)
        .find((attachment) => !!attachment);
      return { ...state, request: entry.request, file };
    }),
  };
  if (draft && !draft.batch && draft.files.length > 0) {
    // Le journal a pu être écrit juste avant la copie des identités dans
    // IndexedDB. Vérifier aussi les fichiers déjà confirmés en mémoire, mais
    // ne jamais reconstruire une confirmation à partir du stockage local.
    const verified = await attachUploadFiles(restoreUploadBatch(serializeUploadBatch(result), scope.userId, scope.projectUrl), draft.files, hashFile);
    result = { ...result, entries: result.entries.map((entry) => ({
      ...entry, file: entry.file || verified.entries.find((item) => item.request.identity.id === entry.request.identity.id)?.file,
    })) };
  }
  return result;
}

function browserFactory(): IDBFactory {
  try {
    const factory = globalThis.indexedDB;
    if (factory) return factory;
  } catch { /* Le stockage peut être bloqué, notamment en navigation privée. */ }
  throw new Error('Le brouillon ne peut pas être conservé sur cet appareil.');
}
function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = factory.open(DATABASE, 1);
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error('Le brouillon met trop de temps à s’ouvrir. Réessayez.'));
    }, 10000);
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onblocked = () => fail(new Error('Fermez les autres onglets de ce site puis réessayez.'));
    request.onerror = () => fail(request.error || new Error('Le brouillon ne peut pas être ouvert.'));
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      clearTimeout(timer);
      resolve(request.result);
    };
  });
}
function transaction(database: IDBDatabase, mode: IDBTransactionMode): IDBTransaction {
  if (mode === 'readwrite') {
    try { return database.transaction(STORE, mode, { durability: 'strict' }); }
    catch (error) { if (!(error instanceof TypeError)) throw error; }
  }
  return database.transaction(STORE, mode);
}
function operate<T>(database: IDBDatabase, mode: IDBTransactionMode, operation: (
  store: IDBObjectStore, finish: (value: T) => void, fail: (error: unknown) => void,
) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = transaction(database, mode);
    let result: T;
    let finished = false;
    let failure: unknown;
    const timer = setTimeout(() => {
      failure = new Error('Le brouillon met trop de temps à s’enregistrer. Réessayez.');
      try { tx.abort(); } catch { clearTimeout(timer); reject(failure); }
    }, 10000);
    const fail = (error: unknown) => {
      failure = error;
      try { tx.abort(); } catch { clearTimeout(timer); reject(error); }
    };
    tx.oncomplete = () => {
      clearTimeout(timer);
      if (finished) resolve(result);
      else reject(new Error('Le brouillon n’a pas été confirmé.'));
    };
    tx.onabort = () => { clearTimeout(timer); reject(failure || tx.error || new Error('Le brouillon n’a pas été enregistré.')); };
    tx.onerror = () => { failure ||= tx.error || new Error('Le brouillon n’a pas été enregistré.'); };
    try { operation(tx.objectStore(STORE), (value) => { result = value; finished = true; }, fail); }
    catch (error) { fail(error); }
  });
}
async function withDatabase<T>(factory: IDBFactory | undefined, operation: (database: IDBDatabase) => Promise<T>): Promise<T> {
  const database = await openDatabase(factory || browserFactory());
  try { return await operation(database); }
  finally { database.close(); }
}
export async function readUploadDraft(scope: UploadDraftScope, factory?: IDBFactory): Promise<UploadDraft | null> {
  const key = uploadDraftKey(scope);
  return withDatabase(factory, (database) => operate(database, 'readonly', (store, finish, fail) => {
    const request = store.get(key);
    request.onsuccess = () => {
      try { finish(request.result === undefined ? null : decodeUploadDraft(scope, request.result)); }
      catch (error) { fail(error); }
    };
  }));
}
function assertCurrentDraft(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new Error('Le compte du dépôt a changé. Rouvrez le dépôt avec le compte utilisé.');
}

export async function saveUploadDraft(
  scope: UploadDraftScope, input: UploadDraftInput, expectedRevision: number | null, factory?: IDBFactory,
  isCurrent: () => boolean = () => true,
): Promise<UploadDraft> {
  // Le contenu est construit avant la transaction : aucune attente asynchrone
  // ne laisse IndexedDB fermer une transaction encore nécessaire.
  assertCurrentDraft(isCurrent);
  const captured = { ...scope };
  const next = encodeUploadDraft(captured, input, (expectedRevision || 0) + 1);
  const nextBatch = next.batch ? restoreUploadBatch(next.batch, captured.userId, captured.projectUrl) : null;
  return withDatabase(factory, (database) => operate(database, 'readwrite', (store, finish, fail) => {
    const request = store.get(next.key);
    request.onsuccess = () => {
      try {
        assertCurrentDraft(isCurrent);
        const previous = request.result === undefined ? null : decodeUploadDraft(captured, request.result);
        if ((previous?.revision ?? null) !== expectedRevision || (previous?.batch
          && (!nextBatch || !preservesUploadBatch(serializeUploadBatch(previous.batch), nextBatch)))) {
          throw new UploadDraftConflictError();
        }
        store.put(next);
        finish(decodeUploadDraft(captured, next));
      } catch (error) { fail(error); }
    };
  }));
}
export async function clearCompletedUploadDraft(
  scope: UploadDraftScope, batch: UploadBatch, expectedRevision: number | null, factory?: IDBFactory,
): Promise<void> {
  if (!isUploadBatchComplete(batch) || batch.userId !== scope.userId || batch.projectUrl !== scope.projectUrl) {
    throw new UploadDraftConflictError();
  }
  const key = uploadDraftKey(scope);
  return withDatabase(factory, (database) => operate(database, 'readwrite', (store, finish, fail) => {
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        if (request.result === undefined) { finish(undefined); return; }
        const previous = decodeUploadDraft(scope, request.result);
        if (previous.revision !== expectedRevision || !previous.batch
          || serializeUploadBatch(previous.batch) !== serializeUploadBatch(batch)) throw new UploadDraftConflictError();
        // Retrait du seul brouillon confirmé, jamais d'un fichier du projet.
        store.delete(key);
        finish(undefined);
      } catch (error) { fail(error); }
    };
  }));
}

async function sameDraftForm(
  left: UploadDraftInput, right: UploadDraftInput, hashFile: (file: Blob) => Promise<string>,
): Promise<boolean> {
  if (left.description !== right.description || left.schoolName !== right.schoolName
    || left.subjectName !== right.subjectName || JSON.stringify(left.picker ?? null) !== JSON.stringify(right.picker ?? null)
    || JSON.stringify(preparationFlags(left.filesPrepared, left.files.length)) !== JSON.stringify(preparationFlags(right.filesPrepared, right.files.length))
    || left.files.length !== right.files.length
    || left.titles.length !== right.titles.length || left.titles.some((title, index) => title !== right.titles[index])) return false;
  for (let index = 0; index < left.files.length; index++) {
    const file = left.files[index];
    const other = right.files[index];
    if (file.name !== other.name || file.type !== other.type || file.size !== other.size
      || file.lastModified !== other.lastModified) return false;
    if (file !== other && await hashFile(file) !== await hashFile(other)) return false;
  }
  return true;
}

// Les sauvegardes d'un même formulaire sont ordonnées. La révision est aussi
// vérifiée DANS la transaction, afin qu'un ancien onglet n'écrase pas un autre.
export function createUploadDraftPersistence(scope: UploadDraftScope, factory?: IDBFactory) {
  const captured = { ...scope };
  let revision: number | null = null;
  let lastDraft: UploadDraft | null = null;
  let loaded = false;
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  };
  const remember = (draft: UploadDraft | null) => {
    revision = draft?.revision ?? null;
    lastDraft = draft && { ...draft, files: [...draft.files], titles: [...draft.titles],
      picker: draft.picker ? { ...draft.picker } : null,
      filesPrepared: preparationFlags(draft.filesPrepared, draft.files.length),
      batch: draft.batch ? restoreUploadBatch(serializeUploadBatch(draft.batch), captured.userId, captured.projectUrl) : null };
    loaded = true;
  };
  return {
    read: () => enqueue(async () => {
      loaded = false;
      const draft = await readUploadDraft(captured, factory);
      remember(draft);
      return draft;
    }),
    save: (input: UploadDraftInput, isCurrent: () => boolean = () => true) => {
      const snapshot = { ...input, files: [...input.files], titles: [...input.titles],
        picker: input.picker ? { ...input.picker } : null,
        filesPrepared: preparationFlags(input.filesPrepared, input.files.length) };
      return enqueue(async () => {
        if (!loaded) throw new Error('Le brouillon précédent doit d’abord être vérifié.');
        const saved = await saveUploadDraft(captured, snapshot, revision, factory, isCurrent);
        remember(saved);
        return saved;
      });
    },
    retry: (input: UploadDraftInput, options: UploadDraftRetryOptions) => {
      const snapshot = { ...input, files: [...input.files], titles: [...input.titles],
        picker: input.picker ? { ...input.picker } : null,
        filesPrepared: preparationFlags(input.filesPrepared, input.files.length) };
      return enqueue(async () => {
        if (!loaded) throw new Error('Le brouillon précédent doit d’abord être vérifié.');
        assertCurrentDraft(options.isCurrent);
        const latest = await readUploadDraft(captured, factory);
        assertCurrentDraft(options.isCurrent);
        if (!snapshot.batch && latest?.batch) throw new UploadDraftConflictError();
        if (latest && !latest.batch) {
          // Une révision différente n'autorise pas à écraser les saisies d'un
          // autre onglet. Accepter seulement notre dernière copie confirmée
          // ou une copie identique aux saisies que nous voulons conserver.
          const unchanged = !!lastDraft && !lastDraft.batch && await sameDraftForm(latest, lastDraft, options.hashFile);
          if (!unchanged && !await sameDraftForm(latest, snapshot, options.hashFile)) throw new UploadDraftConflictError();
        }
        assertCurrentDraft(options.isCurrent);
        const journal = options.readJournal();
        const expectedJournal = journal ? serializeUploadBatch(journal) : null;
        if (!snapshot.batch && journal) throw new UploadDraftConflictError();
        const batch = await reconcileUploadDraftBatch(captured, latest, journal, snapshot.batch, options.hashFile);
        const isCurrent = () => {
          assertCurrentDraft(options.isCurrent);
          const current = options.readJournal();
          if ((current ? serializeUploadBatch(current) : null) !== expectedJournal) throw new UploadDraftConflictError();
          return true;
        };
        const labels = batch?.entries.find((entry) => entry.request.schoolName && entry.request.subjectName)?.request;
        const saved = await saveUploadDraft(captured, { ...snapshot, batch,
          schoolName: labels?.schoolName || snapshot.schoolName, subjectName: labels?.subjectName || snapshot.subjectName,
        }, latest?.revision ?? null, factory, isCurrent);
        remember(saved);
        // Seule la copie encore en mémoire peut garder une confirmation. La
        // copie persistée reste une reprise à vérifier, jamais une preuve d'envoi.
        return { ...saved, batch };
      });
    },
    clear: (batch: UploadBatch) => enqueue(async () => {
      if (!loaded) throw new Error('Le brouillon précédent doit d’abord être vérifié.');
      await clearCompletedUploadDraft(captured, batch, revision, factory);
      remember(null);
    }),
  };
}
