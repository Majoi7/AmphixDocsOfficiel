import { motion, useReducedMotion } from 'motion/react';
import { Plus } from 'lucide-react';
import { SearchBar } from '../SearchBar';

interface MobileDashboardHeroProps {
  userFirstName: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onFocusSearch: () => void;
  onOpenUpload: () => void;
  onOpenLeo: () => void;
  leoOpen?: boolean;
}

export function MobileDashboardHero({ userFirstName, searchQuery, onSearchChange, onFocusSearch, onOpenUpload, onOpenLeo, leoOpen = false }: MobileDashboardHeroProps) {
  const reducedMotion = useReducedMotion();
  return <motion.section initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    transition={reducedMotion ? { duration: 0 } : { type: 'spring', damping: 24, stiffness: 280 }} className="flex min-w-0 flex-col gap-6 py-6 md:hidden">
    <div className="min-w-0">
      <p className="mb-2 truncate text-sm font-bold text-[#ff6a2b]">Bonjour, {userFirstName}</p>
      <h1 className="text-3xl leading-tight font-extrabold tracking-tight">Que souhaitez-vous consulter ?</h1>
      <p className="mt-3 text-sm text-[#141414]/70">Retrouvez un fichier par son titre, son école ou sa matière.</p>
    </div>
    <SearchBar value={searchQuery} onChange={onSearchChange} onFocusSearch={onFocusSearch} onOpenLeo={onOpenLeo} leoOpen={leoOpen} variant="mobile" />
    <motion.button type="button" onClick={onOpenUpload} whileTap={reducedMotion ? undefined : { scale: 0.98 }}
      className="flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-full border-2 border-[#141414] bg-[#ff6a2b] px-4 py-3 text-base font-extrabold shadow-[3px_3px_0px_#141414] hover:bg-[#ff8a4c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#4a6cf0]">
      <Plus aria-hidden="true" size={22} />Déposer un fichier
    </motion.button>
  </motion.section>;
}
