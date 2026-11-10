import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import { History, Search, Square, X } from 'lucide-react';
import { LEO_MESSAGES, type LeoDocument } from '../../supabase/functions/_shared/leo-contract';
import type { LeoEntry, LeoSession, LeoSessionSnapshot } from '../lib/leo-session';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';
import { useDialogViewport } from '../hooks/useDialogViewport';
import { useDocumentThumbnails } from '../hooks/useDocumentThumbnails';
import { DocumentGrid } from './DocumentGrid';
import { Avatar } from './ui/components-primitives-avatar';
import { AIInputWithLoading } from './ui/ai-input-with-loading';
import {
  AiChainOfThought, AiChainOfThoughtContent, AiChainOfThoughtHeader,
  AiChainOfThoughtSearchResults, AiChainOfThoughtStep,
} from './ui/chain-of-thought';

const SUGGESTIONS = [
  'Les sujets d’examen d’algèbre de l’EPAC',
  'Des cours de probabilités',
  'Des exercices corrigés de physique',
];
const EMPTY_DOCUMENTS: LeoDocument[] = [];
const buttonClass = 'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141414] disabled:cursor-not-allowed disabled:opacity-50';
const STEP_TITLES = ['Comprendre ta demande', 'Rechercher dans les fichiers', 'Classer les résultats'] as const;

function resultCount(count: number) {
  return `${count} résultat${count === 1 ? '' : 's'} trouvé${count === 1 ? '' : 's'}`;
}

function entryStatus(entry: LeoEntry) {
  if (entry.outcome === 'done') return resultCount(entry.documents.length);
  if (entry.outcome === 'out-of-scope') return 'Demande hors recherche de fichiers';
  if (entry.outcome === 'error') return 'Recherche à réessayer';
  if (entry.outcome === 'cancelled') return 'Recherche interrompue';
  return STEP_TITLES[entry.steps.indexOf('active')] ?? 'Léo cherche…';
}

// Le contrôleur vit dans le dashboard, pas dans ce dialogue. Ouvrir un document
// démonte le panneau, mais revenir retrouve la même recherche sans nouvel appel.
export function LeoPanel({ session, snapshot, onClose, onOpenDocument }: {
  session: LeoSession;
  snapshot: LeoSessionSnapshot;
  onClose: () => void;
  onOpenDocument: (id: string) => void;
}) {
  const uid = useId();
  const headingId = `${uid}-title`;
  const descriptionId = `${uid}-description`;
  const inputId = `${uid}-input`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const animate = reducedMotion === false;
  const [inputMaxHeight, setInputMaxHeight] = useState(144);
  const entry = snapshot.entries.find((item) => item.id === snapshot.selectedId);
  const documents = entry?.outcome === 'done' ? entry.documents : EMPTY_DOCUMENTS;
  const previews = useDocumentThumbnails(documents);

  useDialogViewport(viewportRef, true);
  useDialogAccessibility(dialogRef, true, onClose);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // L'auto-resize du champ ne doit pas prendre toute la place quand le clavier
    // réduit le viewport visuel. La position reste gérée par useDialogViewport.
    const resize = () => setInputMaxHeight(Math.max(56, Math.min(144, Math.floor(viewport.clientHeight * 0.23))));
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(viewport);
    window.addEventListener('resize', resize);
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize); };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [entry?.id]);

  const focusInput = () => dialogRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
  const chooseSuggestion = (prompt: string) => {
    if (snapshot.busy) return;
    session.setDraft(prompt);
    focusInput();
  };
  const retry = async (previous: LeoEntry) => {
    const accepted = await session.retry(previous.id);
    if (accepted && session.getSnapshot().draft.trim() === previous.prompt) session.setDraft('');
  };

  return createPortal(
    <div ref={viewportRef} className="leo-viewport">
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-[#141414]/40 backdrop-blur-xs" />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        initial={animate ? { opacity: 0, x: 24, y: 12, rotate: 1.5, scale: 0.96 } : false}
        animate={{ opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }}
        transition={animate ? { type: 'spring', stiffness: 380, damping: 28 } : { duration: 0 }}
        className="leo-panel"
      >
        <header className="safe-top leo-safe-x flex shrink-0 items-center gap-3 border-b border-[#141414]/10 pb-4">
          <span aria-hidden="true" className="pointer-events-none inline-flex shrink-0"><Avatar color="orange" size="md" /></span>
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="text-xl font-extrabold tracking-tight">Léo AI</h2>
            <p id={descriptionId} className="mt-0.5 text-sm leading-snug text-[#141414]/70">Décris le fichier que tu cherches</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer Léo AI" className={`${buttonClass} size-11 shrink-0 px-0 hover:bg-[#141414]/5`}><X aria-hidden="true" size={22} /></button>
        </header>

        <div ref={scrollRef} className="leo-safe-x min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto overscroll-contain py-5">
          <p role="status" aria-atomic="true" className="sr-only">{entry ? entryStatus(entry) : 'Léo est prêt à rechercher un fichier.'}</p>
          {snapshot.entries.length > 0 && <details className="min-w-0 rounded-2xl border border-[#141414]/10 bg-white/60">
            <summary className="min-h-11 cursor-pointer rounded-2xl px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141414]">
              <History aria-hidden="true" size={16} className="mr-2 inline-block align-text-bottom" />Historique de cette session ({snapshot.entries.length})
            </summary>
            <p className="px-4 pb-2 text-xs text-[#141414]/65">Tes 20 dernières recherches au maximum, uniquement pendant cette session.</p>
            <ol className="max-h-56 space-y-1 overflow-y-auto overscroll-contain px-2 pb-2">
              {[...snapshot.entries].reverse().map((previous) => <li key={previous.id}>
                <button type="button" disabled={snapshot.busy} aria-pressed={previous.id === snapshot.selectedId} onClick={() => session.select(previous.id)}
                  className={`flex min-h-11 w-full min-w-0 cursor-pointer flex-col rounded-xl px-3 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#141414] disabled:cursor-not-allowed disabled:opacity-50 ${previous.id === snapshot.selectedId ? 'bg-[#141414] text-white' : 'hover:bg-[#ededed]'}`}>
                  <span className="line-clamp-2 text-sm font-semibold break-words [overflow-wrap:anywhere]">{previous.prompt}</span>
                  <span className="mt-0.5 text-xs opacity-75">{entryStatus(previous)}</span>
                </button>
              </li>)}
            </ol>
          </details>}

          {!entry ? <section className="min-w-0 space-y-4" aria-label="Commencer une recherche avec Léo">
            <div className="rounded-3xl bg-white p-5">
              <h3 className="text-lg font-extrabold">Le bon fichier, avec tes mots.</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#141414]/70">Précise une matière, une école ou un type de document. Léo retrouve les fichiers accessibles à ton compte, sans lire leur contenu.</p>
            </div>
            <p className="text-sm text-[#141414]/70">Choisis une suggestion, puis envoie ta recherche :</p>
            <div className="grid min-w-0 gap-2">
              {SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => chooseSuggestion(suggestion)}
                className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-[#141414]/15 bg-white/70 px-4 py-3 text-left text-sm font-semibold hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141414]">
                <Search aria-hidden="true" size={17} className="shrink-0" /><span className="break-words [overflow-wrap:anywhere]">{suggestion}</span>
              </button>)}
            </div>
          </section> : <>
            <div className="ml-4 rounded-3xl rounded-br-lg bg-[#141414] px-4 py-3 text-sm leading-relaxed text-white break-words [overflow-wrap:anywhere]">
              <p className="sr-only">Ta demande :</p><p>{entry.prompt}</p>
            </div>
            <AiChainOfThought key={entry.id}>
              <AiChainOfThoughtHeader stepCount={3} completedCount={entry.steps.filter((step) => step === 'complete').length} />
              <AiChainOfThoughtContent>
                <AiChainOfThoughtStep status={entry.steps[0]} title={STEP_TITLES[0]} description={entry.plan?.reformulation} />
                <AiChainOfThoughtStep status={entry.steps[1]} title={STEP_TITLES[1]}
                  description={entry.candidateCount === null ? undefined : `${entry.candidateCount} fichier${entry.candidateCount === 1 ? '' : 's'} retrouvé${entry.candidateCount === 1 ? '' : 's'} avant classement.`}>
                  {entry.candidates.length > 0 && <AiChainOfThoughtSearchResults
                    results={entry.candidates.map((document) => ({ title: document.title, url: `/dashboard?document=${document.id}`, snippet: [document.school_name, document.subject_name].filter(Boolean).join(' · ') }))}
                    onSelect={(result) => {
                      const document = entry.candidates.find((item) => `/dashboard?document=${item.id.toLowerCase()}` === result.url);
                      if (document) onOpenDocument(document.id);
                    }}
                  />}
                </AiChainOfThoughtStep>
                <AiChainOfThoughtStep status={entry.steps[2]} title={STEP_TITLES[2]}
                  description={entry.outcome === 'done' ? entry.fallback ? 'Résultats de la recherche classique.' : 'Les fichiers les plus pertinents sont affichés ci-dessous.' : undefined} />
              </AiChainOfThoughtContent>
            </AiChainOfThought>

            {snapshot.busy && <button type="button" onClick={() => session.cancel()} className={`${buttonClass} bg-white`}><Square aria-hidden="true" size={14} />Arrêter la recherche</button>}
            {entry.outcome === 'out-of-scope' && <p role="status" className="rounded-2xl bg-white p-4 text-sm">{LEO_MESSAGES.outOfScope}</p>}
            {(entry.outcome === 'error' || entry.outcome === 'cancelled') && <div className="rounded-2xl bg-white p-4">
              <p role={entry.outcome === 'error' ? 'alert' : 'status'} className="text-sm leading-relaxed">{entry.outcome === 'cancelled' ? 'La recherche a été interrompue. Tu peux la réessayer.' : LEO_MESSAGES[entry.error ?? 'error']}</p>
              <button type="button" disabled={snapshot.busy} onClick={() => void retry(entry)} className={`${buttonClass} mt-3 bg-[#141414] text-white`}>Réessayer</button>
            </div>}
            {entry.outcome === 'done' && <section aria-label="Résultats de Léo" className="min-w-0 space-y-4">
              {entry.fallback && <p role="status" className="rounded-2xl bg-white p-4 text-sm leading-relaxed">{LEO_MESSAGES.unavailable}</p>}
              <h3 className="text-lg font-extrabold">{resultCount(documents.length)}</h3>
              {documents.length === 0 ? <div className="rounded-3xl border border-[#141414]/15 bg-white p-5">
                <p className="font-bold">Essaie une autre formulation.</p>
                <p className="mt-2 text-sm leading-relaxed text-[#141414]/70">Indique la matière ou l’école, utilise un titre plus court, ou retire un critère trop précis.</p>
                <button type="button" onClick={() => chooseSuggestion(entry.prompt)} className={`${buttonClass} mt-3 bg-[#ededed]`}>Modifier ma recherche</button>
              </div> : <>
                {previews.error && <div className="rounded-2xl bg-white p-3 text-sm">
                  <p role="status">Certains aperçus sont indisponibles. Les fichiers restent accessibles.</p>
                  <button type="button" onClick={previews.retry} className={`${buttonClass} mt-1 bg-[#ededed]`}>Recharger les aperçus</button>
                </div>}
                <div className="leo-results"><DocumentGrid documents={documents} urls={previews.urls} loadingPreviews={previews.loading} onOpen={(document) => onOpenDocument(document.id)} /></div>
                {entry.explanations.length > 0 && <div className="rounded-3xl bg-white p-4">
                  <h4 className="text-sm font-bold">Pourquoi ces fichiers ?</h4>
                  <ul className="mt-3 space-y-3">
                    {entry.explanations.map((explanation) => <li key={explanation.id} className="text-sm leading-relaxed break-words [overflow-wrap:anywhere]">
                      <p className="font-semibold">{documents.find((document) => document.id === explanation.id)?.title}</p>
                      <p className="mt-0.5 text-[#141414]/70">{explanation.text}</p>
                    </li>)}
                  </ul>
                </div>}
              </>}
            </section>}
          </>}
        </div>

        <footer className="safe-bottom leo-safe-x shrink-0 border-t border-[#141414]/10 bg-[#f1ece4] pt-3">
          {snapshot.validation && <p role="alert" className="mb-2 text-sm">{snapshot.validation}</p>}
          <AIInputWithLoading id={inputId} value={snapshot.draft} onChange={session.setDraft} loading={snapshot.busy} onSubmit={session.submit} maxHeight={inputMaxHeight} />
        </footer>
      </motion.div>
    </div>,
    document.body,
  );
}
