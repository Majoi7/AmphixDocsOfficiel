import {
  attachUploadFiles, isUploadBatchComplete, preservesUploadBatch, restoreUploadBatch, serializeUploadBatch,
  type UploadBatch,
} from './upload-batch';
import { MAX_UPLOAD_FILE_SIZE } from './upload-files';

export interface UploadDraftScope {
  userId: string;
  projectUrl: string;
}
export interface UploadDraftInput {
  files: File[];
  titles: string[];
  description: string;
  schoolName: string;
  subjectName: string;
  batch: UploadBatch | null;
}
export interface UploadDraft extends UploadDraftInput, UploadDraftScope {
  revision: number;
  updatedAt: number;
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
export async function saveUploadDraft(
  scope: UploadDraftScope, input: UploadDraftInput, expectedRevision: number | null, factory?: IDBFactory,
): Promise<UploadDraft> {
  // Le contenu est construit avant la transaction : aucune attente asynchrone
  // ne laisse IndexedDB fermer une transaction encore nécessaire.
  const next = encodeUploadDraft(scope, input, (expectedRevision || 0) + 1);
  return withDatabase(factory, (database) => operate(database, 'readwrite', (store, finish, fail) => {
    const request = store.get(next.key);
    request.onsuccess = () => {
      try {
        const previous = request.result === undefined ? null : decodeUploadDraft(scope, request.result);
        if ((previous?.revision ?? null) !== expectedRevision || (previous?.batch
          && (!input.batch || !preservesUploadBatch(serializeUploadBatch(previous.batch), input.batch)))) {
          throw new UploadDraftConflictError();
        }
        store.put(next);
        finish(decodeUploadDraft(scope, next));
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

// Les sauvegardes d'un même formulaire sont ordonnées. La révision est aussi
// vérifiée DANS la transaction, afin qu'un ancien onglet n'écrase pas un autre.
export function createUploadDraftPersistence(scope: UploadDraftScope, factory?: IDBFactory) {
  const captured = { ...scope };
  let revision: number | null = null;
  let loaded = false;
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  };
  return {
    read: () => enqueue(async () => {
      const draft = await readUploadDraft(captured, factory);
      revision = draft?.revision ?? null;
      loaded = true;
      return draft;
    }),
    save: (input: UploadDraftInput) => {
      const snapshot = { ...input, files: [...input.files], titles: [...input.titles] };
      return enqueue(async () => {
        if (!loaded) throw new Error('Le brouillon précédent doit d’abord être vérifié.');
        const saved = await saveUploadDraft(captured, snapshot, revision, factory);
        revision = saved.revision;
        return saved;
      });
    },
    clear: (batch: UploadBatch) => enqueue(async () => {
      if (!loaded) throw new Error('Le brouillon précédent doit d’abord être vérifié.');
      await clearCompletedUploadDraft(captured, batch, revision, factory);
      revision = null;
    }),
  };
}
