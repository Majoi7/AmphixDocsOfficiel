import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// Tests exclusivement locaux : aucune requête ne sort de ce client simulé.
// Le serveur Vite ne charge ni vite.config.ts ni les fichiers .env.
const userId = '11111111-1111-4111-8111-111111111111';
const folderId = '22222222-2222-4222-8222-222222222222';
const documentId = '33333333-3333-4333-8333-333333333333';
const author = { full_name: 'Compte de test', avatar_url: '', email: 'test@example.invalid' };
const folder = {
  id: folderId, user_id: userId, name: 'Dossier de test', category_id: null,
  status: 'pending', rejection_reason: null, created_at: '2026-01-01T00:00:00Z', profiles: author,
};
const document = {
  id: documentId, user_id: userId, title: 'Document de test', description: null,
  file_name: 'test.pdf', file_path: `${userId}/test.pdf`, file_type: 'pdf', file_size: 4,
  folder_id: folderId, category_id: null, status: 'pending', rejection_reason: null,
  created_at: '2026-01-01T00:00:00Z', profiles: author,
};
const expectedFolderSelect = '*, profiles:profiles!folders_user_id_profiles_fkey(full_name, avatar_url, email)';
const expectedDocumentSelect = '*, profiles:profiles!documents_user_id_profiles_fkey(full_name, avatar_url, email)';
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let server;
let library;
let requests = [];
let profileVisible = true;
let mutationResponses = {};

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});

before(async () => {
  const values = new Map([
    ['amphix_supabase_url', 'https://relations-test.invalid'],
    ['amphix_supabase_anon_key', 'public-test-key-not-a-real-credential'],
  ]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.origin, 'https://relations-test.invalid', 'Tout accès réseau externe est interdit dans ces tests.');
    const method = init.method ?? (input instanceof Request ? input.method : 'GET');
    requests.push({ url, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
    const json = jsonResponse;
    if (method === 'PATCH' && ['/rest/v1/folders', '/rest/v1/documents'].includes(url.pathname)) {
      const response = mutationResponses[url.pathname];
      assert.ok(response, 'Toute mutation doit avoir une réponse de test explicite.');
      if (response instanceof Error) throw response;
      return json(response.data, response.status ?? 200);
    }
    const profiles = profileVisible ? author : null;
    if (url.pathname === '/rest/v1/categories' && method === 'GET') {
      return json([{ id: '44444444-4444-4444-8444-444444444444', name: 'Test', color: '#4a6cf0' }]);
    }
    if (url.pathname === '/rest/v1/folders') {
      if (method === 'GET') return json([{ ...folder, profiles }]);
      if (method === 'POST') return json({ ...folder, ...JSON.parse(init.body)[0], profiles });
    }
    if (url.pathname === '/rest/v1/documents') {
      if (method === 'GET') return json([{ ...document, profiles }]);
      if (method === 'POST') return json({ ...document, ...JSON.parse(init.body)[0], profiles });
    }
    if (url.pathname.startsWith('/storage/v1/object/documents/') && method === 'POST') {
      return json({ Key: url.pathname.slice('/storage/v1/object/'.length) });
    }
    throw new Error(`Requête de test inattendue : ${method} ${url.pathname}`);
  };
  server = await createServer({
    configFile: false, envDir: false, server: { middlewareMode: true },
    appType: 'custom', logLevel: 'error',
  });
  library = await server.ssrLoadModule('/src/lib/supabase.ts');
});

after(async () => {
  library?.supabase.auth.stopAutoRefresh();
  await server?.close();
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('la bibliothèque joint explicitement profiles via les deux FK', async () => {
  requests = [];
  const result = await library.fetchDashboardData(userId, false);
  const folderRequest = requests.find(({ url }) => url.pathname === '/rest/v1/folders');
  const documentRequest = requests.find(({ url }) => url.pathname === '/rest/v1/documents');
  assert.equal(folderRequest.url.searchParams.get('select'), expectedFolderSelect.replaceAll(' ', ''));
  assert.equal(documentRequest.url.searchParams.get('select'), expectedDocumentSelect.replaceAll(' ', ''));
  assert.equal(result.folders[0].document_count, 1);
  assert.equal(result.folders[0].author_name, author.full_name);
  assert.equal(result.documents[0].author_name, author.full_name);
});

test('un profil masqué par RLS ne fait pas disparaître le document ou le dossier', async () => {
  profileVisible = false;
  try {
    const result = await library.fetchDashboardData(userId, false);
    assert.equal(result.documents[0].id, documentId);
    assert.equal(result.documents[0].author_name, 'Utilisateur');
    assert.equal(result.documents[0].author_email, '');
    assert.equal(result.folders[0].id, folderId);
    assert.equal(result.folders[0].author_name, 'Utilisateur');
  } finally {
    profileVisible = true;
  }
});

test('la création de dossier utilise la relation profiles et confirme le retour', async () => {
  requests = [];
  const result = await library.createFolderItem('Nouveau dossier', null, userId);
  const request = requests.find(({ url, method }) => url.pathname === '/rest/v1/folders' && method === 'POST');
  assert.equal(request.url.searchParams.get('select'), expectedFolderSelect.replaceAll(' ', ''));
  assert.equal(result.name, 'Nouveau dossier');
  assert.equal(result.document_count, 0);
  assert.equal(result.author_name, author.full_name);
});

test('le retour du dépôt joint profiles via la FK documents', async () => {
  requests = [];
  const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });
  const result = await library.uploadUserDocument(file, 'Nouveau document', '', userId, folderId);
  const request = requests.find(({ url, method }) => url.pathname === '/rest/v1/documents' && method === 'POST');
  assert.equal(request.url.searchParams.get('select'), expectedDocumentSelect.replaceAll(' ', ''));
  assert.equal(result.title, 'Nouveau document');
  assert.equal(result.author_name, author.full_name);
  assert.equal(result.file_size, 4);
});

test('la modération laisse reviewer/date au serveur et confirme la cible', async () => {
  requests = [];
  mutationResponses = { '/rest/v1/documents': { data: [{ id: documentId }] } };
  await library.setItemApprovalStatus('document', documentId, 'approved', undefined, userId);
  const request = requests.find(({ method }) => method === 'PATCH');
  assert.deepEqual(request.body, { status: 'approved', rejection_reason: null });
  assert.equal(request.url.searchParams.get('id'), `eq.${documentId}`);
  assert.equal(request.url.searchParams.get('select'), 'id');
});

test('une modération refusée ou sans ligne affectée ne donne pas un succès', async () => {
  mutationResponses = { '/rest/v1/documents': { data: [], status: 200 } };
  await assert.rejects(
    library.setItemApprovalStatus('document', documentId, 'approved'),
    /aucun élément confirmé/
  );
  mutationResponses = {
    '/rest/v1/documents': { data: { message: 'Accès refusé', code: '42501' }, status: 403 },
  };
  await assert.rejects(
    library.setItemApprovalStatus('document', documentId, 'approved'),
    /Accès refusé/
  );
});

test('l’approbation collective ne touche que les fichiers confirmés par le filtre', async () => {
  requests = [];
  mutationResponses = { '/rest/v1/documents': { data: [{ id: documentId }] } };
  await library.approveAllPendingItems({ documentIds: [documentId, documentId], folderIds: [] }, userId);
  const patches = requests.filter(({ method }) => method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].url.pathname, '/rest/v1/documents');
  assert.equal(patches[0].url.searchParams.get('id'), `in.(${documentId})`);
  assert.equal(patches[0].url.searchParams.get('status'), 'eq.pending');
  assert.deepEqual(patches[0].body, { status: 'approved', rejection_reason: null });
});

test('le filtre dossiers n’approuve aucun fichier et une sélection vide ne mute rien', async () => {
  requests = [];
  mutationResponses = { '/rest/v1/folders': { data: [{ id: folderId }] } };
  await library.approveAllPendingItems({ documentIds: [], folderIds: [folderId] });
  const patches = requests.filter(({ method }) => method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].url.pathname, '/rest/v1/folders');
  assert.equal(patches[0].url.searchParams.get('id'), `in.(${folderId})`);
  requests = [];
  await library.approveAllPendingItems({ documentIds: [], folderIds: [] });
  assert.equal(requests.length, 0);
});

test('un succès partiel de deux tables est annoncé comme incomplet', async () => {
  mutationResponses = {
    '/rest/v1/documents': { data: [{ id: documentId }] },
    '/rest/v1/folders': { data: { message: 'Refus RLS', code: '42501' }, status: 403 },
  };
  await assert.rejects(
    library.approveAllPendingItems({ documentIds: [documentId], folderIds: [folderId] }),
    /Approbation incomplète : 1 sur 2.*Refus RLS/
  );
});

test('une cible absente ou une réponse réseau perdue n’est pas confirmée', async () => {
  mutationResponses = { '/rest/v1/documents': { data: [] } };
  await assert.rejects(
    library.approveAllPendingItems({ documentIds: [documentId], folderIds: [] }),
    /Approbation incomplète : 0 sur 1/
  );
  mutationResponses = {
    '/rest/v1/documents': new Error('Panne de test locale'),
    '/rest/v1/folders': { data: [{ id: folderId }] },
  };
  await assert.rejects(
    library.approveAllPendingItems({ documentIds: [documentId], folderIds: [folderId] }),
    /Approbation incomplète : 1 sur 2/
  );
});
