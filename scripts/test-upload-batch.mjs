import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// Modules de production, aucun SDK ni réseau réel : les imports Supabase sont
// des imports de types. Vite ne lit ni sa configuration d’application ni .env.
const root = fileURLToPath(new URL('../', import.meta.url));
const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '99999999-9999-4999-8999-999999999999';
const projectUrl = 'https://upload-batch-test.invalid';
const batchId = '77777777-7777-4777-8777-777777777777';
const secondBatchId = '88888888-8888-4888-8888-888888888888';
let server;
let library;
let networkAttempts = 0;
const originalFetch = globalThis.fetch;

before(async () => {
  globalThis.fetch = async () => { networkAttempts++; throw new Error('Réseau interdit dans les tests de lot.'); };
  server = await createServer({
    root, configFile: false, envDir: false,
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error',
  });
  library = await server.ssrLoadModule('/src/lib/upload-batch.ts');
});
after(async () => {
  try { await server?.close(); assert.equal(networkAttempts, 0); }
  finally { globalThis.fetch = originalFetch; }
});

function prepared(index = 1, overrides = {}, contents = 'test') {
  const id = `${String(index).padStart(8, '0')}-3333-4333-8333-333333333333`;
  const fileName = overrides.fileName || `cours-${index}.pdf`;
  const file = new File([contents], fileName, { type: 'application/pdf' });
  const request = {
    identity: { id, filePath: `${userId}/${id}-${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}` },
    userId, title: `Cours ${index}`, description: '', fileName, fileSize: file.size, fileType: 'pdf',
    sha256: createHash('sha256').update(contents).digest('hex'), schoolName: 'École de test', subjectName: 'Mathématiques',
    ...overrides,
  };
  return { request, file };
}
function documentFrom(request) {
  return {
    id: request.identity.id, user_id: request.userId, title: request.title,
    description: request.description || null, file_name: request.fileName, file_path: request.identity.filePath,
    file_size: request.fileSize, file_type: request.fileType, school_name: request.schoolName,
    subject_name: request.subjectName, deleted_at: null, deleted_by: null, status: 'pending', rejection_reason: null,
    reviewed_by: null, reviewed_at: null, created_at: '2026-01-01T00:00:00Z', thumbnail_path: null, page_count: null,
  };
}
function batch(entries = [prepared()], id = batchId) {
  return library.createUploadBatch(userId, projectUrl, entries, id);
}
function dependencies(overrides = {}) {
  return {
    generation: 4, isCurrent: () => true,
    uploadDocument: async (request, _file, stage) => {
      stage('transfert'); stage('enregistrement'); stage('termine');
      return documentFrom(request);
    },
    ...overrides,
  };
}
const failure = (kind) => Object.assign(new Error(`Panne locale ${kind}`), { kind });
const noChange = () => {};
function memoryStorage() {
  const values = new Map();
  return {
    values, getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key),
  };
}
async function complete(value) {
  return library.runUploadBatch(value, dependencies(), noChange, noChange);
}

 test('un lot neuf valide ses identités et n’accepte pas une sélection vide', () => {
  assert.throws(() => batch([]), /au moins un fichier/);
  const item = prepared();
  const result = batch([item]);
  assert.equal(result.id, batchId);
  assert.deepEqual(result.entries[0].request, item.request);
  assert.equal(result.entries[0].attempted, false);
  assert.equal(result.entries[0].status, 'pending');
  assert.equal(result.entries[0].stage, 'preparation');
  assert.equal(library.isUploadBatchComplete(result), false);
});

test('trois réussites remontent cumulativement, sous les mêmes identifiants', async () => {
  const entries = [1, 2, 3].map((index) => prepared(index));
  const value = batch(entries);
  const calls = [];
  const reports = [];
  const changes = [];
  const result = await library.runUploadBatch(value, dependencies({
    uploadDocument: async (request, file, stage, project, mode) => {
      calls.push(['document', request.identity.id, project, mode]);
      assert.equal(file, entries.find((entry) => entry.request.identity.id === request.identity.id).file);
      stage('transfert'); stage('enregistrement'); return documentFrom(request);
    },
  }), (next) => changes.push(next), (report) => reports.push(report));
  assert.deepEqual(calls.map((call) => call.slice(1)),
    entries.map(({ request }) => [request.identity.id, projectUrl, 'initial']));
  assert.deepEqual(reports.map((report) => report.documents.length), [1, 2, 3, 3]);
  assert.ok(reports.every((report) => report.userId === userId && report.projectUrl === projectUrl && report.generation === 4));
  assert.equal(reports.at(-1).complete, true);
  assert.ok(changes.some((next) => next.entries.some((entry) => entry.stage === 'transfert')));
  assert.ok(result.entries.every((entry) => entry.status === 'confirmed' && entry.document.status === 'pending'));
  assert.equal(library.isUploadBatchComplete(result), true);
  assert.deepEqual(value.entries.map((entry) => entry.status), ['pending', 'pending', 'pending']);
});

test('l’aperçu facultatif utilise le même original après confirmation puis remonte les pages réelles', async () => {
  const entry = prepared();
  const order = [];
  const reports = [];
  const changes = [];
  const result = await library.runUploadBatch(batch([entry]), dependencies({
    uploadDocument: async (request, file) => {
      assert.equal(file, entry.file);
      order.push('original');
      return documentFrom(request);
    },
    completePreview: async (document, file) => {
      order.push('aperçu');
      assert.equal(file, entry.file);
      assert.equal(changes.at(-1).entries[0].status, 'confirmed');
      assert.equal(changes.at(-1).entries[0].error, null);
      return { ...document, thumbnail_path: `${userId}/${document.id}/${'a'.repeat(64)}.jpg`, page_count: 24 };
    },
  }), (value) => changes.push(value), (report) => reports.push(report));
  assert.deepEqual(order, ['original', 'aperçu']);
  assert.equal(result.entries[0].request.identity.id, entry.request.identity.id);
  assert.equal(result.entries[0].document.page_count, 24);
  assert.equal(result.entries[0].document.thumbnail_path, `${userId}/${entry.request.identity.id}/${'a'.repeat(64)}.jpg`);
  assert.deepEqual(reports.at(-1).documents, [result.entries[0].document]);
  assert.equal(reports.at(-1).complete, true);
});

test('une panne d’aperçu laisse le dépôt réussi sans message ni renvoi de l’original au réessai', async () => {
  let uploads = 0;
  let previews = 0;
  const reports = [];
  const deps = dependencies({
    uploadDocument: async (request) => { uploads++; return documentFrom(request); },
    completePreview: async () => { previews++; throw new Error('Panne de miniature simulée'); },
  });
  const first = await library.runUploadBatch(batch(), deps, noChange, (report) => reports.push(report));
  assert.equal(library.isUploadBatchComplete(first), true);
  assert.equal(library.canRetryUploadBatch(first), false);
  assert.equal(first.entries[0].error, null);
  assert.equal(first.entries[0].failureKind, null);
  assert.equal(first.notificationError, null);
  assert.equal(first.entries[0].document.thumbnail_path, null);
  assert.equal(first.entries[0].document.page_count, null);
  const retried = await library.runUploadBatch(first, deps, noChange, (report) => reports.push(report));
  assert.equal(uploads, 1);
  assert.equal(previews, 1);
  assert.equal(retried.entries[0].request.identity.id, first.entries[0].request.identity.id);
  assert.equal(reports.at(-1).complete, true);
  assert.doesNotMatch(JSON.stringify(reports), /Panne de miniature/);
});

test('une confirmation d’aperçu incomplète ou d’une autre identité ne remplace pas le succès principal', async () => {
  for (const changes of [
    { id: prepared(2).request.identity.id }, { user_id: otherUserId },
    { file_path: 'autre-original.pdf' }, { file_type: 'image' },
    { deleted_at: '2026-01-03T00:00:00Z' }, { thumbnail_path: null }, { page_count: null },
  ]) {
    const result = await library.runUploadBatch(batch(), dependencies({
      completePreview: async (document) => ({
        ...document, thumbnail_path: `${userId}/${document.id}/${'a'.repeat(64)}.jpg`, page_count: 3, ...changes,
      }),
    }), noChange, noChange);
    assert.equal(library.isUploadBatchComplete(result), true);
    assert.deepEqual(result.entries[0].document, documentFrom(prepared().request));
    assert.equal(result.entries[0].error, null);
  }
});

test('une réponse d’aperçu d’un ancien compte n’est ni projetée ni publiée', async () => {
  let current = true;
  let uploads = 0;
  const changes = [];
  const reports = [];
  const result = await library.runUploadBatch(batch([prepared(1), prepared(2)]), dependencies({
    isCurrent: () => current,
    uploadDocument: async (request) => { uploads++; return documentFrom(request); },
    completePreview: async (document) => {
      current = false;
      return { ...document, thumbnail_path: `${userId}/${document.id}/${'a'.repeat(64)}.jpg`, page_count: 3 };
    },
  }), (value) => changes.push(value), (report) => reports.push(report));
  assert.equal(uploads, 1);
  assert.equal(reports.length, 0);
  assert.equal(result.entries[0].status, 'confirmed');
  assert.equal(result.entries[0].document.thumbnail_path, null);
  assert.equal(result.entries[1].status, 'pending');
  assert.ok(changes.every((value) => !value.entries[0].document?.thumbnail_path));
});

test('les autres formats et les aperçus déjà complets ne lancent aucune génération', async () => {
  let previews = 0;
  for (const fileType of ['doc', 'autre']) {
    const result = await library.runUploadBatch(batch([prepared(1, { fileType })]), dependencies({
      completePreview: async (document) => { previews++; return document; },
    }), noChange, noChange);
    assert.equal(library.isUploadBatchComplete(result), true);
  }
  await library.runUploadBatch(batch(), dependencies({
    uploadDocument: async (request) => ({ ...documentFrom(request), thumbnail_path: 'historique.webp', page_count: 3 }),
    completePreview: async (document) => { previews++; return document; },
  }), noChange, noChange);
  assert.equal(previews, 0);
});

test('un lot restauré peut compléter son aperçu sans original local ni nouvelle identité', async () => {
  const store = memoryStorage();
  library.saveUploadJournal(store, batch());
  const restored = library.readUploadJournal(store, userId, projectUrl);
  let previews = 0;
  const result = await library.runUploadBatch(restored, dependencies({
    completePreview: async (document, file) => {
      previews++;
      assert.equal(file, undefined);
      assert.equal(document.id, restored.entries[0].request.identity.id);
      return { ...document, thumbnail_path: `${userId}/${document.id}/${'a'.repeat(64)}.jpg`, page_count: 8 };
    },
  }), noChange, noChange);
  assert.equal(previews, 1);
  assert.equal(result.entries[0].document.page_count, 8);
  assert.equal(library.isUploadBatchComplete(result), true);
});

test('une panne au milieu n’empêche pas le fichier suivant et la reprise ne rejoue que l’échec', async () => {
  const entries = [1, 2, 3].map((index) => prepared(index));
  const calls = [];
  const reports = [];
  const first = await library.runUploadBatch(batch(entries), dependencies({
    uploadDocument: async (request, _file, _stage, project, mode) => {
      calls.push([request.identity.id, project, mode]);
      if (request.identity.id === entries[1].request.identity.id) throw failure('retryable');
      return documentFrom(request);
    },
  }), noChange, (report) => reports.push(report));
  assert.deepEqual(first.entries.map((entry) => entry.status), ['confirmed', 'error', 'confirmed']);
  assert.deepEqual(reports.at(-1).documents.map((document) => document.id),
    [entries[0].request.identity.id, entries[2].request.identity.id]);
  assert.equal(library.canRetryUploadBatch(first), true);
  const resumedCalls = [];
  const resumed = await library.runUploadBatch(first, dependencies({
    uploadDocument: async (request, _file, _stage, project, mode) => {
      resumedCalls.push([request.identity.id, project, mode]);
      assert.deepEqual(request, entries[1].request); return documentFrom(request);
    },
  }), noChange, noChange);
  assert.equal(calls.length, 3);
  assert.deepEqual(resumedCalls, [[entries[1].request.identity.id, projectUrl, 'resume']]);
  assert.equal(library.isUploadBatchComplete(resumed), true);
  assert.equal(library.canRetryUploadBatch(resumed), false);
});

test('une exception non typée reste indéterminée, pas un succès', async () => {
  const result = await library.runUploadBatch(batch(), dependencies({
    uploadDocument: async () => { throw new Error('Réponse perdue localement'); },
  }), noChange, noChange);
  assert.equal(result.entries[0].failureKind, 'uncertain');
  assert.equal(result.entries[0].document, null);
  assert.equal(result.entries[0].error, 'L’envoi n’a pas pu être terminé. Réessayez ; les fichiers déjà envoyés sont conservés.');
  assert.doesNotMatch(result.entries[0].error, /Réponse perdue/);
  assert.equal(library.isUploadBatchComplete(result), false);
});

test('la progression décrit les octets, pas une confirmation de document à 100 %', async () => {
  const entry = prepared();
  const changes = [];
  const reports = [];
  const result = await library.runUploadBatch(batch([entry]), dependencies({
    uploadDocument: async (request, file, stage, project, mode, progress) => {
      assert.equal(file, entry.file);
      assert.equal(project, projectUrl);
      assert.equal(mode, 'initial');
      stage('transfert');
      for (const uploadedBytes of [1, request.fileSize, request.fileSize + 10]) {
        progress({ uploadedBytes, totalBytes: request.fileSize, transport: 'standard' });
        const working = changes.at(-1).entries[0];
        assert.equal(working.status, 'working');
        assert.equal(working.document, null);
        assert.equal(working.progress.uploadedBytes, Math.min(uploadedBytes, request.fileSize));
        assert.equal(reports.length, 0, 'Les octets seuls ne publient aucun succès.');
      }
      stage('enregistrement');
      assert.equal(changes.at(-1).entries[0].status, 'working');
      return documentFrom(request);
    },
  }), (value) => changes.push(value), (report) => reports.push(report));
  assert.equal(result.entries[0].status, 'confirmed');
  assert.equal(result.entries[0].progress.totalBytes, entry.file.size);
  assert.equal(result.entries[0].progress.transport, 'standard');
  assert.equal(reports.at(-1).complete, true);
  assert.equal(reports.at(-1).documents.length, 1);
});

test('les compteurs invalides et les callbacks après confirmation sont ignorés', async () => {
  const changes = [];
  let publishProgress;
  const result = await library.runUploadBatch(batch(), dependencies({
    uploadDocument: async (request, _file, stage, _project, _mode, progress) => {
      publishProgress = progress;
      stage('transfert');
      for (const invalid of [
        { uploadedBytes: -1, totalBytes: request.fileSize, transport: 'standard' },
        { uploadedBytes: NaN, totalBytes: request.fileSize, transport: 'standard' },
        { uploadedBytes: Infinity, totalBytes: request.fileSize, transport: 'tus' },
        { uploadedBytes: 1, totalBytes: request.fileSize + 1, transport: 'standard' },
        { uploadedBytes: 1, totalBytes: request.fileSize, transport: 'minuteur' },
      ]) {
        const count = changes.length;
        progress(invalid);
        assert.equal(changes.length, count);
        assert.equal(changes.at(-1).entries[0].progress, null);
      }
      progress({ uploadedBytes: 2, totalBytes: request.fileSize, transport: 'tus' });
      return documentFrom(request);
    },
  }), (value) => changes.push(value), noChange);
  assert.deepEqual(result.entries[0].progress, { uploadedBytes: 2, totalBytes: 4, transport: 'tus' });
  const count = changes.length;
  publishProgress({ uploadedBytes: 4, totalBytes: 4, transport: 'tus' });
  assert.equal(changes.length, count);
  assert.equal(result.entries[0].progress.uploadedBytes, 2);
});

test('un compteur d’un ancien compte ne produit aucune mise à jour ni notification', async () => {
  let current = true;
  const changes = [];
  const reports = [];
  const result = await library.runUploadBatch(batch(), dependencies({
    isCurrent: () => current,
    uploadDocument: async (request, _file, stage, _project, _mode, progress) => {
      stage('transfert');
      progress({ uploadedBytes: 1, totalBytes: request.fileSize, transport: 'standard' });
      const count = changes.length;
      current = false;
      progress({ uploadedBytes: request.fileSize, totalBytes: request.fileSize, transport: 'standard' });
      assert.equal(changes.length, count);
      return documentFrom(request);
    },
  }), (value) => changes.push(value), (report) => reports.push(report));
  assert.equal(result.entries[0].failureKind, 'scope');
  assert.equal(result.entries[0].document, null);
  assert.equal(result.entries[0].progress.uploadedBytes, 1);
  assert.equal(reports.length, 0);
});

test('la reprise remet le compteur à zéro sans rejouer les originaux confirmés', async () => {
  const entries = [prepared(1), prepared(2)];
  const first = await library.runUploadBatch(batch(entries), dependencies({
    uploadDocument: async (request, _file, stage, _project, _mode, progress) => {
      stage('transfert');
      progress({ uploadedBytes: request.fileSize, totalBytes: request.fileSize, transport: 'standard' });
      if (request.identity.id === entries[1].request.identity.id) throw failure('retryable');
      return documentFrom(request);
    },
  }), noChange, noChange);
  assert.deepEqual(first.entries.map((entry) => entry.status), ['confirmed', 'error']);
  assert.equal(first.entries[1].progress.uploadedBytes, 4);
  const changes = [];
  const calls = [];
  const retried = await library.runUploadBatch(first, dependencies({
    uploadDocument: async (request, _file, _stage, _project, mode) => {
      calls.push(request.identity.id);
      assert.equal(mode, 'resume');
      assert.equal(changes.at(-1).entries[1].progress, null);
      assert.equal(changes.at(-1).entries[0].status, 'confirmed');
      return documentFrom(request);
    },
  }), (value) => changes.push(value), noChange);
  assert.deepEqual(calls, [entries[1].request.identity.id]);
  assert.equal(retried.entries[1].progress, null);
  assert.equal(first.entries[1].progress.uploadedBytes, 4, 'Le lot d’origine reste immuable.');
});

test('la trace persistée ne contient aucun compteur et la restauration ne suppose pas le transfert', async () => {
  const first = await library.runUploadBatch(batch(), dependencies({
    uploadDocument: async (request, _file, stage, _project, _mode, progress) => {
      stage('transfert');
      progress({ uploadedBytes: request.fileSize, totalBytes: request.fileSize, transport: 'tus' });
      return documentFrom(request);
    },
  }), noChange, noChange);
  const raw = library.serializeUploadBatch(first);
  assert.doesNotMatch(raw, /progress|uploadedBytes|totalBytes|transport/);
  const store = memoryStorage();
  library.saveUploadJournal(store, first);
  const restored = library.readUploadJournal(store, userId, projectUrl);
  assert.equal(restored.entries[0].progress, null);
  assert.equal(restored.entries[0].document, null);
  assert.equal(restored.entries[0].status, 'pending');
  assert.deepEqual(restored.entries[0].request, first.entries[0].request);
});

// Les scénarios de création/conflit de dossier ont été retirés :
// le contrat V5 ne crée plus de dossiers.

test('un conflit de fichier conserve les réussites suivantes, sans retenter le conflit', async () => {
  const entries = [prepared(1), prepared(2)];
  const calls = [];
  const deps = dependencies({ uploadDocument: async (request) => {
    calls.push(request.identity.id);
    if (request.identity.id === entries[0].request.identity.id) throw failure('conflict');
    return documentFrom(request);
  } });
  const first = await library.runUploadBatch(batch(entries), deps, noChange, noChange);
  const second = await library.runUploadBatch(first, deps, noChange, noChange);
  assert.equal(calls.length, 2);
  assert.equal(second.entries[0].failureKind, 'conflict');
  assert.equal(second.entries[1].status, 'confirmed');
  assert.equal(library.canRetryUploadBatch(second), false);
});

test('un scope déjà obsolète interdit les écritures et les notifications du lot', async () => {
  let writes = 0;
  let reports = 0;
  const result = await library.runUploadBatch(batch([prepared(1), prepared(2)]), dependencies({
    isCurrent: () => false,
    uploadDocument: async () => { writes++; throw new Error('Ne doit pas être appelé'); },
  }), noChange, () => { reports++; });
  assert.equal(writes, 0);
  assert.equal(reports, 0);
  assert.equal(result.entries[0].failureKind, 'scope');
  assert.equal(result.entries[1].status, 'pending');
});

test('un changement de scope après une confirmation arrête les fichiers restants', async () => {
  let current = true;
  let writes = 0;
  const reports = [];
  const result = await library.runUploadBatch(batch([prepared(1), prepared(2), prepared(3)]), dependencies({
    isCurrent: () => current,
    uploadDocument: async (request) => { writes++; return documentFrom(request); },
  }), noChange, (report) => { reports.push(report); current = false; });
  assert.equal(writes, 1);
  assert.equal(reports.length, 1);
  assert.equal(result.entries[0].status, 'confirmed');
  assert.equal(result.entries[1].failureKind, 'scope');
  assert.equal(result.entries[2].status, 'pending');
});

test('un changement de scope pendant une réponse ne projette pas sa confirmation sur l’autre compte', async () => {
  let current = true;
  let reports = 0;
  const result = await library.runUploadBatch(batch(), dependencies({
    isCurrent: () => current,
    uploadDocument: async (request) => { current = false; return documentFrom(request); },
  }), noChange, () => { reports++; });
  assert.equal(reports, 0);
  assert.equal(result.entries[0].failureKind, 'scope');
  assert.equal(result.entries[0].document, null);
  assert.equal(result.entries[0].request.identity.id, prepared().request.identity.id);
});

test('une notification défaillante ne transforme pas les écritures confirmées en échecs', async () => {
  const first = await library.runUploadBatch(batch([prepared(1), prepared(2)]), dependencies(), noChange,
    () => { throw new Error('Affichage indisponible localement'); });
  assert.equal(library.isUploadBatchComplete(first), true);
  assert.equal(first.notificationError, 'La liste n’a pas pu être actualisée. Vos fichiers envoyés sont conservés. Actualisez la bibliothèque.');
  assert.doesNotMatch(first.notificationError, /Affichage indisponible localement/);
  let writes = 0;
  const reports = [];
  const resumed = await library.runUploadBatch(first, dependencies({
    uploadDocument: async () => { writes++; throw new Error('Un succès ne doit pas être rejoué'); },
  }), noChange, (report) => reports.push(report));
  assert.equal(writes, 0);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].documents.length, 2);
  assert.equal(resumed.notificationError, null);
});

test('une exception de publication locale n’annule pas les confirmations distantes', async () => {
  const result = await library.runUploadBatch(batch(), dependencies(),
    () => { throw new Error('Publication locale impossible'); }, noChange);
  assert.equal(result.entries[0].status, 'confirmed');
  assert.equal(result.notificationError, 'La liste n’a pas pu être actualisée. Vos fichiers envoyés sont conservés. Actualisez la bibliothèque.');
  assert.doesNotMatch(result.notificationError, /Publication locale impossible/);
});

test('une trace restaurée revérifie toutes les identités sans supposer un succès ni un fichier local', async () => {
  const store = memoryStorage();
  const completed = await complete(batch([prepared(1), prepared(2)]));
  library.saveUploadJournal(store, completed);
  const restored = library.readUploadJournal(store, userId, projectUrl);
  assert.ok(restored.entries.every((entry) => entry.status === 'pending' && entry.attempted && !entry.file && !entry.document));
  assert.equal(restored.legacySource, null);
  const calls = [];
  const result = await library.runUploadBatch(restored, dependencies({
    uploadDocument: async (request, file, _stage, project, mode) => {
      calls.push([request.identity.id, file, project, mode]); return documentFrom(request);
    },
  }), noChange, noChange);
  assert.deepEqual(calls, completed.entries.map((entry) => [entry.request.identity.id, undefined, projectUrl, 'resume']));
  assert.equal(library.isUploadBatchComplete(result), true);
});

test('les originaux compatibles se rattachent par nom, taille et empreinte sans changer les métadonnées', async () => {
  const value = batch([prepared(1), prepared(2)]);
  const originalRequests = value.entries.map((entry) => structuredClone(entry.request));
  const replacements = value.entries.map((entry) => new File(['test'], entry.request.fileName));
  const result = await library.attachUploadFiles(value, replacements,
    async (file) => createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'));
  assert.deepEqual(result.entries.map((entry) => entry.request), originalRequests);
  assert.equal(result.entries[0].file, replacements[0]);
  assert.notEqual(value.entries[0].file, replacements[0]);
});

test('une resélection incompatible conserve tous les originaux, même après un candidat valide', async () => {
  const value = batch([prepared(1), prepared(2)]);
  const beforeFiles = value.entries.map((entry) => entry.file);
  const incoming = [new File(['test'], 'cours-1.pdf'), new File(['faux'], 'cours-2.pdf')];
  await assert.rejects(library.attachUploadFiles(value, incoming,
    async (file) => createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex')), /diffère/);
  assert.deepEqual(value.entries.map((entry) => entry.file), beforeFiles);
  await assert.rejects(library.attachUploadFiles(value, [new File(['test'], 'inconnu.pdf')], async () => ''), /aucun fichier restant/);
});

test('des fichiers identiques à noms identiques gardent des identités distinctes', async () => {
  const value = batch([prepared(1, { fileName: 'meme.pdf' }), prepared(2, { fileName: 'meme.pdf' })]);
  const replacement = new File(['test'], 'meme.pdf');
  const result = await library.attachUploadFiles(value, [replacement],
    async () => createHash('sha256').update('test').digest('hex'));
  assert.notEqual(result.entries[0].request.identity.id, result.entries[1].request.identity.id);
  assert.ok(result.entries.every((entry) => entry.file === replacement));
});

test('le journal ne conserve que les requêtes, sans fichiers, profils, clés ou états de confirmation', async () => {
  const store = memoryStorage();
  const value = await complete(batch());
  value.access_token = 'secret-fictif-à-ne-pas-conserver';
  value.entries[0].request.private_key = 'secret-fictif-à-ne-pas-conserver';
  value.entries[0].document.author_email = 'profil-fictif-à-ne-pas-conserver';
  value.notificationError = 'erreur-fictive-à-ne-pas-conserver';
  library.saveUploadJournal(store, value);
  const raw = [...store.values.values()][0];
  assert.doesNotMatch(raw, /secret-fictif|profil-fictif|erreur-fictive|access_token|private_key|"file"|"status"|"document"/);
  const saved = JSON.parse(raw);
  assert.deepEqual(Object.keys(saved).sort(), ['version', 'id', 'userId', 'projectUrl', 'legacySource', 'requests'].sort());
  assert.deepEqual(saved.requests[0].identity, value.entries[0].request.identity);
});

test('l’absence et le périmètre compte/projet des traces restent distincts', () => {
  const store = memoryStorage();
  assert.equal(library.readUploadJournal(store, userId, projectUrl), null);
  library.saveUploadJournal(store, batch());
  assert.equal(library.readUploadJournal(store, otherUserId, projectUrl), null);
  assert.equal(library.readUploadJournal(store, userId, 'https://autre-projet.invalid'), null);
  assert.equal(library.readUploadJournal(store, userId, projectUrl).id, batchId);
});

test('une trace illisible ou une identité altérée reste conservée et bloque la reprise', () => {
  const store = memoryStorage();
  library.saveUploadJournal(store, batch());
  const [key, raw] = [...store.values][0];
  for (const changed of [
    '{invalide',
    JSON.stringify({ ...JSON.parse(raw), userId: otherUserId }),
    JSON.stringify({ ...JSON.parse(raw), projectUrl: 'https://autre-projet.invalid' }),
    JSON.stringify({ ...JSON.parse(raw), requests: [JSON.parse(raw).requests[0], JSON.parse(raw).requests[0]] }),
    JSON.stringify({ ...JSON.parse(raw), legacySource: { userId: otherUserId } }),
    JSON.stringify({ ...JSON.parse(raw), requests: [{ ...JSON.parse(raw).requests[0], identity: { id: prepared().request.identity.id, filePath: 'chemin/altéré' } }] }),
  ]) {
    store.values.set(key, changed);
    assert.throws(() => library.readUploadJournal(store, userId, projectUrl), /illisible ou incompatible/);
    assert.equal(store.values.get(key), changed);
  }
});

test('les bornes du journal utilisent 20 Mo et 200 points de code, pas 200 unités UTF-16', () => {
  const allowed = batch([prepared(1, { fileSize: 20 * 1024 * 1024, description: '🧡'.repeat(200) })]);
  assert.equal(allowed.entries[0].request.description.length, 400);
  assert.throws(() => batch([prepared(1, { fileSize: 20 * 1024 * 1024 + 1 })]), /incompatible/);
  assert.throws(() => batch([prepared(1, { description: '🧡'.repeat(201) })]), /incompatible/);
  assert.throws(() => batch([prepared(1, { sha256: 'empreinte-invalide' })]), /incompatible/);
  assert.throws(() => batch([prepared(1, { userId: otherUserId })]), /incompatible/);
});

test('un stockage bloqué ou une écriture non confirmée empêche tout nouvel envoi', async () => {
  const value = batch();
  for (const store of [
    { getItem: () => null, setItem: () => { throw new Error('Quota bloqué'); } },
    { getItem: () => null, setItem: () => {} },
    { getItem: () => { throw new Error('Stockage bloqué'); }, setItem: () => {} },
  ]) {
    let writes = 0;
    await assert.rejects(async () => {
      library.saveUploadJournal(store, value);
      await library.runUploadBatch(value, dependencies({ uploadDocument: async () => { writes++; } }), noChange, noChange);
    }, /Aucun nouvel envoi/);
    assert.equal(writes, 0);
  }
  assert.throws(() => library.readUploadJournal({ getItem: () => { throw new Error('Lecture bloquée'); } }, userId, projectUrl), /inaccessible/);
});

test('réenregistrer la même trace de reprise conserve les mêmes identités', () => {
  const store = memoryStorage();
  const value = batch();
  library.saveUploadJournal(store, value);
  const raw = [...store.values.values()][0];
  library.saveUploadJournal(store, value);
  assert.equal([...store.values.values()][0], raw);
});

test('un autre lot détecté dans le journal n’est jamais écrasé par un nouveau dépôt', () => {
  const store = memoryStorage();
  const first = batch();
  library.saveUploadJournal(store, first);
  const raw = [...store.values.values()][0];
  assert.throws(() => library.saveUploadJournal(store, batch([prepared(2)], secondBatchId)), /autre trace/);
  assert.equal([...store.values.values()][0], raw);
});

test('une trace incompatible n’est pas écrasée lors d’un réessai', () => {
  const store = memoryStorage();
  library.saveUploadJournal(store, batch());
  const [key] = [...store.values.keys()];
  store.values.set(key, '{trace-incompatible');
  assert.throws(() => library.saveUploadJournal(store, batch()), /autre trace/);
  assert.equal(store.values.get(key), '{trace-incompatible');
});

test('seul le lot complet correspondant à la trace peut la retirer', async () => {
  const store = memoryStorage();
  const value = batch();
  library.saveUploadJournal(store, value);
  assert.throws(() => library.clearCompletedUploadJournal(store, value), /non confirmé/);
  assert.equal(store.values.size, 1);
  const completed = await complete(value);
  library.clearCompletedUploadJournal(store, completed);
  assert.equal(store.values.size, 0);
  library.clearCompletedUploadJournal(store, completed);
  assert.equal(store.values.size, 0);
});

test('terminer un lot ne retire pas la trace d’un autre lot', async () => {
  const store = memoryStorage();
  const first = await complete(batch());
  library.saveUploadJournal(store, batch([prepared(2)], secondBatchId));
  const raw = [...store.values.values()][0];
  assert.throws(() => library.clearCompletedUploadJournal(store, first), /autre trace/);
  assert.equal([...store.values.values()][0], raw);
});

test('un retrait non confirmé de la trace terminée produit un avertissement récupérable', async () => {
  const store = memoryStorage();
  const value = await complete(batch());
  library.saveUploadJournal(store, value);
  const blocked = { ...store, removeItem: () => {} };
  assert.throws(() => library.clearCompletedUploadJournal(blocked, value), /trace locale n’a pas pu être retirée/);
  assert.equal(store.values.size, 1);
});
