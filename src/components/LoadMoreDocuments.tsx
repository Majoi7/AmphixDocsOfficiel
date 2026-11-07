import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

export function LoadMoreDocuments({ hasMore, loading, disabled = false, error = false, onLoad }: {
  hasMore: boolean;
  loading: boolean;
  disabled?: boolean;
  error?: boolean;
  onLoad: () => Promise<void>;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const loadRef = useRef(onLoad);
  loadRef.current = onLoad;
  useEffect(() => {
    if (!hasMore || loading || disabled || error || !sentinel.current || !('IntersectionObserver' in window)) return;
    let requested = false;
    const observer = new IntersectionObserver((entries) => {
      if (requested || !entries.some((entry) => entry.isIntersecting)) return;
      requested = true;
      // Les contrôleurs publient l'erreur ; aucun rejet non géré dans l'observer.
      void loadRef.current().catch(() => undefined);
    }, { rootMargin: '240px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, loading, disabled, error]);
  if (!hasMore && !loading) return null;
  return <div ref={sentinel} className="flex justify-center py-6">
    <button type="button" disabled={loading || disabled} onClick={() => void onLoad().catch(() => undefined)}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-[#141414]/15 bg-white px-5 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:opacity-60">
      {loading && <Loader2 aria-hidden="true" size={18} className="animate-spin motion-reduce:animate-none" />}
      {loading ? 'Chargement…' : error ? 'Réessayer la suite' : 'Afficher la suite'}
    </button>
  </div>;
}
