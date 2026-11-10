import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { build, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Recette locale, sans installation ni .env : vrais composants, hooks, transport
// et navigation ; frontières Auth/HTTP/SQL/signatures explicitement fictives.
// Le serveur ne sert que son build en mémoire, deux ressources fictives et
// une page de bootstrap sans scripts pour sonder CDP avant l'application.
// CSP et CDP interdisent tout réseau externe AVANT le montage de l'application.
// Aucun profil navigateur existant n'est ouvert ; le profil créé est conservé.
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixturePath = normalizePath(path.join(root, 'scripts/browser/leo-mocks.tsx'));
const sourcePath = normalizePath(path.join(root, 'src/lib/supabase.ts'));
const configPath = normalizePath(path.join(root, 'src/lib/supabase-config'));
const authPath = normalizePath(path.join(root, 'src/context/AuthContext'));
const pdfRuntimePath = normalizePath(path.join(root, 'src/lib/pdf-runtime'));
const decoderId = '\0amphixdocs-preview-decoder-fixture';
const facadeId = '\0amphixdocs-leo-test-boundaries';
const project = 'https://leo-browser.invalid';
const id = (n) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const launcher = 'button[aria-label="Ouvrir Léo AI"]';
const input = '.leo-panel textarea';
const resultCards = '.leo-results button[aria-haspopup="dialog"]';
const steps = '.leo-panel [data-status]';
const blockedRequests = [], remoteResponses = [], protocolErrors = [], runtimeErrors = [];
let server, origin, browser, cdp, session, profile;
let pendingNetworkProbe = null;
let previousRuntimeErrors = 0;

function isolatedImports() {
  let replacements = 0;
  return {
    name: 'leo-browser-isolation',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return;
      const parent = normalizePath(importer.split('?')[0]);
      const resolved = normalizePath(path.resolve(path.dirname(parent), source)).replace(/\.(?:tsx?|jsx?)$/, '');
      if (resolved === configPath || resolved === authPath) return fixturePath;
      if (resolved === pdfRuntimePath) return decoderId;
      if (resolved === sourcePath.replace(/\.ts$/, '')) { replacements++; return facadeId; }
    },
    load(moduleId) {
      // Frontière de décodage simulée UNIQUEMENT dans ce banc : le lecteur et
      // son import restent réels. Cela ne valide ni pdf.js ni le build livré.
      if (moduleId === decoderId) return `export { openFixturePdf as openPdf } from ${JSON.stringify(fixturePath)};`;
      if (moduleId !== facadeId) return;
      // Les exports explicites priment sur export *. Les helpers purs de
      // production restent réels, mais aucune lecture/mutation n'est distante.
      return `export * from ${JSON.stringify(sourcePath)};
export { fetchDashboardData, fetchDocumentTargets, getDocumentThumbnailUrls, getDocumentSignedUrl, getDocumentPreviewSource, completeDocumentPreview, updateDocumentMetadata, setDocumentTrash } from ${JSON.stringify(fixturePath)};
export async function resumeUserDocument() { throw new Error('Le dépôt est hors périmètre de la recette Léo.'); }`;
    },
    generateBundle() {
      assert.ok(replacements >= 5, 'Les frontières du dashboard, du détail et des aperçus doivent être isolées.');
      const modules = new Set([...this.getModuleIds()].map((name) => normalizePath(name.split('?')[0])));
      for (const relative of [
        'src/pages/DashboardPage.tsx', 'src/hooks/useLeoSession.ts', 'src/lib/leo-client.ts', 'src/lib/leo-session.ts',
        'src/hooks/useLibraryNavigation.ts', 'src/hooks/useDialogAccessibility.ts', 'src/hooks/useDialogViewport.ts',
        'src/hooks/useDocumentThumbnails.ts', 'src/hooks/useDocumentLink.ts', 'src/components/LeoPanel.tsx',
        'src/components/LeoLauncher.tsx', 'src/components/DocumentGrid.tsx', 'src/components/FileCard.tsx',
        'src/components/DocumentDetails.tsx', 'src/components/DocumentPreview.tsx',
        'src/components/DocumentFileViewer.tsx', 'src/components/PdfDocumentViewer.tsx', 'src/components/ImageDocumentViewer.tsx',
        'src/components/ui/ai-input-with-loading.tsx', 'src/components/ui/chain-of-thought.tsx',
        'src/components/UploadModal.tsx', 'src/lib/supabase.ts',
      ]) assert.ok(modules.has(normalizePath(path.join(root, relative))), `Le module réel manque : ${relative}`);
      assert.ok(!modules.has(`${configPath}.ts`), 'La configuration réelle ne doit jamais entrer dans le banc.');
      assert.ok(!modules.has(`${authPath}.tsx`), 'Aucune session réelle ne doit entrer dans le banc.');
      assert.ok(!modules.has(`${pdfRuntimePath}.ts`), 'Le décodage PDF doit rester explicitement simulé dans ce banc.');
      assert.ok(![...modules].some((name) => name.includes('/functions/leo-search/')), 'Le serveur Gemini ne doit jamais entrer dans le navigateur.');
    },
  };
}

class DevTools {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
        else entry.resolve(message.result);
      } else {
        for (const listener of this.listeners) Promise.resolve().then(() => listener(message))
          .catch((error) => { protocolErrors.push(error.message); });
      }
    });
    socket.addEventListener('close', () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`Connexion DevTools fermée pendant ${entry.method}.`));
      }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Le canal DevTools local ne répond pas.')), 15000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Canal DevTools local inaccessible.')); }, { once: true });
    });
    return new DevTools(socket);
  }
  send(method, params = {}, sessionId) {
    const commandId = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        reject(new Error(`Délai dépassé : ${method}.`));
      }, 20000);
      this.pending.set(commandId, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id: commandId, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}
const send = (method, params = {}) => cdp.send(method, params, session);
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const api = (method, ...args) => evaluate(`window.__leoTest[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
async function waitUntil(predicate, description, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(25); }
  throw new Error(`Attente dépassée : ${description}.`);
}
const waitFor = (expression, description) => waitUntil(() => evaluate(`Boolean(${expression})`), description);
function eventOnce(method) {
  return new Promise((resolve, reject) => {
    const listener = (event) => {
      if (event.sessionId !== session || event.method !== method) return;
      clearTimeout(timer); cdp.listeners.delete(listener); resolve(event.params);
    };
    const timer = setTimeout(() => { cdp.listeners.delete(listener); reject(new Error(`Événement absent : ${method}.`)); }, 15000);
    cdp.listeners.add(listener);
  });
}
// Plusieurs launchers sont montés mais masqués par les breakpoints : toujours
// choisir une vraie cible visible, jamais le premier querySelector aveuglément.
const visible = `(element) => {
  const rect = element.getBoundingClientRect();
  return !!(rect.width && rect.height) && getComputedStyle(element).visibility !== 'hidden'
    && !element.closest('[inert], [aria-hidden="true"]');
}`;
const element = (selector) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find(${visible})`;
async function clickElement(expression) {
  const point = await evaluate(`(() => {
    const element = ${expression};
    if (!element || element.matches(':disabled')) throw new Error('Action visible indisponible.');
    element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    if (!element.contains(document.elementFromPoint(x, y))) throw new Error('Action occultée par un autre élément.');
    return { x, y };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
const click = (selector) => clickElement(element(selector));
const clickText = (text, scope = '.leo-panel') => clickElement(`[...document.querySelectorAll(${JSON.stringify(`${scope} button, ${scope} a, ${scope} summary`)})].filter(${visible}).find(el => el.textContent.trim() === ${JSON.stringify(text)})`);
async function fill(selector, text, expected = text) {
  await evaluate(`(() => { const element = ${element(selector)};
    if (!element || element.matches(':disabled') || element.readOnly) throw new Error('Champ indisponible.');
    element.focus({ preventScroll: true }); element.select();
  })()`);
  await send('Input.insertText', { text });
  assert.equal(await evaluate(`(${element(selector)}).value`), expected);
}
async function key(value, modifiers = 0) {
  const windowsVirtualKeyCode = { Enter: 13, Tab: 9, Escape: 27 }[value];
  const params = { key: value, code: value, modifiers, ...(windowsVirtualKeyCode ? { windowsVirtualKeyCode } : {}) };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(value === 'Enter' ? { text: '\r' } : {}) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}
async function fresh(width = 360, url = '/dashboard') {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 800, screenWidth: width, screenHeight: 800, deviceScaleFactor: 1, mobile: width < 768 });
  await send('Emulation.setTouchEmulationEnabled', { enabled: width < 768, maxTouchPoints: 1 });
  const loaded = eventOnce('Page.loadEventFired');
  await send('Page.navigate', { url: `${origin}${url}` }); await loaded;
  await waitFor(`!!window.__leoTest && !!(${element(launcher)}) && window.__leoTest.libraryCalls().length > 0`, 'montage du dashboard réel');
  await api('settle');
  assert.equal(await evaluate('location.origin'), origin);
}
async function open() {
  await evaluate(`window.__leoLauncher = ${element(launcher)}; void 0;`);
  await click(launcher);
  await waitFor('!!document.querySelector(".leo-panel") && document.activeElement === document.querySelector(".leo-panel textarea")', 'panneau et focus initial');
}
async function close() {
  await click('.leo-panel button[aria-label="Fermer Léo AI"]');
  await waitFor('!document.querySelector(".leo-panel")', 'fermeture de Léo');
}
async function submit(prompt = 'Sujets d’algèbre') { await fill(input, prompt); await key('Enter'); }
async function completed(count = 10) {
  await waitFor(`document.querySelectorAll(${JSON.stringify(resultCards)}).length === ${count}
    && !!document.querySelector('.leo-panel section[aria-label="Résultats de Léo"]')
    && !document.querySelector('.leo-panel textarea').readOnly`, 'résultats terminés');
}
const stepStates = () => evaluate(`[...document.querySelectorAll(${JSON.stringify(steps)})].map(el => el.dataset.status)`);
const panelText = () => evaluate('document.querySelector(".leo-panel")?.textContent || ""');
async function details(documentId = id(21), useCard = false) {
  if (useCard) await click(`${resultCards}[aria-label="Voir le détail de Sujet d’algèbre fictif 21"]`);
  else await click(`.leo-panel a[href="/dashboard?document=${documentId}"]`);
  await waitFor('!document.querySelector(".leo-panel") && !!document.querySelector("[role=dialog] h3")', 'détail réel hors pagination');
  assert.equal(await evaluate('new URLSearchParams(location.search).get("document")'), documentId);
}
async function backToLeo() {
  await click('[role="dialog"] button[aria-label="Fermer"]');
  await waitFor('!!document.querySelector(".leo-panel")', 'retour vers Léo');
}
const pdfRegion = '[role="region"][aria-label="Pages du document PDF"]';
const previewMessage = 'Impossible d’afficher l’aperçu. Tu peux télécharger le fichier.';
async function renderedPdf(page = 1) {
  await waitFor(`document.querySelector('[data-pdf-page="${page}"] canvas')?.width > 0`, `canvas de la page ${page}`);
  await waitUntil(async () => (await api('pdf')).rendered.includes(page), `rendu fictif de la page ${page}`);
}
async function lastPdfPage() {
  await evaluate(`(() => { const region = document.querySelector(${JSON.stringify(pdfRegion)});
    region.scrollTop = region.scrollHeight; region.dispatchEvent(new Event('scroll')); })()`);
  await renderedPdf(8);
  await waitFor('!document.querySelector(\'[data-pdf-page="1"] canvas\')', 'libération du canvas éloigné');
}
async function screenshotFailure(name) {
  if (!cdp || !session || !profile) return;
  try {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    const destination = path.join(profile, `echec-${name.replace(/[^a-z0-9-]/gi, '-').slice(0, 70)}.png`);
    await writeFile(destination, Buffer.from(result.data, 'base64'));
    console.info(`Capture locale : ${destination}`);
  } catch { /* La capture ne doit pas masquer l'échec original. */ }
}

before(async () => {
  const result = await build({
    root, configFile: false, envDir: false, publicDir: false, mode: 'leo-browser-test', logLevel: 'error',
    plugins: [isolatedImports(), react(), tailwindcss()],
    build: { write: false, emptyOutDir: false, minify: false, sourcemap: false,
      rolldownOptions: { input: path.join(root, 'scripts/browser/leo-harness.html') } },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((output) => output.output || []);
  const files = new Map(outputs.map((output) => [output.fileName, output.type === 'chunk' ? output.code : output.source]));
  const html = [...files.keys()].find((name) => name.endsWith('leo-harness.html'));
  assert.ok(html, 'Le build isolé doit fournir son entrée HTML.');
  files.set('fixture-preview.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320" viewBox="0 0 240 320"><rect width="240" height="320" fill="#f1ece4"/><text x="20" y="80" fill="#141414">APERÇU FICTIF</text></svg>');
  files.set('fixture-file.pdf', '%PDF-1.4\n% Fixture de transport uniquement, aucun document réel.\n%%EOF');
  const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'none'; media-src 'self' blob:; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };
  server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const file = pathname === '/' || pathname === '/dashboard' ? html : pathname.slice(1);
    response.setHeader('Content-Security-Policy', csp);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (pathname === '/__cdp_bootstrap__') {
      // La CSP applicative n'est pas desserrée. Cette page n'a aucun script ;
      // seule la sonde contrôlée par CDP peut utiliser connect-src 'self'.
      response.setHeader('Content-Security-Policy', "default-src 'none'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html lang="fr"><meta charset="utf-8"><title>Sonde locale CDP</title><body>Sonde locale, sans application.</body></html>');
      return;
    }
    if (!files.has(file)) { response.writeHead(404); response.end('Ressource absente du banc local.'); return; }
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.end(files.get(file));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const edge = process.env.AMPHIXDOCS_TEST_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  await access(edge);
  profile = await mkdtemp(path.join(tmpdir(), 'amphixdocs-leo-browser-'));
  browser = spawn(edge, [
    '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const websocketUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Edge n’a pas ouvert DevTools. ${stderr.slice(-1200)}`)), 20000);
    browser.once('error', (error) => { clearTimeout(timer); reject(error); });
    browser.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Edge s’est arrêté avant DevTools (${code}).`)); });
    browser.stderr.on('data', (data) => {
      stderr = (stderr + data.toString()).slice(-5000);
      const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/.exec(stderr);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  cdp = await DevTools.connect(websocketUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  cdp.listeners.add(async (event) => {
    if (event.sessionId !== session) return;
    if (event.method === 'Fetch.requestPaused') {
      const url = event.params.request.url;
      const probe = pendingNetworkProbe;
      const probeRequest = probe?.url === url;
      if (url.startsWith(`${origin}/`) && !probeRequest) await send('Fetch.continueRequest', { requestId: event.params.requestId });
      else {
        if (probeRequest) probe.observed = { method: event.params.request.method, resourceType: event.params.resourceType };
        const intentional = !!probe && probe.url === url && probe.requestId === null
          && event.params.request.method === 'GET' && event.params.resourceType === 'Fetch';
        if (intentional) probe.requestId = event.params.requestId;
        blockedRequests.push({ url, intentional });
        await send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'BlockedByClient' });
        if (intentional) probe.blocked = true;
      }
    }
    const probe = pendingNetworkProbe;
    if (probe && event.method === 'Network.requestWillBeSent' && event.params.request.url === probe.url) probe.networkId = event.params.requestId;
    if (probe && event.method === 'Network.loadingFailed' && event.params.requestId === probe.networkId) {
      probe.failure = { errorText: event.params.errorText, blockedReason: event.params.blockedReason, corsErrorStatus: event.params.corsErrorStatus };
    }
    if (event.method === 'Network.responseReceived' && /^https?:/.test(event.params.response.url)
      && !event.params.response.url.startsWith(`${origin}/`)) remoteResponses.push(event.params.response.url);
    if (event.method === 'Runtime.exceptionThrown') runtimeErrors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Network.enable'); await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__leoCsp = []; document.addEventListener('securitypolicyviolation', (event) => window.__leoCsp.push(event.effectiveDirective));` });
  await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  console.info('Banc Léo/aperçus : vrais React, navigation et transport ; Auth, HTTP, SQL, signatures et décodage PDF fictifs. Aucun test pdf.js/RLS/OAuth distant.');
  console.info(`Profil isolé conservé : ${profile}`);
}, { timeout: 120000 });

afterEach(async (context) => {
  if (context.error) await screenshotFailure(context.name);
  assert.deepEqual(protocolErrors, [], 'Aucune erreur DevTools ne doit être ignorée.');
  assert.deepEqual(remoteResponses, [], 'Aucune réponse distante ne doit être reçue.');
  assert.deepEqual(blockedRequests.filter((request) => !request.intentional), [], 'L’application ne doit tenter aucun accès externe.');
  assert.deepEqual(runtimeErrors.slice(previousRuntimeErrors), [], 'Aucune exception React/navigateur ne doit être ignorée.');
  previousRuntimeErrors = runtimeErrors.length;
  if (cdp && session && await evaluate('!!window.__leoTest')) assert.equal(await api('networkAttempts'), 0, 'Aucun appel SDK ou HTTP non simulé.');
});
after(async () => {
  if (cdp) { try { await cdp.send('Browser.close'); } catch { /* La fermeture peut précéder la réponse. */ } cdp.socket.close(); }
  if (browser && browser.exitCode === null) browser.kill();
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test('CDP et CSP bloquent le réseau avant tout appel réel', async () => {
  // Sonder le fetch natif depuis une page locale sans application. La requête
  // reste locale même si CDP régresse ; son interception explicite est requise.
  const probe = { url: `${origin}/__cdp_probe__/${randomUUID()}`, requestId: null, blocked: false };
  const loaded = eventOnce('Page.loadEventFired');
  await send('Page.navigate', { url: `${origin}/__cdp_bootstrap__` }); await loaded;
  assert.equal(await evaluate('location.href'), `${origin}/__cdp_bootstrap__`);
  assert.equal(await evaluate('!!window.__leoTest'), false);
  const before = blockedRequests.length;
  pendingNetworkProbe = probe;
  try {
    const result = await evaluate(`fetch(${JSON.stringify(probe.url)}, {
      mode: 'no-cors', cache: 'no-store', credentials: 'omit', redirect: 'error'
    }).then(() => 'autorisé', () => 'refusé')`);
    assert.equal(result, 'refusé');
    await waitUntil(() => probe.blocked, 'refus explicite de la sonde par CDP').catch((cause) => {
      throw new Error(`${cause.message} Événement observé : ${JSON.stringify(probe.observed ?? null)} ; échec : ${JSON.stringify(probe.failure ?? null)} ; requêtes : ${JSON.stringify(blockedRequests.slice(before))}`, { cause });
    });
    assert.ok(probe.requestId);
    assert.deepEqual(blockedRequests.slice(before), [{ url: probe.url, intentional: true }]);
  } finally { pendingNetworkProbe = null; }
  await fresh();
  assert.equal(await api('probeCsp'), 'refusé');
  await waitFor('window.__leoCsp.includes("connect-src")', 'preuve du blocage CSP du fetch natif');
});

test('launchers accueil/recherche, cibles tactiles et panneau de 320 px au desktop', async () => {
  for (const width of [320, 360, 390, 430, 1366]) for (const url of ['/dashboard', '/dashboard?view=search']) {
    await fresh(width, url);
    const target = await evaluate(`(() => { const r = (${element(launcher)}).getBoundingClientRect(); return { width: r.width, height: r.height }; })()`);
    assert.ok(target.width >= 44 && target.height >= 44);
    await open();
    const dimensions = await evaluate(`(() => {
      const dialog = document.querySelector('.leo-panel'), r = dialog.getBoundingClientRect();
      return { width: r.width, right: r.right, page: document.documentElement.scrollWidth, screen: innerWidth,
        name: document.getElementById(dialog.getAttribute('aria-labelledby')).textContent,
        modal: dialog.getAttribute('aria-modal'), placeholder: dialog.querySelector('textarea').placeholder,
        navHidden: document.querySelector('nav[aria-label="Navigation principale mobile"]')?.getAttribute('aria-hidden'),
        navInert: document.querySelector('nav[aria-label="Navigation principale mobile"]')?.inert };
    })()`);
    assert.equal(dimensions.name, 'Léo AI'); assert.equal(dimensions.modal, 'true');
    assert.equal(dimensions.placeholder, 'Décris le fichier que tu cherches…');
    assert.ok(Math.abs(dimensions.width - Math.min(width, 640)) <= 1);
    assert.ok(Math.abs(dimensions.right - width) <= 1);
    assert.ok(dimensions.page <= dimensions.screen);
    assert.equal(dimensions.navHidden, 'true'); assert.equal(dimensions.navInert, true);
    await close();
    assert.equal(await evaluate('document.activeElement === window.__leoLauncher'), true);
    assert.equal(await evaluate('document.body.style.overflow'), '');
  }
});

test('focus confiné, Échap, clavier visuel et animations réduites', async () => {
  await fresh(320); await open();
  assert.equal(await evaluate('document.body.style.overflow'), 'hidden');
  await evaluate(`window.__leoFocusable = [...document.querySelector('.leo-panel').querySelectorAll('button, a, textarea, summary, [tabindex]')].filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && (${visible})(el)); window.__leoFocusable.at(-1).focus();`);
  await key('Tab'); assert.equal(await evaluate('document.activeElement === window.__leoFocusable[0]'), true);
  await key('Tab', 8); assert.equal(await evaluate('document.activeElement === window.__leoFocusable.at(-1)'), true);
  await evaluate('document.querySelector("header a").focus()');
  assert.equal(await evaluate('document.querySelector(".leo-panel").contains(document.activeElement)'), true);
  await fill(input, 'Algèbre\n'.repeat(40));
  await api('viewport', 340, 18);
  await waitFor('Math.abs(document.querySelector(".leo-viewport").getBoundingClientRect().height - 340) < 1', 'adaptation au clavier visuel');
  await api('settle');
  const sizes = await evaluate(`(() => { const dialog = document.querySelector('.leo-panel'); const r = dialog.getBoundingClientRect(); const field = dialog.querySelector('textarea'); const f = field.getBoundingClientRect(); const s = getComputedStyle(field);
    return { top: r.top, bottom: r.bottom, inputBottom: f.bottom, inputHeight: f.height, overflow: s.overflowY, font: s.fontSize,
      caret: s.caretColor, background: s.backgroundColor, page: document.documentElement.scrollWidth,
      animations: dialog.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length }; })()`);
  assert.ok(Math.abs(sizes.top - 18) < 1); assert.ok(Math.abs(sizes.bottom - 358) < 1);
  assert.ok(sizes.inputBottom < sizes.bottom && sizes.inputHeight >= 44 && sizes.inputHeight <= 81);
  assert.equal(sizes.overflow, 'auto'); assert.equal(sizes.font, '16px');
  assert.equal(sizes.caret, 'rgb(20, 20, 20)'); assert.equal(sizes.background, 'rgb(237, 237, 237)');
  assert.equal(sizes.animations, 0); assert.ok(sizes.page <= 320);
  await key('Escape'); await waitFor('!document.querySelector(".leo-panel")', 'Échap');
  assert.equal(await evaluate('document.activeElement === window.__leoLauncher'), true);
});

test('saisie contrôlée : vide, Maj+Entrée, 500 caractères, composition IME et double envoi', async () => {
  await fresh(); await open(); await fill(input, '   '); await key('Enter');
  assert.equal((await api('calls')).length, 0);
  await fill(input, 'Algèbre'); await key('Enter', 8); await send('Input.insertText', { text: 'Physique' });
  assert.equal(await evaluate('document.querySelector(".leo-panel textarea").value'), 'Algèbre\nPhysique');
  assert.equal((await api('calls')).length, 0);
  await fill(input, 'x'.repeat(501), 'x'.repeat(500));
  await fill(input, 'Algèbre');
  // Événements de composition simulés, pas une validation de clavier iOS/Android.
  await evaluate(`(() => { const field = document.querySelector('.leo-panel textarea');
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true })); })()`);
  assert.equal((await api('calls')).length, 0);
  await evaluate(`document.querySelector('.leo-panel textarea').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))`);
  await api('hold', 'plan'); await key('Enter');
  await waitUntil(async () => (await api('calls')).length === 1, 'premier envoi');
  await key('Enter'); await key('Enter'); await api('settle');
  assert.equal((await api('calls')).length, 1);
  assert.equal(await evaluate('document.querySelector(".leo-panel textarea").readOnly'), true);
  assert.equal(await evaluate('document.querySelector(\'.leo-panel button[aria-label="Léo cherche…"]\').disabled'), true);
  await api('release', 'plan'); await completed();
  assert.equal(await evaluate('document.querySelector(".leo-panel textarea").value'), '');
});

test('trois étapes réelles, suggestions, 30 liens internes, dix cartes et aperçus', async () => {
  await fresh(); await open();
  for (const action of ['plan', 'search', 'rank']) await api('hold', action);
  await clickText('Les sujets d’examen d’algèbre de l’EPAC');
  assert.equal((await api('calls')).length, 0);
  assert.equal(await evaluate('document.querySelector(".leo-panel textarea").value'), 'Les sujets d’examen d’algèbre de l’EPAC');
  await key('Enter'); await waitUntil(async () => (await api('calls')).length === 1, 'plan lancé');
  assert.deepEqual(await stepStates(), ['active', 'pending', 'pending']); await api('settle');
  assert.deepEqual(await stepStates(), ['active', 'pending', 'pending']);
  await api('release', 'plan'); await waitUntil(async () => (await api('calls')).length === 2, 'recherche lancée');
  assert.deepEqual(await stepStates(), ['complete', 'active', 'pending']);
  assert.match(await panelText(), /Les sujets d’algèbre de l’EPAC\./);
  await api('release', 'search'); await waitUntil(async () => (await api('calls')).length === 3, 'classement lancé');
  assert.deepEqual(await stepStates(), ['complete', 'complete', 'active']);
  assert.equal(await evaluate('document.querySelectorAll(".leo-results button").length'), 0);
  const links = await evaluate('[...document.querySelectorAll(".leo-panel a")].map(a => ({ url: a.getAttribute("href"), target: a.getAttribute("target") }))');
  assert.equal(links.length, 30);
  assert.ok(links.every(link => /^\/dashboard\?document=[0-9a-f-]{36}$/.test(link.url) && !link.target));
  await api('release', 'rank'); await completed();
  assert.deepEqual(await stepStates(), ['complete', 'complete', 'complete']);
  const headerText = await evaluate(`Array.from(document.querySelectorAll('.leo-panel button')).find(button => button.textContent.includes('Réflexion de Léo'))?.textContent`);
  assert.equal(headerText, 'Réflexion de Léo3/3 étapes');
  assert.doesNotMatch(headerText, /3\/33|terminées sur/);
  assert.match(await panelText(), /10 résultats trouvés/);
  assert.equal(await evaluate('document.querySelectorAll(".leo-panel h4 + ul li").length'), 3);
  await evaluate('document.querySelector(".leo-results").scrollIntoView({ block: "start", behavior: "instant" })');
  await waitFor('!!document.querySelector(".leo-results img")?.naturalWidth', 'aperçu fictif avec le vrai composant');
  assert.ok((await api('thumbnails')).some(paths => paths.some(path => path.endsWith('fictif-21.png'))));
  const calls = await api('calls');
  assert.deepEqual(calls.map(call => call.body.action), ['plan', 'search', 'rank']);
  assert.ok(calls.every(call => call.cache === 'no-store' && call.credentials === 'omit' && call.redirect === 'error'));
});

test('détail hors pagination, téléchargement préparé, retour et historique sans nouvel appel', async () => {
  await fresh(390, '/dashboard?view=search&q=algebre'); await open(); await submit(); await completed();
  const url = await evaluate('location.href');
  assert.ok((await api('libraryCalls')).every(call => !call.ids.includes(id(21))));
  await details();
  assert.ok((await api('targets')).some(ids => ids.includes(id(21))));
  await evaluate(`window.__downloadClickEvents = [];
    for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, event => {
      const target = event.target instanceof Element ? event.target : null;
      window.__downloadClickEvents.push({ type, tag: target?.tagName, button: target?.closest('button, a')?.textContent.trim(), x: event.clientX, y: event.clientY });
    }, true); void 0;`);
  await clickText('Télécharger', '[role="dialog"]');
  await waitFor('!!document.querySelector("[role=dialog] a[download]")', 'signature fictive préparée').catch(async (cause) => {
    const state = await evaluate(`({ events: window.__downloadClickEvents,
      text: document.querySelector('[role=dialog]')?.textContent,
      controls: [...document.querySelectorAll('[role=dialog] button, [role=dialog] a')].map(element => ({ text: element.textContent.trim(), disabled: element.disabled, rect: element.getBoundingClientRect().toJSON() })) })`);
    throw new Error(`${cause.message} État local : ${JSON.stringify(state)}`, { cause });
  });
  assert.equal(await evaluate('document.querySelector("[role=dialog] a[download]").getAttribute("href")'), '/fixture-file.pdf');
  await backToLeo(); await completed(); assert.equal(await evaluate('location.href'), url);
  assert.equal((await api('calls')).length, 3);
  await details(id(21), true); await api('navigate', -1); await completed();
  assert.equal(await evaluate('location.href'), url); assert.equal((await api('calls')).length, 3);
  await close(); await open(); await completed(); assert.equal((await api('calls')).length, 3);
  await submit('Cours de physique'); await completed();
  await click('.leo-panel details summary'); await click('.leo-panel details li:last-child button');
  assert.equal((await api('calls')).length, 6);
  assert.equal(await evaluate('document.querySelector(".leo-panel details li:last-child button").getAttribute("aria-pressed")'), 'true');
  await fill(input, 'Brouillon de recette non persistant');
  assert.equal(await evaluate('[localStorage, sessionStorage].some(storage => Object.values(storage).some(value => value.includes("Brouillon de recette non persistant")))'), false);
  await api('navigate', '/'); await waitFor('!document.querySelector(".leo-panel") && !document.querySelector("main")', 'dashboard démonté');
  await api('navigate', '/dashboard'); await waitFor(`!!(${element(launcher)})`, 'dashboard remonté'); await open();
  assert.equal(await evaluate('document.querySelector(".leo-panel textarea").value'), '');
  assert.equal(await evaluate('document.querySelectorAll(".leo-panel details").length'), 0);
  assert.equal((await api('calls')).length, 6);
});

for (const action of ['plan', 'search', 'rank']) test(`fermeture pendant ${action} : annulation, réponse tardive ignorée et réessai`, async () => {
  await fresh(); await open(); await api('hold', action); await submit('Demande interrompue');
  await waitUntil(async () => (await api('calls')).at(-1)?.body.action === action, `${action} suspendue`);
  const count = (await api('calls')).length;
  await close(); assert.equal((await api('calls')).at(-1).aborted, true);
  await open(); assert.match(await panelText(), /La recherche a été interrompue/);
  assert.equal(await evaluate('document.querySelector(".leo-panel textarea").value'), 'Demande interrompue');
  await api('release', action); await api('settle');
  assert.equal((await api('calls')).length, count);
  assert.equal(await evaluate('document.querySelectorAll(".leo-panel a, .leo-results button").length'), 0);
  await clickText('Réessayer'); await completed();
  const calls = await api('calls');
  assert.deepEqual(calls.slice(count).map(call => call.body.action), ['plan', 'search', 'rank']);
  if (action !== 'plan') assert.notEqual(calls.at(-1).body.requestId, calls[count - 1].body.requestId);
});

test('messages français : hors périmètre, vide, repli, erreur et quota avec réessai', async () => {
  for (const mode of ['out-of-scope', 'empty', 'fallback', 'rank-fallback']) {
    await fresh(); await open(); await api('mode', mode); await submit('Demande de recette');
    if (mode === 'out-of-scope') {
      await waitFor('document.querySelector(".leo-panel").textContent.includes("Je peux seulement t\'aider à retrouver des fichiers.")', 'hors périmètre');
      assert.deepEqual(await stepStates(), ['complete', 'skipped', 'skipped']); assert.equal((await api('calls')).length, 1);
    } else {
      await completed(mode === 'empty' ? 0 : 10);
      assert.equal((await api('calls')).length, 3);
      if (mode === 'empty') {
        assert.match(await panelText(), /Essaie une autre formulation/); await clickText('Modifier ma recherche');
        assert.equal(await evaluate('document.querySelector(".leo-panel textarea").value'), 'Demande de recette');
      } else assert.match(await panelText(), /Léo est indisponible, voici une recherche classique\./);
    }
  }
  for (const [action, status, message] of [
    ['search', 503, "Léo n'a pas pu répondre. Réessaie dans un instant."],
    ['plan', 429, 'Tu as fait beaucoup de demandes, réessaie dans quelques minutes.'],
    ['rank', 503, "Léo n'a pas pu répondre. Réessaie dans un instant."],
  ]) {
    await fresh(); await open(); await api('fail', action, status); await submit('Brouillon conservé');
    await waitFor(`document.querySelector('.leo-panel')?.textContent.includes(${JSON.stringify(message)})`, 'message public sans erreur technique');
    assert.doesNotMatch(await panelText(), /SQL_SECRET|503|429|Gemini|apikey|leo-search/);
    assert.equal(await evaluate('document.querySelector(".leo-panel textarea").value'), 'Brouillon conservé');
    assert.equal(await evaluate('document.querySelectorAll(".leo-panel a, .leo-results button").length'), 0);
    const before = (await api('calls')).length;
    await clickText('Réessayer'); await completed();
    assert.deepEqual((await api('calls')).slice(before).map(call => call.body.action), ['plan', 'search', 'rank']);
  }
});

test('aperçu en erreur : cartes accessibles et rechargement réel du hook', async () => {
  await fresh(); await open(); await api('failPreview', true); await submit(); await completed();
  await waitFor('document.querySelector(".leo-panel").textContent.includes("Certains aperçus sont indisponibles.")', 'erreur aperçu actionnable');
  await api('failPreview', false); await clickText('Recharger les aperçus');
  await evaluate('document.querySelector(".leo-results").scrollIntoView({ block: "start", behavior: "instant" })');
  await waitFor('!!document.querySelector(".leo-results img")?.naturalWidth', 'aperçu rechargé');
  assert.equal((await api('calls')).length, 3);
});

for (const change of ['user', 'signout', 'client', 'project', 'generation', 'key']) test(`changement ${change} : historique, brouillon et réponse en vol invalidés`, async () => {
  await fresh(); await open(); await submit('Recherche du premier compte'); await completed();
  await api('hold', 'rank'); await submit('Brouillon privé du premier contexte');
  await waitUntil(async () => (await api('calls')).length === 6, 'classement en vol du premier contexte');
  if (change === 'user' || change === 'signout') await api('user', change === 'user' ? id(900) : null);
  else await api('scope', change);
  await waitFor('document.querySelector(".leo-panel textarea").value === "" && !document.querySelector(".leo-panel details")', 'effacement du contexte');
  assert.equal((await api('calls')).at(-1).aborted, true);
  await api('release', 'rank'); await api('settle');
  assert.equal((await api('calls')).length, 6);
  assert.doesNotMatch(await panelText(), /Recherche du premier compte|Brouillon privé du premier contexte|Sujet d’algèbre fictif/);
});

test('rafraîchir le JWT du même compte conserve historique et demande en cours', async () => {
  await fresh(); await open(); await submit('Première demande'); await completed();
  await api('hold', 'plan'); await submit('Deuxième demande');
  await waitUntil(async () => (await api('calls')).length === 4, 'plan en vol');
  await api('refreshToken'); await api('settle');
  assert.equal((await api('calls')).at(-1).aborted, false);
  assert.match(await panelText(), /Historique de cette session \(2\)/);
  await api('release', 'plan'); await completed(); assert.equal((await api('calls')).length, 6);
});

test('modification et corbeille hors pagination : aucune mutation optimiste, confirmation répercutée dans Léo', async () => {
  await fresh(); await open(); await submit(); await completed(); await details();
  await clickText('Modifier', '[role="dialog"]');
  const title = 'Algèbre — titre confirmé localement';
  await fill('[role="dialog"] form input', title);
  await api('hold', 'update'); await api('failMutation', 'update');
  await click('[role="dialog"] button[type="submit"]');
  await waitUntil(async () => (await api('mutations')).length === 1, 'modification en attente');
  assert.equal((await api('document', id(21))).title, 'Sujet d’algèbre fictif 21');
  assert.equal((await api('mutations'))[0].confirmed, false);
  await key('Escape'); assert.equal(await evaluate('!!document.querySelector("[role=dialog] form")'), true);
  await api('release', 'update');
  await waitFor('document.querySelector("[role=dialog] [role=alert]")?.textContent === "Les modifications n’ont pas pu être confirmées. Réessayez."', 'échec de confirmation affiché');
  assert.doesNotMatch(await evaluate('document.querySelector("[role=dialog]").textContent'), /Confirmation fictive refusée/);
  assert.equal((await api('document', id(21))).title, 'Sujet d’algèbre fictif 21');
  await click('[role="dialog"] button[type="submit"]');
  await waitFor('document.querySelector("[role=dialog]").textContent.includes("Modifications enregistrées.")', 'modification confirmée');
  assert.equal((await api('document', id(21))).title, title);
  await backToLeo(); await completed();
  assert.equal(await evaluate(`document.querySelector('.leo-panel a[href="/dashboard?document=${id(21)}"]').textContent.includes(${JSON.stringify(title)})`), true);
  assert.equal(await evaluate('document.querySelectorAll(".leo-panel h4 + ul li").length'), 2);
  assert.ok((await api('libraryCalls')).every(call => !call.ids.includes(id(21))));
  await details(); await api('hold', 'trash'); await api('failMutation', 'trash');
  await clickText('Placer dans la corbeille', '[role="dialog"]');
  await waitUntil(async () => (await api('mutations')).length === 3, 'corbeille en attente');
  assert.equal((await api('document', id(21))).deleted_at, null);
  await api('release', 'trash');
  await waitFor('document.querySelector("[role=dialog] [role=alert]")?.textContent === "L’action n’a pas pu être confirmée. Réessayez."', 'échec corbeille affiché');
  assert.doesNotMatch(await evaluate('document.querySelector("[role=dialog]").textContent'), /Confirmation fictive refusée/);
  await backToLeo(); await completed();
  assert.ok(await evaluate(`!!document.querySelector('.leo-panel a[href="/dashboard?document=${id(21)}"]')`));
  await details(); await api('hold', 'trash'); await clickText('Placer dans la corbeille', '[role="dialog"]');
  await waitUntil(async () => (await api('mutations')).length === 4, 'seconde corbeille en attente');
  assert.equal((await api('document', id(21))).deleted_at, null);
  assert.equal(await evaluate('!!document.querySelector(".leo-panel")'), false);
  await api('release', 'trash'); await completed(9);
  assert.notEqual((await api('document', id(21))).deleted_at, null);
  assert.equal(await evaluate(`!!document.querySelector('.leo-panel a[href="/dashboard?document=${id(21)}"]')`), false);
  assert.equal((await api('calls')).length, 3);
});

test('lecteur PDF réel, décodage fictif : rendu proche, libération et confirmation propriétaire', async () => {
  await fresh(320);
  await api('patchDocument', id(21), { thumbnail_path: null, page_count: null });
  await api('hold', 'preview-complete');
  await open(); await submit(); await completed(); await details(); await renderedPdf();
  await waitUntil(async () => (await api('completions')).length === 1, 'complétion propriétaire en attente');
  assert.equal((await api('sources')).length, 1);
  assert.equal((await api('completions'))[0].sameSource, true, 'Le lecteur et la génération partagent le Blob original.');
  assert.equal((await api('document', id(21))).thumbnail_path, null, 'Aucune miniature optimiste.');
  assert.equal((await api('document', id(21))).page_count, null);
  const initial = await evaluate(`(() => {
    const region = document.querySelector(${JSON.stringify(pdfRegion)});
    const canvases = [...region.querySelectorAll('canvas')];
    window.__firstPdfCanvas = region.querySelector('[data-pdf-page="1"] canvas');
    return { pages: region.querySelectorAll('[data-pdf-page]').length, canvases: canvases.length,
      pixels: canvases.map(canvas => canvas.width * canvas.height), width: document.documentElement.scrollWidth,
      frames: document.querySelectorAll('iframe, object, embed').length };
  })()`);
  assert.equal(initial.pages, 8);
  assert.ok(initial.canvases >= 1 && initial.canvases <= 3);
  assert.ok(initial.pixels.every(pixels => pixels > 0 && pixels <= 2_000_000));
  assert.ok(initial.width <= 320);
  assert.equal(initial.frames, 0);
  await lastPdfPage();
  await waitFor('window.__firstPdfCanvas.width === 0 && window.__firstPdfCanvas.height === 0', 'pixels du canvas détaché libérés');
  assert.ok(await evaluate(`document.querySelector(${JSON.stringify(pdfRegion)}).querySelectorAll('canvas').length <= 3`));
  assert.match(await evaluate('document.querySelector("[role=dialog]").textContent'), /Page [78] \/ 8/);
  const stats = await api('pdf');
  assert.ok(stats.maxActive >= 1 && stats.maxActive <= 2);
  assert.ok(new Set(stats.rendered).size < 8, 'Le lecteur ne doit pas rendre les huit pages à l’ouverture.');
  await api('release', 'preview-complete');
  await waitUntil(async () => (await api('document', id(21))).page_count === 8, 'colonnes confirmées par la frontière fictive');
  await api('settle'); await backToLeo(); await completed();
  await waitFor('document.querySelector(".leo-results").textContent.includes("8 pages")', 'compte propagé dans les cartes Léo');
  assert.equal(await evaluate('document.querySelectorAll(".leo-panel h4 + ul li").length'), 3, 'La confirmation d’aperçu conserve les explications.');
  assert.ok((await api('thumbnails')).some(paths => paths.some(value => value.endsWith('.jpg'))));
  await waitUntil(async () => { const value = await api('pdf'); return value.disposed === value.opened && value.active === 0; }, 'document PDF et rendus libérés');
  assert.equal((await api('calls')).length, 3, 'Aucun nouveau pipeline Léo pour confirmer l’aperçu.');
});

test('lecteur PDF : repli géométrique sans IntersectionObserver', async () => {
  await fresh();
  await evaluate('window.IntersectionObserver = undefined; void 0;');
  await open(); await submit(); await completed(); await details(); await renderedPdf();
  await lastPdfPage();
  assert.ok(await evaluate(`document.querySelector(${JSON.stringify(pdfRegion)}).querySelectorAll('canvas').length <= 3`));
  await backToLeo();
  await waitUntil(async () => { const stats = await api('pdf'); return stats.disposed === stats.opened; }, 'nettoyage du repli sans observer');
});

for (const failure of ['Source', 'Decoder']) test(`lecteur : erreur ${failure} maîtrisée et réessai sans fuite technique`, async () => {
  await fresh(); await api(`fail${failure}`, true);
  await open(); await submit(); await completed(); await details();
  await waitFor(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent === ${JSON.stringify(previewMessage)}`, 'erreur d’aperçu publique');
  assert.doesNotMatch(await evaluate('document.querySelector("[role=dialog]").textContent'), /SECRET|STORAGE|DECODER|pdfjs|supabase/i);
  assert.equal((await api('sources')).length, 1);
  await api(`fail${failure}`, false);
  await clickText('Réessayer', '[role="dialog"]'); await renderedPdf();
  assert.equal((await api('sources')).length, failure === 'Source' ? 2 : 1, 'Un réessai de décodage conserve le Blob téléchargé.');
  assert.equal(await evaluate('!!document.querySelector("[role=dialog] [role=alert]")'), false);
  await backToLeo();
});

test('complétion propriétaire en échec : le lecteur reste disponible et aucune miniature n’est inventée', async () => {
  await fresh();
  await api('patchDocument', id(21), { thumbnail_path: null, page_count: null });
  await api('failCompletion', true);
  await open(); await submit(); await completed(); await details(); await renderedPdf();
  await waitUntil(async () => (await api('completions')).length === 1, 'essai facultatif effectué');
  await api('settle');
  const text = await evaluate('document.querySelector("[role=dialog]").textContent');
  assert.match(text, /Page \d+ \/ 8/);
  assert.doesNotMatch(text, /RPC_SECRET|Impossible d’afficher/);
  assert.equal((await api('document', id(21))).thumbnail_path, null);
  assert.equal((await api('document', id(21))).page_count, null);
  assert.equal((await api('sources')).length, 1);
  await backToLeo(); await completed();
  assert.equal(await evaluate('document.querySelectorAll(".leo-results img").length'), 0);
  assert.equal((await api('calls')).length, 3);
});

for (const pending of ['preview-source', 'preview-complete']) test(`fermeture du détail pendant ${pending} : réponse tardive ignorée`, async () => {
  await fresh();
  await api('patchDocument', id(21), { thumbnail_path: null, page_count: null });
  await api('hold', pending);
  await open(); await submit(); await completed(); await details();
  const collection = pending === 'preview-source' ? 'sources' : 'completions';
  await waitUntil(async () => (await api(collection)).length === 1, 'frontière d’aperçu suspendue');
  if (pending === 'preview-complete') await renderedPdf();
  await backToLeo(); await completed();
  assert.equal((await api(collection))[0].aborted, true);
  await api('release', pending); await api('settle');
  assert.equal((await api('document', id(21))).thumbnail_path, null);
  assert.equal((await api('document', id(21))).page_count, null);
  assert.equal(await evaluate('document.querySelectorAll(".leo-results img").length'), 0);
  assert.equal(await evaluate(`document.querySelectorAll('[data-pdf-page], section[aria-label="Aperçu du fichier"]').length`), 0);
  assert.equal(await evaluate('[...document.querySelectorAll("[role=dialog]")].every(dialog => dialog.classList.contains("leo-panel"))'), true);
  assert.equal((await api('completions')).length, pending === 'preview-source' ? 0 : 1);
  const stats = await api('pdf');
  assert.equal(stats.opened, stats.disposed); assert.equal(stats.active, 0);
  assert.equal((await api('calls')).length, 3);
});

test('chargement différé du lecteur : rejet capturé, réessai avec le même Blob et démontage en attente', async () => {
  await fresh(); await api('navigate', '/preview-loader');
  await waitFor(`document.querySelector('[role="alert"]')?.textContent === ${JSON.stringify(previewMessage)}`, 'erreur du loader injecté');
  assert.doesNotMatch(await evaluate('document.body.textContent'), /CHUNK_SECRET/);
  const rejectedCalls = (await api('loader')).calls;
  assert.ok(rejectedCalls > 0);
  await api('loaderMode', 'resolve'); await clickText('Réessayer', 'body');
  await waitFor('document.querySelector("[data-fixture-reader]")?.dataset.sameSource === "true"', 'réessai du même composant et du même Blob');
  assert.equal((await api('loader')).calls, rejectedCalls + 1);
  assert.equal((await api('sources')).length, 0, 'Le loader ne doit pas déclencher de téléchargement.');
  await api('navigate', '/'); await api('loaderMode', 'hold'); await api('navigate', '/preview-loader');
  await waitUntil(async () => (await api('loader')).calls === rejectedCalls + 2, 'import différé suspendu');
  assert.match(await evaluate('document.body.textContent'), /Ouverture du PDF/);
  await api('navigate', '/'); await api('releaseLoader'); await api('settle');
  assert.equal(await evaluate('!!document.querySelector("[data-fixture-reader]")'), false);
  assert.match(await evaluate('document.body.textContent'), /dashboard est démonté/);
});

test('image plein écran : pincement à deux doigts, clavier, focus imbriqué et nettoyage', async () => {
  await fresh(320);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await api('patchDocument', id(21), { file_type: 'image', file_name: 'fictif-21.svg', page_count: 1 });
  await evaluate(`(() => {
    window.__imageObjectUrls = { created: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = create(blob); window.__imageObjectUrls.created.push(url); return url; };
    URL.revokeObjectURL = (url) => { window.__imageObjectUrls.revoked.push(url); revoke(url); };
  })()`);
  await open(); await submit(); await completed(); await details();
  const imageButton = 'button[aria-label="Afficher l’image en plein écran"]';
  const stage = '[role="group"][aria-label="Image agrandie, zoom avec deux doigts ou les boutons"]';
  const fullscreenClose = 'button[aria-label="Fermer l’image en plein écran"]';
  const transform = () => evaluate(`(() => {
    const stage = document.querySelector(${JSON.stringify(stage)});
    const matrix = new DOMMatrixReadOnly(getComputedStyle(stage.querySelector('img')).transform);
    return { scale: matrix.a, x: matrix.e, y: matrix.f, width: stage.clientWidth, height: stage.clientHeight };
  })()`);
  await waitFor(`document.querySelector(${JSON.stringify(imageButton)})?.disabled === false`, 'image locale décodée');
  await evaluate(`window.__imageLauncher = document.querySelector(${JSON.stringify(imageButton)}); void 0;`);
  await click(imageButton);
  await waitFor(`document.activeElement === document.querySelector(${JSON.stringify(fullscreenClose)})`, 'focus initial du dialogue image');
  assert.equal(await evaluate('document.querySelectorAll("[role=dialog]").length'), 2);
  assert.equal(await evaluate('document.body.style.overflow'), 'hidden');
  assert.equal((await api('sources')).length, 1);
  assert.equal((await api('pdf')).opened, 0);
  assert.equal((await api('completions')).length, 0);
  assert.equal((await transform()).scale, 1);
  assert.equal(await evaluate('document.querySelector(\'button[aria-label="Dézoomer"]\').disabled'), true);
  await evaluate('document.querySelector(\'button[aria-label="Réinitialiser le zoom"]\').focus()');
  await key('Tab');
  assert.equal(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(fullscreenClose)})`), true);
  await key('Tab', 8);
  assert.equal(await evaluate('document.activeElement === document.querySelector(\'button[aria-label="Réinitialiser le zoom"]\')'), true);
  await evaluate('document.querySelector(\'[role="dialog"] button[aria-label="Fermer"]\').focus()');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(stage)}).closest('[role="dialog"]').contains(document.activeElement)`), true);
  await api('settle');
  const bounds = await evaluate(`(() => {
    const region = document.querySelector(${JSON.stringify(stage)}), dialog = region.closest('[role="dialog"]');
    const r = region.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2,
      targets: [...dialog.querySelectorAll('button')].map(button => { const b = button.getBoundingClientRect(); return [b.width, b.height]; }),
      animations: dialog.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length };
  })()`);
  assert.ok(bounds.targets.every(([width, height]) => width >= 44 && height >= 44));
  assert.equal(bounds.animations, 0);
  const touches = (spread) => [
    { id: 1, x: bounds.x - spread, y: bounds.y, radiusX: 2, radiusY: 2, force: 1 },
    { id: 2, x: bounds.x + spread, y: bounds.y, radiusX: 2, radiusY: 2, force: 1 },
  ];
  // Événements tactiles CDP transmis au navigateur, pas appel direct des handlers React.
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(30) });
  for (const spread of [40, 50, 60]) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(spread) });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitUntil(async () => (await transform()).scale >= 1.8, 'zoom par pincement réel dans le navigateur');
  const pinched = await transform();
  assert.ok(pinched.scale <= 4);
  const panPoint = { id: 1, x: bounds.x, y: bounds.y, radiusX: 2, radiusY: 2, force: 1 };
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [panPoint] });
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...panPoint, x: bounds.x + 35, y: bounds.y + 20 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitUntil(async () => Math.abs((await transform()).x - pinched.x) > 10, 'déplacement de l’image zoomée');
  const panned = await transform();
  assert.ok(Math.abs(panned.x) <= panned.width * (panned.scale - 1) / 2);
  assert.ok(Math.abs(panned.y) <= panned.height * (panned.scale - 1) / 2);
  await click('button[aria-label="Réinitialiser le zoom"]');
  await waitUntil(async () => (await transform()).scale === 1, 'zoom réinitialisé');
  await evaluate(`document.querySelector(${JSON.stringify(stage)}).focus()`);
  await key('+');
  await waitUntil(async () => (await transform()).scale === 1.25, 'zoom au clavier');
  await key('ArrowRight');
  assert.ok((await transform()).x < 0);
  await key('0');
  await waitUntil(async () => { const value = await transform(); return value.scale === 1 && value.x === 0 && value.y === 0; }, 'remise à zéro au clavier');
  await api('viewport', 340, 18);
  await waitFor(`Math.abs(document.querySelector(${JSON.stringify(stage)}).closest('[role="dialog"]').getBoundingClientRect().height - 340) < 1`, 'plein écran dans le viewport visuel');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= 320'));
  await key('Escape');
  await waitFor(`!document.querySelector(${JSON.stringify(stage)})`, 'Échap ferme seulement le dialogue image');
  assert.equal(await evaluate('document.querySelectorAll("[role=dialog]").length'), 1);
  assert.equal(await evaluate('document.activeElement === window.__imageLauncher'), true);
  assert.equal(await evaluate('document.body.style.overflow'), 'hidden');
  assert.equal(await evaluate('window.__imageObjectUrls.revoked.length'), 0, 'L’image reste disponible dans le détail.');
  await api('viewport', 800, 0);
  await backToLeo(); await completed();
  await waitFor('window.__imageObjectUrls.created.length > 0 && window.__imageObjectUrls.created.every(url => window.__imageObjectUrls.revoked.includes(url))', 'URL objet révoquée après fermeture du détail');
  assert.equal((await api('sources')).length, 1);
  assert.equal((await api('calls')).length, 3);
});

test('autres formats : type et téléchargement, sans lecture de l’original ni conversion', async () => {
  await fresh();
  await api('patchDocument', id(21), { file_type: 'doc', file_name: 'fictif-21.docx', thumbnail_path: null, page_count: null });
  await open(); await submit(); await completed(); await details(); await api('settle');
  assert.equal((await api('sources')).length, 0);
  assert.equal((await api('completions')).length, 0);
  assert.equal((await api('pdf')).opened, 0);
  assert.equal(await evaluate('document.querySelectorAll("[role=dialog] canvas, iframe, object, embed").length'), 0);
  await clickText('Télécharger', '[role="dialog"]');
  await waitFor('document.querySelector("[role=dialog] a[download]")?.download === "fictif-21.docx"', 'lien de téléchargement du format non prévisualisable');
  await backToLeo();
});
