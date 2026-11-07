import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// Simulation limitée aux API IndexedDB utilisées par le brouillon : requêtes
// asynchrones, transactions atomiques, révisions et fermeture. Ce n'est pas un
// test de conformité IndexedDB, d'éviction mobile ni de persistance navigateur.
// Aucun réseau, aucune configuration Vite d'application, aucun fichier .env.
const root = fileURLToPath(new URL('../', import.meta.url));
const originalFetch = globalThis.fetch;
const scope = { userId: '11111111-1111-4111-8111-111111111111', projectUrl: 'https://draft-test.invalid' };
const otherScope = { ...scope, userId: '22222222-2222-4222-8222-222222222222' };
const batchId = '77777777-7777-4777-8777-777777777777';
const otherBatchId = '88888888-8888-4888-8888-888888888888';
const lastModified = 1760000000000;
let server;
let draft;
let batches;
let networkAttempts = 0;

before(async () => {
  globalThis.fetch = async () => { networkAttempts++; throw new Error('Réseau interdit dans les tests de brouillon.'); };
  server = await createServer({
    root, configFile: false, envDir: false, optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error',
  });
  draft = await server.ssrLoadModule('/src/lib/upload-draft.ts');
  batches = await server.ssrLoadModule('/src/lib/upload-batch.ts');
});
after(async () => {
  try { await server?.close(); assert.equal(networkAttempts, 0); }
  finally { globalThis.fetch = originalFetch; }
});

const deferred = () => {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
};
function memoryIndexedDb(options = {}) {
  const values = new Map();
  const events = [];
  const waiting = [];
  const commitReady = deferred();
  const getReady = deferred();
  let pendingCommit;
  let active;
  let created = false;
  let closed = 0;

  function pump() {
    if (active || waiting.length === 0) return;
    active = waiting.shift();
    active.start();
  }
  function createTransaction(mode) {
    const operations = [];
    let data;
    let running = false;
    let ended = false;
    const tx = {
      error: null, oncomplete: null, onabort: null, onerror: null,
      objectStore(name) {
        assert.equal(name, 'drafts');
        return {
          get: (key) => enqueue('get', key),
          put: (value) => {
            assert.equal(mode, 'readwrite');
            return enqueue('put', value.key, structuredClone(value));
          },
          delete: (key) => { assert.equal(mode, 'readwrite'); return enqueue('delete', key); },
        };
      },
      abort() {
        if (ended) throw new DOMException('Transaction déjà terminée.', 'InvalidStateError');
        ended = true;
        pendingCommit = null;
        events.push(['abort', mode]);
        setImmediate(() => {
          tx.onabort?.({ target: tx });
          if (active === tx) active = null;
          pump();
        });
      },
      start() {
        data = new Map([...values].map(([key, value]) => [key, structuredClone(value)]));
        run();
      },
    };
    function enqueue(kind, key, value) {
      if (ended) throw new DOMException('Transaction terminée.', 'TransactionInactiveError');
      const request = { result: undefined, error: null, onsuccess: null, onerror: null };
      operations.push({ kind, key, value, request });
      if (active === tx && !running) setImmediate(run);
      return request;
    }
    function finish() {
      if (ended) return;
      ended = true;
      if (mode === 'readwrite') {
        values.clear();
        for (const [key, value] of data) values.set(key, structuredClone(value));
      }
      events.push(['complete', mode]);
      tx.oncomplete?.({ target: tx });
      active = null;
      pump();
    }
    function run() {
      if (ended || running) return;
      running = true;
      setImmediate(() => {
        running = false;
        if (ended) return;
        const operation = operations.shift();
        if (!operation) {
          if (mode === 'readwrite' && options.pauseWriteCommit) {
            pendingCommit = finish;
            commitReady.resolve();
          } else finish();
          return;
        }
        const { kind, key, value, request } = operation;
        events.push([kind, key]);
        if (kind === 'get') getReady.resolve();
        if (kind === 'get' && options.hangGet) return;
        const error = kind === 'put' && options.quota
          ? new DOMException('Quota simulé.', 'QuotaExceededError')
          : kind === 'get' ? options.getError : null;
        if (error) {
          request.error = error;
          request.onerror?.({ target: request });
          tx.error = error;
          tx.onerror?.({ target: tx });
          if (!ended) tx.abort();
          return;
        }
        if (kind === 'get') request.result = structuredClone(data.get(key));
        if (kind === 'put') { data.set(key, value); request.result = key; }
        if (kind === 'delete') data.delete(key);
        request.onsuccess?.({ target: request });
        if (!ended) run();
      });
    }
    waiting.push(tx);
    setImmediate(pump);
    return tx;
  }

  const database = {
    objectStoreNames: { contains: (name) => created && name === 'drafts' },
    createObjectStore(name, settings) {
      assert.equal(name, 'drafts');
      assert.deepEqual(settings, { keyPath: 'key' });
      created = true;
    },
    transaction(name, mode, settings) {
      assert.equal(name, 'drafts');
      events.push(['transaction', mode, settings]);
      if (options.noDurability && settings) throw new TypeError('Options non prises en charge dans la simulation.');
      if (options.transactionError) throw options.transactionError;
      return createTransaction(mode);
    },
    close() { closed++; },
  };
  const factory = {
    open(name, version) {
      assert.equal(name, 'amphixdocs-upload-drafts');
      assert.equal(version, 1);
      if (options.openThrow) throw options.openThrow;
      const request = { result: database, error: null, onupgradeneeded: null, onblocked: null, onerror: null, onsuccess: null };
      setImmediate(() => {
        if (options.hangOpen) return;
        if (options.blocked) { request.onblocked?.({ target: request }); request.onsuccess?.({ target: request }); return; }
        if (options.openError) { request.error = options.openError; request.onerror?.({ target: request }); return; }
        if (!created) request.onupgradeneeded?.({ target: request });
        request.onsuccess?.({ target: request });
      });
      return request;
    },
  };
  return {
    factory, values, events, options, commitReady: commitReady.promise, getReady: getReady.promise,
    get closed() { return closed; },
    commit() { assert.ok(pendingCommit, 'Une transaction attend sa confirmation.'); const finish = pendingCommit; pendingCommit = null; finish(); },
  };
}

const file = (contents = 'test', name = 'cours.pdf') => new File([contents], name, { type: 'application/pdf', lastModified });
const hashFile = async (value) => createHash('sha256').update(Buffer.from(await value.arrayBuffer())).digest('hex');
function input(overrides = {}) {
  return {
    files: [file()], titles: ['Cours'], description: 'Une description', schoolName: 'EPAC', subjectName: 'Mathématiques', batch: null,
    ...overrides,
  };
}
function batch(id = batchId, contents = 'test') {
  const attachment = file(contents);
  const documentId = '33333333-3333-4333-8333-333333333333';
  return batches.createUploadBatch(scope.userId, scope.projectUrl, [{ file: attachment, request: {
    identity: { id: documentId, filePath: `${scope.userId}/${documentId}-cours.pdf` }, userId: scope.userId,
    title: 'Cours', description: 'Une description', fileName: attachment.name, fileSize: attachment.size, fileType: 'pdf',
    sha256: createHash('sha256').update(contents).digest('hex'), schoolName: 'EPAC', subjectName: 'Mathématiques',
  } }], id);
}
async function complete(value) {
  return batches.runUploadBatch(value, {
    generation: 1, isCurrent: () => true,
    uploadDocument: async (request) => ({ id: request.identity.id, user_id: request.userId, file_path: request.identity.filePath }),
  }, () => {}, () => {});
}
function encoded(overrides = {}) {
  return draft.encodeUploadDraft(scope, input(overrides), 1, lastModified);
}
function legacyBatch() {
  const value = batch();
  const requests = value.entries.map(({ request }) => {
    const { schoolName: _school, subjectName: _subject, ...identity } = request;
    return { ...identity, folderId: null, categoryId: null };
  });
  return batches.restoreUploadBatch(JSON.stringify({
    version: 1, id: value.id, userId: scope.userId, projectUrl: scope.projectUrl, folderRequest: null, requests,
  }), scope.userId, scope.projectUrl);
}

test('le brouillon est isolé par compte et projet, sans clé de session', () => {
  const key = draft.uploadDraftKey(scope);
  assert.equal(key, `${encodeURIComponent(scope.projectUrl)}:${scope.userId}`);
  assert.notEqual(key, draft.uploadDraftKey(otherScope));
  assert.notEqual(key, draft.uploadDraftKey({ ...scope, projectUrl: 'https://autre-projet.invalid' }));
  assert.throws(() => draft.uploadDraftKey({ ...scope, userId: 'invalide' }), /compte du brouillon/);
  assert.throws(() => draft.uploadDraftKey({ ...scope, projectUrl: '' }), /compte du brouillon/);
});

test('encodage puis décodage gardent les octets et toutes les saisies', async () => {
  const source = input();
  const value = draft.decodeUploadDraft(scope, draft.encodeUploadDraft(scope, source, 2, lastModified));
  assert.equal(value.revision, 2);
  assert.equal(value.updatedAt, lastModified);
  for (const field of ['titles', 'description', 'schoolName', 'subjectName']) assert.deepEqual(value[field], source[field]);
  assert.ok(value.files[0] instanceof File);
  assert.equal(value.files[0].name, source.files[0].name);
  assert.equal(value.files[0].type, source.files[0].type);
  assert.equal(value.files[0].lastModified, lastModified);
  assert.deepEqual(await value.files[0].arrayBuffer(), await source.files[0].arrayBuffer());
});

test('la liste blanche exclut clés, session, profil et confirmations locales', async () => {
  const confirmed = await complete(batch());
  confirmed.session = { access_token: 'JETON_FICTIF_A_NE_PAS_CONSERVER' };
  confirmed.entries[0].document.secret = 'PROFIL_FICTIF_A_NE_PAS_CONSERVER';
  const value = draft.encodeUploadDraft({ ...scope, key: 'CLE_FICTIVE' }, input({
    batch: confirmed, access_token: 'JETON_FICTIF_A_NE_PAS_CONSERVER', apiKey: 'CLE_FICTIVE', profile: { email: 'test@example.invalid' },
  }), 1);
  assert.deepEqual(Object.keys(value).sort(), [
    'attachments', 'batch', 'description', 'files', 'key', 'projectUrl', 'revision', 'schoolName', 'subjectName', 'titles', 'updatedAt', 'userId', 'version',
  ]);
  assert.doesNotMatch(JSON.stringify(value), /JETON_FICTIF|CLE_FICTIVE|PROFIL_FICTIF|access_token|confirmed|test@example/);
  const restored = draft.decodeUploadDraft(scope, structuredClone(value));
  assert.equal(restored.batch.entries[0].status, 'pending');
  assert.equal(restored.batch.entries[0].stage, 'verification');
  assert.equal(restored.batch.entries[0].document, null);
  assert.equal(await restored.batch.entries[0].file.text(), 'test');
});

test('des données corrompues ou d’un autre scope ne deviennent pas un brouillon vide', () => {
  const original = encoded();
  for (const invalid of [
    null, {}, { ...original, version: 2 }, { ...original, revision: 0 }, { ...original, revision: 1.5 },
    { ...original, updatedAt: NaN }, { ...original, titles: [] }, { ...original, attachments: null },
    { ...original, description: 'x'.repeat(201) }, { ...original, schoolName: 'x'.repeat(121) },
    { ...original, subjectName: 'x'.repeat(121) }, { ...original, batch: {} },
  ]) assert.throws(() => draft.decodeUploadDraft(scope, invalid), /ne peut pas être lu/);
  assert.throws(() => draft.decodeUploadDraft(otherScope, original), /ne peut pas être lu/);
  assert.throws(() => draft.encodeUploadDraft(scope, input({ files: [], titles: ['Titre'] }), 1), /saisies/);
  assert.throws(() => draft.encodeUploadDraft(otherScope, input({ batch: batch() }), 1), /autre dépôt/);
});

test('les bornes des saisies utilisent des points de code et le fichier reste limité à 20 Mo', () => {
  assert.equal(draft.decodeUploadDraft(scope, encoded({ description: '🙂'.repeat(200), schoolName: 'é'.repeat(120) })).description.length, 400);
  assert.throws(() => encoded({ description: '🙂'.repeat(201) }), /saisies/);
  const invalid = encoded();
  invalid.files[0].lastModified = Infinity;
  assert.throws(() => draft.decodeUploadDraft(scope, invalid), /fichier du brouillon/);
  assert.throws(() => encoded({ files: [new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'trop-grand.pdf')], titles: ['Titre'] }), /fichier ne peut pas être conservé/);
});

test('les pièces jointes conservent l’identité et refusent doublons ou nom/taille incompatibles', () => {
  const original = encoded({ batch: batch() });
  const duplicate = structuredClone(original);
  duplicate.attachments.push(structuredClone(duplicate.attachments[0]));
  assert.throws(() => draft.decodeUploadDraft(scope, duplicate), /fichiers du dépôt/);
  for (const change of [{ id: otherBatchId }, { file: { ...original.attachments[0].file, name: 'autre.pdf' } },
    { file: { ...original.attachments[0].file, blob: new Blob(['plus long']) } }]) {
    const value = structuredClone(original);
    Object.assign(value.attachments[0], change);
    assert.throws(() => draft.decodeUploadDraft(scope, value), /autre dépôt/);
  }
});

test('l’absence est distincte d’une lecture refusée et les connexions sont fermées', async () => {
  const memory = memoryIndexedDb();
  assert.equal(await draft.readUploadDraft(scope, memory.factory), null);
  assert.equal(memory.closed, 1);
  memory.options.getError = new DOMException('Lecture simulée refusée.', 'UnknownError');
  await assert.rejects(draft.readUploadDraft(scope, memory.factory), /Lecture simulée refusée/);
  assert.equal(memory.closed, 2);
});

test('une sauvegarde n’est confirmée qu’après commit de la transaction', async () => {
  const memory = memoryIndexedDb({ pauseWriteCommit: true });
  let resolved = false;
  const pending = draft.saveUploadDraft(scope, input(), null, memory.factory).then((value) => { resolved = true; return value; });
  await memory.commitReady;
  assert.equal(resolved, false);
  assert.equal(memory.values.size, 0);
  memory.commit();
  assert.equal((await pending).revision, 1);
  assert.equal(memory.values.size, 1);
  assert.equal(memory.closed, 1);
});

test('les sauvegardes FIFO figent les tableaux et le scope au moment de l’appel', async () => {
  const memory = memoryIndexedDb();
  const mutableScope = { ...scope };
  const persistence = draft.createUploadDraftPersistence(mutableScope, memory.factory);
  await persistence.read();
  mutableScope.userId = otherScope.userId;
  const first = input({ titles: ['Premier'] });
  const pending = persistence.save(first);
  first.files.length = 0;
  first.titles[0] = 'Muté après appel';
  const second = persistence.save(input({ titles: ['Deuxième'] }));
  assert.equal((await pending).titles[0], 'Premier');
  assert.equal((await second).revision, 2);
  const stored = await draft.readUploadDraft(scope, memory.factory);
  assert.equal(stored.titles[0], 'Deuxième');
  assert.equal(await draft.readUploadDraft(otherScope, memory.factory), null);
});

test('un ancien onglet ne remplace pas la révision d’un autre et doit relire avant sauvegarde', async () => {
  const memory = memoryIndexedDb();
  const first = draft.createUploadDraftPersistence(scope, memory.factory);
  const second = draft.createUploadDraftPersistence(scope, memory.factory);
  await Promise.all([first.read(), second.read()]);
  await first.save(input({ description: 'Premier onglet' }));
  await assert.rejects(second.save(input({ description: 'Ancien onglet' })), /autre dépôt/);
  assert.equal((await draft.readUploadDraft(scope, memory.factory)).description, 'Premier onglet');
  assert.equal((await second.read()).revision, 1);
  assert.equal((await second.save(input({ description: 'Choix après relecture' }))).revision, 2);
});

test('une transaction échouée ne modifie rien et la queue permet le réessai', async () => {
  const memory = memoryIndexedDb({ quota: true });
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  await assert.rejects(persistence.save(input()), /Quota simulé/);
  assert.equal(memory.values.size, 0);
  memory.options.quota = false;
  assert.equal((await persistence.save(input())).revision, 1);
  assert.ok(memory.events.some(([name]) => name === 'abort'));
});

test('un lot figé ne peut pas être effacé ou remplacé pendant une sauvegarde', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  await persistence.save(input({ batch: batch() }));
  await assert.rejects(persistence.save(input({ batch: null })), /autre dépôt/);
  await assert.rejects(persistence.save(input({ batch: batch(otherBatchId) })), /autre dépôt/);
  assert.equal((await draft.readUploadDraft(scope, memory.factory)).batch.id, batchId);
});

test('le retrait exige le lot complet exact et permet ensuite un nouveau brouillon', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  const pending = batch();
  await persistence.save(input({ batch: pending }));
  await assert.rejects(persistence.clear(pending), /autre dépôt/);
  await assert.rejects(persistence.clear(await complete(batch(otherBatchId))), /autre dépôt/);
  assert.equal(memory.values.size, 1);
  await persistence.clear(await complete(pending));
  assert.equal(await persistence.read(), null);
  assert.equal((await persistence.save(input({ titles: ['Nouveau'] }))).revision, 1);
  assert.equal((await persistence.read()).titles[0], 'Nouveau');
});

test('un retrait tardif n’efface pas une sauvegarde plus récente ni un autre compte', async () => {
  const memory = memoryIndexedDb();
  const value = batch();
  await draft.saveUploadDraft(scope, input({ batch: value }), null, memory.factory);
  await draft.saveUploadDraft(scope, input({ batch: value, description: 'Plus récent' }), 1, memory.factory);
  await draft.saveUploadDraft(otherScope, input(), null, memory.factory);
  await assert.rejects(draft.clearCompletedUploadDraft(scope, await complete(value), 1, memory.factory), /autre dépôt/);
  assert.equal(memory.values.size, 2);
});

test('la durabilité stricte utilise un fallback seulement si les options sont indisponibles', async () => {
  const memory = memoryIndexedDb({ noDurability: true });
  await draft.saveUploadDraft(scope, input(), null, memory.factory);
  const attempts = memory.events.filter(([name]) => name === 'transaction');
  assert.deepEqual(attempts.map((entry) => entry.slice(1)), [['readwrite', { durability: 'strict' }], ['readwrite', undefined]]);
  const denied = memoryIndexedDb({ transactionError: new DOMException('Transaction refusée.', 'SecurityError') });
  await assert.rejects(draft.readUploadDraft(scope, denied.factory), /Transaction refusée/);
  assert.equal(denied.closed, 1);
});

test('ouverture bloquée, exception et indisponibilité restent des erreurs actionnables', async () => {
  const blocked = memoryIndexedDb({ blocked: true });
  await assert.rejects(draft.readUploadDraft(scope, blocked.factory), /Fermez les autres onglets/);
  assert.equal(blocked.closed, 1, 'Une ouverture tardive doit fermer sa connexion.');
  for (const options of [{ openError: new DOMException('Ouverture refusée.', 'SecurityError') }, { openThrow: new Error('Ouverture refusée.') }]) {
    await assert.rejects(draft.readUploadDraft(scope, memoryIndexedDb(options).factory), /Ouverture refusée/);
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  try {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get: () => { throw new DOMException('Bloqué.', 'SecurityError'); } });
    await assert.rejects(draft.readUploadDraft(scope), /ne peut pas être conservé sur cet appareil/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});

test('une ouverture suspendue expire sans présenter une absence', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = assert.rejects(draft.readUploadDraft(scope, memoryIndexedDb({ hangOpen: true }).factory), /trop de temps à s’ouvrir/);
  t.mock.timers.tick(10000);
  await pending;
});

test('une transaction suspendue expire, annule la sauvegarde et ferme la connexion', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const memory = memoryIndexedDb({ hangGet: true });
  const pending = assert.rejects(draft.saveUploadDraft(scope, input(), null, memory.factory), /trop de temps à s’enregistrer/);
  await memory.getReady;
  t.mock.timers.tick(10000);
  await pending;
  assert.equal(memory.values.size, 0);
  assert.equal(memory.closed, 1);
});

test('la réconciliation conserve seulement les confirmations encore en mémoire', async () => {
  const confirmed = await complete(batch());
  const stored = draft.decodeUploadDraft(scope, encoded({ batch: confirmed }));
  const journal = batches.restoreUploadBatch(batches.serializeUploadBatch(confirmed), scope.userId, scope.projectUrl);
  const reloaded = await draft.reconcileUploadDraftBatch(scope, stored, journal, null, hashFile);
  assert.equal(reloaded.entries[0].status, 'pending');
  assert.equal(reloaded.entries[0].document, null);
  assert.equal(await reloaded.entries[0].file.text(), 'test');
  const inMemory = await draft.reconcileUploadDraftBatch(scope, stored, journal, confirmed, hashFile);
  assert.equal(inMemory.entries[0].status, 'confirmed');
  assert.deepEqual(inMemory.entries[0].document, confirmed.entries[0].document);
});

test('une coupure entre journal et brouillon réattache les octets après vérification du hash', async () => {
  const stored = draft.decodeUploadDraft(scope, encoded());
  const journal = batches.restoreUploadBatch(batches.serializeUploadBatch(batch()), scope.userId, scope.projectUrl);
  const hashes = [];
  const result = await draft.reconcileUploadDraftBatch(scope, stored, journal, null, async (attachment) => {
    hashes.push(attachment.name); return hashFile(attachment);
  });
  assert.deepEqual(hashes, ['cours.pdf']);
  assert.equal(await result.entries[0].file.text(), 'test');
  assert.deepEqual(result.entries[0].request, journal.entries[0].request);
  assert.equal(result.entries[0].status, 'pending');
  const incompatible = draft.decodeUploadDraft(scope, encoded({ files: [file('faux')] }));
  await assert.rejects(draft.reconcileUploadDraftBatch(scope, incompatible, journal, null, hashFile), {
    message: 'Le contenu de « cours.pdf » diffère du fichier d’origine. Aucun fichier n’a été remplacé.',
  });
});

test('la complétion legacy est rapprochée dans les deux sens sans modifier les identités', async () => {
  const before = legacyBatch();
  const after = batches.completeLegacyClassification(before, 'EPAC', 'Mathématiques');
  for (const [storedBatch, journal] of [[before, after], [after, before]]) {
    const stored = draft.decodeUploadDraft(scope, encoded({ batch: storedBatch }));
    const result = await draft.reconcileUploadDraftBatch(scope, stored, journal, null, hashFile);
    assert.equal(result.entries[0].request.schoolName, 'EPAC');
    assert.equal(result.entries[0].request.subjectName, 'Mathématiques');
    assert.deepEqual(result.entries[0].request.identity, before.entries[0].request.identity);
    assert.equal(result.entries[0].request.sha256, before.entries[0].request.sha256);
  }
});

test('la réconciliation ne remplace jamais un autre lot, contenu, compte ou projet', async () => {
  const stored = draft.decodeUploadDraft(scope, encoded({ batch: batch() }));
  await assert.rejects(draft.reconcileUploadDraftBatch(scope, stored, batch(otherBatchId), null, hashFile), /autre dépôt/);
  await assert.rejects(draft.reconcileUploadDraftBatch(scope, stored, batch(batchId, 'faux'), null, hashFile), /autre dépôt/);
  await assert.rejects(draft.reconcileUploadDraftBatch(otherScope, stored, null, null, hashFile), /autre dépôt/);
  await assert.rejects(draft.reconcileUploadDraftBatch(scope, null, { ...batch(), projectUrl: 'https://autre.invalid' }, null, hashFile), /autre dépôt/);
  assert.equal(await draft.reconcileUploadDraftBatch(scope, null, null, null, hashFile), null);
});
