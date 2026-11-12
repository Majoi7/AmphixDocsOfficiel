import type { Upload as TusUpload, UploadOptions, UrlStorage, PreviousUpload, HttpStack, HttpRequest, HttpResponse } from 'tus-js-client';
import { inferUploadMimeType } from './upload-files';
import { logDevelopmentError } from './errors';

export const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
export const UPLOAD_RETRY_DELAYS = [0, 3000, 5000, 10000, 20000];
export interface UploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  transport: 'standard' | 'tus';
}
export interface StorageUpload {
  projectUrl: string;
  publicKey: string;
  userId: string;
  filePath: string;
  sha256: string;
  file: File;
  signal: AbortSignal;
  checkScope: () => void;
  getAccessToken: (forceRefresh?: boolean) => Promise<string>;
  reconcile: () => Promise<'present' | 'missing'>;
  onProgress?: (progress: UploadProgress) => void;
}
interface TransportTools {
  createXhr: () => XMLHttpRequest;
  loadTus: () => Promise<{ Upload: typeof TusUpload }>;
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
class TransferError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}
const aborted = () => new DOMException('Envoi interrompu.', 'AbortError');
function check(options: StorageUpload) {
  if (options.signal.aborted) throw aborted();
  options.checkScope();
}
function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const abort = () => { clearTimeout(timer); reject(aborted()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}
const defaultTools: TransportTools = {
  createXhr: () => new XMLHttpRequest(),
  loadTus: () => import('tus-js-client'),
  wait,
};
export function storageUploadEndpoints(projectUrl: string) {
  const project = new URL(projectUrl);
  if (!['https:', 'http:'].includes(project.protocol) || project.username || project.password || project.search || project.hash) {
    throw new Error('Adresse du stockage incompatible.');
  }
  const storage = new URL(project.href);
  // Domaine Storage direct recommandé par Supabase. Les domaines personnalisés
  // et les installations locales conservent leur hôte explicitement configuré.
  if (/^[a-z0-9-]+\.supabase\.co$/i.test(storage.hostname)) {
    storage.hostname = storage.hostname.replace(/\.supabase\.co$/i, '.storage.supabase.co');
  }
  return {
    standard: `${project.href.replace(/\/$/, '')}/storage/v1/object/documents/`,
    resumable: `${storage.href.replace(/\/$/, '')}/storage/v1/upload/resumable`,
  };
}
function allowedTusUrl(value: string, endpoint: string): boolean {
  try {
    const url = new URL(value), base = new URL(endpoint);
    return url.origin === base.origin && !url.username && !url.password && !url.search && !url.hash
      && (url.pathname === base.pathname || url.pathname.startsWith(`${base.pathname}/`));
  } catch { return false; }
}
function progress(options: StorageUpload, transport: UploadProgress['transport'], uploadedBytes: number) {
  check(options);
  if (!Number.isFinite(uploadedBytes)) return;
  // Le compteur décrit des octets transportés, jamais la confirmation SQL.
  try {
    options.onProgress?.({ uploadedBytes: Math.max(0, Math.min(options.file.size, uploadedBytes)), totalBytes: options.file.size, transport });
  } catch (error) { logDevelopmentError(error, 'Affichage de la progression'); }
}
const retryable = (status: number) => status === 0 || status === 401 || status === 408 || status === 429 || status >= 500;

async function standardAttempt(options: StorageUpload, tools: TransportTools, forceRefresh: boolean): Promise<void> {
  check(options);
  const token = await options.getAccessToken(forceRefresh);
  check(options);
  const endpoint = storageUploadEndpoints(options.projectUrl).standard;
  const path = options.filePath.split('/').map(encodeURIComponent).join('/');
  return new Promise((resolve, reject) => {
    const xhr = tools.createXhr();
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener('abort', abort);
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
      xhr.upload.onprogress = null;
      if (error) reject(error); else resolve();
    };
    const abort = () => { xhr.abort(); finish(aborted()); };
    options.signal.addEventListener('abort', abort, { once: true });
    try {
      check(options);
      xhr.open('POST', `${endpoint}${path}`);
      xhr.withCredentials = false;
      xhr.timeout = 120000;
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', options.publicKey);
      xhr.setRequestHeader('Content-Type', inferUploadMimeType(options.file.name, options.file.type));
      xhr.setRequestHeader('Cache-Control', 'max-age=0');
      // Aucun upsert : une réponse perdue sera réconciliée par taille + SHA-256.
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.upload.onprogress = (event) => {
        try { if (event.lengthComputable) progress(options, 'standard', event.loaded); }
        catch (error) { finish(error); xhr.abort(); }
      };
      xhr.onerror = xhr.ontimeout = () => finish(new TransferError('Le réseau a interrompu le transfert.'));
      xhr.onabort = () => finish(aborted());
      xhr.onload = () => {
        try {
          check(options);
          if (xhr.status < 200 || xhr.status >= 300) throw new TransferError('Le stockage a refusé le transfert.', xhr.status);
          const result: unknown = JSON.parse(xhr.responseText);
          if (typeof result !== 'object' || result === null || !('Key' in result) || result.Key !== `documents/${options.filePath}`) {
            throw new TransferError('La confirmation du stockage est incomplète.', 409);
          }
          progress(options, 'standard', options.file.size);
          finish();
        } catch (error) { finish(error); }
      };
      progress(options, 'standard', 0);
      xhr.send(options.file);
    } catch (error) { finish(error); xhr.abort(); }
  });
}
async function standardUpload(options: StorageUpload, tools: TransportTools) {
  for (let attempt = 0; ; attempt++) {
    try { await standardAttempt(options, tools, false); return; }
    catch (error) {
      check(options);
      if (!(error instanceof TransferError) || !retryable(error.status) || attempt >= UPLOAD_RETRY_DELAYS.length) throw error;
      if (error.status === 401) await options.getAccessToken(true);
      // Une réponse réseau perdue peut cacher un POST réussi. Ne renvoyer les
      // octets qu'après une absence certaine, jamais après un simple 404/refus.
      if (await options.reconcile() === 'present') {
        progress(options, 'standard', options.file.size);
        return;
      }
      check(options);
      await tools.wait(UPLOAD_RETRY_DELAYS[attempt], options.signal);
    }
  }
}

// Stockage d'URL limité à cette identité. Les quotas/modes privés ne doivent
// jamais rejeter addUpload/removeUpload : TUS attend leur résolution pour avancer.
// Les vrais fichiers et la reprise SQL restent conservés séparément en IndexedDB.
function resumableUrlStorage(options: StorageUpload, endpoint: string, fingerprint: string): UrlStorage {
  const key = `amphixdocs-tus-v1:${encodeURIComponent(fingerprint)}`;
  let memory: PreviousUpload | null = null;
  const normalize = (value: unknown): PreviousUpload | null => {
    if (typeof value !== 'object' || value === null || !('uploadUrl' in value)
      || typeof value.uploadUrl !== 'string' || !allowedTusUrl(value.uploadUrl, endpoint)
      || !('creationTime' in value) || typeof value.creationTime !== 'string'
      || !('size' in value) || value.size !== options.file.size) return null;
    const age = Date.now() - Date.parse(value.creationTime);
    if (!Number.isFinite(age) || age < 0 || age >= 24 * 60 * 60 * 1000) return null;
    return {
      size: options.file.size, creationTime: value.creationTime, urlStorageKey: key,
      uploadUrl: value.uploadUrl, parallelUploadUrls: null,
      metadata: { bucketName: 'documents', objectName: options.filePath,
        contentType: inferUploadMimeType(options.file.name, options.file.type), cacheControl: '0' },
    };
  };
  const read = async (): Promise<PreviousUpload[]> => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) memory = normalize(JSON.parse(saved));
    } catch (error) { logDevelopmentError(error, 'Lecture de la reprise réseau'); }
    const candidate = normalize(memory);
    return candidate ? [candidate] : [];
  };
  return {
    findAllUploads: read,
    findUploadsByFingerprint: async (value) => value === fingerprint ? read() : [],
    addUpload: async (value, upload) => {
      if (value !== fingerprint) return key;
      memory = normalize(upload);
      try { if (memory) localStorage.setItem(key, JSON.stringify(memory)); }
      catch (error) { logDevelopmentError(error, 'Sauvegarde de la reprise réseau'); }
      return key;
    },
    removeUpload: async (value) => {
      if (value !== key) return;
      memory = null;
      try { localStorage.removeItem(key); }
      catch (error) { logDevelopmentError(error, 'Retrait de la reprise réseau'); }
    },
  };
}

// XHR fournit les octets réellement envoyés. Chaque requête TUS est bornée :
// une connexion suspendue n'immobilise pas indéfiniment le bouton de dépôt.
function resumableHttpStack(options: StorageUpload, tools: TransportTools): HttpStack {
  return {
    getName: () => 'bounded-xhr',
    createRequest: (method, url): HttpRequest => {
      const xhr = tools.createXhr();
      const headers = new Map<string, string>();
      let rejectPending: ((reason: unknown) => void) | undefined;
      xhr.open(method, url, true);
      xhr.withCredentials = false;
      xhr.timeout = 120000;
      return {
        getMethod: () => method, getURL: () => url,
        setHeader: (name, value) => { headers.set(name.toLowerCase(), value); xhr.setRequestHeader(name, value); },
        getHeader: (name) => headers.get(name.toLowerCase()),
        setProgressHandler: (handler) => {
          xhr.upload.onprogress = (event) => { if (event.lengthComputable) handler(event.loaded); };
        },
        getUnderlyingObject: () => xhr,
        abort: async () => { rejectPending?.(aborted()); xhr.abort(); },
        send: (body: Parameters<XMLHttpRequest['send']>[0]) => new Promise<HttpResponse>((resolve, reject) => {
          let settled = false;
          const finish = (error?: unknown) => {
            if (settled) return;
            settled = true;
            rejectPending = undefined;
            xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
            xhr.upload.onprogress = null;
            if (error) reject(error);
            else resolve({
              getStatus: () => xhr.status, getHeader: (name) => xhr.getResponseHeader(name) ?? undefined,
              getBody: () => xhr.responseText, getUnderlyingObject: () => xhr,
            });
          };
          rejectPending = finish;
          xhr.onerror = xhr.ontimeout = () => finish(new TransferError('Le réseau a interrompu le transfert.'));
          xhr.onabort = () => finish(aborted());
          xhr.onload = () => { try { check(options); finish(); } catch (error) { finish(error); } };
          try { check(options); xhr.send(body); } catch (error) { finish(error); }
        }),
      };
    },
  };
}
async function resumableUpload(options: StorageUpload, tools: TransportTools): Promise<void> {
  const { Upload } = await tools.loadTus();
  check(options);
  const endpoint = storageUploadEndpoints(options.projectUrl).resumable;
  // Ni JWT ni clé dans l'empreinte ou les métadonnées persistées par tus-js-client.
  // Une autre identité, un autre compte/projet ou d'autres octets ne se rattachent
  // jamais à cette URL de reprise.
  const fingerprint = JSON.stringify(['document-tus-v1', options.projectUrl, options.userId, options.filePath, options.sha256]);
  return new Promise((resolve, reject) => {
    let upload: TusUpload;
    let settled = false;
    let refreshNextRequest = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => {
      // false : ne pas supprimer le transfert distant ; la même identité pourra
      // reprendre après reconnexion ou recréation de la page Android.
      void upload?.abort(false).catch((error) => logDevelopmentError(error, 'Arrêt du transfert'));
      finish(aborted());
    };
    const settings: UploadOptions = {
      endpoint, chunkSize: TUS_CHUNK_SIZE, retryDelays: [...UPLOAD_RETRY_DELAYS],
      httpStack: resumableHttpStack(options, tools),
      urlStorage: resumableUrlStorage(options, endpoint, fingerprint),
      uploadDataDuringCreation: true, removeFingerprintOnSuccess: true,
      fingerprint: async () => fingerprint,
      metadata: { bucketName: 'documents', objectName: options.filePath,
        contentType: inferUploadMimeType(options.file.name, options.file.type), cacheControl: '0' },
      onBeforeRequest: async (request) => {
        check(options);
        // Les URL de reprise viennent du navigateur ou d'une réponse HTTP : ne
        // jamais envoyer une session vers un hôte/chemin substitué.
        if (!allowedTusUrl(request.getURL(), endpoint)) throw new Error('Adresse de reprise incompatible.');
        const token = await options.getAccessToken(refreshNextRequest);
        refreshNextRequest = false;
        check(options);
        request.setHeader('Authorization', `Bearer ${token}`);
        request.setHeader('apikey', options.publicKey);
      },
      onShouldRetry: (error) => {
        if (options.signal.aborted || settled) return false;
        try { check(options); } catch { return false; }
        const status = error.originalResponse?.getStatus() ?? 0;
        if (status === 401) refreshNextRequest = true;
        return retryable(status) || status === 409 || status === 423;
      },
      onProgress: (uploaded) => {
        if (settled) return;
        try { progress(options, 'tus', uploaded); } catch { abort(); }
      },
      onError: (error) => finish(error),
      onSuccess: () => {
        try { check(options); progress(options, 'tus', options.file.size); finish(); }
        catch (error) { finish(error); }
      },
    };
    upload = new Upload(options.file, settings);
    options.signal.addEventListener('abort', abort, { once: true });
    void (async () => {
      try {
        check(options);
        try {
          const previous = await upload.findPreviousUploads();
          check(options);
          const candidate = previous.filter((item) => item.uploadUrl && allowedTusUrl(item.uploadUrl, endpoint)
            && Number.isFinite(Date.parse(item.creationTime)) && Date.now() - Date.parse(item.creationTime) < 24 * 60 * 60 * 1000)
            .sort((a, b) => Date.parse(b.creationTime) - Date.parse(a.creationTime))[0];
          if (candidate) upload.resumeFromPreviousUpload(candidate);
        } catch (error) {
          check(options);
          // IndexedDB garde toujours le fichier et son identité. Un stockage TUS
          // indisponible n'empêche pas un nouvel essai sans écrasement de l'objet.
          logDevelopmentError(error, 'Lecture de la reprise du transfert');
        }
        check(options);
        if (!settled) upload.start();
      } catch (error) { finish(error); }
    })();
  });
}

export async function uploadStorageFile(options: StorageUpload, tools: TransportTools = defaultTools): Promise<void> {
  check(options);
  if (options.file.size > TUS_CHUNK_SIZE) await resumableUpload(options, tools);
  else await standardUpload(options, tools);
  check(options);
}
