import { withLeoSignal } from '../_shared/leo-abort.ts';
import {
  isLeoDocument, isLeoRequest, isRecord, isUuid, LEO_LIMITS, LEO_MESSAGES, normalizeLeoPrompt,
  toLeoMetadata, type LeoDocument, type LeoPlan, type LeoResponse,
} from '../_shared/leo-contract.ts';
import {
  createPlanCache, fallbackPlan, isClearlyOutOfScope, parseGeneratedPlan, parseGeneratedRank,
  PLAN_INSTRUCTION, PLAN_SCHEMA, RANK_INSTRUCTION, RANK_SCHEMA, requestFingerprint,
} from './planning.ts';

export interface LeoBackend {
  userId: string;
  begin(): Promise<string>;
  advance(id: string, action: string, fingerprint?: string, candidates?: string[]): Promise<string[]>;
  search(plan: LeoPlan): Promise<unknown>;
  read(ids: string[]): Promise<unknown>;
}
export class LeoHttpError extends Error {
  constructor(public status: number, public code: 'quota' | 'auth' | 'error' | 'invalid') { super(code); }
}
export interface LeoHandlerDependencies {
  authenticate(token: string, signal: AbortSignal): Promise<LeoBackend>;
  generate(instruction: string, schema: unknown, data: unknown, signal: AbortSignal): Promise<unknown>;
  cache?: ReturnType<typeof createPlanCache>;
  // Codes fixes seulement : aucun token, prompt, détail fournisseur ou document.
  log?: (event: string) => void;
  timeoutMs?: number;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Retry-After',
  'Cache-Control': 'no-store',
  Vary: 'Origin',
};
function response(status: number, value: unknown) {
  return new Response(JSON.stringify(value), { status, headers: { ...cors,
    'Content-Type': 'application/json; charset=utf-8', ...(status === 429 ? { 'Retry-After': '600' } : {}) } });
}
function visibleDocuments(value: unknown, actor: string): LeoDocument[] {
  if (!Array.isArray(value) || value.length > LEO_LIMITS.candidates || !value.every(isLeoDocument)) throw new Error('invalid_document_contract');
  const seen = new Set<string>();
  return value.filter((document) => {
    if (seen.has(document.id)) return false;
    seen.add(document.id);
    return document.deleted_at === null && (document.status === 'approved' || document.user_id === actor);
  });
}
// Taille lue bornée, y compris pour une requête chunked sans Content-Length.
async function readRequest(request: Request, signal: AbortSignal) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new LeoHttpError(400, 'invalid');
  if (Number(request.headers.get('Content-Length') || 0) > 12000) throw new LeoHttpError(400, 'invalid');
  const reader = request.body?.getReader();
  if (!reader) throw new LeoHttpError(400, 'invalid');
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await withLeoSignal(signal, () => reader.read());
      if (done) break;
      size += value.byteLength;
      if (size > 12000) { cancel(); throw new LeoHttpError(400, 'invalid'); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  signalCheck(signal);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { throw new LeoHttpError(400, 'invalid'); }
}
function signalCheck(signal: AbortSignal) { if (signal.aborted) throw new LeoHttpError(503, 'error'); }

export function createLeoHandler(dependencies: LeoHandlerDependencies) {
  const cache = dependencies.cache ?? createPlanCache();
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return response(405, { code: 'invalid', message: LEO_MESSAGES.invalid });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(dependencies.timeoutMs ?? 18000)]);
    // Chaque frontière asynchrone s'interrompt : une dépendance qui ignore le signal
    // ne déclenche pas l'étape suivante lorsqu'elle finit après la fermeture/échéance.
    const run = <T>(operation: () => Promise<T>) => withLeoSignal(signal, operation);
    try {
      const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('Authorization') || '')?.[1];
      if (!token) throw new LeoHttpError(401, 'auth');
      const body = await run(() => readRequest(request, signal));
      if (!isLeoRequest(body)) throw new LeoHttpError(400, 'invalid');
      const backend = await run(() => dependencies.authenticate(token, signal));
      if (!isUuid(backend.userId)) throw new LeoHttpError(401, 'auth');
      signalCheck(signal);
      let result: LeoResponse;
      if (body.action === 'plan') {
        // Même un plan en cache ou hors périmètre consomme une demande.
        const requestId = await run(() => backend.begin());
        if (!isUuid(requestId)) throw new Error('invalid_request_id');
        const cacheKey = `${backend.userId}:${normalizeLeoPrompt(body.prompt)}`;
        let generated = cache.get(cacheKey);
        let fallback = false;
        if (isClearlyOutOfScope(body.prompt)) generated = { inScope: false, plan: null };
        if (!generated) {
          try {
            generated = parseGeneratedPlan(await run(() => dependencies.generate(PLAN_INSTRUCTION, PLAN_SCHEMA, { request: body.prompt }, signal)));
            signalCheck(signal);
            cache.set(cacheKey, generated);
          } catch {
            signalCheck(signal);
            dependencies.log?.('leo_plan_fallback');
            fallback = true;
            generated = { inScope: true, plan: fallbackPlan(body.prompt) };
          }
        }
        signalCheck(signal);
        if (!generated.inScope || !generated.plan) {
          await run(() => backend.advance(requestId, 'out_of_scope'));
          result = { action: 'plan', requestId, inScope: false, plan: null, fallback: false, message: LEO_MESSAGES.outOfScope };
        } else {
          const plan = generated.plan;
          const fingerprint = await run(() => requestFingerprint(body.prompt, plan, fallback));
          await run(() => backend.advance(requestId, 'planned', fingerprint));
          result = { action: 'plan', requestId, inScope: true, plan, fallback,
            ...(fallback ? { message: LEO_MESSAGES.unavailable } : {}) };
        }
      } else {
        const fingerprint = await run(() => requestFingerprint(body.prompt, body.plan, body.fallback));
        // Une étape ne peut être consommée qu'une fois, sous verrou en base.
        const candidateIds = await run(() => backend.advance(body.requestId, body.action, fingerprint));
        if (body.action === 'search') {
          const documents = visibleDocuments(await run(() => backend.search(body.plan)), backend.userId);
          await run(() => backend.advance(body.requestId, 'searched', fingerprint, documents.map((document) => document.id)));
          result = { action: 'search', requestId: body.requestId, documents, fallback: body.fallback,
            ...(body.fallback ? { message: LEO_MESSAGES.unavailable } : {}) };
        } else {
          if (!Array.isArray(candidateIds) || candidateIds.length > LEO_LIMITS.candidates || !candidateIds.every(isUuid)) throw new Error('invalid_candidates');
          const allowed = new Set(candidateIds);
          // Les candidats proviennent du registre, jamais d'identifiants transmis par le navigateur.
          const candidates = candidateIds.length ? visibleDocuments(await run(() => backend.read(candidateIds)), backend.userId)
            .filter((document) => allowed.has(document.id)) : [];
          candidates.sort((a, b) => candidateIds.indexOf(a.id) - candidateIds.indexOf(b.id));
          let fallback = body.fallback;
          let ranked = candidates.slice(0, LEO_LIMITS.results).map((document) => ({ id: document.id, explanation: null as string | null }));
          if (candidates.length && !fallback) {
            try {
              ranked = parseGeneratedRank(await run(() => dependencies.generate(RANK_INSTRUCTION, RANK_SCHEMA, {
                request: body.prompt, plan: body.plan, candidates: candidates.map(toLeoMetadata),
              }, signal)), new Set(candidates.map((document) => document.id)));
            } catch {
              signalCheck(signal);
              fallback = true;
              dependencies.log?.('leo_rank_fallback');
            }
          }
          signalCheck(signal);
          // Revérifier les droits APRÈS Gemini : modération/corbeille peuvent avoir changé.
          const fresh = ranked.length ? visibleDocuments(await run(() => backend.read(ranked.map((item) => item.id))), backend.userId) : [];
          const byId = new Map(fresh.filter((document) => allowed.has(document.id)).map((document) => [document.id, document]));
          let documents = ranked.flatMap((item) => byId.has(item.id) ? [byId.get(item.id)!] : []);
          if (body.plan.sort !== 'relevance') {
            documents = documents.sort((a, b) => {
              const aDate = a.created_at ? Date.parse(a.created_at) : NaN;
              const bDate = b.created_at ? Date.parse(b.created_at) : NaN;
              if (!Number.isFinite(aDate)) return Number.isFinite(bDate) ? 1 : a.id.localeCompare(b.id);
              if (!Number.isFinite(bDate)) return -1;
              return (body.plan.sort === 'oldest' ? aDate - bDate : bDate - aDate) || a.id.localeCompare(b.id);
            });
          }
          const included = new Set(documents.map((document) => document.id));
          const explanations = ranked.flatMap((item) => item.explanation && included.has(item.id)
            ? [{ id: item.id, text: item.explanation }] : []);
          await run(() => backend.advance(body.requestId, 'ranked', fingerprint));
          result = { action: 'rank', requestId: body.requestId, documents, explanations, fallback,
            ...(fallback ? { message: LEO_MESSAGES.unavailable } : {}) };
        }
      }
      signalCheck(signal);
      return response(200, result);
    } catch (error) {
      const known = error instanceof LeoHttpError ? error : new LeoHttpError(503, 'error');
      if (!(error instanceof LeoHttpError)) dependencies.log?.('leo_request_failed');
      return response(known.status, { code: known.code, message: LEO_MESSAGES[known.code] });
    }
  };
}

export function databaseError(error: unknown): never {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
  if (code === 'PT429') throw new LeoHttpError(429, 'quota');
  if (code === 'PGRST301' || code === 'PGRST303') throw new LeoHttpError(401, 'auth');
  // Une colonne/RPC absente, une transition invalide ou une panne restent opaques.
  throw new LeoHttpError(503, 'error');
}
