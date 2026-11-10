import { useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Plus, Search } from 'lucide-react';
import { LeoLauncher } from './LeoLauncher';

interface SearchHeroProps {
  value: string;
  onChange: (value: string) => void;
  onFocusSearch: () => void;
  onOpenUpload: () => void;
  onOpenLeo: () => void;
}

export function SearchHero({ value, onChange, onFocusSearch, onOpenUpload, onOpenLeo }: SearchHeroProps) {
  const id = useId();
  const reducedMotion = useReducedMotion();
  return <section className="flex min-w-0 flex-1 flex-col items-center justify-center py-16">
    <div className="flex w-full min-w-0 max-w-2xl flex-col items-center text-center">
      <h1 className="text-4xl leading-tight font-extrabold tracking-tight lg:text-5xl">Que souhaitez-vous consulter ?</h1>
      <p className="mt-4 mb-8 text-lg text-[#141414]/70">Recherchez un fichier, ou partagez vos ressources.</p>
      <div className="relative w-full min-w-0">
        <label htmlFor={id} className="sr-only">Rechercher par titre, école, matière ou nom de fichier</label>
        <Search aria-hidden="true" size={22} className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-[#141414]/50" />
        <input id={id} type="search" value={value} onFocus={onFocusSearch} onChange={(event) => onChange(event.target.value)} placeholder="Titre, école, matière…"
          className="min-h-16 w-full min-w-0 rounded-full border-2 border-[#141414] bg-white py-4 pr-16 pl-14 text-lg shadow-[4px_4px_0px_#141414] outline-none focus:border-[#4a6cf0] focus:ring-4 focus:ring-[#4a6cf0]/20" />
        <span className="absolute top-1/2 right-2 -translate-y-1/2"><LeoLauncher onClick={onOpenLeo} /></span>
      </div>
      <motion.button type="button" onClick={onOpenUpload} whileHover={reducedMotion ? undefined : { rotate: -2 }} whileTap={reducedMotion ? undefined : { scale: 0.98 }}
        className="mt-8 inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#ff6a2b] px-6 py-3 text-base font-bold text-[#141414] hover:bg-[#ff8a4c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#4a6cf0]">
        <Plus aria-hidden="true" size={22} />Déposer un fichier
      </motion.button>
    </div>
  </section>;
}
