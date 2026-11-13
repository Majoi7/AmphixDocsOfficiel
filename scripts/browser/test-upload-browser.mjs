import assert from 'node:assert/strict';
import { before, after, afterEach, test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, access, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { build, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Recette locale : ni installation, ni .env, ni base distante, ni serveur de
// l'application. Le navigateur et son IndexedDB sont réels ; Auth et transport
// sont explicitement fictifs. Le profil temporaire est conservé, jamais effacé.
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixturePath = normalizePath(path.join(root, 'scripts/browser/upload-mocks.tsx'));
const sourcePath = normalizePath(path.join(root, 'src/lib/supabase.ts'));
const modalPath = normalizePath(path.join(root, 'src/components/UploadModal.tsx'));
const configPath = normalizePath(path.join(root, 'src/lib/supabase-config'));
const authPath = normalizePath(path.join(root, 'src/context/AuthContext'));
const facadeId = '\0amphixdocs-upload-test-transport';
const blockedRequests = [];
const remoteResponses = [];
const protocolErrors = [];
const runtimeErrors = [];
const choosers = [];
const testProject = 'https://upload-browser.invalid';
const userId = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
let server;
let origin;
let browser;
let cdp;
let session;
let profile;
let intentionalNetworkProbe = false;
let previousRuntimeErrors = 0;

function isolatedImports() {
  let replacedTransport = false;
  return {
    name: 'upload-browser-isolation',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return;
      const parent = normalizePath(importer.split('?')[0]);
      const resolved = normalizePath(path.resolve(path.dirname(parent), source)).replace(/\.(?:tsx?|jsx?)$/, '');
      if (resolved === configPath || resolved === authPath) return fixturePath;
      if (parent === modalPath && resolved === sourcePath.replace(/\.ts$/, '')) {
        replacedTransport = true;
        return facadeId;
      }
    },
    load(id) {
      if (id !== facadeId) return;
      return `export { MAX_DOCUMENT_SIZE, STATUS_CONFIG, formatFileSize, hashUploadFile, prepareUploadDocument, validateClassification } from ${JSON.stringify(sourcePath)};
export { fixtureUpload as resumeUserDocument, fixtureCompletePreview as completeDocumentPreview } from ${JSON.stringify(fixturePath)};`;
    },
    generateBundle() {
      assert.ok(replacedTransport, 'Le vrai formulaire doit utiliser le transport fictif de ce build seulement.');
      const modules = [...this.getModuleIds()].map((id) => normalizePath(id.split('?')[0]));
      assert.ok(modules.includes(modalPath), 'Le vrai UploadModal doit être compilé.');
      assert.ok(modules.includes(sourcePath), 'La préparation et le hash de production doivent rester réels.');
      assert.ok(!modules.includes(`${configPath}.ts`), 'La configuration réelle ne doit jamais entrer dans le banc.');
      assert.ok(!modules.includes(`${authPath}.tsx`), 'Aucune session réelle ne doit entrer dans le banc.');
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
        for (const listener of this.listeners) {
          Promise.resolve().then(() => listener(message)).catch((error) => { protocolErrors.push(error.message); });
        }
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
      const timer = setTimeout(() => reject(new Error('Edge ne répond pas sur son canal local.')), 15000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Le canal DevTools local est inaccessible.')); }, { once: true });
    });
    return new DevTools(socket);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Délai dépassé : ${method}.`));
      }, 20000);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}
const send = (method, params = {}) => cdp.send(method, params, session);
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}
const api = (method, ...args) => evaluate(`window.__uploadHarness[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
async function waitUntil(predicate, description, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(25);
  }
  throw new Error(`Attente dépassée : ${description}.`);
}
const waitFor = (expression, description, timeout) => waitUntil(() => evaluate(expression), description, timeout);
function eventOnce(method) {
  return new Promise((resolve, reject) => {
    const listener = (event) => {
      if (event.sessionId !== session || event.method !== method) return;
      clearTimeout(timer);
      cdp.listeners.delete(listener);
      resolve(event.params);
    };
    const timer = setTimeout(() => {
      cdp.listeners.delete(listener);
      reject(new Error(`Événement navigateur absent : ${method}.`));
    }, 15000);
    cdp.listeners.add(listener);
  });
}
async function viewport(width = 360, height = 740, screenHeight = height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, screenWidth: width, screenHeight, deviceScaleFactor: 1, mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
}
async function fresh(number, width = 360) {
  await viewport(width);
  const loaded = eventOnce('Page.loadEventFired');
  await send('Page.navigate', { url: `${origin}/?account=${userId(number)}` });
  await loaded;
  await waitFor('!!window.__uploadHarness?.ready()', 'montage du vrai formulaire');
  assert.equal(await evaluate('location.origin'), origin);
}
async function reload() {
  const loaded = eventOnce('Page.loadEventFired');
  await send('Page.reload', { ignoreCache: true });
  await loaded;
  await waitFor('!!window.__uploadHarness?.ready()', 'remontage après rechargement');
}
async function click(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.matches(':disabled')) throw new Error('Action réelle indisponible : ' + ${JSON.stringify(selector)});
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error('Action masquée : ' + ${JSON.stringify(selector)});
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
async function activateChooser(kind = 'files') {
  const before = choosers.length;
  await click(`label[for$="-${kind}"]`);
  await waitUntil(async () => choosers.length > before
    || await evaluate('document.body.textContent.includes("Touchez de nouveau")'), 'sauvegarde avant le sélecteur natif');
  if (choosers.length === before) await click(`label[for$="-${kind}"]`);
  await waitUntil(() => choosers.length === before + 1, 'activation native après commit IndexedDB');
}
async function fill(selector, text) {
  await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.matches(':disabled')) throw new Error('Champ verrouillé : ' + ${JSON.stringify(selector)});
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    element.focus(); element.select();
  })()`);
  await send('Input.insertText', { text });
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), text);
}
async function key(key, code = key, modifiers = 0) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
}
async function saved(expected = {}) {
  await waitFor(`(async () => {
    if (!document.body.textContent.includes('Brouillon conservé sur cet appareil.')) return false;
    const draft = await window.__uploadHarness.readDraft();
    return !!draft && Object.entries(${JSON.stringify(expected)}).every(([key, value]) => JSON.stringify(draft[key]) === JSON.stringify(value));
  })()`, 'commit IndexedDB et statut de sauvegarde');
}
async function open() {
  await click('#open-upload-test');
  await waitFor('!!document.querySelector(\'[role="dialog"]\')', 'ouverture du dépôt');
  await saved();
}
async function form(number, name = 'cours.pdf', width = 360) {
  await fresh(number, width);
  await open();
  await api('chooseFiles', [{ name, text: '%PDF-octets-identiques', type: '' }]);
  await waitFor('!!document.querySelector("#upload-file-title-0")', 'sélection native copiée');
  await saved({ titles: [name.replace(/\.[^.]+$/, '')] });
  await fill('#upload-school', 'EPAC');
  await saved({ schoolName: 'EPAC' });
  await fill('#upload-subject', 'Mathématiques');
  await saved({ subjectName: 'Mathématiques' });
  await click('details summary');
}
const submit = () => click('button[type="submit"]');
async function finished() {
  await waitFor('document.body.textContent.includes("Votre dépôt est confirmé.") && !document.querySelector(\'[role="dialog"]\')?.getAttribute("aria-busy").includes("true")', 'confirmation du transport fictif');
}
async function screenshotFailure(name) {
  if (!cdp || !session || !profile) return;
  try {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    const destination = path.join(profile, `echec-${name.replace(/[^a-z0-9-]/gi, '-').slice(0, 70)}.png`);
    await writeFile(destination, Buffer.from(result.data, 'base64'));
    console.info(`Capture locale : ${destination}`);
  } catch { /* La capture ne doit pas masquer le premier échec. */ }
}

before(async () => {
  const result = await build({
    root, configFile: false, envDir: false, publicDir: false, mode: 'upload-browser-test', logLevel: 'error',
    plugins: [isolatedImports(), react(), tailwindcss()],
    build: {
      write: false, emptyOutDir: false, minify: false, sourcemap: false,
      rolldownOptions: { input: path.join(root, 'scripts/browser/upload-harness.html') },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((output) => output.output || []);
  const files = new Map(outputs.map((output) => [output.fileName, output.type === 'chunk' ? output.code : output.source]));
  const html = [...files.keys()].find((file) => file.endsWith('upload-harness.html'));
  assert.ok(html, 'Le build isolé doit fournir son entrée HTML.');
  const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const key = pathname === '/' ? html : pathname.slice(1);
    response.setHeader('Content-Security-Policy', csp);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!files.has(key)) { response.writeHead(404); response.end('Ressource absente du banc local.'); return; }
    response.setHeader('Content-Type', types[path.extname(key)] || 'application/octet-stream');
    response.end(files.get(key));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  const edge = process.env.AMPHIXDOCS_TEST_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  await access(edge);
  profile = await mkdtemp(path.join(tmpdir(), 'amphixdocs-upload-browser-'));
  browser = spawn(edge, [
    '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
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
      if (url.startsWith(`${origin}/`)) {
        await send('Fetch.continueRequest', { requestId: event.params.requestId });
      } else {
        blockedRequests.push({ url, intentional: intentionalNetworkProbe });
        await send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'BlockedByClient' });
      }
    }
    if (event.method === 'Network.responseReceived' && /^https?:/.test(event.params.response.url)
      && !event.params.response.url.startsWith(`${origin}/`)) remoteResponses.push(event.params.response.url);
    if (event.method === 'Runtime.exceptionThrown') runtimeErrors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    if (event.method === 'Page.fileChooserOpened') choosers.push(event.params);
  });
  // Interception active AVANT la première navigation vers le banc.
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Network.enable');
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  console.info('Banc local : React, CSS, IndexedDB et codecs du navigateur réels ; compte et transport fictifs.');
  console.info(`Profil isolé conservé : ${profile}`);
}, { timeout: 120000 });

afterEach(async (context) => {
  if (context.error) await screenshotFailure(context.name);
  assert.deepEqual(protocolErrors, [], 'Aucune erreur du blocage DevTools ne doit être ignorée.');
  assert.deepEqual(remoteResponses, [], 'Aucune réponse distante ne doit être reçue.');
  assert.deepEqual(blockedRequests.filter((request) => !request.intentional), [], 'Le formulaire ne doit tenter aucun accès externe.');
  assert.deepEqual(runtimeErrors.slice(previousRuntimeErrors), [], 'Aucune exception React/navigateur ne doit être ignorée.');
  previousRuntimeErrors = runtimeErrors.length;
  if (cdp && session && await evaluate('!!window.__uploadHarness')) {
    assert.equal(await api('networkAttempts'), 0, 'Aucun appel réel du SDK Supabase ne doit être tenté.');
  }
});

after(async () => {
  if (cdp) {
    try { await cdp.send('Browser.close'); } catch { /* Edge peut fermer le canal avant la réponse. */ }
    cdp.socket.close();
  }
  if (browser && browser.exitCode === null) browser.kill();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('DevTools bloque une navigation fictive et la CSP interdit les appels externes', async () => {
  // Une navigation principale n'est pas un appel connect-src : elle permet de
  // vérifier l'interception avant réseau sans désactiver la CSP du formulaire.
  intentionalNetworkProbe = true;
  try {
    const blockedBefore = blockedRequests.length;
    const navigation = await send('Page.navigate', { url: `${testProject}/storage/v1/upload/resumable` });
    assert.match(navigation.errorText || '', /ERR_BLOCKED_BY_CLIENT/);
    assert.equal(blockedRequests.length, blockedBefore + 1);
    assert.equal(blockedRequests.at(-1).url, `${testProject}/storage/v1/upload/resumable`);
  } finally {
    intentionalNetworkProbe = false;
  }
  await fresh(1);
  const result = await evaluate(`fetch('${testProject}/rest/v1/documents').then(() => 'autorisé', () => 'refusé')`);
  assert.equal(result, 'refusé');
  await waitUntil(async () => (await api('violations')).some((violation) => violation.directive === 'connect-src'), 'preuve du blocage CSP');
});

test('sélecteurs natifs, cible tactile, focus confiné et restauration à 320 px', async () => {
  await fresh(2, 320);
  const originalOverflow = await evaluate('document.body.style.overflow');
  await open();
  assert.equal(await evaluate('document.body.style.overflow'), 'hidden');
  assert.equal(await evaluate('document.querySelector(\'[role="dialog"]\').contains(document.activeElement)'), true);
  const pickers = await evaluate(`Array.from(document.querySelectorAll('input[type="file"]')).map((input) => {
    const label = document.querySelector('label[for="' + input.id + '"]');
    const rect = label.getBoundingClientRect();
    const style = getComputedStyle(input);
    return { id: input.id, label: label.textContent.trim(), width: rect.width, height: rect.height, display: style.display,
      accept: input.accept, capture: input.getAttribute('capture'), touch: getComputedStyle(label).touchAction };
  })`);
  assert.equal(pickers.length, 3);
  assert.deepEqual(pickers.map((picker) => picker.label), ['Fichiers', 'Galerie', 'Prendre une photo']);
  for (const picker of pickers) {
    assert.ok(picker.width >= 44 && picker.height >= 44, `Cible tactile insuffisante : ${picker.id}`);
    assert.notEqual(picker.display, 'none');
    assert.match(picker.touch, /manipulation/);
    assert.ok(picker.accept.split(',').includes('.heic'));
    assert.ok(picker.accept.split(',').includes('.heif'));
  }
  assert.match(pickers.find((picker) => picker.id.endsWith('-files')).accept, /\.pdf/);
  assert.equal(pickers.find((picker) => picker.id.endsWith('-camera')).capture, 'environment');
  await activateChooser();
  assert.equal((await api('readDraft')).picker.kind, 'files');
  await evaluate('document.querySelector(\'input[type="file"][id$="-files"]\').dispatchEvent(new Event("cancel"))');
  await saved({ picker: null });
  await evaluate('document.querySelector(\'[aria-label="Fermer le dépôt"]\').focus()');
  await key('Tab', 'Tab', 8);
  assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Fermer');
  await key('Tab');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Fermer le dépôt');
  await evaluate('document.querySelector("#open-upload-test").focus()');
  assert.equal(await evaluate('document.querySelector(\'[role="dialog"]\').contains(document.activeElement)'), true);
  await key('Escape');
  await waitFor('!document.querySelector(\'[role="dialog"]\')', 'fermeture Échap sûre');
  assert.equal(await evaluate('document.activeElement.id'), 'open-upload-test');
  assert.equal(await evaluate('document.body.style.overflow'), originalOverflow);
});

test('FileList copiée, MIME PDF déduit et saisies/octets restaurés après rechargement', async () => {
  await form(3);
  await fill('#upload-file-title-0', 'Cours d’algèbre');
  await saved({ titles: ['Cours d’algèbre'] });
  await fill('#upload-description', 'Chapitre 2 · équations');
  await saved({ description: 'Chapitre 2 · équations' });
  const draft = await api('readDraft');
  assert.equal(draft.files[0].type, 'application/pdf');
  assert.equal(draft.files[0].text, '%PDF-octets-identiques');
  assert.equal(await evaluate('document.querySelector(\'input[type="file"][id$="-files"]\').value'), '');
  await api('chooseFiles', [{ name: 'trop-grand.pdf', size: 20 * 1024 * 1024 + 1 }]);
  await waitFor('document.body.textContent.includes("la sélection précédente est conservée")', 'limite de 20 Mo');
  assert.deepEqual((await api('readDraft')).files, draft.files);
  await reload();
  await open();
  assert.equal(await evaluate('document.querySelector("#upload-file-title-0").value'), 'Cours d’algèbre');
  assert.equal(await evaluate('document.querySelector("#upload-school").value'), 'EPAC');
  assert.equal(await evaluate('document.querySelector("#upload-subject").value'), 'Mathématiques');
  assert.deepEqual((await api('readDraft')).files, draft.files);
  assert.equal(await evaluate('document.querySelector(\'button[type="submit"]\').textContent.trim()'), 'Reprendre l’envoi');
  assert.equal((await api('calls')).length, 0);
});

test('sélecteur interrompu : marqueur conservé avant ouverture et message après rechargement', async () => {
  await form(17);
  const previous = (await api('readDraft')).files;
  await activateChooser('gallery');
  assert.equal((await api('readDraft')).picker.kind, 'gallery');
  await reload();
  await open();
  assert.equal(await evaluate('document.body.textContent.includes("La page s\\\'est rechargée pendant le choix du fichier")'), true);
  assert.deepEqual((await api('readDraft')).files, previous);
  await api('chooseFiles', [{ name: 'nouveau.txt', text: 'nouveaux octets', type: 'text/plain' }]);
  await saved({ picker: null, titles: ['nouveau'], filesPrepared: [false] });
  assert.equal(await evaluate('document.body.textContent.includes("La page s\\\'est rechargée pendant le choix du fichier")'), false);
  assert.equal((await api('calls')).length, 0);
});

test('quota avant sélecteur : aucune ouverture native avant le réessai confirmé', async () => {
  await form(18);
  const before = choosers.length;
  await api('failNextPut');
  await click('label[for$="-files"]');
  await waitFor('!!document.querySelector(\'[role="alert"] button\')', 'quota du marqueur de sélection');
  assert.equal(choosers.length, before);
  await click('[role="alert"] button');
  await saved();
  await activateChooser();
  assert.equal(choosers.length, before + 1);
  await evaluate('document.querySelector(\'input[type="file"][id$="-files"]\').dispatchEvent(new Event("cancel"))');
  await saved({ picker: null });
});

test('octets et aperçu : aucun traitement avant commit, miniature réelle ensuite non bloquante', async () => {
  await fresh(19);
  await open();
  const png = await evaluate(`(() => {
    const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 16;
    const context = canvas.getContext('2d'); context.fillStyle = '#ff6a2b'; context.fillRect(0, 0, 24, 16);
    return canvas.toDataURL('image/png').split(',')[1];
  })()`);
  const before = (await api('diagnostics')).length;
  await api('holdNextOpen');
  await api('chooseFiles', [{ name: 'photo.png', base64: png, type: 'image/png' }]);
  await waitFor('window.__uploadHarness.hasHeldOpen()', 'conservation des octets retenue');
  assert.equal(await evaluate('!!document.querySelector(\'img[alt="Aperçu de photo.png"]\')'), false);
  assert.ok(!(await api('diagnostics')).slice(before).some((entry) => entry.event === 'preview-started'));
  assert.equal(await evaluate('document.querySelector(\'button[type="submit"]\').disabled'), true);
  await api('releaseOpen');
  await saved({ titles: ['photo'], filesPrepared: [false] });
  await waitFor('!!document.querySelector(\'img[alt="Aperçu de photo.png"]\')?.naturalWidth', 'miniature JPEG issue du vrai codec');
  const events = (await api('diagnostics')).slice(before).map((entry) => entry.event);
  assert.ok(events.indexOf('file-saved') > events.indexOf('file-received'));
  assert.ok(events.indexOf('preview-started') > events.indexOf('file-saved'));
  assert.ok(events.indexOf('preview-finished') > events.indexOf('preview-started'));
  await fill('#upload-school', 'IFRI'); await saved({ schoolName: 'IFRI' });
  await fill('#upload-subject', 'Image'); await saved({ subjectName: 'Image' });
  await submit(); await finished();
  assert.equal((await api('calls')).length, 1);
});

test('quota des octets : sélection récupérable en mémoire par Réessayer, sans resélection', async () => {
  await form(20);
  const previous = (await api('readDraft')).files;
  await api('failNextPut');
  await api('chooseFiles', [{ name: 'nouveau.txt', text: 'nouveaux octets', type: 'text/plain' }]);
  await waitFor('!!document.querySelector(\'[role="alert"] button\')', 'quota des octets');
  assert.deepEqual((await api('readDraft')).files, previous);
  assert.equal(await evaluate('document.querySelector("#upload-school").matches(":disabled")'), true);
  assert.equal(await evaluate('document.querySelector(\'button[type="submit"]\').disabled'), true);
  await click('[role="alert"] button');
  await saved({ titles: ['nouveau'], filesPrepared: [false] });
  assert.equal((await api('readDraft')).files[0].text, 'nouveaux octets');
  assert.equal(await evaluate('document.querySelector("#upload-file-title-0").value'), 'nouveau');
  assert.equal((await api('calls')).length, 0);
});

test('image lourde illisible : octets conservés avant tout codec et après rechargement', async () => {
  await fresh(21);
  await open();
  await api('chooseFiles', [{ name: 'image-illisible.png', size: 2 * 1024 * 1024, type: 'image/png' }]);
  await saved({ titles: ['image-illisible'], filesPrepared: [false] });
  await waitFor('window.__uploadHarness.diagnostics().some((entry) => entry.event === "preview-failed")', 'aperçu illisible non bloquant');
  assert.equal(await evaluate('document.querySelector(\'button[type="submit"]\').disabled'), false);
  assert.equal(await evaluate('(async () => (await window.__uploadHarness.readDraft()).files[0].size)()'), 2 * 1024 * 1024);
  await reload(); await open();
  await saved({ titles: ['image-illisible'], filesPrepared: [false] });
  assert.equal(await evaluate('(async () => (await window.__uploadHarness.readDraft()).files[0].size)()'), 2 * 1024 * 1024);
  assert.equal((await api('calls')).length, 0);
});

test('révision compatible : un seul retry, champs verrouillés, saisies locales conservées', async () => {
  await form(4);
  await api('rewriteDraft');
  await fill('#upload-description', 'Mes dernières saisies');
  await waitFor('!!document.querySelector(\'[role="alert"] button\')', 'conflit de révision réel');
  await api('holdNextOpen');
  const before = await api('metrics');
  await evaluate(`(() => { const button = document.querySelector('[role="alert"] button'); button.click(); button.click(); })()`);
  await waitFor('window.__uploadHarness.hasHeldOpen()', 'relecture native retenue');
  assert.equal(await evaluate('document.querySelector("#upload-school").matches(":disabled")'), true);
  assert.equal(await evaluate('document.querySelector("#upload-description").matches(":disabled")'), true);
  assert.equal(await evaluate('document.querySelector(\'input[type="file"]\').disabled'), true);
  await api('releaseOpen');
  await saved({ description: 'Mes dernières saisies', schoolName: 'EPAC', subjectName: 'Mathématiques' });
  const metrics = await api('metrics');
  assert.equal(metrics.puts - before.puts, 1, 'Le double clic ne doit pas créer deux sauvegardes.');
  assert.equal(await evaluate('document.querySelector("#upload-description").matches(":disabled")'), false);
  assert.equal(await evaluate('document.querySelector("#upload-description").value'), 'Mes dernières saisies');
  assert.equal((await api('calls')).length, 0);
});

test('révision incompatible : refus d’écraser un autre onglet, sans abandon des saisies', async () => {
  await form(5);
  await api('rewriteDraft', { schoolName: 'École d’un autre onglet' });
  await fill('#upload-description', 'Texte local non confirmé');
  await waitFor('!!document.querySelector(\'[role="alert"] button\')', 'conflit initial');
  await click('[role="alert"] button');
  await waitFor('!!document.querySelector(\'[role="alert"] button\') && !document.querySelector("#upload-description").matches(":disabled")', 'retry refusé et verrou libéré');
  assert.equal(await evaluate('document.querySelector("#upload-school").value'), 'EPAC');
  assert.equal(await evaluate('document.querySelector("#upload-description").value'), 'Texte local non confirmé');
  assert.equal((await api('readDraft')).schoolName, 'École d’un autre onglet');
  assert.equal((await api('readDraft')).description, '');
  assert.equal((await api('calls')).length, 0);
});

test('quota temporaire : erreur honnête puis vrai retry de sauvegarde', async () => {
  await form(6);
  await api('failNextPut');
  await fill('#upload-description', 'À conserver après le quota');
  await waitFor('!!document.querySelector(\'[role="alert"] button\')', 'erreur de quota injectée dans le vrai store');
  assert.equal(await evaluate('document.querySelector("#upload-description").value'), 'À conserver après le quota');
  assert.equal((await api('readDraft')).description, '');
  await click('[role="alert"] button');
  await saved({ description: 'À conserver après le quota' });
  assert.equal((await api('calls')).length, 0);
});

test('échec de transfert puis rechargement : mêmes identités/hash/octets, mode reprise', async () => {
  await form(7);
  await api('failNextTransfer');
  await submit();
  await waitFor('window.__uploadHarness.calls().length === 1 && !document.querySelector(\'[role="dialog"]\').getAttribute("aria-busy").includes("true")', 'échec fictif du transfert');
  await saved();
  const first = (await api('calls'))[0];
  assert.equal(first.mode, 'initial');
  const draft = await api('readDraft');
  assert.ok(draft.batch);
  assert.equal(draft.attachments[0].status, 'pending', 'Une confirmation ne doit jamais être reconstruite depuis IndexedDB.');
  assert.equal(draft.attachments[0].document, null);
  await reload();
  await open();
  assert.equal((await api('calls')).length, 0, 'Ouvrir une reprise ne doit pas démarrer son transfert.');
  await submit();
  await finished();
  const resumed = (await api('calls'))[0];
  assert.equal(resumed.mode, 'resume');
  assert.deepEqual(resumed.request, first.request);
  assert.equal(resumed.hasFile, true);
  await waitUntil(async () => await api('readDraft') === null, 'nettoyage après confirmation fictive seulement');
  assert.equal(await api('readJournal'), null);
});

test('confirmation mémoire et nettoyage en échec : réouverture sans retransfert', async () => {
  await form(8);
  await api('failNextDelete');
  await submit();
  await finished();
  await waitFor('document.body.textContent.includes("leur brouillon est encore conservé")', 'échec du nettoyage rendu sans faux échec de transfert');
  assert.ok((await api('readDraft')).batch);
  assert.equal((await api('calls')).length, 1);
  await click('button[aria-label="Fermer le dépôt"]');
  await waitFor('!document.querySelector(\'[role="dialog"]\')', 'fermeture après confirmation');
  await open();
  await saved();
  assert.equal((await api('calls')).length, 1);
  assert.equal(await api('readJournal'), null);
  const next = await api('readDraft');
  assert.equal(next.batch, null);
  assert.equal(next.files.length, 0);
});

test('actualisation échouée après confirmation : Réessayer n’envoie aucun nouvel octet', async () => {
  await form(9);
  await api('rejectReports', true);
  await submit();
  await finished();
  await waitFor('document.body.textContent.includes("La liste n’a pas pu être actualisée")', 'erreur de notification, distincte du transfert');
  assert.equal((await api('calls')).length, 1);
  await submit();
  await waitFor('document.body.textContent.includes("La liste ou le brouillon n’a pas pu être actualisé")', 'retry de notification refusé');
  assert.equal((await api('calls')).length, 1);
  await api('rejectReports', false);
  await submit();
  await finished();
  await waitFor('!document.querySelector(\'button[type="submit"]\')', 'notification et nettoyage terminés');
  assert.equal((await api('calls')).length, 1);
  assert.equal(await api('readDraft'), null);
});

for (const [number, kind] of [[10, 'compte'], [11, 'projet']]) {
  test(`sauvegarde en vol : changement de ${kind} invalide l’ancien scope avant put`, async () => {
    await form(number);
    const oldScope = { userId: userId(number), projectUrl: testProject };
    await api('holdNextOpen');
    await fill('#upload-description', 'Écriture devenue obsolète');
    await waitFor('window.__uploadHarness.hasHeldOpen()', 'ouverture native en vol');
    if (kind === 'compte') await api('setUser', userId(number + 100));
    else await api('setProject', 'https://other-upload-browser.invalid');
    await saved({ description: '', schoolName: '', subjectName: '', titles: [] });
    await api('releaseOpen');
    await waitUntil(async () => (await api('readDraft', oldScope)).description === '', 'ancien brouillon non écrasé');
    assert.equal(await evaluate('document.querySelector("#upload-school").value'), '');
    assert.equal((await api('calls')).length, 0);
  });
}

test('transfert en vol : Échap/navigation bloquées et aucun succès après changement de compte', async () => {
  await form(12);
  await api('holdTransfer');
  await submit();
  await waitFor('window.__uploadHarness.calls().length === 1', 'transport fictif retenu');
  const request = (await api('calls'))[0].request;
  await key('Escape');
  assert.equal(await evaluate('!!document.querySelector(\'[role="dialog"]\')'), true);
  await api('navigateAway');
  assert.equal(await evaluate('!!document.querySelector("#away-test")'), false);
  await api('setUser', userId(112));
  await api('releaseTransfer');
  await waitFor('document.body.textContent.includes("Reconnectez-vous au compte utilisé pour ce dépôt")', 'scope différent refusé');
  assert.ok(!(await api('reports')).some((report) => report.complete));
  assert.equal((await api('calls')).length, 1);
  await api('setUser', userId(12));
  await saved();
  await submit();
  await finished();
  const calls = await api('calls');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].request, request);
  assert.equal(calls[1].mode, 'resume');
});

test('fermeture/réouverture pendant autosave : même FIFO, focus et dernière saisie préservés', async () => {
  await form(13);
  await api('holdNextOpen');
  await fill('#upload-description', 'À finir même après fermeture');
  await waitFor('window.__uploadHarness.hasHeldOpen()', 'autosave retenue');
  await click('button[aria-label="Fermer le dépôt"]');
  await waitFor('!document.querySelector(\'[role="dialog"]\')', 'fermeture hors transfert');
  await click('#open-upload-test');
  await waitFor('!!document.querySelector("#upload-description")', 'réouverture du même formulaire');
  assert.equal(await evaluate('document.querySelector("#upload-description").value'), 'À finir même après fermeture');
  await api('releaseOpen');
  await saved({ description: 'À finir même après fermeture' });
  assert.equal((await api('calls')).length, 0);
});

test('lecture retardée puis fermeture/réouverture : aucune réponse de l’ancienne instance', async () => {
  await fresh(14);
  await api('holdNextOpen');
  await click('#open-upload-test');
  await waitFor('window.__uploadHarness.hasHeldOpen()', 'lecture initiale retenue');
  await click('button[aria-label="Fermer le dépôt"]');
  await waitFor('!document.querySelector(\'[role="dialog"]\')', 'fermeture avant lecture');
  await open();
  await fill('#upload-school', 'IFRI');
  await saved({ schoolName: 'IFRI' });
  await api('releaseOpen');
  await saved({ schoolName: 'IFRI' });
  assert.equal(await evaluate('document.querySelector("#upload-school").value'), 'IFRI');
  assert.equal((await api('calls')).length, 0);
});

test('pastilles ENEAM/IFRI accessibles, choix conservé après rechargement et saisie libre', async () => {
  await form(16, 'cours.pdf', 320);
  const group = '[role="group"][aria-label="Écoles proposées"]';
  const chips = () => evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(`${group} button`)})).map((button) => {
    const rect = button.getBoundingClientRect();
    return { label: button.textContent.trim(), pressed: button.getAttribute('aria-pressed'),
      type: button.type, width: rect.width, height: rect.height };
  })`);
  const initial = await chips();
  assert.deepEqual(initial.map((chip) => chip.label), ['ENEAM', 'IFRI']);
  assert.deepEqual(initial.map((chip) => chip.pressed), ['false', 'false']);
  for (const chip of initial) {
    assert.equal(chip.type, 'button');
    assert.ok(chip.width >= 44 && chip.height >= 44, `Pastille trop petite : ${chip.label}`);
  }
  for (const [index, school] of ['ENEAM', 'IFRI'].entries()) {
    await click(`${group} button:nth-of-type(${index + 1})`);
    await saved({ schoolName: school, subjectName: 'Mathématiques' });
    assert.equal(await evaluate('document.querySelector("#upload-school").value'), school);
    assert.deepEqual((await chips()).map((chip) => chip.pressed), index === 0 ? ['true', 'false'] : ['false', 'true']);
    assert.equal((await api('calls')).length, 0, 'Choisir une école ne doit pas envoyer le formulaire.');
  }
  await reload();
  await open();
  assert.equal(await evaluate('document.querySelector("#upload-school").value'), 'IFRI');
  assert.deepEqual((await chips()).map((chip) => chip.pressed), ['false', 'true']);
  await fill('#upload-school', 'Autre école');
  await saved({ schoolName: 'Autre école' });
  assert.deepEqual((await chips()).map((chip) => chip.pressed), ['false', 'false']);
  assert.equal((await api('calls')).length, 0);
});

test('320–430 px et viewport réduit : aucun débordement, action visible, champs 16 px', async () => {
  await form(15, `${'document-très-long-'.repeat(10)}.pdf`, 320);
  for (const width of [320, 360, 390, 430]) {
    await viewport(width, 360, 740);
    await waitFor('Math.abs(parseFloat(document.querySelector(\'[role="dialog"]\').parentElement.style.getPropertyValue("--dialog-viewport-height")) - visualViewport.height) < 2', 'mise à jour visualViewport');
    const geometry = await evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const button = dialog.querySelector('button[type="submit"]');
      const rect = button.getBoundingClientRect();
      const containers = [dialog, dialog.querySelector('form'), dialog.querySelector('form > div'), dialog.querySelector('footer')];
      return { width: innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
        right: dialog.getBoundingClientRect().right, left: dialog.getBoundingClientRect().left,
        overflows: containers.map((element) => element.scrollWidth - element.clientWidth),
        actionTop: rect.top, actionBottom: rect.bottom, height: rect.height,
        viewportBottom: visualViewport.offsetTop + visualViewport.height,
        footerPadding: parseFloat(getComputedStyle(dialog.querySelector('footer')).paddingBottom),
        fontSize: getComputedStyle(document.querySelector('#upload-school')).fontSize,
        fontFamily: getComputedStyle(document.querySelector('#upload-school')).fontFamily,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
    })()`);
    assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `Débordement de page à ${width}px : ${JSON.stringify(geometry)}`);
    assert.ok(geometry.left >= -1 && geometry.right <= geometry.width + 1);
    assert.ok(geometry.overflows.every((overflow) => overflow <= 1), `Débordement interne à ${width}px : ${JSON.stringify(geometry)}`);
    assert.ok(geometry.actionTop >= 0 && geometry.actionBottom <= geometry.viewportBottom + 1, `Action masquée à ${width}px : ${JSON.stringify(geometry)}`);
    assert.ok(geometry.height >= 44 && geometry.footerPadding >= 16);
    assert.equal(geometry.fontSize, '16px');
    assert.match(geometry.fontFamily, /DM Sans/);
    assert.equal(geometry.reduced, true);
  }
});
