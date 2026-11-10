import { withLeoSignal } from '../../supabase/functions/_shared/leo-abort';
import {
  isLeoRequest, LEO_MESSAGES,
  type LeoDocument, type LeoExplanation, type LeoPlan, type LeoRequest, type LeoResponse,
} from '../../supabase/functions/_shared/leo-contract';
import { LeoClientError, type LeoErrorCode } from './leo-client';

export type LeoStepStatus = 'pending' | 'active' | 'complete' | 'error' | 'skipped';
export interface LeoEntry {
  id: number;
  prompt: string;
  requestId: string | null;
  plan: LeoPlan | null;
  steps: [LeoStepStatus, LeoStepStatus, LeoStepStatus];
  outcome: 'running' | 'done' | 'out-of-scope' | 'error' | 'cancelled';
  candidateCount: number | null;
  candidates: LeoDocument[];
  documents: LeoDocument[];
  explanations: LeoExplanation[];
  fallback: boolean;
  error: LeoErrorCode | null;
}
export interface LeoSessionSnapshot {
  entries: readonly LeoEntry[];
  selectedId: number | null;
  draft: string;
  busy: boolean;
  validation: string | null;
}
export interface LeoSessionOptions {
  scope: { userId: string; projectUrl: string; generation: number };
  isCurrent: () => boolean;
  request: (body: LeoRequest, signal: AbortSignal) => Promise<LeoResponse>;
}

// Une session en mémoire, détenue par le dashboard : aucun stockage navigateur,
// aucun historique partagé entre comptes, projets ou montages de la page.
export function createLeoSession(options: LeoSessionOptions) {
  const listeners = new Set<() => void>();
  let snapshot: LeoSessionSnapshot = { entries: [], selectedId: null, draft: '', busy: false, validation: null };
  let sequence = 0;
  let active: { id: number; controller: AbortController } | null = null;
  const publish = (patch: Partial<LeoSessionSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const updateEntry = (id: number, patch: Partial<LeoEntry>) => {
    publish({ entries: snapshot.entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) });
  };
  const cancel = () => {
    const previous = active;
    if (!previous) return;
    active = null;
    previous.controller.abort();
    publish({ busy: false, entries: snapshot.entries.map((entry) => entry.id === previous.id ? {
      ...entry, outcome: 'cancelled', candidates: [], documents: [], explanations: [],
      steps: entry.steps.map((step) => step === 'complete' ? step : 'skipped') as LeoEntry['steps'],
    } : entry) });
  };
  const submit = async (rawPrompt: string): Promise<boolean> => {
    if (active || !options.isCurrent()) return false;
    const prompt = rawPrompt.trim();
    if (!isLeoRequest({ action: 'plan', prompt })) {
      publish({ validation: LEO_MESSAGES.invalid });
      return false;
    }
    const run = { id: ++sequence, controller: new AbortController() };
    active = run;
    const signal = run.controller.signal;
    const current = () => active === run && options.isCurrent() && !signal.aborted;
    const assertCurrent = () => {
      if (!current()) throw new DOMException('Recherche interrompue', 'AbortError');
    };
    const request = async (body: LeoRequest) => {
      assertCurrent();
      const response = await withLeoSignal(signal, () => options.request(body, signal));
      assertCurrent();
      if (response.action !== body.action) throw new LeoClientError();
      return response;
    };
    const entry: LeoEntry = {
      id: run.id, prompt, requestId: null, plan: null, steps: ['active', 'pending', 'pending'],
      outcome: 'running', candidateCount: null, candidates: [], documents: [], explanations: [], fallback: false, error: null,
    };
    publish({ entries: [...snapshot.entries.slice(-19), entry], selectedId: entry.id, busy: true, validation: null });
    let step = 0;
    try {
      const planned = await request({ action: 'plan', prompt });
      assertCurrent();
      if (planned.action !== 'plan') throw new LeoClientError();
      if (!planned.inScope || !planned.plan) {
        updateEntry(run.id, { requestId: planned.requestId, steps: ['complete', 'skipped', 'skipped'], outcome: 'out-of-scope' });
        return true;
      }
      step = 1;
      updateEntry(run.id, { requestId: planned.requestId, plan: planned.plan, fallback: planned.fallback, steps: ['complete', 'active', 'pending'] });
      // Les deux actions suivantes réutilisent exactement le plan et le fallback
      // signés dans le registre serveur, jamais une liste de candidats du client.
      const next = { prompt, requestId: planned.requestId, plan: planned.plan, fallback: planned.fallback };
      const searched = await request({ action: 'search', ...next });
      assertCurrent();
      if (searched.action !== 'search') throw new LeoClientError();
      step = 2;
      updateEntry(run.id, { candidateCount: searched.documents.length, candidates: searched.documents, steps: ['complete', 'complete', 'active'] });
      // Même avec zéro candidat ou sans Gemini, le troisième appel est réel.
      const ranked = await request({ action: 'rank', ...next });
      assertCurrent();
      if (ranked.action !== 'rank') throw new LeoClientError();
      const allowed = new Set(searched.documents.map((document) => document.id));
      if (ranked.documents.some((document) => !allowed.has(document.id))) throw new LeoClientError();
      updateEntry(run.id, {
        steps: ['complete', 'complete', 'complete'], outcome: 'done', documents: ranked.documents,
        // Seules les métadonnées relues après classement restent dans les liens.
        candidates: ranked.documents, explanations: ranked.explanations, fallback: ranked.fallback,
      });
      return true;
    } catch (error) {
      if (!current()) return false;
      const steps: LeoEntry['steps'] = ['pending', 'pending', 'pending'];
      for (let index = 0; index < 3; index++) steps[index] = index < step ? 'complete' : index === step ? 'error' : 'skipped';
      updateEntry(run.id, { steps, outcome: 'error', candidates: [], documents: [], explanations: [],
        error: error instanceof LeoClientError ? error.code : 'error' });
      return false;
    } finally {
      if (active === run) {
        active = null;
        if (options.isCurrent()) publish({ busy: false });
      }
    }
  };
  return {
    scope: { ...options.scope },
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setDraft: (draft: string) => { if (options.isCurrent()) publish({ draft, validation: null }); },
    select: (id: number) => {
      if (!active && options.isCurrent() && snapshot.entries.some((entry) => entry.id === id)) publish({ selectedId: id, validation: null });
    },
    submit,
    retry: (id: number) => {
      const entry = snapshot.entries.find((item) => item.id === id);
      // Une tentative repart toujours de plan avec un nouveau requestId serveur.
      return entry && (entry.outcome === 'error' || entry.outcome === 'cancelled') ? submit(entry.prompt) : Promise.resolve(false);
    },
    cancel,
    clear: () => { cancel(); publish({ entries: [], selectedId: null, draft: '', busy: false, validation: null }); },
    removeDocument: (id: string) => {
      if (!options.isCurrent()) return;
      publish({ entries: snapshot.entries.map((entry) => ({ ...entry,
        candidates: entry.candidates.filter((document) => document.id !== id),
        documents: entry.documents.filter((document) => document.id !== id),
        explanations: entry.explanations.filter((explanation) => explanation.id !== id),
      })) });
    },
    updateDocument: (document: LeoDocument) => {
      if (!options.isCurrent()) return;
      const visible = document.deleted_at === null && (document.status === 'approved' || document.user_id === options.scope.userId);
      const update = (documents: LeoDocument[]) => documents.flatMap((item) => item.id !== document.id ? [item] : visible ? [document] : []);
      publish({ entries: snapshot.entries.map((entry) => ({ ...entry,
        candidates: update(entry.candidates), documents: update(entry.documents),
        explanations: entry.explanations.filter((item) => item.id !== document.id),
      })) });
    },
  };
}
export type LeoSession = ReturnType<typeof createLeoSession>;
