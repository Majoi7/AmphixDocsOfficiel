import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

// Tests exclusivement locaux : le fetch simulé refuse tout autre domaine.
// Le serveur Vite ne charge ni vite.config.ts ni les fichiers .env, et ne
// découvre pas les entrées de l’application (notamment virtual:pwa-register).
// AMPHIX_TEST_ROOT permet seulement de tester une copie locale des modules.
const root = process.env.AMPHIX_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://relations-test.invalid';
const publicKey = 'sb_publishable_local_tests_only_00000000000000000000';
const sessionKey = 'amphixdocs-auth-relations-test.invalid';
const userId = '11111111-1111-4111-8111-111111111111';
const documentId = '33333333-3333-4333-8333-333333333333';
const uploadId = '55555555-5555-4555-8555-555555555555';
const author = { full_name: 'Compte de test', avatar_url: '', email: 'test@example.invalid' };
const document = {
  id: documentId, user_id: userId, title: 'Document de test', description: null,
  file_name: 'test.pdf', file_path: `${userId}/test.pdf`, file_type: 'pdf', file_size: 4,
  school_name: 'École de test', subject_name: 'Mathématiques', deleted_at: null, deleted_by: null,
  status: 'pending', rejection_reason: null,
  reviewed_by: null, reviewed_at: null, created_at: '2026-01-01T00:00:00Z',
  thumbnail_path: null, page_count: null,
};
const expectedDocumentSelect = 'id,user_id,title,description,file_name,file_path,file_type,file_size,created_at,school_name,subject_name,status,rejection_reason,reviewed_by,reviewed_at,deleted_at,deleted_by,thumbnail_path,page_count,profiles:profiles!documents_user_id_profiles_fkey(full_name,avatar_url,email)';
const user = {
  id: userId, aud: 'authenticated', role: 'authenticated', email: author.email,
  app_metadata: {}, user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00Z',
};
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
// Structure JWT reconnue par le SDK, sans signature ni identifiant réel.
// Seul le serveur simulé ci-dessous accepte ce jeton et cette clé fictifs.
const accessToken = [
  base64url({ alg: 'HS256', typ: 'JWT' }),
  base64url({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: expiresAt }),
  Buffer.from('signature-fictive-tests-locaux').toString('base64url'),
].join('.');
const session = {
  access_token: accessToken, refresh_token: 'jeton-fictif-tests-locaux',
  token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user,
};
const originalFetch = globalThis.fetch;
const originalGlobals = new Map(['window', 'document', 'localStorage'].map((name) =>
  [name, Object.getOwnPropertyDescriptor(globalThis, name)]
));
const storageValues = new Map();
const browserEvents = new EventTarget();
const browserListeners = new Map();
let listenerBaseline;

function addBrowserListener(type, listener) {
  browserEvents.addEventListener(type, listener);
  const listeners = browserListeners.get(type) ?? new Set();
  listeners.add(listener);
  browserListeners.set(type, listeners);
}

function removeBrowserListener(type, listener) {
  browserEvents.removeEventListener(type, listener);
  browserListeners.get(type)?.delete(listener);
}

function cleanBrowserListeners(preserved = new Map()) {
  for (const [type, listeners] of browserListeners) {
    for (const listener of listeners) {
      if (!preserved.get(type)?.has(listener)) removeBrowserListener(type, listener);
    }
    if (listeners.size === 0) browserListeners.delete(type);
  }
}

const storage = {
  getItem: (key) => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, value),
  removeItem: (key) => storageValues.delete(key),
};
let server;
let library;
let requests;
let violations;
let profileVisible;
let verifiedUser;
let tables;
let objects;
let mutationResponses;
let failures;

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const testFile = (contents = 'test') => new File([contents], 'test.pdf', { type: 'application/pdf' });
const prepareRequest = () => library.prepareUploadDocument(
  testFile(), 'Nouveau document', '', userId, 'École de test', 'Mathématiques', uploadId
);
const profiles = (row) => ({ ...row, profiles: profileVisible ? author : null });
const assertNoCleanup = () => assert.equal(
  requests.filter(({ method }) => ['DELETE', 'PUT'].includes(method)).length, 0,
  'Une réponse perdue ne doit déclencher ni suppression ni remplacement.'
);
const requestsFor = (method, path) => requests.filter((request) =>
  request.method === method && request.url.pathname === path
);

function resetFixtures() {
  requests = [];
  violations = [];
  profileVisible = true;
  verifiedUser = user;
  tables = {
    documents: new Map([[documentId, { ...document }]]),
  };
  objects = new Map([[document.file_path, testFile()]]);
  mutationResponses = {};
  failures = {};
  storageValues.set(sessionKey, JSON.stringify(session));
}

function respondToLookup(table, url) {
  const lookupFailure = failures[`${table}Lookup`];
  if (lookupFailure) return jsonResponse(lookupFailure.data, lookupFailure.status);
  const rows = [...tables[table].values()].filter((row) =>
    ['id', 'user_id', 'status', 'deleted_at'].every((column) => {
      const filter = url.searchParams.get(column);
      return !filter || filter === `eq.${row[column]}` || (filter === 'is.null' && row[column] === null);
    })
  );
  // maybeSingle() transforme zéro/une ligne GET ; une insertion single()
  // reçoit quant à elle un objet, comme la représentation PostgREST.
  return jsonResponse(rows.map(profiles));
}

function respondToLibrary(body, url) {
  assert.equal(url.searchParams.get('select'), expectedDocumentSelect);
  assert.deepEqual(Object.keys(body).sort(), ['p_ascending', 'p_offset', 'p_pending', 'p_query', 'p_trash']);
  assert.equal(typeof body.p_query, 'string');
  for (const name of ['p_trash', 'p_pending', 'p_ascending']) assert.equal(typeof body[name], 'boolean');
  assert.ok(Number.isSafeInteger(body.p_offset) && body.p_offset >= 0 && body.p_offset <= 100000);
  if (failures.library) return jsonResponse(failures.library.data, failures.library.status);
  // Simulation du contrat HTTP, pas une preuve d'exécution SQL ni des RLS.
  const term = body.p_query.toLowerCase();
  const rows = [...tables.documents.values()].filter((row) =>
    (body.p_trash ? row.deleted_at !== null : row.deleted_at === null)
    && (!body.p_pending || row.status === 'pending')
    && (!term || ['title', 'description', 'file_name', 'school_name', 'subject_name']
      .some((column) => (row[column] || '').toLowerCase().includes(term)))
  );
  rows.sort((a, b) => {
    const direction = body.p_ascending ? 1 : -1;
    return direction * (a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  });
  return jsonResponse(rows.slice(body.p_offset, body.p_offset + 20).map(profiles));
}

function respondToInsert(table, body) {
  assert.ok(Array.isArray(body) && body.length === 1, 'Une seule identité doit être insérée.');
  const row = { ...document, ...body[0] };
  if (tables[table].has(row.id)) {
    return jsonResponse({ code: '23505', message: 'Cette identité existe déjà.' }, 409);
  }
  const failure = failures[`${table}Insert`];
  delete failures[`${table}Insert`];
  if (!failure || failure.committed) tables[table].set(row.id, row);
  if (failure) throw failure.error;
  return jsonResponse(profiles(row));
}

async function simulatedFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== origin) {
    violations.push(`Domaine interdit : ${url.origin}`);
    throw new Error('Tout accès réseau externe est interdit dans ces tests.');
  }
  const method = init.method ?? (input instanceof Request ? input.method : 'GET');
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  requests.push({ url, method, body, headers, cache: init.cache });
  assert.equal(headers.get('apikey'), publicKey);
  assert.equal(headers.get('authorization'), `Bearer ${accessToken}`);
  if (url.pathname === '/auth/v1/user' && method === 'GET') {
    return jsonResponse(verifiedUser);
  }
  if (url.pathname === '/rest/v1/rpc/list_library_documents' && method === 'POST') {
    return respondToLibrary(body, url);
  }
  const table = url.pathname === '/rest/v1/documents' ? 'documents' : null;
  if (table) {
    if (method === 'GET') return respondToLookup(table, url);
    if (method === 'POST') return respondToInsert(table, body);
    if (method === 'PATCH') {
      const response = mutationResponses[url.pathname];
      assert.ok(response, 'Toute modération doit avoir une réponse de test explicite.');
      if (response instanceof Error) throw response;
      return jsonResponse(response.data, response.status ?? 200);
    }
  }
  const storagePrefix = '/storage/v1/object/documents/';
  if (url.pathname.startsWith(storagePrefix)) {
    const path = decodeURIComponent(url.pathname.slice(storagePrefix.length));
    if (method === 'GET') {
      assert.equal(init.cache, 'no-store', 'Une reprise doit relire les octets, pas le cache.');
      if (failures.storageDownload) {
        return jsonResponse(failures.storageDownload.data, failures.storageDownload.status);
      }
      return objects.has(path)
        ? new Response(objects.get(path))
        : jsonResponse({ code: 'NoSuchKey', message: 'Objet absent dans le stockage simulé.' }, 404);
    }
    if (method === 'POST') {
      assert.equal(headers.get('x-upsert'), 'false', 'Un dépôt ne doit jamais remplacer un objet.');
      assert.ok(init.body instanceof FormData);
      assert.equal(init.body.get('cacheControl'), '0');
      const file = [...init.body.values()].find((value) => value instanceof Blob);
      assert.ok(file, 'Le transfert doit contenir de vrais octets de fixture.');
      if (objects.has(path)) return jsonResponse({ code: 'Duplicate', message: 'Objet déjà présent.' }, 409);
      const failure = failures.storageUpload;
      delete failures.storageUpload;
      if (!failure || failure.committed) objects.set(path, file);
      if (failure) throw failure.error;
      return jsonResponse({ Id: uploadId, Key: `documents/${path}` });
    }
  }
  violations.push(`Route inattendue : ${method} ${url.pathname}`);
  throw new Error(`Requête de test inattendue : ${method} ${url.pathname}`);
}

before(async () => {
  storageValues.set('amphix_supabase_config_v1', JSON.stringify({ url: origin, key: publicKey }));
  resetFixtures();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: storage,
      location: { href: 'https://interface-test.invalid/dashboard' },
      addEventListener: addBrowserListener,
      removeEventListener: removeBrowserListener,
    },
  });
  // L’onglet caché évite un rafraîchissement inutile du jeton fictif.
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'hidden' } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  globalThis.fetch = async (...args) => {
    try { return await simulatedFetch(...args); }
    catch (error) {
      // Le SDK peut transformer une assertion du faux serveur en erreur API.
      // afterEach la signale tout de même, même si le test attend un rejet.
      if (error instanceof assert.AssertionError) violations.push(error.message);
      throw error;
    }
  };
  server = await createServer({
    root, configFile: false, envDir: false,
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    appType: 'custom', logLevel: 'error',
  });
  library = await server.ssrLoadModule('/src/lib/supabase.ts');
  assert.equal(library.getSupabaseClientState().config.status, 'configured');
  const restored = await library.getSupabaseClient().auth.getSession();
  assert.equal(restored.error, null);
  assert.equal(restored.data.session?.user.id, userId);
  listenerBaseline = new Map([...browserListeners].map(([type, listeners]) => [type, new Set(listeners)]));
});

beforeEach(resetFixtures);
afterEach(() => {
  // Phoenix enregistre des callbacks de fenêtre pour chaque client de travail,
  // sans disposer de ces abonnements lors d’un simple disconnect(). Nettoyer
  // la fausse fenêtre après chaque test, sans masquer son seuil d’avertissement.
  cleanBrowserListeners(listenerBaseline);
  assert.deepEqual(violations, [], 'Le serveur simulé a reçu une requête interdite ou incompatible.');
});
after(async () => {
  try {
    const client = library?.getSupabaseClientState?.()?.client;
    await client?.auth.dispose();
  } finally {
    try { await server?.close(); }
    finally {
      cleanBrowserListeners();
      assert.equal(browserListeners.size, 0);
      globalThis.fetch = originalFetch;
      for (const [name, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  }
});

test('la bibliothèque paginée joint explicitement profiles via la FK documents', async () => {
  const result = await library.fetchDashboardData(userId, false);
  const [documentRequest] = requestsFor('POST', '/rest/v1/rpc/list_library_documents');
  assert.equal(documentRequest.url.searchParams.get('select'), expectedDocumentSelect);
  assert.deepEqual(documentRequest.body, {
    p_query: '', p_trash: false, p_pending: false, p_offset: 0, p_ascending: false,
  });
  assert.equal(requestsFor('GET', '/rest/v1/documents').length, 0);
  assert.equal(result.documents[0].author_name, author.full_name);
  assert.equal(result.documents[0].thumbnail_path, null);
  assert.equal(result.documents[0].page_count, null);
});

test('la recherche, la corbeille et la pagination sont envoyées à la RPC sans accorder un rôle', async () => {
  const result = await library.fetchDashboardData(userId, true, undefined, {
    query: '  %_Test,\\\\  ', trash: true, pending: true, offset: 20, ascending: true,
  });
  const [request] = requestsFor('POST', '/rest/v1/rpc/list_library_documents');
  assert.deepEqual(request.body, {
    p_query: '%_Test,\\\\', p_trash: true, p_pending: true, p_offset: 20, p_ascending: true,
  });
  assert.deepEqual(result.documents, []);
  assert.ok(!Object.keys(request.body).some((key) => /user|admin|role/i.test(key)));
});

test('une erreur de RPC ou un décalage invalide ne devient pas une bibliothèque vide', async () => {
  failures.library = { data: { code: '42501', message: 'Bibliothèque refusée dans la simulation.' }, status: 403 };
  await assert.rejects(library.fetchDashboardData(userId, false), /Bibliothèque refusée dans la simulation/);
  const count = requests.length;
  await assert.rejects(library.fetchDashboardData(userId, false, undefined, { offset: -1 }), /page est indisponible/);
  await assert.rejects(library.fetchDashboardData(userId, false, undefined, { offset: 0.5 }), /page est indisponible/);
  assert.equal(requests.length, count);
});

test('un profil masqué par RLS ne fait pas disparaître le document', async () => {
  profileVisible = false;
  const result = await library.fetchDashboardData(userId, false);
  assert.equal(result.documents[0].id, documentId);
  assert.equal(result.documents[0].author_name, 'Utilisateur');
  assert.equal(result.documents[0].author_email, '');
});

test('le retour du dépôt joint profiles via la FK documents et publie des étapes honnêtes', async () => {
  const stages = [];
  const result = await library.uploadUserDocument(testFile(), 'Nouveau document', '', userId, 'École de test', 'Mathématiques', (stage) => stages.push(stage));
  const request = requestsFor('POST', '/rest/v1/documents')[0];
  assert.equal(request.url.searchParams.get('select'), expectedDocumentSelect);
  assert.equal(result.title, 'Nouveau document');
  assert.equal(result.author_name, author.full_name);
  assert.equal(result.file_size, 4);
  assert.deepEqual(stages, ['verification', 'transfert', 'enregistrement', 'termine']);
  assert.ok(requestsFor('GET', '/auth/v1/user').length > 0);
});

test('la modération laisse reviewer/date au serveur et confirme la cible', async () => {
  mutationResponses = { '/rest/v1/documents': { data: [{ id: documentId, status: 'approved', rejection_reason: null }] } };
  await library.setItemApprovalStatus(documentId, 'approved', undefined, userId);
  const request = requests.find(({ method }) => method === 'PATCH');
  assert.deepEqual(request.body, { status: 'approved', rejection_reason: null });
  assert.equal(request.url.searchParams.get('id'), `eq.${documentId}`);
  assert.equal(request.url.searchParams.get('select'), 'id,status,rejection_reason');
});

test('une modération refusée ou sans ligne affectée ne donne pas un succès', async () => {
  mutationResponses = { '/rest/v1/documents': { data: [], status: 200 } };
  await assert.rejects(library.setItemApprovalStatus(documentId, 'approved', undefined, userId), /aucune cible exacte confirmée/);
  mutationResponses = {
    '/rest/v1/documents': { data: { message: 'Accès refusé', code: '42501' }, status: 403 },
  };
  await assert.rejects(library.setItemApprovalStatus(documentId, 'approved', undefined, userId), /Accès refusé/);
});

test('l’approbation collective ne touche que les fichiers confirmés par le filtre', async () => {
  mutationResponses = { '/rest/v1/documents': { data: [{ id: documentId, status: 'approved', rejection_reason: null }] } };
  await library.approveAllPendingItems({ documentIds: [documentId, documentId] }, userId);
  const patches = requests.filter(({ method }) => method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].url.pathname, '/rest/v1/documents');
  assert.equal(patches[0].url.searchParams.get('id'), `in.(${documentId})`);
  assert.equal(patches[0].url.searchParams.get('status'), 'eq.pending');
  assert.deepEqual(patches[0].body, { status: 'approved', rejection_reason: null });
});

test('une sélection vide est refusée sans mutation', async () => {
  await assert.rejects(library.approveAllPendingItems({ documentIds: [] }, userId), /Aucun fichier en attente/);
  assert.equal(requests.length, 0);
});

test('un succès partiel des fichiers est annoncé comme incomplet', async () => {
  mutationResponses = {
    '/rest/v1/documents': { data: [{ id: documentId, status: 'approved', rejection_reason: null }] },
  };
  await assert.rejects(
    library.approveAllPendingItems({ documentIds: [documentId, uploadId] }, userId),
    /Approbation incomplète : 1 sur 2/
  );
});

test('une cible absente ou une réponse réseau perdue n’est pas confirmée', async () => {
  mutationResponses = { '/rest/v1/documents': { data: [] } };
  await assert.rejects(
    library.approveAllPendingItems({ documentIds: [documentId] }, userId),
    /Approbation incomplète : 0 sur 1/
  );
  mutationResponses = { '/rest/v1/documents': new Error('Panne de test locale') };
  await assert.rejects(
    library.approveAllPendingItems({ documentIds: [documentId, uploadId] }, userId),
    /Panne de test locale/
  );
});

test('une réponse Storage perdue est réconciliée par les octets sans second transfert', async () => {
  const request = await prepareRequest();
  failures.storageUpload = { committed: true, error: new Error('Réponse Storage perdue localement') };
  const stages = [];
  const result = await library.resumeUserDocument(request, testFile(), (stage) => stages.push(stage), origin, 'initial');
  const uploads = requestsFor('POST', `/storage/v1/object/documents/${request.identity.filePath}`);
  assert.equal(uploads.length, 1);
  assert.equal(result.id, request.identity.id);
  assert.equal(result.file_path, request.identity.filePath);
  assert.ok(requestsFor('GET', `/storage/v1/object/documents/${request.identity.filePath}`).length > 0);
  assert.equal(tables.documents.size, 2);
  assert.equal(stages.at(-1), 'termine');
  assertNoCleanup();
});

test('une réponse SQL perdue retrouve la même identité sans insertion ni transfert doublés', async () => {
  const request = await prepareRequest();
  failures.documentsInsert = { committed: true, error: new Error('Réponse SQL perdue localement') };
  const result = await library.resumeUserDocument(request, testFile(), undefined, origin, 'initial');
  assert.equal(result.id, uploadId);
  assert.equal(requestsFor('POST', '/rest/v1/documents').length, 1);
  assert.equal(tables.documents.size, 2);
  const writesBeforeResume = requests.filter(({ method }) => method === 'POST').length;
  const resumed = await library.resumeUserDocument(request, undefined, undefined, origin);
  assert.equal(resumed.id, result.id);
  assert.equal(resumed.file_path, request.identity.filePath);
  assert.equal(requests.filter(({ method }) => method === 'POST').length, writesBeforeResume);
  assert.equal(objects.size, 2);
  assertNoCleanup();
});

test('un dépôt SQL indéterminé conserve son objet et reprend sous la même identité sans fichier local', async () => {
  const request = await prepareRequest();
  failures.documentsInsert = { committed: false, error: new Error('Écriture SQL non confirmée localement') };
  await assert.rejects(library.resumeUserDocument(request, testFile(), undefined, origin, 'initial'), (error) => {
    assert.equal(error.name, 'DocumentUploadError');
    assert.deepEqual(error.identity, request.identity);
    assert.equal(error.storageConfirmed, true);
    assert.equal(error.kind, 'uncertain');
    return true;
  });
  assert.ok(objects.has(request.identity.filePath));
  assert.equal(tables.documents.has(uploadId), false);
  const result = await library.resumeUserDocument(request, undefined, undefined, origin);
  assert.equal(result.id, uploadId);
  assert.equal(requestsFor('POST', `/storage/v1/object/documents/${request.identity.filePath}`).length, 1);
  const inserts = requestsFor('POST', '/rest/v1/documents');
  assert.equal(inserts.length, 2);
  assert.ok(inserts.every(({ body }) => body[0].id === uploadId && body[0].file_path === request.identity.filePath));
  assertNoCleanup();
});

test('un contenu distant de même taille mais d’empreinte différente bloque la reprise sans nettoyage', async () => {
  const request = await prepareRequest();
  await library.resumeUserDocument(request, testFile(), undefined, origin, 'initial');
  objects.set(request.identity.filePath, testFile('faux'));
  requests = [];
  await assert.rejects(library.resumeUserDocument(request, undefined, undefined, origin), (error) => {
    assert.equal(error.kind, 'conflict');
    assert.deepEqual(error.identity, request.identity);
    assert.match(error.message, /empreinte/);
    return true;
  });
  assert.equal(requests.filter(({ method }) => method === 'POST').length, 0);
  assert.equal(tables.documents.has(uploadId), true);
  assert.equal(await objects.get(request.identity.filePath).text(), 'faux');
  assertNoCleanup();
});

test('un 404 Storage générique n’autorise pas un nouvel envoi sous une identité incertaine', async () => {
  const request = await prepareRequest();
  failures.storageDownload = { status: 404, data: { message: 'Objet non accessible dans le test', statusCode: '404' } };
  await assert.rejects(library.resumeUserDocument(request, testFile(), undefined, origin), (error) => {
    assert.equal(error.kind, 'uncertain');
    assert.deepEqual(error.identity, request.identity);
    return true;
  });
  assert.equal(requests.filter(({ method }) => method === 'POST').length, 0);
  assertNoCleanup();
});

test('resélectionner un fichier de même nom et taille mais de contenu différent ne le transfère pas', async () => {
  const request = await prepareRequest();
  await assert.rejects(library.resumeUserDocument(request, testFile('faux'), undefined, origin), (error) => {
    assert.equal(error.kind, 'conflict');
    assert.deepEqual(error.identity, request.identity);
    return true;
  });
  assert.equal(requests.filter(({ method }) => method === 'POST').length, 0);
  assertNoCleanup();
});

// Création/reprise de dossier retirées avec le contrat V5, sans contourner
// les tests de reprise des fichiers ni l'interdiction de réseau réel.

test('un compte Auth incompatible bloque les écritures et conserve l’identité du dépôt', async () => {
  const request = await prepareRequest();
  verifiedUser = { ...user, id: '77777777-7777-4777-8777-777777777777' };
  await assert.rejects(library.resumeUserDocument(request, testFile(), undefined, origin, 'initial'), (error) => {
    assert.equal(error.kind, 'scope');
    assert.deepEqual(error.identity, request.identity);
    return true;
  });
  assert.ok(requests.length > 0);
  assert.ok(requests.every(({ url }) => url.pathname === '/auth/v1/user'));
  assertNoCleanup();
});
