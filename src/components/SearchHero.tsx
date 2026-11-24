import { motion, useReducedMotion } from 'motion/react';
import { Plus } from 'lucide-react';
import { SearchBar } from './SearchBar';

interface SearchHeroProps {
  value: string;
  onChange: (value: string) => void;
  onFocusSearch: () => void;
  onOpenUpload: () => void;
  onOpenLeo: () => void;
  leoOpen?: boolean;
}

export function SearchHero({ value, onChange, onFocusSearch, onOpenUpload, onOpenLeo, leoOpen = false }: SearchHeroProps) {
  const reducedMotion = useReducedMotion();
  return <section className="flex min-w-0 flex-1 flex-col items-center justify-center py-16">
    <div className="flex w-full min-w-0 max-w-2xl flex-col items-center text-center">
      <h1 className="text-4xl leading-tight font-extrabold tracking-tight lg:text-5xl">Que souhaitez-vous consulter ?</h1>
      <p className="mt-4 mb-8 text-lg text-[#141414]/70">Recherchez un fichier, ou partagez vos ressources.</p>
      <SearchBar value={value} onChange={onChange} onFocusSearch={onFocusSearch} onOpenLeo={onOpenLeo} leoOpen={leoOpen} variant="hero" />
      <motion.button type="button" onClick={onOpenUpload} whileHover={reducedMotion ? undefined : { rotate: -2 }} whileTap={reducedMotion ? undefined : { scale: 0.98 }}
        className="mt-8 inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#ff6a2b] px-6 py-3 text-base font-bold text-[#141414] hover:bg-[#ff8a4c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#4a6cf0]">
        <Plus aria-hidden="true" size={22} />Déposer un fichier
      </motion.button>
    </div>
  </section>;
}
