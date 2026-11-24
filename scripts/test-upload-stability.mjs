import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { createServer } from 'vite';

// Contrôleur Auth et helpers réels, sans SDK distant, .env ou écriture de build.
// Le banc navigateur existant complète ces tests pour le vrai DOM du sélecteur.
const root = fileURLToPath(new URL('../', import.meta.url));
const originalFetch = globalThis.fetch;
const userId = '11111111-1111-4111-8111-111111111111';
const secondUserId = '22222222-2222-4222-8222-222222222222';
let vite, auth, diagnostics, files, hash, draft, batch;
let networkAttempts = 0;
before(async () => {
  globalThis.fetch = async () => { networkAttempts++; throw new Error('Réseau interdit dans cette recette.'); };
  vite = await createServer({
    root, configFile: false, envDir: false, optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error',
  });
  auth = await vite.ssrLoadModule('/src/lib/auth-session.ts');
  diagnostics = await vite.ssrLoadModule('/src/lib/upload-diagnostics.ts');
  files = await vite.ssrLoadModule('/src/lib/upload-files.ts');
  hash = await vite.ssrLoadModule('/src/lib/upload-hash.ts');
  draft = await vite.ssrLoadModule('/src/lib/upload-draft.ts');
  batch = await vite.ssrLoadModule('/src/lib/upload-batch.ts');
});
after(async () => {
  try { await vite?.close(); assert.equal(networkAttempts, 0); }
  finally { globalThis.fetch = originalFetch; }
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const makeUser = (id = userId) => ({ id, aud: 'authenticated', created_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} });
const makeSession = (id = userId) => ({ user: makeUser(id), access_token: 'TEST_ONLY', refresh_token: 'TEST_ONLY', expires_in: 3600, token_type: 'bearer' });
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await pause(1);
  }
  assert.fail('Le contrôleur fictif ne s’est pas résolu.');
}
function fixture(t, overrides = {}) {
  let callback;
  const calls = { session: 0, user: 0, role: 0 };
  const published = [];
  const client = { auth: {
    onAuthStateChange: (next) => { callback = next; return { data: { subscription: { unsubscribe() { callback = undefined; } } } }; },
    getSession: async () => { calls.session++; return overrides.getSession ? overrides.getSession() : { data: { session: makeSession() }, error: null }; },
    getUser: async () => { calls.user++; assert.fail('Aucun getUser supplémentaire ne doit retarder le dépôt.'); },
  } };
  const controller = auth.createAuthSessionController({
    client, generation: 1,
    loadRole: async (id) => { calls.role++; return overrides.loadRole ? overrides.loadRole(id) : 'user'; },
    publish: (value) => { published.push(value); },
  });
  t.after(() => controller.dispose());
  return { controller, calls, published, emit: (event, session = makeSession()) => callback(event, session) };
}

test('Auth : les quatre notifications du même compte gardent snapshot, user et rôle par référence', async (t) => {
  const f = fixture(t);
  await until(() => f.controller.getSnapshot().roleStatus === 'ready');
  const before = f.controller.getSnapshot();
  const publicationCount = f.published.length;
  const calls = { ...f.calls };
  for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'INITIAL_SESSION']) {
    const session = makeSession();
    session.user.user_metadata = { changed: true };
    f.emit(event, session);
    assert.equal(f.controller.getSnapshot(), before);
  }
  await pause(5);
  assert.equal(f.controller.getSnapshot().user, before.user);
  assert.equal(f.controller.getSnapshot().userRole, before.userRole);
  assert.equal(f.published.length, publicationCount);
  assert.deepEqual(f.calls, calls);
});

test('Auth : une réémission pendant la première résolution ne relance ni getUser ni le profil', async (t) => {
  const role = deferred();
  const f = fixture(t, { loadRole: () => role.promise });
  await until(() => f.calls.role === 1);
  const resolving = f.controller.getSnapshot();
  for (const event of ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED']) f.emit(event);
  assert.equal(f.controller.getSnapshot(), resolving);
  role.resolve('user');
  await until(() => f.controller.getSnapshot().roleStatus === 'ready');
  assert.equal(f.calls.user, 0);
  assert.equal(f.calls.role, 1);
});

test('Auth : un getSession ancien ne peut pas effacer le compte annoncé puis réémis', async (t) => {
  const restore = deferred();
  const f = fixture(t, { getSession: () => restore.promise });
  f.emit('SIGNED_IN');
  await until(() => f.controller.getSnapshot().roleStatus === 'ready');
  const before = f.controller.getSnapshot();
  f.emit('TOKEN_REFRESHED');
  restore.resolve({ data: { session: null }, error: null });
  await pause(5);
  assert.equal(f.controller.getSnapshot(), before);
});

test('Auth : SIGNED_OUT efface le compte ; une notification sans session ne simule pas une déconnexion', async (t) => {
  const f = fixture(t);
  await until(() => f.controller.getSnapshot().roleStatus === 'ready');
  const before = f.controller.getSnapshot();
  f.emit('TOKEN_REFRESHED', null);
  assert.equal(f.controller.getSnapshot(), before);
  f.emit('SIGNED_OUT', null);
  assert.equal(f.controller.getSnapshot().user, null);
  assert.equal(f.controller.getSnapshot().userRole, null);
  assert.equal(f.controller.getSnapshot().sessionStatus, 'ready');
});

test('Auth : une réponse de profil précédente ne gagne pas contre un vrai changement de compte', async (t) => {
  const firstRole = deferred();
  const f = fixture(t, { loadRole: (id) => id === userId ? firstRole.promise : 'user' });
  await until(() => f.calls.role === 1);
  f.emit('SIGNED_IN', makeSession(secondUserId));
  await until(() => f.controller.getSnapshot().roleStatus === 'ready');
  const second = f.controller.getSnapshot();
  firstRole.resolve('admin');
  await pause(5);
  assert.equal(f.controller.getSnapshot(), second);
  assert.equal(second.user.id, secondUserId);
  assert.equal(f.calls.role, 2);
  assert.equal(f.calls.user, 0);
});

test('Auth : le réessai explicite après erreur reste possible pour le même compte', async (t) => {
  let request = 0;
  const f = fixture(t, { getSession: () => ++request === 1
    ? { data: { session: null }, error: new Error('Échec fictif') }
    : { data: { session: makeSession() }, error: null } });
  await until(() => f.controller.getSnapshot().sessionStatus === 'error');
  await f.controller.retrySession();
  await until(() => f.controller.getSnapshot().roleStatus === 'ready');
  assert.equal(f.controller.getSnapshot().user.id, userId);
  assert.equal(f.calls.session, 2);
  assert.equal(f.calls.user, 0);
});

test('Auth : un réessai de session déjà résolue ne publie pas d’écran de chargement', async (t) => {
  const f = fixture(t);
  await until(() => f.controller.getSnapshot().roleStatus === 'ready');
  const before = f.controller.getSnapshot();
  const publications = f.published.length;
  await f.controller.retrySession();
  assert.equal(f.controller.getSnapshot(), before);
  assert.equal(f.published.length, publications);
  assert.equal(f.calls.user, 0);
  assert.equal(f.calls.role, 1);
});

test('Auth : une revalidation de rôle explicite garde les enfants jusqu’à la réponse réelle', async (t) => {
  const gate = deferred();
  let request = 0;
  const f = fixture(t, { loadRole: () => ++request === 1 ? 'admin' : gate.promise });
  await until(() => f.controller.getSnapshot().roleStatus === 'ready');
  const before = f.controller.getSnapshot();
  const refresh = f.controller.refreshUserRole();
  assert.equal(f.controller.getSnapshot(), before);
  gate.resolve('user');
  await refresh;
  assert.equal(f.controller.getSnapshot().user, before.user);
  assert.equal(f.controller.getSnapshot().userRole, 'user');
});

test('Auth : erreurs temporaires de session et de profil ne retirent pas une page ouverte', async (t) => {
  let roleRequest = 0, sessionRequest = 0;
  const f = fixture(t, {
    getSession: () => ++sessionRequest === 1 ? { data: { session: makeSession() }, error: null }
      : { data: { session: null }, error: new Error('Réseau fictivement interrompu') },
    loadRole: () => { if (++roleRequest === 1) return 'admin'; throw new Error('Profil fictivement indisponible'); },
  });
  await until(() => f.controller.getSnapshot().roleStatus === 'ready');
  const user = f.controller.getSnapshot().user;
  await assert.rejects(f.controller.refreshUserRole());
  assert.equal(f.controller.getSnapshot().user, user);
  assert.equal(f.controller.getSnapshot().userRole, 'admin');
  assert.equal(f.controller.getSnapshot().roleStatus, 'ready');
  await f.controller.retrySession();
  assert.equal(f.controller.getSnapshot().user, user);
  assert.equal(f.controller.getSnapshot().sessionStatus, 'ready');
  assert.equal(f.calls.user, 0);
});

test('Sélecteur : même chargement = remontage ; identifiant différent ou wasDiscarded = rechargement', () => {
  const marker = { pageLoadId: 'page-a' };
  assert.equal(diagnostics.wasUploadPickerReloaded(marker, 'page-a', false), false);
  assert.equal(diagnostics.wasUploadPickerReloaded(marker, 'page-b', false), true);
  assert.equal(diagnostics.wasUploadPickerReloaded(marker, 'page-a', true), true);
  assert.equal(diagnostics.wasUploadPickerReloaded({}, 'page-a', false), false);
  assert.equal(diagnostics.wasUploadPickerReloaded(null, 'page-b', true), false);
  const scope = { userId, projectUrl: 'https://stability-test.invalid' };
  const record = draft.encodeUploadDraft(scope, { files: [], titles: [], description: '', schoolName: '', subjectName: '', batch: null,
    picker: { kind: 'files', openedAt: 1760000000000, pageLoadId: diagnostics.UPLOAD_PAGE_LOAD_ID, token: 'EXCLUDED' } }, 1);
  assert.equal(draft.decodeUploadDraft(scope, record).picker.pageLoadId, diagnostics.UPLOAD_PAGE_LOAD_ID);
  assert.doesNotMatch(JSON.stringify(record), /EXCLUDED|token/);
});

test('Diagnostic : identifiant, navigation et type Auth seulement, sans session ni donnée personnelle', async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const entries = new Map();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage: {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { wasDiscarded: false } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
  });
  diagnostics.logUploadDiagnostic('auth-event', { authEvent: 'TOKEN_REFRESHED', access_token: 'EXCLUDED', user: { id: 'EXCLUDED' }, fileName: 'EXCLUDED' });
  const entry = JSON.parse(entries.get(diagnostics.UPLOAD_DIAGNOSTICS_KEY))[0];
  assert.equal(entry.pageLoadId, diagnostics.UPLOAD_PAGE_LOAD_ID);
  assert.equal(entry.navigationType, 'unknown');
  assert.equal(entry.authEvent, 'TOKEN_REFRESHED');
  assert.equal(entry.wasDiscarded, false);
  assert.doesNotMatch(JSON.stringify(entry), /EXCLUDED|access_token|fileName|"user"/);
  const f = fixture(t);
  await until(() => f.controller.getSnapshot().roleStatus === 'ready');
  for (const event of ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED']) f.emit(event);
  const log = JSON.parse(entries.get(diagnostics.UPLOAD_DIAGNOSTICS_KEY));
  assert.deepEqual(log.slice(-4).map((value) => value.authEvent), ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED']);
});

test('Noms : NFD, alphabet sûr, 100 caractères avec extension conservée et chemin UUID indépendant', () => {
  assert.equal(files.normalizeUploadFileName('Été — résumé (final).PDF'), 'Ete___resume__final_.PDF');
  assert.equal(files.normalizeUploadFileName('épreuve.pdf'), 'epreuve.pdf');
  const long = files.normalizeUploadFileName(`${'É'.repeat(150)}.docx`);
  assert.equal(long.length, 100);
  assert.ok(long.endsWith('.docx'));
  assert.match(long, /^[A-Za-z0-9._-]+$/);
  const path = files.uploadStoragePath(userId, secondUserId);
  assert.equal(path, `${userId}/${secondUserId}-document`);
  assert.ok(files.isUploadIdentityPath(long, userId, secondUserId, path));
  const original = 'Épreuve finale.pdf';
  const legacy = `${userId}/${secondUserId}-${original.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  assert.ok(files.isUploadIdentityPath(original, userId, secondUserId, legacy));
  assert.ok(files.matchesUploadFileName('Epreuve_finale.pdf', original));
});

test('SHA-256 : vecteurs et frontières de padding/tranches identiques à node:crypto', async () => {
  for (const text of ['', 'abc', 'épreuve 📝']) {
    assert.equal(await hash.hashUploadBlob(new Blob([text])), createHash('sha256').update(text).digest('hex'));
  }
  for (const size of [55, 56, 63, 64, 65, hash.UPLOAD_HASH_CHUNK_SIZE - 1, hash.UPLOAD_HASH_CHUNK_SIZE, hash.UPLOAD_HASH_CHUNK_SIZE + 65]) {
    const bytes = Uint8Array.from({ length: size }, (_, index) => (index * 31 + 7) % 256);
    assert.equal(await hash.hashUploadBlob(new Blob([bytes])), createHash('sha256').update(bytes).digest('hex'));
  }
});

test('SHA-256 : seul slice().arrayBuffer() est lu, jamais celui du fichier complet', async () => {
  const bytes = new Uint8Array(hash.UPLOAD_HASH_CHUNK_SIZE * 3 + 7).fill(123);
  const original = new Blob([bytes]);
  const reads = [];
  original.arrayBuffer = async () => { assert.fail('Lecture complète du fichier interdite.'); };
  const slice = original.slice.bind(original);
  original.slice = (start, end) => { reads.push(end - start); return slice(start, end); };
  assert.equal(await hash.hashUploadBlob(original), createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(reads, [hash.UPLOAD_HASH_CHUNK_SIZE, hash.UPLOAD_HASH_CHUNK_SIZE, hash.UPLOAD_HASH_CHUNK_SIZE, 7]);
});

test('Reprise : le nom normalisé retrouve les octets au nom d’origine sans changer l’identité', async () => {
  const file = new File(['contenu'], 'Épreuve finale.pdf', { type: 'application/pdf' });
  const request = { identity: { id: secondUserId, filePath: files.uploadStoragePath(userId, secondUserId) }, userId,
    title: 'Épreuve', description: '', fileName: files.normalizeUploadFileName(file.name), fileSize: file.size,
    fileType: 'pdf', sha256: await hash.hashUploadBlob(file), schoolName: 'IFRI', subjectName: 'Algèbre' };
  const scope = { userId, projectUrl: 'https://stability-test.invalid' };
  const source = batch.createUploadBatch(userId, scope.projectUrl, [{ request, file }], '33333333-3333-4333-8333-333333333333');
  const stored = draft.encodeUploadDraft(scope, { files: [], titles: [], description: '', schoolName: 'IFRI', subjectName: 'Algèbre', batch: source }, 1);
  const restored = draft.decodeUploadDraft(scope, stored).batch;
  const attached = await batch.attachUploadFiles(restored, [file], hash.hashUploadBlob);
  assert.deepEqual(attached.entries[0].request.identity, request.identity);
  assert.equal(attached.entries[0].file, file);
  assert.equal(restored.entries[0].file.name, file.name);
});

test('Raccordement : dépôt hors des gardes, aucun key Auth et PDF local sans buffer complet', async () => {
  const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const [app, page, provider, protectedRoute, adminRoute, pdf, modal, transport] = await Promise.all([
    source('src/App.tsx'), source('src/pages/DashboardPage.tsx'), source('src/context/UploadContext.tsx'),
    source('src/components/ProtectedRoute.tsx'), source('src/components/AdminRoute.tsx'), source('src/lib/pdf-runtime.ts'),
    source('src/components/UploadModal.tsx'), source('src/lib/upload-transport.ts'),
  ]);
  assert.ok(app.indexOf('<UploadProvider>') < app.indexOf('<Outlet />'));
  assert.doesNotMatch(page, /<UploadModal/);
  assert.match(page, /useDashboardUpload/);
  assert.match(provider, /createPortal\(<UploadModal/);
  assert.doesNotMatch(app + provider + page, /key=\{[^}]*\b(?:user|session|auth)\b/);
  assert.match(protectedRoute, /if \(isConfigured && user\) return/);
  assert.match(adminRoute, /if \(isConfigured && user && isAdmin\) return/);
  // Un commentaire historique ne constitue pas un écran rendu. Garder les
  // assertions sur le code et les textes JSX, pas sur les commentaires de ligne.
  const guards = `${protectedRoute}\n${adminRoute}`.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(guards, /Vérification de|Vérification des|Loader2|animate-spin/);
  assert.match(pdf, /URL\.createObjectURL\(blob\)/);
  assert.match(pdf, /task\?\.destroy\(\)/);
  assert.match(pdf, /URL\.revokeObjectURL\(url\)/);
  assert.match(pdf, /pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs\?url/);
  assert.doesNotMatch(pdf, /\.arrayBuffer\(|https?:\/\//);
  assert.match(modal, /finally \{\s*input\.value = '';/);
  assert.doesNotMatch(modal, /La page s.est rechargée|PICKER_RELOAD_MESSAGE|pickerReady|isSavingPicker|setPickerReloaded|addEventListener\('visibilitychange'|addEventListener\('focus'/);
  const chooser = modal.slice(modal.indexOf('const handlePickerClick'), modal.indexOf('const visibleFiles'));
  assert.doesNotMatch(chooser, /await |\.showPicker\(|requestAnimationFrame\(/);
  const [authSource, storageSource, entry, moduleNotice, offline, update] = await Promise.all([
    source('src/lib/auth-session.ts'), source('src/lib/supabase.ts'), source('index.html'),
    source('src/lib/module-load-error.ts'), source('src/components/pwa/OfflinePage.tsx'), source('src/components/pwa/UpdateToast.tsx'),
  ]);
  assert.doesNotMatch(authSource + storageSource, /\.auth\.getUser\(/);
  assert.doesNotMatch(entry + moduleNotice + offline + update, /location\.reload\(/);
  assert.match(transport, /xhr\.send\(options\.file\)/);
  assert.match(transport, /new Upload\(options\.file, settings\)/);
});
