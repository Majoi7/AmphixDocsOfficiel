export type DashboardView = 'home' | 'search' | 'explore';
export type LibraryPanel = 'upload' | 'profile';

export function readLibraryLocation(search: string) {
  const params = new URLSearchParams(search);
  const requestedView = params.get('view');
  const view: DashboardView = requestedView === 'search' || requestedView === 'explore' ? requestedView : 'home';
  const requestedPanel = params.get('panel');
  const panel: LibraryPanel | null = requestedPanel === 'upload' || requestedPanel === 'profile' ? requestedPanel : null;
  return {
    view,
    query: view === 'home' ? '' : params.get('q') || '',
    showTrash: view === 'explore' && params.get('trash') === '1',
    panel,
    documentId: !panel && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.get('document') || '')
      ? params.get('document') : null,
  };
}

export function dashboardUrl(view: DashboardView = 'home', options: { query?: string; showTrash?: boolean; panel?: LibraryPanel } = {}) {
  const params = new URLSearchParams();
  if (view !== 'home') params.set('view', view);
  if (view !== 'home' && options.query) params.set('q', options.query);
  if (view === 'explore' && options.showTrash) params.set('trash', '1');
  if (options.panel) params.set('panel', options.panel);
  const search = params.toString();
  return `/dashboard${search ? `?${search}` : ''}`;
}
