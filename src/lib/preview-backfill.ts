import type { DocumentItem } from './supabase';
import { assertPreviewIdentity, needsDocumentPreview } from './preview-completion';
import { checkPreviewSignal } from './preview-resources';
import { logDevelopmentError } from './errors';

export interface PreviewBackfillState {
  phase: 'idle' | 'discovering' | 'running' | 'paused' | 'complete' | 'error';
  total: number;
  processed: number;
  succeeded: number;
  failures: { id: string; fileName: string }[];
  currentFile: string | null;
  error: string | null;
}
export interface PreviewBackfillDependencies {
  isCurrent: () => boolean;
  list: (after: string | null, signal: AbortSignal) => Promise<DocumentItem[]>;
  complete: (document: DocumentItem, signal: AbortSignal) => Promise<DocumentItem>;
}

// Le curseur UUID avance sur la liste découverte, jamais sur un offset dans une
// liste qui rétrécit. Un nouveau passage reprend les manquants depuis le début.
export function createPreviewBackfill(dependencies: PreviewBackfillDependencies) {
  let state: PreviewBackfillState = { phase: 'idle', total: 0, processed: 0, succeeded: 0, failures: [], currentFile: null, error: null };
  let queue: DocumentItem[] = [];
  let cursor = 0;
  let controller: AbortController | null = null;
  let task: Promise<void> | null = null;
  let pauseRequested = false;
  let disposed = false;
  const listeners = new Set<() => void>();
  const current = () => !disposed && dependencies.isCurrent();
  const update = (patch: Partial<PreviewBackfillState>) => {
    if (!current()) return;
    state = { ...state, ...patch };
    for (const listener of listeners) {
      try { listener(); } catch (error) { logDevelopmentError(error, 'Affichage du rattrapage'); }
    }
  };
  const check = (signal: AbortSignal) => {
    checkPreviewSignal(signal);
    if (!current()) throw new DOMException('Opération annulée.', 'AbortError');
  };
  const work = async (discover: boolean, signal: AbortSignal) => {
    try {
      check(signal);
      if (discover) {
        queue = [];
        cursor = 0;
        update({ phase: 'discovering', total: 0, processed: 0, succeeded: 0, failures: [], currentFile: null, error: null });
        let after: string | null = null;
        const seen = new Set<string>();
        while (true) {
          const page = await dependencies.list(after, signal);
          check(signal);
          if (page.length > 20) throw new Error('Page de rattrapage incompatible.');
          for (const document of page) {
            if (seen.has(document.id) || (after !== null && document.id <= after)) throw new Error('Curseur de rattrapage incompatible.');
            seen.add(document.id);
            after = document.id;
            if (needsDocumentPreview(document)) queue.push(document);
          }
          if (page.length < 20) break;
        }
        // Le dénominateur n'est annoncé qu'après la découverte complète.
        update({ total: queue.length, phase: 'running' });
      } else update({ phase: 'running', error: null });
      while (cursor < queue.length) {
        check(signal);
        if (pauseRequested) { update({ phase: 'paused', currentFile: null }); return; }
        const document = queue[cursor];
        update({ currentFile: document.file_name });
        try {
          const confirmed = await dependencies.complete(document, signal);
          check(signal);
          assertPreviewIdentity(document, confirmed);
          if (needsDocumentPreview(confirmed)) throw new Error('Aperçu incomplet.');
          update({ succeeded: state.succeeded + 1 });
        } catch (error) {
          check(signal);
          logDevelopmentError(error, 'Rattrapage d’aperçu');
          update({ failures: [...state.failures, { id: document.id, fileName: document.file_name }] });
        }
        cursor++;
        update({ processed: cursor });
      }
      update({ phase: 'complete', currentFile: null });
    } catch (error) {
      if (!current() || signal.aborted) return;
      logDevelopmentError(error, 'Rattrapage d’aperçus');
      update({ phase: 'error', currentFile: null, error: 'Impossible de poursuivre. Vérifiez votre connexion et vos droits, puis réessayez.' });
    }
  };
  const launch = (discover: boolean): Promise<void> => {
    if (!current()) return Promise.resolve();
    // Une annulation peut précéder la fin d'un transfert. Attendre sa sortie
    // avant de redécouvrir évite deux fichiers simultanés et les réponses tardives.
    if (task) return controller?.signal.aborted ? task.then(() => launch(true)) : task;
    pauseRequested = false;
    const activeController = new AbortController();
    controller = activeController;
    task = work(discover, activeController.signal).finally(() => {
      if (controller === activeController) { controller = null; task = null; }
    });
    return task;
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start: () => launch(true),
    resume: () => state.phase === 'paused' ? launch(false) : launch(true),
    // On termine le fichier en cours avant la pause, pour ne pas annoncer un
    // échec si le serveur vient de confirmer l'association.
    pause: () => { pauseRequested = true; },
    cancelPending: () => {
      controller?.abort();
      pauseRequested = false;
      queue = [];
      cursor = 0;
      update({ phase: 'idle', total: 0, processed: 0, succeeded: 0, failures: [], currentFile: null, error: null });
    },
    dispose: () => { disposed = true; controller?.abort(); listeners.clear(); queue = []; },
  };
}
