import { FileCard } from './FileCard';
import type { DocumentItem } from '../lib/supabase';

export function DocumentGrid({ documents, urls, loadingPreviews = false, loading = false, highlightedId, disabled = false, compact = false, onOpen }: {
  documents: DocumentItem[];
  urls: Record<string, string>;
  loadingPreviews?: boolean;
  loading?: boolean;
  highlightedId?: string | null;
  disabled?: boolean;
  compact?: boolean;
  onOpen: (document: DocumentItem) => void;
}) {
  return <div aria-busy={loading} className={`grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 ${compact ? 'max-w-4xl' : ''}`}>
    {documents.map((document, index) => <FileCard key={document.id} doc={document} index={index}
      thumbnailUrl={document.thumbnail_path ? urls[document.thumbnail_path] : undefined}
      loadingPreview={!!document.thumbnail_path && loadingPreviews && !urls[document.thumbnail_path]}
      isNew={document.id === highlightedId} disabled={disabled} onOpen={onOpen} />)}
    {loading && documents.length === 0 && Array.from({ length: 6 }, (_, index) => <div key={index} aria-hidden="true" className="min-w-0 animate-pulse motion-reduce:animate-none">
      <div className="aspect-[3/4] rounded-[20px] bg-[#e8e4de] p-4"><div className="h-full rounded-sm bg-white/70" /></div>
      <div className="mt-3 h-3 w-4/5 rounded bg-[#141414]/10" /><div className="mt-2 h-2 w-3/5 rounded bg-[#141414]/5" />
    </div>)}
  </div>;
}
