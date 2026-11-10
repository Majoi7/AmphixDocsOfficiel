import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { DashboardPage } from '../../src/pages/DashboardPage';
import { DeferredPdfViewer } from '../../src/components/DocumentFileViewer';
import { fixtureApi, fixtureFetch } from './leo-mocks';
import '../../src/index.css';

// Échec différé injecté pour tester le réessai du composant, pas le réseau
// ni le décodage pdf.js. Le même Blob doit être transmis après le réessai.
const loaderSource = new Blob(['SOURCE FICTIVE DU TEST DE CHARGEMENT']);
let loaderCalls = 0;
let loaderMode: 'reject' | 'resolve' | 'hold' = 'reject';
let releaseLoader: (() => void) | undefined;
function FixtureReader({ source }: { source: Blob }) {
  return <p data-fixture-reader data-same-source={source === loaderSource}>Lecteur fictif chargé.</p>;
}
const fixtureLoader = async () => {
  loaderCalls++;
  if (loaderMode === 'reject') throw new Error('CHUNK_SECRET_SHOULD_NEVER_RENDER');
  if (loaderMode === 'hold') await new Promise<void>((resolve) => { releaseLoader = resolve; });
  return FixtureReader;
};

// Le transport et les hooks Léo restent ceux de production. Seules leurs
// frontières externes sont simulées ; CSP et CDP bloquent aussi tout réseau.
window.fetch = fixtureFetch;
const router = createBrowserRouter([
  { path: '/dashboard', element: <DashboardPage /> },
  { path: '/preview-loader', element: <DeferredPdfViewer source={loaderSource} load={fixtureLoader} /> },
  { path: '/', element: <p>Recette locale : le dashboard est démonté.</p> },
]);
const api = {
  ...fixtureApi,
  loader: () => ({ calls: loaderCalls, mode: loaderMode }),
  loaderMode: (mode: typeof loaderMode) => { loaderMode = mode; },
  releaseLoader: () => { releaseLoader?.(); releaseLoader = undefined; },
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
