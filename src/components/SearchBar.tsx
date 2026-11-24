import { forwardRef, useCallback, useId, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { LeoLauncher } from './LeoLauncher';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onOpenLeo: () => void;
  onFocusSearch?: () => void;
  onSubmit?: () => void;
  leoOpen?: boolean;
  autoFocus?: boolean;
  id?: string;
  variant?: 'hero' | 'mobile' | 'list';
}

// Les trois apparences de main restent locales : même forme, même ombre,
// mêmes dimensions. Le focus est neutre, sans anneau ni bordure de couleur.
const variants = {
  hero: {
    input: 'min-h-16 rounded-full py-4 pl-14 text-lg shadow-[4px_4px_0px_#141414]',
    icon: 'left-5', size: 22, actions: 'right-2',
  },
  mobile: {
    input: 'min-h-16 rounded-2xl py-4 pl-12 text-base shadow-[3px_3px_0px_#141414]',
    icon: 'left-4', size: 22, actions: 'right-1.5',
  },
  list: {
    input: 'min-h-14 rounded-2xl py-3 pl-12 text-base',
    icon: 'left-4', size: 20, actions: 'right-1',
  },
};

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(function SearchBar({
  value, onChange, onOpenLeo, onFocusSearch, onSubmit, leoOpen = false, autoFocus = false, id, variant = 'list',
}, forwardedRef) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const clearing = useRef(false);
  const assignInput = useCallback((input: HTMLInputElement | null) => {
    inputRef.current = input;
    if (typeof forwardedRef === 'function') forwardedRef(input);
    else if (forwardedRef) forwardedRef.current = input;
  }, [forwardedRef]);
  const style = variants[variant];

  return <form role="search" aria-label="Recherche de fichiers" data-search-variant={variant} className="relative w-full min-w-0"
    onSubmit={(event) => { event.preventDefault(); onSubmit?.(); }}>
    <label htmlFor={inputId} className="sr-only">Rechercher par titre, école, matière ou nom de fichier</label>
    <Search aria-hidden="true" size={style.size} className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[#141414]/50 ${style.icon}`} />
    <input ref={assignInput} id={inputId} type="search" value={value} autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      onFocus={() => { if (!clearing.current) onFocusSearch?.(); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
      }}
      placeholder="Titre, école, matière…"
      className={`w-full min-w-0 border-2 border-[#141414] bg-white outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141414] [&::-webkit-search-cancel-button]:appearance-none ${style.input} ${value ? 'pr-28' : 'pr-16'}`} />
    <span className={`absolute top-1/2 flex -translate-y-1/2 items-center gap-1 ${style.actions}`}>
      {value && <button type="button" aria-label="Effacer la recherche"
        onClick={() => {
          onChange('');
          // Restaurer le focus sans que le callback de l'accueil renavigue
          // avec l'ancienne valeur de q avant le prochain rendu.
          clearing.current = true;
          try { inputRef.current?.focus({ preventScroll: true }); }
          finally { clearing.current = false; }
        }}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-[#f1ece4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141414]">
        <X aria-hidden="true" size={20} />
      </button>}
      <LeoLauncher onClick={onOpenLeo} expanded={leoOpen} />
    </span>
  </form>;
});
