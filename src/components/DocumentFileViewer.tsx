import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Download, Loader2, RotateCcw } from 'lucide-react';
import { completeDocumentPreview, getDocumentPreviewSource, type DocumentItem } from '../lib/supabase';
import { needsDocumentPreview } from '../lib/preview-completion';
import { getSupabaseClientState } from '../lib/supabase-config';
import { logDevelopmentError, userError } from '../lib/errors';
import { useDocumentLink } from '../hooks/useDocumentLink';
import { DocumentPreview } from './DocumentPreview';
import { ImageDocumentViewer } from './ImageDocumentViewer';

const previewError = 'Impossible d’afficher l’aperçu. Tu peux télécharger le fichier.';
const buttonClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:opacity-50';

type PdfViewer = ComponentType<{ source: Blob }>;
const loadPdfViewer = () => import('./PdfDocumentViewer').then((module) => module.PdfDocumentViewer);

// Une erreur de chunk n'est pas une erreur du fichier : réessayer l'import,
// sans retélécharger l'original ni réutiliser une promesse React.lazy rejetée.
export function DeferredPdfViewer({ source, load = loadPdfViewer }: {
  source: Blob; load?: () => Promise<PdfViewer>;
}) {
  const [Viewer, setViewer] = useState<PdfViewer | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void Promise.resolve().then(load).then((component) => {
      if (!cancelled) setViewer(() => component);
    }).catch((cause) => {
      if (!cancelled) { logDevelopmentError(cause, 'Chargement du lecteur PDF'); setFailed(true); }
    });
    return () => { cancelled = true; };
  }, [load, attempt]);
  if (Viewer) return <Viewer source={source} />;
  if (failed) return <div className="space-y-3 rounded-2xl bg-[#141414]/5 p-4 text-sm">
    <p role="alert">{previewError}</p>
    <button type="button" className={`${buttonClass} bg-white`} onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}><RotateCcw size={18} aria-hidden="true" />Réessayer</button>
  </div>;
  return <p role="status" className="py-8 text-center text-sm">Ouverture du PDF…</p>;
}

// Le Blob original reste uniquement dans la fenêtre du détail. Ni IndexedDB,
// ni stockage navigateur, ni cache du service worker. Un seul téléchargement
// est partagé avec la génération propriétaire ; l’original n’est jamais renvoyé.
export function DocumentFileViewer({ document: item, actorId, generation, onCompleted, disabled = false }: {
  document: DocumentItem; actorId: string; generation: number; onCompleted: (document: DocumentItem) => void; disabled?: boolean;
}) {
  const [source, setSource] = useState<{ identity: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const identity = `${generation}:${actorId}:${item.id}:${item.file_path}:${item.file_type}:${item.deleted_at || ''}`;
  const current = useRef({ identity, item, onCompleted });
  current.current = { identity, item, onCompleted };
  const link = useDocumentLink(item.file_path, item.file_name);
  const previewable = item.deleted_at === null && (item.file_type === 'pdf' || item.file_type === 'image');
  useEffect(() => {
    setSource(null);
    setError(null);
    if (!previewable || !actorId) return;
    const controller = new AbortController();
    const expected = current.current.item;
    const isCurrent = () => !controller.signal.aborted && current.current.identity === identity && getSupabaseClientState().generation === generation;
    void (async () => {
      try {
        const blob = await getDocumentPreviewSource(expected, actorId, controller.signal);
        if (!isCurrent()) return;
        setSource({ identity, blob });
        // Le lecteur s’ouvre immédiatement, sans attendre cette écriture facultative.
        if (expected.user_id === actorId && needsDocumentPreview(expected)) {
          void completeDocumentPreview(expected, actorId, blob, controller.signal).then((confirmed) => {
            if (isCurrent()) current.current.onCompleted(confirmed);
          }).catch((cause) => { if (isCurrent()) logDevelopmentError(cause, 'Aperçu propriétaire facultatif'); });
        }
      } catch (cause) { if (isCurrent()) setError(userError(cause, previewError)); }
    })();
    return () => controller.abort();
  }, [identity, actorId, generation, previewable, revision]);
  const blob = source?.identity === identity ? source.blob : null;
  return <section aria-label="Aperçu du fichier" className="min-w-0 space-y-3">
    {previewable ? error ? <div className="space-y-3 rounded-2xl bg-[#141414]/5 p-4 text-sm">
      <p role="alert">{error}</p><button type="button" onClick={() => setRevision((value) => value + 1)} className={`${buttonClass} bg-white`}><RotateCcw size={18} aria-hidden="true" />Réessayer</button>
    </div> : !blob ? <p role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm"><Loader2 size={20} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Chargement de l’aperçu…</p>
      : item.file_type === 'pdf' ? <DeferredPdfViewer source={blob} />
        : <ImageDocumentViewer source={blob} title={item.title} onError={() => setError(previewError)} />
      : <div className="mx-auto w-full max-w-xs"><DocumentPreview document={item} large /></div>}
    {item.deleted_at !== null && <p className="text-sm text-[#141414]/65">Aucun aperçu pour un fichier dans la corbeille.</p>}
    {link.url ? <a href={link.url} download={item.file_name} target="_blank" rel="noopener noreferrer" className={`${buttonClass} w-full bg-[#ff6a2b]`}><Download size={18} aria-hidden="true" />Télécharger</a>
      : <button type="button" disabled={disabled || link.isPreparing} onClick={() => void link.prepareLink()} className={`${buttonClass} w-full bg-[#ff6a2b]`}>
        {link.isPreparing ? <Loader2 size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Download size={18} aria-hidden="true" />}{link.isPreparing ? 'Préparation…' : 'Télécharger'}
      </button>}
    {link.url && <p className="text-center text-xs text-[#141414]/65">Lien prêt : touche Télécharger pour enregistrer le fichier.</p>}
    {link.linkError && <p role="alert" className="text-sm text-red-800">{link.linkError}</p>}
  </section>;
}
