import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// R1 seulement : navigation et composants réels, sans .env ni accès distant.
// Les tests navigateur complètent ces contrôles pour le focus et le debounce.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const originalFetch = globalThis.fetch;
let vite, navigation, SearchBar, SearchHero, MobileDashboardHero;
let networkAttempts = 0;
before(async () => {
  globalThis.fetch = async () => { networkAttempts++; throw new Error('Réseau interdit dans cette recette locale.'); };
  vite = await createServer({
    root, configFile: false, envDir: false, plugins: [react()],
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    appType: 'custom', logLevel: 'error',
  });
  navigation = await vite.ssrLoadModule('/src/lib/library-navigation.ts');
  ({ SearchBar } = await vite.ssrLoadModule('/src/components/SearchBar.tsx'));
  ({ SearchHero } = await vite.ssrLoadModule('/src/components/SearchHero.tsx'));
  ({ MobileDashboardHero } = await vite.ssrLoadModule('/src/components/mobile/MobileDashboardHero.tsx'));
});
after(async () => {
  try { await vite?.close(); assert.equal(networkAttempts, 0); }
  finally { globalThis.fetch = originalFetch; }
});
const noop = () => undefined;

const props = { value: 'Algèbre', onChange: noop, onOpenLeo: noop };
test('R1 : une seule recherche accessible dans chaque variante de main', () => {
  for (const variant of ['hero', 'mobile', 'list']) {
    const html = renderToStaticMarkup(createElement(SearchBar, { ...props, variant, id: 'r1-search' }));
    assert.equal((html.match(/type="search"/g) || []).length, 1);
    assert.equal((html.match(/role="search"/g) || []).length, 1);
    assert.match(html, /for="r1-search"/);
    assert.match(html, /id="r1-search"/);
    assert.match(html, /aria-label="Effacer la recherche"/);
    assert.equal((html.match(/aria-label="Ouvrir Léo AI"/g) || []).length, 1);
    assert.match(html, /size-11/);
    assert.doesNotMatch(html, /focus(?:-visible)?:ring|focus(?:-visible)?:border|notion|Inter|dark:/);
  }
  const empty = renderToStaticMarkup(createElement(SearchBar, { ...props, value: '' }));
  assert.doesNotMatch(empty, /aria-label="Effacer la recherche"/);
});

test('R1 : formes et ombres d’origine conservées, focus en encre seulement', () => {
  const hero = renderToStaticMarkup(createElement(SearchBar, { ...props, variant: 'hero' }));
  const mobile = renderToStaticMarkup(createElement(SearchBar, { ...props, variant: 'mobile' }));
  const list = renderToStaticMarkup(createElement(SearchBar, { ...props, variant: 'list' }));
  assert.match(hero, /rounded-full/); assert.ok(hero.includes('shadow-[4px_4px_0px_#141414]'));
  assert.match(mobile, /rounded-2xl/); assert.ok(mobile.includes('shadow-[3px_3px_0px_#141414]'));
  assert.match(list, /min-h-14/); assert.match(list, /rounded-2xl/);
  for (const html of [hero, mobile, list]) {
    assert.ok(html.includes('border-[#141414]'));
    assert.ok(html.includes('focus-visible:outline-[#141414]'));
    assert.match(html, /bg-white/);
  }
});

test('R1 : les deux accueils réutilisent le champ sans remplacer leur structure', () => {
  const desktop = renderToStaticMarkup(createElement(SearchHero, { ...props, onFocusSearch: noop, onOpenUpload: noop }));
  const mobile = renderToStaticMarkup(createElement(MobileDashboardHero, {
    userFirstName: 'Membre', searchQuery: 'Algèbre', onSearchChange: noop,
    onFocusSearch: noop, onOpenUpload: noop, onOpenLeo: noop,
  }));
  for (const html of [desktop, mobile]) {
    assert.equal((html.match(/type="search"/g) || []).length, 1);
    assert.match(html, /Que souhaitez-vous consulter/);
    assert.match(html, /Déposer un fichier/);
    assert.match(html, /bg-\[#ff6a2b\]/);
  }
  assert.match(desktop, /max-w-2xl/); assert.match(desktop, /py-16/);
  assert.match(mobile, /Bonjour, Membre/); assert.match(mobile, /py-6/);
});

test('R1 : q partagé entre Accueil, Recherche et Explorer, sans perdre accents ou espaces', () => {
  for (const view of ['home', 'search', 'explore']) {
    const url = navigation.dashboardUrl(view, { query: 'Algèbre & logique', showTrash: true });
    const state = navigation.readLibraryLocation(url.slice(url.indexOf('?')));
    assert.equal(state.view, view);
    assert.equal(state.query, 'Algèbre & logique');
    assert.equal(state.showTrash, view === 'explore');
  }
  assert.equal(navigation.readLibraryLocation('?q=cours').query, 'cours');
  assert.equal(navigation.dashboardUrl('home', { query: 'cours' }), '/dashboard?q=cours');
  assert.equal(navigation.dashboardUrl('home'), '/dashboard');
  assert.equal(navigation.readLibraryLocation('?view=search&q=%20%20').query, '  ');
});

test('R1 : les panneaux et liens directs gardent leur contrat de navigation', () => {
  const id = '33333333-3333-4333-8333-333333333333';
  assert.equal(navigation.readLibraryLocation(`?q=cours&document=${id}`).documentId, id);
  assert.equal(navigation.readLibraryLocation(`?panel=leo&document=${id}`).documentId, null);
  for (const panel of ['leo', 'upload', 'profile']) {
    const state = navigation.readLibraryLocation(`?q=cours&panel=${panel}`);
    assert.equal(state.panel, panel); assert.equal(state.query, 'cours');
  }
});

test('R1 : une branche d’accueil montée, debounce 250 ms et conservation de l’état URL', async () => {
  const page = await source('src/pages/DashboardPage.tsx');
  assert.match(page, /view === 'home' \? isMobile/);
  assert.doesNotMatch(page, /type="search"|<LeoLauncher/);
  assert.match(page, /setTimeout\(\(\) => setDebouncedQuery\(searchQuery\.trim\(\)\), 250\)/);
  assert.match(page, /return \(\) => clearTimeout\(timer\)/);
  assert.match(page, /const query = debouncedQuery/);
  const hook = await source('src/hooks/useLibraryNavigation.ts');
  assert.match(hook, /location\.pathname === '\/dashboard' \? current\.query/);
  assert.match(hook, /params\.set\('q', query\)/);
  assert.match(hook, /state: location\.state/);
  assert.doesNotMatch(hook, /current\.view === 'home' \? 'search'/);
});

test('R1 : état vide différé, erreur non technique et actions de réessai conservées', async () => {
  const page = await source('src/pages/DashboardPage.tsx');
  assert.match(page, /!documents\.length && !loading && !searching && !libraryError/);
  assert.match(page, /aria-busy=\{loading \|\| loadingMore \|\| searching\}/);
  assert.match(page, /disabled=\{loading \|\| searching \|\| overlayOpen\}/);
  assert.match(page, /documents\.length > 0 && <p/);
  assert.doesNotMatch(page, /\{libraryError\}<\/p>|\{previews\.error\}<\/p>/);
  assert.match(page, /Réessayer le chargement/);
  assert.match(page, /Recharger les aperçus/);
  assert.match(page, /<DocumentGrid documents=\{documents\} urls=\{previews\.urls\}/);
});

test('R1 : animations de main et colonnes de la grille conservées', async () => {
  const mobile = await source('src/components/mobile/MobileDashboardHero.tsx');
  assert.match(mobile, /type: 'spring', damping: 24, stiffness: 280/);
  assert.match(mobile, /whileTap=\{reducedMotion \? undefined : \{ scale: 0\.98 \}\}/);
  const hero = await source('src/components/SearchHero.tsx');
  assert.match(hero, /whileHover=\{reducedMotion \? undefined : \{ rotate: -2 \}\}/);
  const card = await source('src/components/FileCard.tsx');
  assert.match(card, /delay: \(index % 20\) \* 0\.025/);
  assert.match(card, /whileTap=\{reducedMotion \? undefined : \{ scale: 0\.97 \}\}/);
  const grid = await source('src/components/DocumentGrid.tsx');
  assert.match(grid, /grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4/);
  assert.match(grid, /thumbnailUrl=\{document\.thumbnail_path/);
  const css = await source('src/index.css');
  for (const color of ['#f1ece4', '#ff6a2b', '#4a6cf0', '#141414', '#ffd23f', '#9ab8ff', '#ffb6e1', '#1b1230']) assert.ok(css.includes(color));
  assert.match(css, /--font-sans: 'DM Sans'/);
});
