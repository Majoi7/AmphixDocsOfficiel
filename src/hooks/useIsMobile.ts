import { useState, useEffect } from 'react';

/**
 * Hook pour détecter si l'écran est en affichage mobile (< 768px).
 */
export function useIsMobile(breakpoint: number = 768): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < breakpoint;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const query = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const updateMatch = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };

    setIsMobile(query.matches);

    if (query.addEventListener) {
      query.addEventListener('change', updateMatch);
      return () => query.removeEventListener('change', updateMatch);
    } else {
      // Compatibilité navigateurs plus anciens
      query.addListener(updateMatch);
      return () => query.removeListener(updateMatch);
    }
  }, [breakpoint]);

  return isMobile;
}
