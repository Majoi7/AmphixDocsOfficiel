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
        if (kind === 'get') {
          options.onGet?.(key, mode);
          request.result = structuredClone(data.get(key));
        }
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

const retryOptions = (overrides = {}) => ({ readJournal: () => null, hashFile, isCurrent: () => true, ...overrides });
const storedRecord = (memory) => structuredClone(memory.values.get(draft.uploadDraftKey(scope)));
const writes = (memory) => memory.events.filter(([kind]) => kind === 'put').length;

test('sauvegarde et reprise exigent une lecture confirmée, y compris après une relecture échouée', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await assert.rejects(persistence.save(input()), /doit d’abord être vérifié/);
  await assert.rejects(persistence.retry(input(), retryOptions()), /doit d’abord être vérifié/);
  assert.equal(memory.events.length, 0);
  await persistence.read();
  memory.options.getError = new Error('Relecture refusée.');
  await assert.rejects(persistence.read(), /Relecture refusée/);
  memory.options.getError = null;
  await assert.rejects(persistence.retry(input(), retryOptions()), /doit d’abord être vérifié/);
  await persistence.read();
  assert.equal((await persistence.retry(input(), retryOptions())).revision, 1);
});

test('le garde interdit une sauvegarde obsolète avant ouverture et avant put', async () => {
  const memory = memoryIndexedDb();
  await assert.rejects(draft.saveUploadDraft(scope, input(), null, memory.factory, () => false), /compte du dépôt a changé/);
  assert.equal(memory.events.length, 0);
  let current = true;
  memory.options.onGet = () => { current = false; };
  await assert.rejects(draft.saveUploadDraft(scope, input(), null, memory.factory, () => current), /compte du dépôt a changé/);
  assert.equal(memory.values.size, 0);
  assert.equal(writes(memory), 0);
  assert.ok(memory.events.some(([kind]) => kind === 'abort'));
  assert.equal(memory.closed, 1);
});

test('le garde est transmis aux sauvegardes FIFO sans condamner la file après une erreur', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  await assert.rejects(persistence.save(input(), () => false), /compte du dépôt a changé/);
  assert.equal(memory.values.size, 0);
  const first = persistence.save(input({ titles: ['Premier'] }), () => true);
  const second = persistence.save(input({ titles: ['Deuxième'] }), () => true);
  assert.equal((await first).revision, 1);
  assert.equal((await second).revision, 2);
  assert.equal((await draft.readUploadDraft(scope, memory.factory)).titles[0], 'Deuxième');
});

test('le contrôle du lot et du scope utilise la copie encodée avant les attentes', async () => {
  const memory = memoryIndexedDb();
  const original = batch();
  await draft.saveUploadDraft(scope, input({ batch: original }), null, memory.factory);
  const mutableScope = { ...scope };
  const replacement = input({ batch: batch(otherBatchId) });
  memory.options.onGet = () => { replacement.batch = original; mutableScope.userId = otherScope.userId; };
  await assert.rejects(draft.saveUploadDraft(mutableScope, replacement, 1, memory.factory), /autre dépôt/);
  assert.equal(storedRecord(memory).batch, batches.serializeUploadBatch(original));
  memory.options.onGet = null;
  const validScope = { ...scope };
  const valid = input({ titles: ['Copie capturée'], batch: original });
  const pending = draft.saveUploadDraft(validScope, valid, 1, memory.factory);
  validScope.userId = otherScope.userId;
  valid.batch = batch(otherBatchId);
  valid.titles[0] = 'Modification tardive';
  assert.equal((await pending).titles[0], 'Copie capturée');
  assert.equal(storedRecord(memory).userId, scope.userId);
  assert.equal(storedRecord(memory).batch, batches.serializeUploadBatch(original));
});

test('Réessayer relit une révision compatible et conserve les saisies locales', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  await persistence.save(input());
  const confirmed = storedRecord(memory);
  memory.values.set(confirmed.key, { ...confirmed, revision: 2 });
  const local = input({ titles: ['Titre local'], description: 'Saisie locale' });
  await assert.rejects(persistence.save(local), /autre dépôt/);
  const before = writes(memory);
  const saved = await persistence.retry(local, retryOptions());
  assert.equal(saved.revision, 3);
  assert.equal(saved.titles[0], 'Titre local');
  assert.equal(saved.description, 'Saisie locale');
  assert.equal(await saved.files[0].text(), 'test');
  assert.equal(writes(memory), before + 1);
  assert.equal((await persistence.save(input({ description: 'Saisie suivante' }))).revision, 4);
});

test('une copie déjà identique aux saisies locales peut être confirmée après réponse perdue', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  const local = input({ titles: ['Titre déjà sauvé'], description: 'Réponse locale perdue' });
  memory.values.set(draft.uploadDraftKey(scope), draft.encodeUploadDraft(scope, local, 1, lastModified));
  await assert.rejects(persistence.save(local), /autre dépôt/);
  const saved = await persistence.retry(local, retryOptions());
  assert.equal(saved.revision, 2);
  assert.equal(saved.description, local.description);
});

test('une reprise copie les tableaux à l’appel et attend le commit avant confirmation', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  memory.options.pauseWriteCommit = true;
  const local = input({ titles: ['Titre capturé'] });
  let resolved = false;
  const pending = persistence.retry(local, retryOptions()).then((value) => { resolved = true; return value; });
  local.files.length = 0;
  local.titles[0] = 'Muté après appel';
  await memory.commitReady;
  assert.equal(resolved, false);
  assert.equal(memory.values.size, 0);
  memory.commit();
  const saved = await pending;
  assert.equal(saved.titles[0], 'Titre capturé');
  assert.equal(await saved.files[0].text(), 'test');
});

test('Réessayer ne remplace pas les champs ou les octets d’un autre onglet', async () => {
  for (const changes of [{ titles: ['Autre titre'] }, { description: 'Autre description' }, { schoolName: 'IFRI' },
    { subjectName: 'Anglais' }, { files: [file('faux')] }, { files: [file('test', 'autre.pdf')] }]) {
    const memory = memoryIndexedDb();
    const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
    await persistence.read();
    await persistence.save(input());
    const newer = draft.encodeUploadDraft(scope, input(changes), 2, lastModified);
    memory.values.set(newer.key, newer);
    const before = writes(memory);
    const local = input({ description: 'Saisie dans cet onglet' });
    await assert.rejects(persistence.retry(local, retryOptions()), /autre dépôt/);
    assert.deepEqual(storedRecord(memory), newer);
    assert.equal(writes(memory), before);
    assert.equal(local.description, 'Saisie dans cet onglet');
    await assert.rejects(persistence.save(local), /autre dépôt/);
  }
});

test('la dernière copie confirmée ne partage pas ses tableaux avec le résultat rendu', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  const rendered = await persistence.save(input());
  rendered.titles[0] = 'Titre étranger';
  const newer = draft.encodeUploadDraft(scope, input({ titles: ['Titre étranger'] }), 2, lastModified);
  memory.values.set(newer.key, newer);
  await assert.rejects(persistence.retry(input({ description: 'Saisie locale' }), retryOptions()), /autre dépôt/);
  assert.deepEqual(storedRecord(memory), newer);
});

test('une panne temporaire de quota ou de lecture conserve les saisies et permet la reprise', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  await persistence.save(input());
  const local = input({ titles: ['À conserver'] });
  memory.options.quota = true;
  await assert.rejects(persistence.retry(local, retryOptions()), /Quota simulé/);
  assert.equal(storedRecord(memory).revision, 1);
  memory.options.quota = false;
  memory.options.getError = new Error('Relecture temporairement refusée.');
  await assert.rejects(persistence.retry(local, retryOptions()), /Relecture temporairement refusée/);
  assert.equal(storedRecord(memory).revision, 1);
  memory.options.getError = null;
  const saved = await persistence.retry(local, retryOptions());
  assert.equal(saved.revision, 2);
  assert.equal(saved.titles[0], 'À conserver');
});

test('un autre lot IndexedDB ou journal est bloqué sans adoption silencieuse', async () => {
  for (const hasLocalBatch of [false, true]) {
    for (const source of ['draft', 'journal']) {
      const memory = memoryIndexedDb();
      const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
      await persistence.read();
      const local = input({ batch: hasLocalBatch ? batch() : null });
      await persistence.save(local);
      const other = batch(otherBatchId);
      if (source === 'draft') memory.values.set(draft.uploadDraftKey(scope), draft.encodeUploadDraft(scope, input({ batch: other }), 2, lastModified));
      const before = storedRecord(memory);
      const beforeWrites = writes(memory);
      await assert.rejects(persistence.retry(local, retryOptions({ readJournal: () => source === 'journal' ? other : null })), /autre dépôt/);
      assert.deepEqual(storedRecord(memory), before);
      assert.equal(writes(memory), beforeWrites);
    }
  }
});

test('la reprise répare la coupure journal/brouillon avec les mêmes identités et octets', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  await persistence.save(input());
  const localBatch = batch();
  const journal = batches.restoreUploadBatch(batches.serializeUploadBatch(localBatch), scope.userId, scope.projectUrl);
  const saved = await persistence.retry(input({ batch: localBatch }), retryOptions({ readJournal: () => journal }));
  assert.equal(saved.revision, 2);
  assert.equal(saved.batch.id, batchId);
  assert.deepEqual(saved.batch.entries[0].request, localBatch.entries[0].request);
  assert.equal(await saved.batch.entries[0].file.text(), 'test');
  const restored = await draft.readUploadDraft(scope, memory.factory);
  assert.equal(await restored.batch.entries[0].file.text(), 'test');
  assert.equal(restored.batch.entries[0].status, 'pending');
});

test('une reprise conserve les confirmations mémoire sans les enregistrer comme preuves', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  const confirmed = await complete(batch());
  await persistence.save(input({ batch: confirmed }));
  const journal = batches.restoreUploadBatch(batches.serializeUploadBatch(confirmed), scope.userId, scope.projectUrl);
  const saved = await persistence.retry(input({ batch: confirmed }), retryOptions({ readJournal: () => journal }));
  assert.equal(saved.batch.entries[0].status, 'confirmed');
  assert.deepEqual(saved.batch.entries[0].document, confirmed.entries[0].document);
  const restored = await draft.readUploadDraft(scope, memory.factory);
  assert.equal(restored.batch.entries[0].status, 'pending');
  assert.equal(restored.batch.entries[0].document, null);
});

test('la reprise rapproche la complétion legacy sans changer UUID, chemin ou hash', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  const original = legacyBatch();
  await persistence.save(input({ batch: original, schoolName: '', subjectName: '' }));
  const classified = batches.completeLegacyClassification(original, 'IFRI', 'Anglais');
  const newer = draft.encodeUploadDraft(scope, input({ batch: classified, schoolName: 'IFRI', subjectName: 'Anglais' }), 2, lastModified);
  memory.values.set(newer.key, newer);
  const saved = await persistence.retry(input({ batch: original, schoolName: 'EPAC', subjectName: 'Mathématiques' }), retryOptions({ readJournal: () => original }));
  const request = saved.batch.entries[0].request;
  assert.equal(saved.revision, 3);
  assert.equal(saved.schoolName, 'IFRI');
  assert.equal(saved.subjectName, 'Anglais');
  assert.deepEqual(request.identity, original.entries[0].request.identity);
  assert.equal(request.sha256, original.entries[0].request.sha256);
  assert.equal(request.schoolName, 'IFRI');
  assert.equal(request.subjectName, 'Anglais');
});

test('un changement de compte bloque la reprise avant lecture et juste après la relecture', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  const beforeEvents = memory.events.length;
  await assert.rejects(persistence.retry(input(), retryOptions({ isCurrent: () => false })), /compte du dépôt a changé/);
  assert.equal(memory.events.length, beforeEvents);
  let current = true;
  memory.options.onGet = () => { current = false; };
  await assert.rejects(persistence.retry(input(), retryOptions({ isCurrent: () => current })), /compte du dépôt a changé/);
  assert.equal(writes(memory), 0);
  memory.options.onGet = null;
  assert.equal((await persistence.retry(input(), retryOptions())).revision, 1);
});

test('un changement de compte pendant le hash n’écrit pas la reprise tardive', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  await persistence.save(input());
  let current = true;
  let hashes = 0;
  const before = storedRecord(memory);
  await assert.rejects(persistence.retry(input({ description: 'Saisie locale' }), retryOptions({
    isCurrent: () => current,
    hashFile: async (value) => { hashes++; current = false; return hashFile(value); },
  })), /compte du dépôt a changé/);
  assert.ok(hashes > 0);
  assert.deepEqual(storedRecord(memory), before);
});

test('un changement de compte juste avant put annule la reprise atomiquement', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  await persistence.save(input());
  const before = storedRecord(memory);
  let current = true;
  memory.options.onGet = (_key, mode) => { if (mode === 'readwrite') current = false; };
  await assert.rejects(persistence.retry(input({ description: 'Saisie locale' }), retryOptions({ isCurrent: () => current })), /compte du dépôt a changé/);
  assert.deepEqual(storedRecord(memory), before);
  assert.equal(writes(memory), 1);
  assert.ok(memory.events.some(([kind]) => kind === 'abort'));
});

test('une nouvelle révision entre relecture et transaction reste un conflit, sans écrasement', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  await persistence.save(input());
  const other = draft.encodeUploadDraft(scope, input({ description: 'Autre onglet' }), 2, lastModified);
  let changed = false;
  await assert.rejects(persistence.retry(input({ description: 'Saisie locale' }), retryOptions({
    hashFile: async (value) => {
      if (!changed) { memory.values.set(other.key, other); changed = true; }
      return hashFile(value);
    },
  })), /autre dépôt/);
  assert.deepEqual(storedRecord(memory), other);
  assert.equal(writes(memory), 1);
});

test('le journal modifié pendant la réconciliation est refusé avant toute sauvegarde', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  await persistence.save(input());
  const journal = batches.restoreUploadBatch(batches.serializeUploadBatch(batch()), scope.userId, scope.projectUrl);
  const original = batches.serializeUploadBatch(journal);
  let hashes = 0;
  const before = storedRecord(memory);
  await assert.rejects(persistence.retry(input({ batch: batch() }), retryOptions({
    readJournal: () => journal,
    hashFile: async (value) => {
      hashes++;
      if (hashes === 3) journal.entries[0].request.title = 'Modifié pendant attente';
      return hashFile(value);
    },
  })), /autre dépôt/);
  assert.ok(hashes >= 3);
  assert.notEqual(batches.serializeUploadBatch(journal), original);
  assert.deepEqual(storedRecord(memory), before);
});

test('le journal est revérifié dans la transaction juste avant put', async () => {
  const memory = memoryIndexedDb();
  const persistence = draft.createUploadDraftPersistence(scope, memory.factory);
  await persistence.read();
  const local = input({ batch: batch() });
  await persistence.save(local);
  let journal = batch();
  memory.options.onGet = (_key, mode) => { if (mode === 'readwrite') journal = batch(otherBatchId); };
  const before = storedRecord(memory);
  await assert.rejects(persistence.retry(local, retryOptions({ readJournal: () => journal })), /autre dépôt/);
  assert.deepEqual(storedRecord(memory), before);
  assert.equal(writes(memory), 1);
});
