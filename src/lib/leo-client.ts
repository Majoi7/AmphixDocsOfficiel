import { withLeoSignal } from '../../supabase/functions/_shared/leo-abort';
import {
  hasOnlyKeys, isLeoDocument, isLeoPlan, isLeoRequest, isRecord, isUuid, LEO_LIMITS, LEO_MESSAGES,
  type LeoDocument, type LeoRequest, type LeoResponse,
} from '../../supabase/functions/_shared/leo-contract';

export type LeoErrorCode = 'error' | 'quota' | 'auth' | 'invalid';
export class LeoClientError extends Error {
  constructor(public readonly code: LeoErrorCode = 'error') { super(LEO_MESSAGES[code]); }
}

export interface LeoTransportOptions {
  projectUrl: string;
  publicKey: string;
  userId: string;
  getSession: () => Promise<{
    data: { session: { access_token: string; user: { id: string } } | null };
    error: unknown;
  }>;
  isCurrent: () => boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
  // Codes fixes uniquement ; le branchement React n'active ceci qu'en développement.
  log?: (code: string) => void;
}

function invalidResponse(): never { throw new LeoClientError(); }
function documentsFrom(value: unknown, limit: number, userId: string): LeoDocument[] {
  if (!Array.isArray(value) || value.length > limit || !value.every(isLeoDocument)) return invalidResponse();
  const ids = new Set<string>();
  for (const document of value) {
    if (ids.has(document.id) || document.deleted_at !== null
      || (document.status !== 'approved' && document.user_id !== userId)) return invalidResponse();
    ids.add(document.id);
  }
  return value;
}

// Le texte d'erreur du serveur n'entre jamais dans l'interface. Même une réponse
// HTTP 200 doit respecter le contrat, la demande et la visibilité attendus.
export function parseLeoResponse(value: unknown, request: LeoRequest, userId: string): LeoResponse {
  if (!isRecord(value) || value.action !== request.action || !isUuid(value.requestId)
    || typeof value.fallback !== 'boolean') return invalidResponse();
  const fields = request.action === 'plan' ? ['action', 'requestId', 'inScope', 'plan', 'fallback']
    : request.action === 'search' ? ['action', 'requestId', 'documents', 'fallback']
      : ['action', 'requestId', 'documents', 'explanations', 'fallback'];
  if (!hasOnlyKeys(value, Object.hasOwn(value, 'message') ? [...fields, 'message'] : fields)) return invalidResponse();
  if (Object.hasOwn(value, 'message') && typeof value.message !== 'string') return invalidResponse();
  if (request.action === 'plan') {
    if (value.inScope === false && value.plan === null && value.fallback === false) {
      return { action: 'plan', requestId: value.requestId, inScope: false, plan: null, fallback: false, message: LEO_MESSAGES.outOfScope };
    }
    if (value.inScope !== true || !isLeoPlan(value.plan)) return invalidResponse();
    return { action: 'plan', requestId: value.requestId, inScope: true, plan: value.plan, fallback: value.fallback,
      ...(value.fallback ? { message: LEO_MESSAGES.unavailable } : {}) };
  }
  if (value.requestId !== request.requestId || (request.fallback && !value.fallback)) return invalidResponse();
  const documents = documentsFrom(value.documents, request.action === 'search' ? LEO_LIMITS.candidates : LEO_LIMITS.results, userId);
  if (request.action === 'search') {
    if (value.fallback !== request.fallback) return invalidResponse();
    return { action: 'search', requestId: value.requestId, documents, fallback: value.fallback,
      ...(value.fallback ? { message: LEO_MESSAGES.unavailable } : {}) };
  }
  if (!Array.isArray(value.explanations) || value.explanations.length > 3
    || (value.fallback && value.explanations.length)) return invalidResponse();
  const ids = new Set(documents.map((document) => document.id));
  const explained = new Set<string>();
  const explanations = value.explanations.map((explanation) => {
    if (!isRecord(explanation) || !hasOnlyKeys(explanation, ['id', 'text']) || !isUuid(explanation.id)
      || !ids.has(explanation.id) || explained.has(explanation.id) || typeof explanation.text !== 'string'
      || !explanation.text.trim() || explanation.text.length > 240
      || /[\u0000-\u001f]|https?:\/\//i.test(explanation.text)) return invalidResponse();
    explained.add(explanation.id);
    return { id: explanation.id, text: explanation.text };
  });
  return { action: 'rank', requestId: value.requestId, documents, explanations, fallback: value.fallback,
    ...(value.fallback ? { message: LEO_MESSAGES.unavailable } : {}) };
}

export function createLeoTransport(options: LeoTransportOptions) {
  return async (request: LeoRequest, parentSignal: AbortSignal): Promise<LeoResponse> => {
    if (!isLeoRequest(request)) throw new LeoClientError('invalid');
    const controller = new AbortController();
    const abort = () => controller.abort(parentSignal.reason);
    if (parentSignal.aborted) abort();
    else parentSignal.addEventListener('abort', abort, { once: true });
    // Une échéance réseau réelle, jamais un minuteur de progression de l'interface.
    const timer = setTimeout(() => controller.abort(new DOMException('Délai dépassé', 'TimeoutError')), options.timeoutMs ?? 25000);
    const signal = controller.signal;
    const assertCurrent = () => {
      signal.throwIfAborted();
      if (!options.isCurrent()) throw new DOMException('Session changée', 'AbortError');
    };
    const checkSession = async () => {
      assertCurrent();
      const { data, error } = await withLeoSignal(signal, options.getSession);
      assertCurrent();
      if (error || !data.session?.access_token || data.session.user.id !== options.userId) throw new LeoClientError('auth');
      return data.session.access_token;
    };
    try {
      assertCurrent();
      if (!options.projectUrl || !options.publicKey || !options.userId) throw new LeoClientError();
      const token = await checkSession();
      const response = await withLeoSignal(signal, () => (options.fetch ?? fetch)(
        `${options.projectUrl.replace(/\/$/, '')}/functions/v1/leo-search`,
        {
          method: 'POST', signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
          headers: { Authorization: `Bearer ${token}`, apikey: options.publicKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        },
      ));
      assertCurrent();
      if (!response.ok) {
        options.log?.(`leo_http_${response.status}`);
        // Ne pas lire/afficher un corps d'erreur de passerelle ou de fournisseur.
        void response.body?.cancel().catch(() => undefined);
        throw new LeoClientError(response.status === 429 ? 'quota' : response.status === 401 ? 'auth' : response.status === 400 ? 'invalid' : 'error');
      }
      const text = await withLeoSignal(signal, () => response.text());
      assertCurrent();
      if (text.length > 1_000_000) throw new LeoClientError();
      const value: unknown = JSON.parse(text);
      // Un changement de compte pendant fetch ne doit jamais rendre ses données.
      await checkSession();
      assertCurrent();
      return parseLeoResponse(value, request, options.userId);
    } catch (error) {
      if (parentSignal.aborted || !options.isCurrent()) throw new DOMException('Recherche interrompue', 'AbortError');
      options.log?.('leo_client_request_failed');
      throw error instanceof LeoClientError ? error : new LeoClientError();
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', abort);
    }
  };
}
