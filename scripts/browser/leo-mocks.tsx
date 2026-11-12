import { useSyncExternalStore } from 'react';
import { createClient, type AuthChangeEvent, type Session, type User } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import type { SupabaseClientState, SupabaseConfig } from '../../src/lib/supabase-config';
import type { DocumentItem, LibraryPageOptions } from '../../src/lib/supabase';
import type { LeoPlan, LeoRequest } from '../../supabase/functions/_shared/leo-contract';

// Frontières fictives résolues UNIQUEMENT par le build de recette Léo.
// Aucun .env, compte réel, jeton réel, SDK distant ou stockage persistant.
export const TEST_PROJECT = 'https://leo-browser.invalid';
export const TEST_USER = '11111111-1111-4111-8111-111111111111';
export const fixtureId = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const makeUser = (id: string): User => ({
  id, aud: 'authenticated', app_metadata: {}, user_metadata: { full_name: 'Compte fictif' },
  created_at: '2026-01-01T00:00:00Z',
});
let user: User | null = makeUser(TEST_USER);
let tokenVersion = 1;
let forbiddenCalls = 0;
const authListeners = new Set<() => void>();
const clientListeners = new Set<() => void>();
const authEvents = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
const currentSession = (): Session | null => user ? {
  access_token: `TEST_ONLY_JWT_${tokenVersion}`, refresh_token: 'TEST_ONLY_REFRESH',
  expires_in: 3600, token_type: 'bearer', user,
} : null;
const makeClient = (url: string) => {
  const client = createClient<Database>(url, 'sb_publishable_leo_browser_tests_only_000000000000', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async () => { forbiddenCalls++; throw new Error('SDK distant interdit dans la recette.'); } },
  });
  // Le client garde sa forme réelle, mais toute lecture/notification Auth est locale.
  client.auth.getSession = async () => {
    const session = currentSession();
    return session
      ? { data: { session }, error: null }
      : { data: { session: null }, error: null };
  };
  client.auth.onAuthStateChange = (callback) => {
    const listener = (event: AuthChangeEvent, session: Session | null) => { void callback(event, session); };
    authEvents.add(listener);
    return { data: { subscription: { id: crypto.randomUUID(), callback, unsubscribe: () => { authEvents.delete(listener); } } } };
  };
  return client;
};
const makeConfig = (url: string, key = 'PUBLIC_TEST_KEY'): SupabaseConfig => ({
  url, key, status: 'configured', source: 'local', isConfigured: true, error: null, storageWarning: null,
});
let state: SupabaseClientState = { client: makeClient(TEST_PROJECT), config: makeConfig(TEST_PROJECT), generation: 1 };
export let supabase = state.client;
export const getSupabaseClientState = () => state;
export const getStoredSupabaseConfig = () => state.config;
export const isSupabaseConfigured = () => true;
export const getSupabaseClient = () => {
  if (!state.client) throw new Error('Client fictif absent.');
  return state.client;
};
export const subscribeSupabaseClient = (listener: () => void) => {
  clientListeners.add(listener);
  return () => { clientListeners.delete(listener); };
};
export const reinitializeSupabase = () => { throw new Error('Configuration réelle interdite dans la recette.'); };
export const resetSupabaseConfig = reinitializeSupabase;
function emitAuth(event: AuthChangeEvent) {
  authEvents.forEach((listener) => listener(event, currentSession()));
  authListeners.forEach((listener) => listener());
}
export function setFixtureUser(id: string | null) {
  if (id !== null && !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Identifiant fictif invalide.');
  user = id === null ? null : makeUser(id);
  emitAuth(user ? 'SIGNED_IN' : 'SIGNED_OUT');
}
export function changeFixtureScope(mode: 'project' | 'client' | 'generation' | 'key') {
  const url = mode === 'project' ? 'https://leo-second-project.invalid' : state.config.url;
  state = {
    client: mode === 'project' || mode === 'client' ? makeClient(url) : state.client,
    config: makeConfig(url, mode === 'key' ? `${state.config.key}_ROTATED` : state.config.key),
    generation: mode === 'generation' || mode === 'project' ? state.generation + 1 : state.generation,
  };
  supabase = state.client;
  clientListeners.forEach((listener) => listener());
}
export function refreshFixtureToken() { tokenVersion++; emitAuth('TOKEN_REFRESHED'); }
export function useAuth() {
  const current = useSyncExternalStore((listener) => {
    authListeners.add(listener);
    return () => { authListeners.delete(listener); };
  }, () => user, () => user);
  return { user: current, isAdmin: false, signOut: async () => { setFixtureUser(null); } };
}

const documents = new Map<string, DocumentItem>();
for (let n = 1; n <= 50; n++) documents.set(fixtureId(n), {
  id: fixtureId(n), user_id: TEST_USER,
  title: n <= 20 ? `Fichier de bibliothèque fictif ${n}` : `Sujet d’algèbre fictif ${n}`,
  description: 'Données fictives de recette locale, sans contenu de fichier.',
  file_name: `fictif-${n}.pdf`, file_path: `${TEST_USER}/fictif-${n}.pdf`, file_type: 'pdf', file_size: 1234,
  created_at: '2026-01-02T00:00:00Z', school_name: 'EPAC', subject_name: 'Algèbre',
  status: n === 22 ? 'pending' : 'approved', rejection_reason: null, reviewed_by: null, reviewed_at: null,
  deleted_at: null, deleted_by: null, thumbnail_path: n === 21 ? `${TEST_USER}/fictif-21.png` : null, page_count: 3,
});
const visible = (document: DocumentItem, actor = user?.id) => document.deleted_at === null
  && (document.status === 'approved' || document.user_id === actor);
const clone = <T,>(value: T): T => structuredClone(value);
export const libraryCalls: { ids: string[]; offset: number }[] = [];
export const targetCalls: string[][] = [];
export const thumbnailCalls: string[][] = [];
export const mutationCalls: { action: string; id: string; confirmed: boolean }[] = [];
let previewFailure = false;
export async function fetchDashboardData(actorId: string, _admin?: boolean, _client?: unknown, options: LibraryPageOptions = {}) {
  if (actorId !== user?.id) throw new Error('Compte fictif changé.');
  const offset = options.offset ?? 0;
  const candidates = [...documents.values()].filter((document) => Number(document.id.slice(0, 8)) <= 20
    && (document.deleted_at !== null) === !!options.trash
    && (!options.query || document.title.toLocaleLowerCase('fr').includes(options.query.toLocaleLowerCase('fr'))));
  const page = candidates.slice(offset, offset + 20);
  libraryCalls.push({ ids: page.map((document) => document.id), offset });
  return { documents: clone(page) };
}
export async function fetchDocumentTargets(ids: readonly string[], actorId: string) {
  targetCalls.push([...ids]);
  if (actorId !== user?.id) throw new Error('Compte fictif changé.');
  return clone(ids.flatMap((id) => {
    const document = documents.get(id);
    return document && visible(document, actorId) ? [document] : [];
  }));
}
export async function getDocumentThumbnailUrls(paths: readonly string[], actorId: string): Promise<Record<string, string>> {
  thumbnailCalls.push([...paths]);
  if (actorId !== user?.id || previewFailure) throw new Error('Aperçus fictifs indisponibles.');
  return Object.fromEntries(paths.map((path) => [path, '/fixture-preview.svg']));
}
const signedLinkCalls: { filePath: string; downloadName?: string }[] = [];
let downloadFailure = false;
export async function getDocumentSignedUrl(filePath: string, downloadName?: string) {
  signedLinkCalls.push({ filePath, downloadName });
  // La signature peut arriver après fermeture ou changement de compte.
  await gates.get('download')?.promise;
  if (downloadFailure) throw new Error('SIGNATURE_SECRET_SHOULD_NEVER_RENDER');
  return '/fixture-file.pdf';
}

// Les octets et le décodage sont fictifs : ce banc vérifie les composants et
// leurs cycles de vie, pas pdf.js, les droits Storage ou le contenu d'un PDF.
export const sourceCalls: { id: string; aborted: boolean }[] = [];
export const completionCalls: { id: string; sameSource: boolean; aborted: boolean }[] = [];
const originalBlobs = new Map<string, Blob>();
let sourceFailure = false;
let completionFailure = false;
let decoderFailure = false;
const pdfStats = { opened: 0, disposed: 0, rendered: [] as number[], active: 0, maxActive: 0 };
const fixtureImage = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="240" height="320" fill="#f1ece4"/><text x="20" y="80">IMAGE FICTIVE</text></svg>';
export async function getDocumentPreviewSource(expected: DocumentItem, actorId: string, signal?: AbortSignal): Promise<Blob> {
  if (actorId !== user?.id || !visible(expected, actorId)) throw new Error('Source fictive inaccessible.');
  const call = { id: expected.id, aborted: !!signal?.aborted };
  sourceCalls.push(call);
  signal?.addEventListener('abort', () => { call.aborted = true; }, { once: true });
  const blob = new Blob([expected.file_type === 'image' ? fixtureImage : 'SOURCE FICTIVE, PAS UN PDF'], {
    type: expected.file_type === 'image' ? 'image/svg+xml' : 'application/pdf',
  });
  originalBlobs.set(expected.id, blob);
  // Ignorer volontairement l'annulation après cette attente pour éprouver le
  // filtrage des réponses tardives du composant, indépendamment du helper réel.
  await gates.get('preview-source')?.promise;
  if (sourceFailure) throw new Error('STORAGE_SECRET_SHOULD_NEVER_RENDER');
  return blob;
}
export async function completeDocumentPreview(expected: DocumentItem, actorId: string, source?: Blob, signal?: AbortSignal): Promise<DocumentItem> {
  if (actorId !== user?.id || expected.user_id !== actorId || expected.deleted_at !== null) throw new Error('Complétion fictive interdite.');
  const call = { id: expected.id, sameSource: source === originalBlobs.get(expected.id), aborted: !!signal?.aborted };
  completionCalls.push(call);
  signal?.addEventListener('abort', () => { call.aborted = true; }, { once: true });
  const confirmed = { ...clone(expected), thumbnail_path: expected.thumbnail_path || `${actorId}/${expected.id}/${'a'.repeat(64)}.jpg`, page_count: expected.page_count ?? (expected.file_type === 'pdf' ? 8 : 1) };
  await gates.get('preview-complete')?.promise;
  if (completionFailure) throw new Error('RPC_SECRET_SHOULD_NEVER_RENDER');
  if (!signal?.aborted && actorId === user?.id) {
    const current = documents.get(expected.id);
    if (current?.deleted_at === null) documents.set(expected.id, { ...current, thumbnail_path: confirmed.thumbnail_path, page_count: confirmed.page_count });
  }
  return confirmed;
}
export async function openFixturePdf(_source: Blob, signal?: AbortSignal) {
  if (decoderFailure) throw new Error('DECODER_SECRET_SHOULD_NEVER_RENDER');
  if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
  pdfStats.opened++;
  let disposed = false;
  const dispose = async () => {
    if (!disposed) { disposed = true; pdfStats.disposed++; }
    signal?.removeEventListener('abort', abort);
  };
  const abort = () => { void dispose(); };
  signal?.addEventListener('abort', abort, { once: true });
  return {
    dispose,
    document: {
      numPages: 8,
      getPage: async (number: number) => {
        if (disposed || number < 1 || number > 8) throw new Error('Page fictive indisponible.');
        return {
          getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
          cleanup: () => undefined,
          render: ({ canvasContext, viewport }: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
            let cancelled = false;
            pdfStats.active++;
            pdfStats.maxActive = Math.max(pdfStats.maxActive, pdfStats.active);
            const promise = Promise.resolve().then(() => {
              if (cancelled || disposed) throw new DOMException('Annulé', 'AbortError');
              canvasContext.fillStyle = '#ffffff';
              canvasContext.fillRect(0, 0, viewport.width, viewport.height);
              canvasContext.fillStyle = '#141414';
              canvasContext.font = '20px sans-serif';
              canvasContext.fillText(`PAGE FICTIVE ${number}`, 20, 60);
              pdfStats.rendered.push(number);
            }).finally(() => { pdfStats.active--; });
            return { promise, cancel: () => { cancelled = true; } };
          },
        };
      },
    },
  };
}

type Action = 'plan' | 'search' | 'rank';
type Mode = 'normal' | 'empty' | 'fallback' | 'out-of-scope' | 'rank-fallback';
type Gate = { promise: Promise<void>; release: () => void };
const gates = new Map<string, Gate>();
function hold(action: string) {
  if (gates.has(action)) throw new Error('Cette étape fictive est déjà suspendue.');
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  gates.set(action, { promise, release });
}
function release(action: string) { const gate = gates.get(action); gates.delete(action); gate?.release(); }
let mutationFailure: string | null = null;
async function beforeMutation(action: string, id: string, actorId: string) {
  const generation = state.generation;
  const call = { action, id, confirmed: false };
  mutationCalls.push(call);
  const gate = gates.get(action);
  if (gate) await gate.promise;
  if (mutationFailure === action) { mutationFailure = null; throw new Error('Confirmation fictive refusée. Réessayez.'); }
  if (actorId !== user?.id || generation !== state.generation) throw new Error('Compte fictif changé.');
  const document = documents.get(id);
  if (!document || document.user_id !== actorId) throw new Error('Cible fictive inaccessible.');
  call.confirmed = true;
  return document;
}
export async function updateDocumentMetadata(id: string, title: string, description: string, actorId: string) {
  const document = await beforeMutation('update', id, actorId);
  documents.set(id, { ...document, title: title.trim(), description: description.trim() || null });
}
export async function setDocumentTrash(id: string, deleted: boolean, actorId: string) {
  const document = await beforeMutation('trash', id, actorId);
  const next = { id, deleted_at: deleted ? '2026-02-01T00:00:00Z' : null, deleted_by: deleted ? actorId : null };
  documents.set(id, { ...document, ...next });
  return next;
}

const plan: LeoPlan = { keywords: ['algebre'], school: 'EPAC', subject: null, type: 'examen',
  period: { from: null, to: null }, sort: 'relevance', reformulation: 'Les sujets d’algèbre de l’EPAC.' };
let mode: Mode = 'normal';
let nextRequest = 100;
let nextFailure: { action: Action; status: number } | null = null;
const requests = new Map<string, { actor: string; mode: Mode; ids: string[] }>();
export const leoCalls: { body: LeoRequest; aborted: boolean; cache: RequestCache | undefined; credentials: RequestCredentials | undefined; redirect: RequestRedirect | undefined }[] = [];
const nativeFetch = window.fetch.bind(window);
export const fixtureFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url !== `${state.config.url}/functions/v1/leo-search` || init?.method !== 'POST' || !user) {
    forbiddenCalls++;
    throw new Error('Tout réseau non simulé est interdit dans la recette.');
  }
  const headers = new Headers(init.headers);
  if (headers.get('Authorization') !== `Bearer ${currentSession()?.access_token}` || headers.get('apikey') !== state.config.key) {
    throw new Error('Le transport réel doit envoyer la session fictive courante.');
  }
  const body = JSON.parse(String(init.body)) as LeoRequest;
  const call = { body: clone(body), aborted: !!init.signal?.aborted, cache: init.cache, credentials: init.credentials, redirect: init.redirect };
  leoCalls.push(call);
  init.signal?.addEventListener('abort', () => { call.aborted = true; }, { once: true });
  const actor = user.id;
  const gate = gates.get(body.action);
  // Ignorer volontairement l'annulation pour éprouver le rejet des réponses tardives.
  if (gate) await gate.promise;
  if (nextFailure?.action === body.action) {
    const status = nextFailure.status; nextFailure = null;
    return new Response('SQL_SECRET_SHOULD_NEVER_RENDER', { status });
  }
  if (body.action === 'plan') {
    const requestId = fixtureId(++nextRequest);
    requests.set(requestId, { actor, mode, ids: [] });
    return Response.json({ action: 'plan', requestId, inScope: mode !== 'out-of-scope',
      plan: mode === 'out-of-scope' ? null : plan, fallback: mode === 'fallback' });
  }
  const request = requests.get(body.requestId);
  if (!request || request.actor !== actor) return new Response('', { status: 401 });
  if (body.action === 'search') {
    const found = request.mode === 'empty' ? [] : [...documents.values()]
      .filter((document) => Number(document.id.slice(0, 8)) > 20 && visible(document, actor)).slice(0, 30);
    request.ids = found.map((document) => document.id);
    return Response.json({ action: 'search', requestId: body.requestId, documents: found, fallback: request.mode === 'fallback' });
  }
  const found = request.ids.flatMap((id) => { const document = documents.get(id); return document && visible(document, actor) ? [document] : []; }).slice(0, 10);
  const fallback = request.mode === 'fallback' || request.mode === 'rank-fallback';
  return Response.json({ action: 'rank', requestId: body.requestId, documents: found, fallback,
    explanations: fallback ? [] : found.slice(0, 3).map((document) => ({ id: document.id, text: 'Le titre et la matière correspondent à la demande.' })) });
};

export const fixtureApi = {
  calls: () => clone(leoCalls),
  libraryCalls: () => clone(libraryCalls), targets: () => clone(targetCalls), thumbnails: () => clone(thumbnailCalls),
  mutations: () => clone(mutationCalls), document: (id: string) => clone(documents.get(id)),
  sources: () => clone(sourceCalls), completions: () => clone(completionCalls), pdf: () => clone(pdfStats),
  signedLinks: () => clone(signedLinkCalls), failDownload: (fail: boolean) => { downloadFailure = fail; },
  patchDocument: (id: string, fields: Partial<Pick<DocumentItem, 'thumbnail_path' | 'page_count' | 'file_type' | 'file_name' | 'deleted_at'>>) => {
    const document = documents.get(id);
    if (!document) throw new Error('Document fictif absent.');
    documents.set(id, { ...document, ...fields });
  },
  failSource: (fail: boolean) => { sourceFailure = fail; },
  failCompletion: (fail: boolean) => { completionFailure = fail; },
  failDecoder: (fail: boolean) => { decoderFailure = fail; },
  networkAttempts: () => forbiddenCalls,
  hold, release, mode: (next: Mode) => { mode = next; },
  fail: (action: Action, status = 503) => { nextFailure = { action, status }; },
  failMutation: (action: string) => { mutationFailure = action; },
  failPreview: (fail: boolean) => { previewFailure = fail; },
  user: setFixtureUser, scope: changeFixtureScope, refreshToken: refreshFixtureToken,
  probeCsp: () => nativeFetch(`${TEST_PROJECT}/rest/v1/documents`).then(() => 'autorisé', () => 'refusé'),
  viewport: (height: number, offsetTop = 0) => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error('Viewport visuel absent du navigateur de recette.');
    Object.defineProperties(viewport, { height: { configurable: true, value: height }, offsetTop: { configurable: true, value: offsetTop } });
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
  },
};
