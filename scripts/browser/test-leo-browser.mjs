import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { spawn } from 'node:child_process';
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
// Le serveur ne sert que son build en mémoire et deux ressources fictives.
// CSP et CDP interdisent tout réseau externe AVANT le montage de l'application.
// Aucun profil navigateur existant n'est ouvert ; le profil créé est conservé.
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixturePath = normalizePath(path.join(root, 'scripts/browser/leo-mocks.tsx'));
const sourcePath = normalizePath(path.join(root, 'src/lib/supabase.ts'));
const configPath = normalizePath(path.join(root, 'src/lib/supabase-config'));
const authPath = normalizePath(path.join(root, 'src/context/AuthContext'));
const facadeId = '\0amphixdocs-leo-test-boundaries';
const project = 'https://leo-browser.invalid';
const id = (n) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const launcher = 'button[aria-label="Ouvrir Léo AI"]';
const input = '.leo-panel textarea';
const resultCards = '.leo-results button[aria-haspopup="dialog"]';
const steps = '.leo-panel [data-status]';
const blockedRequests = [], remoteResponses = [], protocolErrors = [], runtimeErrors = [];
let server, origin, browser, cdp, session, profile;
let intentionalNetworkProbe = false;
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
      if (resolved === sourcePath.replace(/\.ts$/, '')) { replacements++; return facadeId; }
    },
    load(moduleId) {
      if (moduleId !== facadeId) return;
      // Les exports explicites priment sur export *. Les helpers purs de
      // production restent réels, mais aucune lecture/mutation n'est distante.
      return `export * from ${JSON.stringify(sourcePath)};
export { fetchDashboardData, fetchDocumentTargets, getDocumentThumbnailUrls, getDocumentSignedUrl, updateDocumentMetadata, setDocumentTrash } from ${JSON.stringify(fixturePath)};
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
        'src/components/ui/ai-input-with-loading.tsx', 'src/components/ui/chain-of-thought.tsx',
        'src/components/UploadModal.tsx', 'src/lib/supabase.ts',
      ]) assert.ok(modules.has(normalizePath(path.join(root, relative))), `Le module réel manque : ${relative}`);
      assert.ok(!modules.has(`${configPath}.ts`), 'La configuration réelle ne doit jamais entrer dans le banc.');
      assert.ok(!modules.has(`${authPath}.tsx`), 'Aucune session réelle ne doit entrer dans le banc.');
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
const waitFor = (expression, description) => waitUntil(() => evaluate(expression), description);
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
  await evaluate(`window.__leoLauncher = ${element(launcher)}`);
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
      if (url.startsWith(`${origin}/`)) await send('Fetch.continueRequest', { requestId: event.params.requestId });
      else {
        blockedRequests.push({ url, intentional: intentionalNetworkProbe });
        await send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'BlockedByClient' });
      }
    }
    if (event.method === 'Network.responseReceived' && /^https?:/.test(event.params.response.url)
      && !event.params.response.url.startsWith(`${origin}/`)) remoteResponses.push(event.params.response.url);
    if (event.method === 'Runtime.exceptionThrown') runtimeErrors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Network.enable'); await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__leoCsp = []; document.addEventListener('securitypolicyviolation', (event) => window.__leoCsp.push(event.effectiveDirective));` });
  await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  console.info('Banc Léo : vrais React, navigation et transport ; Auth, HTTP, SQL et signatures fictifs. Aucun test RLS/OAuth distant.');
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
  intentionalNetworkProbe = true;
  try {
    const before = blockedRequests.length;
    const navigation = await send('Page.navigate', { url: `${project}/rest/v1/documents` });
    assert.match(navigation.errorText || '', /ERR_BLOCKED_BY_CLIENT/);
    assert.equal(blockedRequests.length, before + 1);
  } finally { intentionalNetworkProbe = false; }
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
  await clickText('Préparer le téléchargement', '[role="dialog"]');
  await waitFor('!!document.querySelector("[role=dialog] a[download]")', 'signature fictive préparée');
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
  await waitFor('document.querySelector("[role=dialog]").textContent.includes("Confirmation fictive refusée")', 'échec de confirmation affiché');
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
  await waitFor('document.querySelector("[role=dialog]").textContent.includes("Confirmation fictive refusée")', 'échec corbeille affiché');
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
