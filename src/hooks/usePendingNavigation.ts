import { useCallback, useEffect } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router-dom';

// Refuser la navigation interne tant qu’une écriture est en vol. Une nouvelle
// tentative fonctionne après sa fin ; aucune sortie différée surprenante.
export function usePendingNavigation(busy: boolean) {
  const blocker = useBlocker(busy);
  useEffect(() => {
    if (blocker.state === 'blocked') blocker.reset();
  }, [blocker]);
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (!busy) return;
    event.preventDefault();
    event.returnValue = '';
  }, [busy]));
}
