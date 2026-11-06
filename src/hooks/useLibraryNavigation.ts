import { useLocation, useNavigate } from 'react-router-dom';
import { dashboardUrl, readLibraryLocation, type DashboardView, type LibraryPanel } from '../lib/library-navigation';

// L’URL est l’unique état de navigation : rechargement, liens directs et retour
// navigateur restituent la même vue. La saisie remplace l’entrée courante.
export function useLibraryNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const current = readLibraryLocation(location.search);
  const href = `${location.pathname}${location.search}`;
  const selectView = (view: DashboardView) => {
    const target = dashboardUrl(view, { query: view === current.view ? current.query : undefined });
    if (target !== href) void navigate(target, { replace: !!current.panel });
  };
  const openPanel = (panel: LibraryPanel) => {
    if (current.panel === panel) return;
    const params = new URLSearchParams(location.search);
    params.set('panel', panel);
    const target = panel === 'upload' && location.pathname !== '/dashboard'
      ? dashboardUrl('home', { panel }) : `${location.pathname}?${params}`;
    void navigate(target, {
      replace: !!current.panel,
      state: current.panel ? location.state : { libraryPanelOrigin: href },
    });
  };
  const closePanel = () => {
    const state: unknown = location.state;
    if (typeof state === 'object' && state !== null && 'libraryPanelOrigin' in state
      && typeof state.libraryPanelOrigin === 'string') {
      void navigate(-1);
      return;
    }
    // Un lien direct n’a pas forcément d’entrée précédente dans l’application.
    const params = new URLSearchParams(location.search);
    params.delete('panel');
    const search = params.toString();
    void navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true, state: null });
  };
  return {
    ...current, selectView, openPanel, closePanel,
    setQuery: (query: string) => void navigate(dashboardUrl(current.view === 'home' ? 'search' : current.view,
      { query, showTrash: current.showTrash }), { replace: true }),
    setShowTrash: (showTrash: boolean) => {
      const target = dashboardUrl('explore', { query: current.query, showTrash });
      if (target !== href) void navigate(target);
    },
  };
}
