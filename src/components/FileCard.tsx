import { motion, useReducedMotion } from 'motion/react';
import type { DocumentItem } from '../lib/supabase';
import { DocumentPreview } from './DocumentPreview';

export interface FileCardProps {
  doc: DocumentItem;
  thumbnailUrl?: string;
  loadingPreview?: boolean;
  index?: number;
  isNew?: boolean;
  disabled?: boolean;
  onOpen: (document: DocumentItem) => void;
}

// La carte ne porte que la vignette, le titre et le classement. Les actions,
// l'auteur, la description et la modération appartiennent au panneau de détail.
export function FileCard({ doc, thumbnailUrl, loadingPreview, index = 0, isNew = false, disabled = false, onOpen }: FileCardProps) {
  const reducedMotion = useReducedMotion();
  return <motion.button type="button" disabled={disabled} onClick={() => onOpen(doc)}
    aria-label={`Voir le détail de ${doc.title}`} aria-haspopup="dialog"
    initial={reducedMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
    transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 340, damping: 29, delay: (index % 20) * 0.025 }}
    whileTap={reducedMotion ? undefined : { scale: 0.97 }}
    className={`block min-h-11 min-w-0 w-full cursor-pointer self-start rounded-[20px] text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4a6cf0] disabled:cursor-default disabled:opacity-60 ${isNew ? 'ring-2 ring-[#ff6a2b] ring-offset-4 ring-offset-[#f1ece4]' : ''}`}>
    <DocumentPreview document={doc} url={thumbnailUrl} loading={loadingPreview} />
    <span className="mt-2.5 line-clamp-2 min-h-10 break-words text-sm leading-5 font-bold text-[#141414] sm:text-base sm:leading-6" title={doc.title}>{doc.title}</span>
    <span className="mt-1 block truncate text-xs text-[#141414]/60" title={`${doc.school_name || 'École non renseignée'} · ${doc.subject_name || 'Matière non renseignée'}`}>
      {doc.school_name || 'École non renseignée'} · {doc.subject_name || 'Matière non renseignée'}
    </span>
  </motion.button>;
}
