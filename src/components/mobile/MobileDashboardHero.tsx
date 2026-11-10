import { useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Plus, Search, Sparkles } from 'lucide-react';
import { LeoLauncher } from '../LeoLauncher';

interface MobileDashboardHeroProps {
  userFirstName: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onFocusSearch: () => void;
  onOpenUpload: () => void;
  onOpenLeo: () => void;
}

export function MobileDashboardHero({ userFirstName, searchQuery, onSearchChange, onFocusSearch, onOpenUpload, onOpenLeo }: MobileDashboardHeroProps) {
  const reducedMotion = useReducedMotion();
  const id = useId();
  return <motion.section initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    transition={reducedMotion ? { duration: 0 } : { type: 'spring', damping: 24, stiffness: 280 }} className="flex min-w-0 flex-col gap-6 py-6 md:hidden">
    <div className="min-w-0">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold text-[#ff6a2b]"><span className="truncate">Bonjour, {userFirstName}</span><Sparkles aria-hidden="true" size={16} className="shrink-0" /></p>
      <h1 className="text-3xl leading-tight font-extrabold tracking-tight">Que souhaitez-vous consulter ?</h1>
      <p className="mt-3 text-sm text-[#141414]/70">Retrouvez un fichier par son titre, son école ou sa matière.</p>
    </div>
    <div className="relative min-w-0">
      <label htmlFor={id} className="sr-only">Rechercher un fichier, une école ou une matière</label>
      <Search aria-hidden="true" size={22} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[#141414]/50" />
      <input id={id} type="search" value={searchQuery} onFocus={onFocusSearch} onChange={(event) => onSearchChange(event.target.value)} placeholder="Titre, école, matière…"
        className="min-h-16 w-full min-w-0 rounded-2xl border-2 border-[#141414] bg-white py-4 pr-16 pl-12 text-base shadow-[3px_3px_0px_#141414] outline-none focus:border-[#4a6cf0] focus:ring-4 focus:ring-[#4a6cf0]/20" />
      <span className="absolute top-1/2 right-1.5 -translate-y-1/2"><LeoLauncher onClick={onOpenLeo} /></span>
    </div>
    <motion.button type="button" onClick={onOpenUpload} whileTap={reducedMotion ? undefined : { scale: 0.98 }}
      className="flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-full border-2 border-[#141414] bg-[#ff6a2b] px-4 py-3 text-base font-extrabold shadow-[3px_3px_0px_#141414] hover:bg-[#ff8a4c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#4a6cf0]">
      <Plus aria-hidden="true" size={22} />Déposer un fichier
    </motion.button>
  </motion.section>;
}
