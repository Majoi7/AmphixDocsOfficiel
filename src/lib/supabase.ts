import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, DocumentRow, DocumentTrashState, ProfileRow, UserRole } from './database.types';
import { getSupabaseClient, getSupabaseClientState, subscribeSupabaseClient } from './supabase-config';
import { errorMessage } from './errors';
import { assertPreviewIdentity, finishDocumentPreview, needsDocumentPreview } from './preview-completion';
import type { GeneratedPreview } from './preview-generation';
import { uploadStorageFile, type UploadProgress } from './upload-transport';

export {
  getStoredSupabaseConfig, isSupabaseConfigured, reinitializeSupabase,
  resetSupabaseConfig, getSupabaseClient, getSupabaseClientState,
  subscribeSupabaseClient, supabase,
} from './supabase-config';
export type { ItemStatus, UserRole, DocumentTrashState } from './database.types';

export type FileCategory = 'pdf' | 'image' | 'doc' | 'autre';
interface AuthorPresentation {
  author_name?: string;
  author_avatar?: string;
  author_email?: string;
}
export type DocumentItem = DocumentRow & AuthorPresentation;
export interface UserProfile extends ProfileRow { document_count: number }
type AuthorRow = Pick<ProfileRow, 'full_name' | 'avatar_url' | 'email'>;
type WithAuthor = DocumentRow & { profiles?: AuthorRow | null };
const DOCUMENT_COLUMNS = 'id,user_id,title,description,file_name,file_path,file_type,file_size,created_at,school_name,subject_name,status,rejection_reason,reviewed_by,reviewed_at,deleted_at,deleted_by,thumbnail_path,page_count';
const DOCUMENT_SELECT = `${DOCUMENT_COLUMNS},profiles:profiles!documents_user_id_profiles_fkey(full_name,avatar_url,email)`;
export const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024;
export const MAX_CLASSIFICATION_LENGTH = 120;

export function assertUuid(value: string, label = 'Identifiant'): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} invalide. Actualisez la session et réessayez.`);
  }
}
function mapDocument({ profiles, ...row }: WithAuthor): DocumentItem {
  if (!['pending', 'approved', 'rejected'].includes(row.status)
    || !('school_name' in row) || !('subject_name' in row) || !('deleted_at' in row) || !('deleted_by' in row)) {
    throw new Error('Le contrat des fichiers est incompatible. Faites appliquer et vérifier la migration V5 avant de continuer.');
  }
  return { ...row, author_name: profiles?.full_name || 'Utilisateur',
    author_avatar: profiles?.avatar_url || '', author_email: profiles?.email || '' };
}

export function detectFileCategory(fileName: string, mimeType?: string): FileCategory {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mime = (mimeType || '').toLowerCase();
  if (ext === 'pdf' || mime.includes('pdf')) return 'pdf';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext) || mime.startsWith('image/')) return 'image';
  if (['doc', 'docx', 'odt', 'txt', 'rtf', 'md', 'pages', 'csv', 'xls', 'xlsx'].includes(ext)
    || mime.includes('word') || mime.includes('document') || mime.includes('text/')) return 'doc';
  return 'autre';
}
export function getFileCategory(value: string | null): FileCategory {
  return value === 'pdf' || value === 'image' || value === 'doc' ? value : 'autre';
}
export function formatFileSize(bytes: number | null): string {
  if (bytes === null || !Number.isSafeInteger(bytes) || bytes < 0) return 'Taille inconnue';
  if (bytes === 0) return '0 Ko';
  const units = ['Octets', 'Ko', 'Mo', 'Go'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${Number((bytes / 1024 ** index).toFixed(1))} ${units[index]}`;
}
export function formatDateFrench(value: string | null): string {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date inconnue';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
export function compareDates(a: string | null, b: string | null, order: 'asc' | 'desc' = 'desc'): number {
  const first = a ? Date.parse(a) : Number.NaN;
  const second = b ? Date.parse(b) : Number.NaN;
  if (!Number.isFinite(first)) return Number.isFinite(second) ? 1 : 0;
  if (!Number.isFinite(second)) return -1;
  return order === 'asc' ? first - second : second - first;
}
export const FILE_BADGES: Record<FileCategory, { label: string; bg: string; text: string; dot: string; border: string }> = {
  pdf: { label: 'PDF', bg: 'bg-[#d83434]', text: 'text-white', dot: 'bg-[#d83434]', border: 'border-[#d83434]' },
  image: { label: 'IMG', bg: 'bg-[#ffb6e1]', text: 'text-[#141414]', dot: 'bg-[#ffb6e1]', border: 'border-[#ffb6e1]' },
  doc: { label: 'DOC', bg: 'bg-[#9ab8ff]', text: 'text-[#141414]', dot: 'bg-[#9ab8ff]', border: 'border-[#9ab8ff]' },
  autre: { label: 'AUTRE', bg: 'bg-[#ffd23f]', text: 'text-[#141414]', dot: 'bg-[#ffd23f]', border: 'border-[#ffd23f]' },
};
export const STATUS_CONFIG = {
  pending: { label: 'En attente', bg: 'bg-[#ffd23f]/20', text: 'text-[#946200]', border: 'border-[#ffd23f]/60' },
  approved: { label: 'Approuvé', bg: 'bg-emerald-500/15', text: 'text-emerald-700', border: 'border-emerald-500/30' },
  rejected: { label: 'Refusé', bg: 'bg-[#ffb6e1]/30', text: 'text-[#b0245e]', border: 'border-[#ffb6e1]/70' },
};

export async function fetchUserRole(userId: string, client = getSupabaseClient()): Promise<UserRole> {
  assertUuid(userId, 'Identifiant du compte');
  const { data, error } = await client.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (error) throw new Error(`Impossible de vérifier votre profil : ${errorMessage(error)}`);
  if (!data) throw new Error('Votre profil est absent ou inaccessible. Réessayez ; si cela persiste, faites vérifier les profils et leurs droits par une personne administratrice.');
  if (data.role !== 'admin' && data.role !== 'user') throw new Error('Le rôle du profil est invalide. Faites vérifier le contrat de la table profiles.');
  return data.role;
}
export const LIBRARY_PAGE_SIZE = 20;
export interface LibraryPageOptions { query?: string; trash?: boolean; pending?: boolean; offset?: number; ascending?: boolean }

export async function fetchDashboardData(
  userId: string, _isAdmin?: boolean, client = getSupabaseClient(), options: LibraryPageOptions = {}
): Promise<{ documents: DocumentItem[] }> {
  assertUuid(userId, 'Identifiant du compte');
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Cette page est indisponible. Actualisez la liste.');
  // Filtrage et limite sont exécutés en base AVANT la pagination. Le booléen
  // d'interface n'accorde aucun droit : RPC invoker + RLS et contrôle SQL admin.
  const result = await client.rpc('list_library_documents', {
    p_query: options.query?.trim() || '', p_trash: options.trash ?? false,
    p_pending: options.pending ?? false, p_offset: offset, p_ascending: options.ascending ?? false,
  }).select(DOCUMENT_SELECT);
  if (result.error) throw new Error(`Impossible de charger les fichiers : ${errorMessage(result.error)}`);
  if (!Array.isArray(result.data) || result.data.length > LIBRARY_PAGE_SIZE) {
    throw new Error('La liste est indisponible. Réessayez.');
  }
  return { documents: result.data.map(mapDocument) };
}

// Une page « en attente » ne contient plus les documents approuvés. Leur
// absence n'est pas une preuve : les confirmations relisent les cibles exactes.
export async function fetchDocumentTargets(ids: readonly string[], actorId: string): Promise<DocumentItem[]> {
  const targets = [...new Set(ids)];
  targets.forEach((id) => assertUuid(id, 'Identifiant du fichier'));
  if (targets.length === 0) return [];
  return withUploadClient(actorId, getSupabaseClientState().config.url, async (client, check) => {
    const documents: DocumentItem[] = [];
    for (let offset = 0; offset < targets.length; offset += LIBRARY_PAGE_SIZE) {
      check();
      const result = await client.from('documents').select(DOCUMENT_SELECT).in('id', targets.slice(offset, offset + LIBRARY_PAGE_SIZE));
      check();
      if (result.error || !Array.isArray(result.data)) throw new Error(`Impossible de vérifier ces fichiers : ${errorMessage(result.error)}`);
      documents.push(...result.data.map(mapDocument));
    }
    return documents;
  });
}

export type UploadStage = 'transfert' | 'enregistrement' | 'verification' | 'termine';
export type UploadFailureKind = 'retryable' | 'uncertain' | 'conflict' | 'scope';
export interface UploadIdentity { id: string; filePath: string }
// Compatibilité strictement réservée aux traces V1 : aucun classement ancien
// n'est proposé dans l'interface ni créé lors d'une reprise.
export interface LegacyUploadClassification { folderId: string | null; categoryId: string | null }
export interface UploadDocumentRequest {
  identity: UploadIdentity;
  userId: string;
  title: string;
  description: string;
  fileName: string;
  fileSize: number;
  fileType: FileCategory;
  sha256: string;
  schoolName: string | null;
  subjectName: string | null;
  legacyClassification?: LegacyUploadClassification;
}
export class DocumentUploadError extends Error {
  constructor(message: string, public readonly identity: UploadIdentity,
    public readonly storageConfirmed: boolean, public readonly kind: UploadFailureKind = 'uncertain') {
    super(message);
    this.name = 'DocumentUploadError';
  }
}
class UploadScopeError extends Error {}
export function createUploadIdentity(file: Pick<File, 'name'>, userId: string, id: string = crypto.randomUUID()): UploadIdentity {
  assertUuid(userId, 'Identifiant du compte');
  assertUuid(id, 'Identifiant du dépôt');
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  return { id, filePath: `${userId}/${id}-${safeName}` };
}
function validateDocumentFields(title: string, description: string) {
  if (!title.trim()) throw new Error('Le titre du fichier est obligatoire.');
  if ([...description].length > 200) throw new Error('La description ne doit pas dépasser 200 caractères.');
}
export function validateClassification(schoolName: string, subjectName: string): void {
  if (!schoolName.trim() || !subjectName.trim()) throw new Error('Renseignez une école et une matière.');
  if ([...schoolName.trim()].length > MAX_CLASSIFICATION_LENGTH || [...subjectName.trim()].length > MAX_CLASSIFICATION_LENGTH) {
    throw new Error('L’école et la matière sont limitées à 120 caractères chacune.');
  }
}
export async function hashUploadFile(file: Blob): Promise<string> {
  if (file.size > MAX_DOCUMENT_SIZE) throw new Error('Le fichier dépasse la limite de 20 Mo.');
  if (!globalThis.crypto?.subtle) throw new Error('La vérification du contenu nécessite un navigateur sécurisé (HTTPS ou localhost). Aucun dépôt n’a été démarré.');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function prepareUploadDocument(
  file: File, title: string, description: string, userId: string,
  schoolName: string, subjectName: string, id: string = crypto.randomUUID()
): Promise<UploadDocumentRequest> {
  validateDocumentFields(title, description);
  validateClassification(schoolName, subjectName);
  if (!file.name) throw new Error('Le fichier doit avoir un nom.');
  return { identity: createUploadIdentity(file, userId, id), userId,
    title: title.trim(), description: description.trim(), fileName: file.name, fileSize: file.size,
    fileType: detectFileCategory(file.name, file.type), sha256: await hashUploadFile(file),
    schoolName: schoolName.trim(), subjectName: subjectName.trim() };
}
function validateUploadRequest(request: UploadDocumentRequest): void {
  validateDocumentFields(request.title, request.description);
  const expected = createUploadIdentity({ name: request.fileName }, request.userId, request.identity.id);
  if (!request.fileName || request.identity.filePath !== expected.filePath) throw new Error('L’identité du dépôt ne correspond pas au fichier et à son propriétaire.');
  if (!Number.isSafeInteger(request.fileSize) || request.fileSize < 0 || request.fileSize > MAX_DOCUMENT_SIZE) throw new Error('La taille du fichier est invalide ou dépasse 20 Mo.');
  if (!/^[a-f0-9]{64}$/.test(request.sha256)) throw new Error('L’empreinte du fichier est absente ou invalide. Le dépôt ne peut pas être repris sans vérification.');
  if (!['pdf', 'image', 'doc', 'autre'].includes(request.fileType)) throw new Error('Le type du fichier est invalide.');
  if (request.legacyClassification) {
    if (request.legacyClassification.folderId) assertUuid(request.legacyClassification.folderId, 'Identifiant historique');
    if (request.legacyClassification.categoryId) assertUuid(request.legacyClassification.categoryId, 'Identifiant historique');
  }
  if (request.schoolName === null && request.subjectName === null && request.legacyClassification) return;
  if (request.schoolName === null || request.subjectName === null) throw new Error('Renseignez une école et une matière.');
  validateClassification(request.schoolName, request.subjectName);
}

// Le JWT reste uniquement en mémoire. Chaque requête utilise la session courante
// du compte d'origine, vérifiée à nouveau lorsque son jeton est renouvelé.
async function withUploadClient<T>(
  userId: string, projectUrl: string, operation: (client: SupabaseClient<Database>, check: () => void, signal: AbortSignal,
    credentials: { publicKey: string; getAccessToken: (forceRefresh?: boolean) => Promise<string> }) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  assertUuid(userId, 'Identifiant du compte');
  const origin = getSupabaseClientState();
  if (!origin.client || origin.config.url !== projectUrl) throw new UploadScopeError('Rétablissez le projet d’origine et sa session pour vérifier cette opération.');
  const authClient = origin.client;
  const controller = new AbortController();
  let invalidated = false;
  const invalidate = () => { invalidated = true; controller.abort(); };
  signal?.addEventListener('abort', invalidate, { once: true });
  if (signal?.aborted) invalidate();
  const check = () => {
    const current = getSupabaseClientState();
    if (invalidated || current.client !== authClient || current.generation !== origin.generation
      || current.config.url !== projectUrl || current.config.key !== origin.config.key) {
      throw new UploadScopeError('Le compte ou le projet a changé. L’identité est conservée ; reconnectez le compte d’origine pour vérifier le résultat.');
    }
  };
  const unsubscribeClient = subscribeSupabaseClient(() => {
    try { check(); } catch { invalidate(); }
  });
  const { data: { subscription } } = authClient.auth.onAuthStateChange((_event, session) => {
    if (session?.user?.id !== userId) invalidate();
  });
  let verifiedToken: string | null = null;
  let tokenRequest: Promise<string> | null = null;
  const readToken = async (forceRefresh: boolean): Promise<string> => {
    check();
    const sessionResult = await authClient.auth.getSession();
    check();
    let session = sessionResult.data.session;
    if (sessionResult.error || !session || session.user.id !== userId) throw new UploadScopeError('La session du compte d’origine n’est plus disponible. Reconnectez-vous avant de reprendre.');
    if (forceRefresh || (session.expires_at !== undefined && session.expires_at * 1000 <= Date.now() + 60_000)) {
      const refreshed = await authClient.auth.refreshSession();
      check();
      const refreshedSession = refreshed.data.session;
      if (refreshed.error || !refreshedSession || refreshedSession.user.id !== userId) throw new UploadScopeError('Reconnectez-vous au compte utilisé pour ce dépôt, puis réessayez.');
      session = refreshedSession;
    }
    const accessToken = session.access_token;
    if (accessToken !== verifiedToken) {
      const verified = await authClient.auth.getUser(accessToken);
      check();
      if (verified.error || verified.data.user?.id !== userId) throw new UploadScopeError(`La session n’a pas pu être vérifiée : ${errorMessage(verified.error, 'Compte incompatible.')} Aucun nouvel envoi n’est autorisé.`);
      verifiedToken = accessToken;
    }
    return accessToken;
  };
  const getAccessToken = async (forceRefresh = false): Promise<string> => {
    if (tokenRequest) {
      const pending = tokenRequest;
      if (!forceRefresh) return pending;
      await pending;
    }
    const pending = readToken(forceRefresh);
    tokenRequest = pending;
    try { return await pending; }
    finally { if (tokenRequest === pending) tokenRequest = null; }
  };
  try {
    await getAccessToken();
    const client = createClient<Database>(projectUrl, origin.config.key, {
      accessToken: getAccessToken,
      global: { fetch: (input, init) => { check(); return globalThis.fetch(input, { ...init, signal: controller.signal, cache: 'no-store' }); } },
    });
    const result = await operation(client, check, controller.signal, { publicKey: origin.config.key, getAccessToken });
    check();
    const currentSession = await authClient.auth.getSession();
    check();
    if (currentSession.error || currentSession.data.session?.user.id !== userId) throw new UploadScopeError('La session a changé avant la confirmation. Vérifiez cette opération avec son compte d’origine.');
    return result;
  } finally {
    signal?.removeEventListener('abort', invalidate);
    subscription.unsubscribe();
    unsubscribeClient();
    controller.abort();
  }
}
function matchesUploadDocument(row: DocumentRow, request: UploadDocumentRequest): boolean {
  const classificationMatches = (request.legacyClassification && row.school_name === null && row.subject_name === null)
    || (row.school_name === request.schoolName && row.subject_name === request.subjectName);
  return row.id === request.identity.id && row.user_id === request.userId
    && row.file_path === request.identity.filePath && row.file_name === request.fileName
    && row.file_size === request.fileSize && row.file_type === request.fileType
    && row.title === request.title.trim() && row.description === (request.description.trim() || null)
    && !!classificationMatches;
}
function isMissingStorageObject(error: unknown): boolean {
  // Un 404 générique ou un refus d'accès n'est jamais une preuve d'absence.
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'NoSuchKey'
    && 'status' in error && (error.status === 400 || error.status === 404);
}
export async function resumeUserDocument(
  request: UploadDocumentRequest, file?: File, onStage?: (stage: UploadStage) => void,
  projectUrl = getSupabaseClientState().config.url, mode: 'initial' | 'resume' = 'resume',
  onProgress?: (progress: UploadProgress) => void
): Promise<DocumentItem> {
  validateUploadRequest(request);
  let storageConfirmed = false;
  let currentStage: UploadStage | null = null;
  const publishStage = (stage: UploadStage) => {
    if (currentStage === stage) return;
    currentStage = stage;
    onStage?.(stage);
  };
  const failure = (message: string, kind: UploadFailureKind = 'uncertain') => new DocumentUploadError(message, request.identity, storageConfirmed, kind);
  try {
    const document = await withUploadClient(request.userId, projectUrl, async (client, check, signal, credentials) => {
      const lookup = async (): Promise<WithAuthor | null> => {
        check();
        let row: WithAuthor | null;
        if (request.legacyClassification) {
          const result = await client.rpc('get_legacy_upload_document', {
            p_document_id: request.identity.id, p_folder_id: request.legacyClassification.folderId,
            p_category_id: request.legacyClassification.categoryId,
          }).maybeSingle();
          check();
          if (result.error) throw failure(`Impossible de vérifier la trace historique : ${errorMessage(result.error)} Aucun nouvel objet n’a été créé.`, result.error.code === '23514' ? 'conflict' : 'uncertain');
          row = result.data;
        } else {
          const result = await client.from('documents').select(DOCUMENT_SELECT)
            .eq('id', request.identity.id).eq('user_id', request.userId).maybeSingle();
          check();
          if (result.error) throw failure(`Impossible de vérifier les métadonnées : ${errorMessage(result.error)} Aucun nouvel objet n’a été créé.`);
          row = result.data;
        }
        if (row && !matchesUploadDocument(row, request)) throw failure('Les métadonnées existantes ne correspondent pas à ce dépôt. Aucun écrasement ni nettoyage effectué ; faites vérifier son identité.', 'conflict');
        return row;
      };
      const verifyStorage = async (): Promise<'present' | 'missing'> => {
        publishStage('verification');
        check();
        const result = await client.storage.from('documents').download(request.identity.filePath, {}, { cache: 'no-store' });
        check();
        if (result.error) {
          if (isMissingStorageObject(result.error)) return 'missing';
          throw failure(`La lecture du fichier distant n’a pas été confirmée : ${errorMessage(result.error)} Ne recommencez pas sous une nouvelle identité.`);
        }
        if (!result.data || result.data.size !== request.fileSize || await hashUploadFile(result.data) !== request.sha256) {
          throw failure('Le contenu distant ne correspond pas à l’empreinte du fichier. Aucun objet écrasé ou supprimé ; faites vérifier le dépôt.', 'conflict');
        }
        check();
        storageConfirmed = true;
        return 'present';
      };
      publishStage('verification');
      const existing = await lookup();
      if (existing) {
        if (await verifyStorage() !== 'present') throw failure('Les métadonnées existent, mais le fichier n’est pas accessible. Aucune compensation automatique effectuée.');
        return mapDocument(existing);
      }
      // Une ancienne ligne déjà migrée peut être confirmée sans classement.
      // Une ligne nouvelle exige un choix explicite, figé et journalisé par l'UI.
      if (request.schoolName === null || request.subjectName === null) throw failure('Renseignez une école et une matière pour terminer ce dépôt ancien, puis reprenez sous la même identité.', 'retryable');
      const stored = mode === 'resume' ? await verifyStorage() : 'missing';
      if (stored !== 'present') {
        if (!file) throw failure(`Resélectionnez « ${request.fileName} » pour reprendre son transfert. L’identité précédente est conservée.`, 'retryable');
        if (file.name !== request.fileName || file.size !== request.fileSize || await hashUploadFile(file) !== request.sha256) {
          throw failure('Le fichier resélectionné ne correspond pas à l’original (nom, taille ou contenu). Aucun nouvel envoi effectué.', 'conflict');
        }
        check();
        publishStage('transfert');
        let transferError: unknown = null;
        try {
          await uploadStorageFile({
            projectUrl, publicKey: credentials.publicKey, userId: request.userId,
            filePath: request.identity.filePath, sha256: request.sha256, file,
            signal, checkScope: check, getAccessToken: credentials.getAccessToken,
            reconcile: verifyStorage,
            onProgress: (progress) => { check(); publishStage('transfert'); onProgress?.(progress); },
          });
          check();
          storageConfirmed = true;
        } catch (error) { check(); transferError = error; }
        if (!storageConfirmed && await verifyStorage() !== 'present') throw failure(`Le transfert n’a pas été confirmé : ${errorMessage(transferError)} Réessayez sous la même identité.`, 'retryable');
      }
      check();
      publishStage('enregistrement');
      let confirmed: WithAuthor | null = null;
      let insertError: unknown = null;
      try {
        if (request.legacyClassification) {
          const response = await client.rpc('finalize_legacy_upload', {
            p_document_id: request.identity.id, p_title: request.title.trim(), p_description: request.description.trim(),
            p_file_name: request.fileName, p_file_path: request.identity.filePath,
            p_file_type: request.fileType, p_file_size: request.fileSize,
            p_folder_id: request.legacyClassification.folderId, p_category_id: request.legacyClassification.categoryId,
            p_school_name: request.schoolName, p_subject_name: request.subjectName,
          }).single();
          check();
          confirmed = response.data;
          insertError = response.error;
        } else {
          const response = await client.from('documents').insert([{
            id: request.identity.id, user_id: request.userId, title: request.title.trim(),
            description: request.description.trim() || null, file_name: request.fileName,
            file_path: request.identity.filePath, file_type: request.fileType, file_size: request.fileSize,
            school_name: request.schoolName, subject_name: request.subjectName, status: 'pending',
          }]).select(DOCUMENT_SELECT).single();
          check();
          confirmed = response.data;
          insertError = response.error;
        }
      } catch (error) { check(); insertError = error; }
      if (insertError || !confirmed) {
        publishStage('verification');
        confirmed = await lookup();
        if (!confirmed) throw failure(`Le fichier est conservé, mais les métadonnées ne sont pas confirmées : ${errorMessage(insertError, 'Réponse SQL absente.')} Reprenez sans renvoyer les fichiers déjà confirmés.`);
      }
      if (!matchesUploadDocument(confirmed, request)) throw failure('La réponse SQL ne correspond pas exactement au dépôt. Aucun objet supprimé ; faites vérifier cette opération.', 'conflict');
      check();
      return mapDocument(confirmed);
    });
    publishStage('termine');
    return document;
  } catch (error) {
    if (error instanceof DocumentUploadError) throw error;
    throw failure(errorMessage(error), error instanceof UploadScopeError ? 'scope' : 'uncertain');
  }
}
export async function uploadUserDocument(
  file: File, title: string, description: string, userId: string, schoolName: string, subjectName: string,
  onStage?: (stage: UploadStage) => void, identity?: UploadIdentity
): Promise<DocumentItem> {
  const request = await prepareUploadDocument(file, title, description, userId, schoolName, subjectName, identity?.id);
  if (identity && identity.filePath !== request.identity.filePath) throw new Error('L’identité du dépôt ne correspond pas au fichier.');
  return resumeUserDocument(request, file, onStage, getSupabaseClientState().config.url, identity ? 'resume' : 'initial');
}
export async function getDocumentThumbnailUrls(paths: readonly string[], actorId: string): Promise<Record<string, string>> {
  const unique = [...new Set(paths)];
  if (!unique.length) return {};
  return withUploadClient(actorId, getSupabaseClientState().config.url, async (client, check) => {
    // Un seul aller-retour pour la sélection entière ; les cartes ne signent rien.
    const result = await client.storage.from('document-thumbnails').createSignedUrls(unique, 120);
    check();
    if (result.error || !Array.isArray(result.data)) throw new Error(errorMessage(result.error, 'Aperçus indisponibles. Réessayez.'));
    const urls: Record<string, string> = {};
    for (const item of result.data) {
      if (!item.error && item.path && unique.includes(item.path) && item.signedUrl) urls[item.path] = item.signedUrl;
    }
    return urls;
  });
}

async function readPreviewDocument(client: SupabaseClient<Database>, expected: DocumentItem, check: () => void): Promise<DocumentItem> {
  assertUuid(expected.id);
  const result = await client.from('documents').select(DOCUMENT_SELECT).eq('id', expected.id).is('deleted_at', null).maybeSingle();
  check();
  if (result.error || !result.data) throw new Error(errorMessage(result.error, 'Fichier indisponible.'));
  const document = mapDocument(result.data);
  assertPreviewIdentity(expected, document);
  return document;
}
async function downloadPreviewSource(
  client: SupabaseClient<Database>, document: DocumentItem, check: () => void, signal: AbortSignal
): Promise<Blob> {
  const signed = await client.storage.from('documents').createSignedUrl(document.file_path, 60);
  check();
  if (signed.error || !signed.data?.signedUrl) throw new Error('Le fichier est indisponible.');
  const response = await globalThis.fetch(signed.data.signedUrl, {
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal,
  });
  check();
  if (!response.ok || !response.body) throw new Error('Le fichier ne peut pas être lu.');
  if (Number(response.headers.get('content-length')) > MAX_DOCUMENT_SIZE) {
    await response.body.cancel();
    throw new Error('Fichier trop volumineux.');
  }
  // Borne également les réponses sans Content-Length avant de construire le Blob.
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      check();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DOCUMENT_SIZE) throw new Error('Fichier trop volumineux.');
      chunks.push(Uint8Array.from(value).buffer);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  if (!size || (document.file_size !== null && document.file_size !== size)) throw new Error('Le fichier est incomplet.');
  return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
}
export async function getDocumentPreviewSource(expected: DocumentItem, actorId: string, signal?: AbortSignal): Promise<Blob> {
  return withUploadClient(actorId, getSupabaseClientState().config.url, async (client, check, scopedSignal) => {
    const document = await readPreviewDocument(client, expected, check);
    return downloadPreviewSource(client, document, check, scopedSignal);
  }, signal);
}

async function saveDocumentPreview(
  client: SupabaseClient<Database>, expected: DocumentItem, preview: GeneratedPreview, check: () => void
): Promise<DocumentItem> {
  let document = await readPreviewDocument(client, expected, check);
  if (!needsDocumentPreview(document)) return document;
  let path = document.thumbnail_path;
  if (!path) {
    const blob = preview.blob;
    if (!blob || blob.type !== 'image/jpeg' || blob.size < 1 || blob.size > 1048576) throw new Error('Miniature incompatible.');
    assertUuid(document.user_id);
    const hash = await hashUploadFile(blob);
    check();
    path = `${document.user_id}/${document.id}/${hash}.jpg`;
    const uploaded = await client.storage.from('document-thumbnails').upload(path, blob, {
      contentType: 'image/jpeg', cacheControl: '0', upsert: false,
    });
    check();
    if (uploaded.error) {
      // Une réponse perdue ou un doublon peut cacher un objet déjà reçu. Vérifier
      // ses octets, sans l'écraser ni supprimer un objet non encore associé.
      const existing = await client.storage.from('document-thumbnails').download(path, {}, { cache: 'no-store' });
      check();
      if (existing.error || !existing.data || existing.data.size !== blob.size || await hashUploadFile(existing.data) !== hash) {
        throw new Error(errorMessage(uploaded.error, 'La miniature n’a pas été reçue.'));
      }
      check();
    } else if (uploaded.data.path !== path) throw new Error('Le transfert de la miniature n’a pas été confirmé.');
  }
  // Une génération concurrente peut avoir associé un autre JPEG entre-temps.
  document = await readPreviewDocument(client, document, check);
  if (!needsDocumentPreview(document)) return document;
  path = document.thumbnail_path || path;
  if (document.page_count !== null && document.page_count !== preview.pageCount) throw new Error('Le nombre de pages a changé.');
  const result = await client.rpc('set_document_preview', {
    p_document_id: document.id, p_thumbnail_path: path, p_page_count: preview.pageCount,
  });
  check();
  if (result.error || !Array.isArray(result.data) || result.data.length !== 1) throw new Error(errorMessage(result.error, 'L’aperçu n’a pas été enregistré.'));
  const confirmed = mapDocument(result.data[0]);
  assertPreviewIdentity(document, confirmed);
  if (confirmed.thumbnail_path !== path || confirmed.page_count !== preview.pageCount) throw new Error('L’aperçu n’a pas été confirmé.');
  return { ...document, ...confirmed, author_name: document.author_name, author_avatar: document.author_avatar, author_email: document.author_email };
}
export async function completeDocumentPreview(
  expected: DocumentItem, actorId: string, source?: Blob, signal?: AbortSignal, requireAdmin = false
): Promise<DocumentItem> {
  if (!needsDocumentPreview(expected)) return expected;
  return withUploadClient(actorId, getSupabaseClientState().config.url, async (client, check, scopedSignal) => {
    const checkRole = async () => {
      if (requireAdmin && await fetchUserRole(actorId, client) !== 'admin') throw new Error('Vos droits ont changé.');
      check();
    };
    await checkRole();
    const confirmed = await finishDocumentPreview(expected, {
      check,
      read: () => readPreviewDocument(client, expected, check),
      source: (document) => downloadPreviewSource(client, document, check, scopedSignal),
      generate: async (blob, type, options) => {
        const { generateDocumentPreview } = await import('./preview-generation');
        check();
        return generateDocumentPreview(blob, type, options);
      },
      save: async (document, preview) => { await checkRole(); return saveDocumentPreview(client, document, preview, check); },
    }, source, scopedSignal);
    await checkRole();
    return confirmed;
  }, signal);
}
export async function getMissingDocumentPreviews(actorId: string, afterId: string | null = null, signal?: AbortSignal): Promise<DocumentItem[]> {
  if (afterId) assertUuid(afterId);
  return withUploadClient(actorId, getSupabaseClientState().config.url, async (client, check) => {
    const result = await client.rpc('get_missing_document_previews', { p_after_id: afterId });
    check();
    if (result.error || !Array.isArray(result.data) || result.data.length > 20) throw new Error(errorMessage(result.error, 'La liste des aperçus est indisponible.'));
    return result.data.map(mapDocument);
  }, signal);
}

export async function getDocumentSignedUrl(filePath: string, downloadName?: string): Promise<string> {
  const { data, error } = await getSupabaseClient().storage.from('documents').createSignedUrl(filePath, 60, downloadName ? { download: downloadName } : undefined);
  if (error || !data?.signedUrl) throw new Error(`Impossible d’ouvrir le fichier : ${errorMessage(error, 'Le lien signé est absent.')}`);
  return data.signedUrl;
}
function confirmTarget(data: { id: string }[] | null, id: string, action: string) {
  if (!data || data.length !== 1 || data[0].id !== id) throw new Error(`${action} : aucune cible exacte confirmée. Actualisez et vérifiez vos droits avant de réessayer.`);
}
export async function updateDocumentMetadata(id: string, title: string, description: string, userId: string): Promise<void> {
  assertUuid(id, 'Identifiant du fichier');
  validateDocumentFields(title, description);
  await withUploadClient(userId, getSupabaseClientState().config.url, async (client, check) => {
    const { data, error } = await client.from('documents').update({ title: title.trim(), description: description.trim() || null })
      .eq('id', id).is('deleted_at', null).select('id');
    check();
    if (error) throw new Error(`La modification a échoué : ${errorMessage(error)}`);
    confirmTarget(data, id, 'Modification non confirmée');
  });
}
export async function setDocumentTrash(id: string, deleted: boolean, userId: string): Promise<DocumentTrashState> {
  assertUuid(id, 'Identifiant du fichier');
  return withUploadClient(userId, getSupabaseClientState().config.url, async (client, check) => {
    const { data, error } = await client.rpc('set_document_trash', { p_document_id: id, p_deleted: deleted });
    check();
    if (error) throw new Error(`L’action de corbeille n’a pas été confirmée : ${errorMessage(error)} Réessayez la même action ; elle est idempotente.`);
    confirmTarget(data, id, 'Action de corbeille non confirmée');
    const state = data![0];
    const trashed = typeof state.deleted_at === 'string' && Number.isFinite(Date.parse(state.deleted_at)) && typeof state.deleted_by === 'string';
    if ((deleted && !trashed) || (!deleted && (state.deleted_at !== null || state.deleted_by !== null))) {
      throw new Error('La corbeille a renvoyé un état incompatible. Le fichier reste affiché ; actualisez avant de réessayer.');
    }
    if (trashed) assertUuid(state.deleted_by!, 'Auteur de la mise en corbeille');
    return state;
  });
}
export async function setItemApprovalStatus(id: string, status: 'approved' | 'rejected', reason: string | undefined, actorId: string): Promise<void> {
  assertUuid(id, 'Identifiant du fichier');
  if (status !== 'approved' && status !== 'rejected') throw new Error('Le statut de modération demandé est invalide.');
  const rejectionReason = status === 'rejected' ? (reason?.trim() || null) : null;
  await withUploadClient(actorId, getSupabaseClientState().config.url, async (client, check) => {
    const { data, error } = await client.from('documents').update({ status, rejection_reason: rejectionReason })
      .eq('id', id).eq('status', 'pending').is('deleted_at', null).select('id,status,rejection_reason');
    check();
    if (error) throw new Error(`La modération n’a pas été confirmée : ${errorMessage(error)} Relisez l’état avant une nouvelle action.`);
    confirmTarget(data, id, 'Modération non confirmée');
    if (data![0].status !== status || data![0].rejection_reason !== rejectionReason) {
      throw new Error('L’état renvoyé ne confirme pas la modération demandée. Relisez la liste avant toute nouvelle action.');
    }
  });
}
export interface PendingApprovalTargets { documentIds: string[] }
export async function approveAllPendingItems(targets: PendingApprovalTargets, actorId: string): Promise<void> {
  const ids = [...new Set(targets.documentIds)];
  if (ids.length === 0) throw new Error('Aucun fichier en attente n’a été sélectionné.');
  ids.forEach((id) => assertUuid(id, 'Identifiant du fichier'));
  await withUploadClient(actorId, getSupabaseClientState().config.url, async (client, check) => {
    const { data, error } = await client.from('documents').update({ status: 'approved', rejection_reason: null })
      .in('id', ids).eq('status', 'pending').is('deleted_at', null).select('id,status,rejection_reason');
    check();
    if (error) throw new Error(`Approbation non confirmée : ${errorMessage(error)} Actualisez la liste avant de réessayer.`);
    const received = new Set((data ?? []).filter((row) => row.status === 'approved' && row.rejection_reason === null).map((row) => row.id));
    const confirmed = ids.filter((id) => received.has(id)).length;
    if (confirmed !== ids.length || received.size !== ids.length || data?.length !== ids.length) {
      throw new Error(`Approbation incomplète : ${confirmed} sur ${ids.length} fichier(s) confirmé(s). Actualisez la liste avant toute nouvelle action.`);
    }
  });
}
export async function fetchUsersList(client = getSupabaseClient()): Promise<UserProfile[]> {
  const [profiles, documents] = await Promise.all([
    client.from('profiles').select('id,email,full_name,avatar_url,role,created_at,last_sign_in_at').order('created_at', { ascending: false }),
    client.from('documents').select('user_id').is('deleted_at', null),
  ]);
  if (profiles.error) throw new Error(`Impossible de charger les inscriptions : ${errorMessage(profiles.error)}`);
  if (documents.error) throw new Error(`Impossible de compter les fichiers : ${errorMessage(documents.error)}`);
  if (!Array.isArray(profiles.data) || !Array.isArray(documents.data)) throw new Error('La réponse des inscriptions ou de leur compteur est absente. Réessayez.');
  const counts = new Map<string, number>();
  documents.data.forEach(({ user_id }) => counts.set(user_id, (counts.get(user_id) || 0) + 1));
  return profiles.data.map((profile) => {
    if (profile.role !== 'user' && profile.role !== 'admin') throw new Error('Un profil possède un rôle incompatible. Faites vérifier le contrat SQL.');
    return { ...profile, document_count: counts.get(profile.id) || 0 };
  });
}
export async function updateUserRole(userId: string, newRole: UserRole, actorId: string): Promise<void> {
  assertUuid(userId, 'Identifiant du profil');
  if (newRole !== 'user' && newRole !== 'admin') throw new Error('Le rôle demandé est invalide.');
  await withUploadClient(actorId, getSupabaseClientState().config.url, async (client, check) => {
    const { data, error } = await client.from('profiles').update({ role: newRole })
      .eq('id', userId).eq('role', newRole === 'admin' ? 'user' : 'admin').select('id,role');
    check();
    if (error) throw new Error(`Le rôle n’a pas été confirmé : ${errorMessage(error)} Relisez le profil avant une nouvelle action.`);
    confirmTarget(data, userId, 'Changement de rôle non confirmé');
    if (data![0].role !== newRole) throw new Error('Le profil renvoyé ne confirme pas le rôle demandé. Actualisez les inscriptions.');
  });
}
