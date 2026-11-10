import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { DashboardPage } from '../../src/pages/DashboardPage';
import { fixtureApi, fixtureFetch } from './leo-mocks';
import '../../src/index.css';

// Le transport et les hooks Léo restent ceux de production. Seules leurs
// frontières externes sont simulées ; CSP et CDP bloquent aussi tout réseau.
window.fetch = fixtureFetch;
const router = createBrowserRouter([
  { path: '/dashboard', element: <DashboardPage /> },
  { path: '/', element: <p>Recette locale : le dashboard est démonté.</p> },
]);
const api = {
  ...fixtureApi,
  navigate: (url: string | number) => typeof url === 'number'
    ? router.navigate(url)
    : router.navigate(url),
  settle: () => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }),
};
declare global {
  interface Window { __leoTest: typeof api }
}
window.__leoTest = api;
createRoot(document.getElementById('root')!).render(
  <StrictMode><RouterProvider router={router} /></StrictMode>,
);
