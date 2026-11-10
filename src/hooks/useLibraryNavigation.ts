import { useLocation, useNavigate } from 'react-router-dom';
import { dashboardUrl, readLibraryLocation, type DashboardView, type LibraryPanel } from '../lib/library-navigation';

// L’URL est l’état de navigation ; une fermeture de lien direct ne quitte pas
// l’application. Les panneaux ouverts depuis une carte utilisent l’historique.
export function useLibraryNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const current = readLibraryLocation(location.search);
  const href = `${location.pathname}${location.search}`;
  const hasOverlay = !!(current.panel || current.documentId);
  const overlayState = hasOverlay ? location.state : { libraryPanelOrigin: href };
  const closeOverlay = () => {
    const state: unknown = location.state;
    if (typeof state === 'object' && state !== null && 'libraryPanelOrigin' in state
      && typeof state.libraryPanelOrigin === 'string') {
      void navigate(-1);
      return;
    }
    const params = new URLSearchParams(location.search);
    params.delete('panel');
    params.delete('document');
    const search = params.toString();
    void navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true, state: null });
  };
  return {
    ...current,
    selectView: (view: DashboardView) => {
      const target = dashboardUrl(view, { query: view === current.view ? current.query : undefined });
      if (target !== href) void navigate(target, { replace: hasOverlay });
    },
    openPanel: (panel: LibraryPanel) => {
      if (current.panel === panel) return;
      const params = new URLSearchParams(location.search);
      params.set('panel', panel);
      params.delete('document');
      const target = panel === 'upload' && location.pathname !== '/dashboard'
        ? dashboardUrl('home', { panel }) : `${location.pathname}?${params}`;
      void navigate(target, { replace: hasOverlay, state: overlayState });
    },
    openDocument: (id: string) => {
      if (current.documentId === id) return;
      const params = new URLSearchParams(location.search);
      params.set('document', id);
      params.delete('panel');
      // Garder l’entrée Léo dans l’historique : fermer le détail retrouve le
      // panneau et sa recherche, sans relancer les trois appels.
      const fromLeo = current.panel === 'leo';
      void navigate(`${location.pathname}?${params}`, {
        replace: hasOverlay && !fromLeo,
        state: fromLeo ? { libraryPanelOrigin: href } : overlayState,
      });
    },
    closePanel: closeOverlay,
    closeDocument: closeOverlay,
    setQuery: (query: string) => void navigate(dashboardUrl(current.view === 'home' ? 'search' : current.view,
      { query, showTrash: current.showTrash }), { replace: true }),
    setShowTrash: (showTrash: boolean) => {
      const target = dashboardUrl('explore', { query: current.query, showTrash });
      if (target !== href) void navigate(target);
    },
  };
}
