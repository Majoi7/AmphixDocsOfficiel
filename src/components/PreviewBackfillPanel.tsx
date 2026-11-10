import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ImagePlus, Loader2, Pause, Play, RotateCcw } from 'lucide-react';
import { completeDocumentPreview, getMissingDocumentPreviews } from '../lib/supabase';
import { createPreviewBackfill } from '../lib/preview-backfill';
import { PendingNavigationGuard } from '../hooks/usePendingNavigation';

const buttonClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:cursor-not-allowed disabled:opacity-50';

export function PreviewBackfillPanel({ actorId, disabled, isCurrent, onBusyChange, onComplete }: {
  actorId: string;
  disabled: boolean;
  isCurrent: () => boolean;
  onBusyChange: (busy: boolean) => void;
  onComplete: () => void;
}) {
  const queue = useMemo(() => createPreviewBackfill({
    isCurrent,
    list: (after, signal) => getMissingDocumentPreviews(actorId, after, signal),
    complete: (document, signal) => completeDocumentPreview(document, actorId, undefined, signal, true),
  }), [actorId, isCurrent]);
  const state = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const [pausing, setPausing] = useState(false);
  const busy = state.phase === 'discovering' || state.phase === 'running';
  useEffect(() => () => queue.cancelPending(), [queue]);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  const start = async (resume = false) => {
    setPausing(false);
    await (resume ? queue.resume() : queue.start());
    if (isCurrent() && queue.getSnapshot().phase === 'complete') onComplete();
  };
  return <section aria-label="Rattrapage des aperçus" className="mb-5 min-w-0 space-y-3 rounded-3xl border border-[#141414]/15 bg-white/60 p-4">
    {busy && <PendingNavigationGuard busy />}
    <div className="flex flex-wrap items-center gap-2">
      {state.phase === 'paused'
        ? <button type="button" disabled={disabled} onClick={() => void start(true)} className={`${buttonClass} bg-[#4a6cf0] text-white`}><Play size={18} aria-hidden="true" />Reprendre le rattrapage</button>
        : <button type="button" disabled={disabled || busy} onClick={() => void start()} className={`${buttonClass} bg-[#4a6cf0] text-white`}>
          {busy ? <Loader2 size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ImagePlus size={18} aria-hidden="true" />}
          Générer les aperçus manquants
        </button>}
      {state.phase === 'running' && <button type="button" disabled={pausing} onClick={() => { setPausing(true); queue.pause(); }} className={`${buttonClass} bg-[#f1ece4]`}><Pause size={18} aria-hidden="true" />{pausing ? 'Pause après ce fichier…' : 'Mettre en pause'}</button>}
    </div>
    {state.phase === 'idle' && <p className="text-xs text-[#141414]/65">PDF et images uniquement. Gardez cette page ouverte ; un seul fichier est traité à la fois.</p>}
    {state.phase === 'discovering' && <p role="status" className="text-sm">Recherche des fichiers à compléter…</p>}
    {state.phase !== 'idle' && state.phase !== 'discovering' && <div className="space-y-2">
      <p role="status" className="text-sm font-semibold tabular-nums">{state.processed} sur {state.total}{state.phase === 'paused' ? ' · En pause' : state.phase === 'complete' ? ' · Terminé' : ''}</p>
      <progress aria-label="Fichiers traités" value={state.processed} max={Math.max(1, state.total)} className="block h-2 w-full overflow-hidden rounded-full accent-[#4a6cf0]" />
      {state.currentFile && <p className="break-words text-xs text-[#141414]/65">En cours : {state.currentFile}</p>}
      <p className="text-sm">{state.succeeded} réussi{state.succeeded > 1 ? 's' : ''} · {state.failures.length} échec{state.failures.length > 1 ? 's' : ''}</p>
      {state.phase === 'complete' && state.total === 0 && <p className="text-sm">Aucun aperçu manquant pour les fichiers accessibles.</p>}
      {state.phase === 'paused' && <p className="text-xs text-[#141414]/65">La reprise continue ce lot. Après fermeture de la page, relancez la recherche : les aperçus déjà enregistrés ne sont pas régénérés.</p>}
      {state.failures.length > 0 && <details className="rounded-2xl bg-[#f1ece4] p-3">
        <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[#4a6cf0]">Fichiers à réessayer ({state.failures.length})</summary>
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">{state.failures.map((failure) => <li key={failure.id} className="break-words">{failure.fileName} — aperçu non enregistré.</li>)}</ul>
      </details>}
    </div>}
    {state.error && <p role="alert" className="text-sm text-red-800">{state.error}</p>}
    {(state.phase === 'error' || (state.phase === 'complete' && state.failures.length > 0)) && <button type="button" disabled={disabled} onClick={() => void start()} className={`${buttonClass} bg-[#f1ece4]`}><RotateCcw size={18} aria-hidden="true" />Réessayer les aperçus manquants</button>}
  </section>;
}
