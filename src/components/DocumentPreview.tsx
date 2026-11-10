import { useState } from 'react';
import { FILE_BADGES, getFileCategory, type DocumentItem } from '../lib/supabase';

export function DocumentPreview({ document, url, loading = false, large = false }: {
  document: DocumentItem;
  url?: string;
  loading?: boolean;
  large?: boolean;
}) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const badge = FILE_BADGES[getFileCategory(document.file_type)];
  const usableUrl = document.deleted_at === null && (document.file_type === 'pdf' || document.file_type === 'image') && url && url !== failedUrl ? url : undefined;
  const waiting = document.deleted_at === null && (loading || (!!usableUrl && loadedUrl !== usableUrl));
  const pages = document.page_count;
  return (
    <span className={`relative isolate block aspect-[3/4] w-full overflow-hidden rounded-[20px] bg-[#e8e4de] ${large ? 'p-6' : 'p-4 sm:p-5'}`}>
      <span className="relative block h-full w-full overflow-hidden rounded-[3px] bg-white shadow-[0_3px_12px_rgba(20,20,20,0.12)]">
        {usableUrl ? <img src={usableUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
          onLoad={() => setLoadedUrl(usableUrl)} onError={() => setFailedUrl(usableUrl)}
          className={`absolute inset-0 h-full w-full object-contain transition-opacity motion-reduce:transition-none ${loadedUrl === usableUrl ? 'opacity-100' : 'opacity-0'}`} /> : null}
        {(!usableUrl || waiting) && <span aria-hidden="true" className={`absolute inset-0 space-y-2 px-[16%] pt-[25%] ${waiting ? 'animate-pulse motion-reduce:animate-none' : ''}`}>
          <span className="mb-4 block h-2 w-2/3 rounded-sm bg-[#d9d7d4]" />
          {[100, 100, 85, 100, 70].map((width, index) => <span key={index} className="block h-1 rounded-sm bg-[#e7e5e2]" style={{ width: `${width}%` }} />)}
        </span>}
      </span>
      <span className={`absolute top-3 left-3 rounded-lg px-2 py-1 text-[10px] font-extrabold tracking-wide sm:text-xs ${badge.bg} ${badge.text}`}>{badge.label}</span>
      {document.file_type === 'pdf' && document.deleted_at === null && typeof pages === 'number' && Number.isSafeInteger(pages) && pages > 0 && <span className="absolute right-2.5 bottom-2.5 rounded-full bg-[#141414]/90 px-2.5 py-1 text-[10px] font-bold text-white sm:text-xs">{pages} {pages === 1 ? 'page' : 'pages'}</span>}
    </span>
  );
}
