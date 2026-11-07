import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// Contrôleur de production, lectures contrôlées et aucun accès Supabase réel.
// Vite ne charge ni la configuration de l’application ni les fichiers .env.
// Les anciens scénarios de suppression/compteurs de dossiers n'existent plus en V5.
const root = fileURLToPath(new URL('../', import.meta.url));
const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '99999999-9999-4999-8999-999999999999';
const projectUrl = 'https://dashboard-library-test.invalid';
const scope = { userId, projectUrl, generation: 4 };
let server;
let createController;
let networkAttempts = 0;
const originalFetch = globalThis.fetch;

before(async () => {
  globalThis.fetch = async () => {
    networkAttempts++;
    throw new Error('Réseau interdit dans les tests de bibliothèque.');
  };
  server = await createServer({
    root, configFile: false, envDir: false,
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error',
  });
  const library = await server.ssrLoadModule('/src/lib/dashboard-library.ts');
  createController = library.createDashboardLibraryController;
});
after(async () => {
  try { await server?.close(); assert.equal(networkAttempts, 0); }
  finally { globalThis.fetch = originalFetch; }
});

const idOf = (index) => `${String(index).padStart(8, '0')}-3333-4333-8333-333333333333`;
function document(index = 1, overrides = {}) {
  return {
    id: idOf(index), user_id: userId, title: `Cours ${index}`, description: null,
    file_name: `cours-${index}.pdf`, file_path: `${userId}/${idOf(index)}-cours-${index}.pdf`,
    file_size: 4, file_type: 'pdf', school_name: 'École de test', subject_name: 'Mathématiques',
    deleted_at: null, deleted_by: null, thumbnail_path: null, page_count: null,
    status: 'pending', rejection_reason: null, reviewed_by: null, reviewed_at: null,
    created_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}
const data = (documents = []) => ({ documents });
function report(documents = [document()], overrides = {}) {
  return { ...scope, documents, entries: [], complete: true, ...overrides };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function controlled() {
  let current = true;
  const reads = [];
  const controller = createController({
    scope: { ...scope }, isCurrent: () => current,
    read: (offset) => { const pending = { ...deferred(), offset }; reads.push(pending); return pending.promise; },
  });
  return { controller, reads, setCurrent: (next) => { current = next; } };
}
async function load(state, value = data()) {
  const loading = state.controller.refresh();
  state.reads.at(-1).resolve(value);
  await loading;
}
const documentIds = (controller) => controller.getSnapshot().documents.map((item) => item.id);

test('le snapshot initial et les abonnements sont stables jusqu’à une publication', async () => {
  const state = controlled();
  const { controller } = state;
  const initial = controller.getSnapshot();
  assert.equal(controller.getSnapshot(), initial);
  assert.deepEqual(initial, { ...data(), loading: true, loadingMore: false, hasMore: false, error: null });
  let notifications = 0;
  const unsubscribe = controller.subscribe(() => { notifications++; });
  await load(state, data([document()]));
  assert.equal(notifications, 2);
  const loaded = controller.getSnapshot();
  assert.notEqual(loaded, initial);
  assert.equal(controller.getSnapshot(), loaded);
  assert.equal(loaded.loading, false);
  assert.equal(loaded.error, null);
  unsubscribe();
  controller.removeDocument(idOf(1));
  assert.equal(notifications, 2);
});

test('une lecture publie les documents et la fin du chargement ensemble', async () => {
  const state = controlled();
  const observations = [];
  state.controller.subscribe(() => { observations.push(state.controller.getSnapshot()); });
  const incoming = data([document(1), document(2)]);
  await load(state, incoming);
  assert.equal(observations.length, 2);
  assert.equal(observations[0].loading, true);
  assert.equal(observations[0].documents.length, 0);
  assert.equal(observations[1].loading, false);
  assert.equal(observations[1].documents.length, 2);
});

test('une confirmation de lot pendant une lecture tardive n’est pas effacée par sa réponse', async () => {
  const state = controlled();
  const loading = state.controller.refresh();
  const received = report([document(1), document(2)]);
  assert.equal(state.controller.applyUploadReport(received), true);
  assert.equal(state.controller.getSnapshot().loading, true);
  assert.deepEqual(documentIds(state.controller), [idOf(1), idOf(2)]);
  state.reads[0].resolve(data([document(3)]));
  await loading;
  assert.deepEqual(documentIds(state.controller), [idOf(1), idOf(2), idOf(3)]);
  assert.equal(state.controller.getSnapshot().loading, false);
});

test('un document déjà présent dans la lecture et dans le rapport n’est pas dupliqué', async () => {
  const state = controlled();
  const loading = state.controller.refresh();
  state.controller.applyUploadReport(report([document(1, { title: 'Confirmation locale' })]));
  state.reads[0].resolve(data([document(1, { title: 'Réponse prise avant confirmation' }), document(2)]));
  await loading;
  assert.deepEqual(documentIds(state.controller), [idOf(1), idOf(2)]);
  assert.equal(state.controller.getSnapshot().documents[0].title, 'Confirmation locale');
});

test('modification puis retrait confirmés pendant une lecture sont réappliqués dans l’ordre', async () => {
  const state = controlled();
  await load(state, data([document(1), document(2)]));
  const loading = state.controller.refresh();
  state.controller.updateDocumentMetadata(idOf(1), '  Titre confirmé  ', '  Description confirmée  ');
  state.controller.removeDocument(idOf(2));
  state.reads.at(-1).resolve(data([document(1), document(2)]));
  await loading;
  assert.deepEqual(documentIds(state.controller), [idOf(1)]);
  assert.equal(state.controller.getSnapshot().documents[0].title, 'Titre confirmé');
  assert.equal(state.controller.getSnapshot().documents[0].description, 'Description confirmée');
});

test('une lecture ultérieure reste l’autorité sur les éléments devenus absents', async () => {
  const state = controlled();
  const received = report([document(1)]);
  state.controller.applyUploadReport(received);
  await load(state, data());
  assert.deepEqual(documentIds(state.controller), []);
  assert.equal(state.controller.applyUploadReport(received), true);
  assert.deepEqual(documentIds(state.controller), []);
});

test('des rapports cumulatifs répétés ajoutent les nouveautés, sans écraser une modification confirmée', async () => {
  const state = controlled();
  await load(state);
  const first = report([document(1)]);
  state.controller.applyUploadReport(first);
  state.controller.updateDocumentMetadata(idOf(1), 'Nouveau titre', '  ');
  const cumulative = report([document(1), document(2)]);
  state.controller.applyUploadReport(cumulative);
  const snapshot = state.controller.getSnapshot();
  assert.equal(snapshot.documents.length, 2);
  assert.equal(snapshot.documents.find((item) => item.id === idOf(1)).title, 'Nouveau titre');
  assert.equal(snapshot.documents.find((item) => item.id === idOf(1)).description, null);
  state.controller.applyUploadReport(cumulative);
  assert.equal(state.controller.getSnapshot(), snapshot);
});

test('un rapport ancien ne rétablit pas un document retiré avant sa première réception', async () => {
  const state = controlled();
  await load(state, data([document(1)]));
  state.controller.removeDocument(idOf(1));
  state.controller.applyUploadReport(report([document(1), document(2)]));
  assert.deepEqual(documentIds(state.controller), [idOf(2)]);
});

test('un ancien rapport ne rétablit pas les métadonnées après une relecture autoritative', async () => {
  const state = controlled();
  const received = report([document(1)]);
  state.controller.applyUploadReport(received);
  await load(state, data([document(1, { title: 'Titre actuel du serveur', status: 'approved' })]));
  state.controller.applyUploadReport(received);
  assert.equal(state.controller.getSnapshot().documents[0].title, 'Titre actuel du serveur');
  assert.equal(state.controller.getSnapshot().documents[0].status, 'approved');
});

test('la dernière lecture démarrée gagne, même si une ancienne réponse arrive ensuite', async () => {
  const state = controlled();
  const first = state.controller.refresh();
  const second = state.controller.refresh();
  state.reads[1].resolve(data([document(2)]));
  await second;
  const latest = state.controller.getSnapshot();
  state.reads[0].resolve(data([document(1)]));
  await first;
  assert.equal(state.controller.getSnapshot(), latest);
  assert.deepEqual(documentIds(state.controller), [idOf(2)]);
});

test('une erreur de lecture obsolète ne remplace pas le succès de la dernière lecture', async () => {
  const state = controlled();
  const first = state.controller.refresh();
  const second = state.controller.refresh();
  state.reads[1].resolve(data([document(2)]));
  await second;
  const latest = state.controller.getSnapshot();
  state.reads[0].reject(new Error('Ancienne panne ignorée'));
  await first;
  assert.equal(state.controller.getSnapshot(), latest);
  assert.equal(latest.error, null);
});

test('la réponse obsolète n’efface pas les mutations reçues pendant la lecture courante', async () => {
  const state = controlled();
  const first = state.controller.refresh();
  const second = state.controller.refresh();
  state.controller.applyUploadReport(report([document(3)]));
  state.reads[0].resolve(data([document(1)]));
  await first;
  assert.equal(state.controller.getSnapshot().loading, true);
  state.reads[1].resolve(data([document(2)]));
  await second;
  assert.deepEqual(documentIds(state.controller), [idOf(3), idOf(2)]);
});

test('une lecture échouée conserve les éléments chargés et confirmés, puis le réessai efface l’erreur', async () => {
  const state = controlled();
  await load(state, data([document(1)]));
  const failing = state.controller.refresh();
  state.controller.applyUploadReport(report([document(2)]));
  state.reads.at(-1).reject(new Error('Lecture locale indisponible'));
  await failing;
  const failed = state.controller.getSnapshot();
  assert.deepEqual(documentIds(state.controller), [idOf(2), idOf(1)]);
  assert.equal(failed.loading, false);
  assert.equal(failed.error, 'Impossible de charger la bibliothèque. Réessayez.');
  assert.doesNotMatch(failed.error, /Lecture locale indisponible/);
  const retry = state.controller.refresh();
  assert.equal(state.controller.getSnapshot().loading, true);
  assert.equal(state.controller.getSnapshot().error, null);
  state.reads.at(-1).resolve(data([document(1), document(2)]));
  await retry;
  assert.equal(state.controller.getSnapshot().loading, false);
  assert.equal(state.controller.getSnapshot().error, null);
  assert.equal(state.controller.getSnapshot().documents.length, 2);
});

test('une réponse après changement de scope ne publie plus de données', async () => {
  const state = controlled();
  const loading = state.controller.refresh();
  const current = state.controller.getSnapshot();
  state.setCurrent(false);
  state.reads[0].resolve(data([document()]));
  await loading;
  assert.equal(state.controller.getSnapshot(), current);
  assert.equal(state.controller.isCurrent(), false);
  assert.equal(state.controller.applyUploadReport(report()), false);
  assert.equal(state.controller.updateDocumentMetadata(idOf(1), 'Ancien scope', ''), false);
  assert.equal(state.controller.removeDocument(idOf(1)), false);
  await state.controller.refresh();
  assert.equal(state.reads.length, 1);
  assert.equal(state.controller.getSnapshot(), current);
});

test('les rapports d’un autre compte, projet, génération ou propriétaire sont refusés sans effet partiel', async () => {
  const state = controlled();
  await load(state);
  const initial = state.controller.getSnapshot();
  for (const incompatible of [
    report([document()], { userId: otherUserId }),
    report([document()], { projectUrl: 'https://autre-projet.invalid' }),
    report([document()], { generation: 5 }),
    report([document(1), document(2, { user_id: otherUserId })]),
  ]) {
    assert.equal(state.controller.applyUploadReport(incompatible), false);
    assert.equal(state.controller.getSnapshot(), initial);
  }
  assert.equal(state.controller.applyUploadReport(report()), true);
  assert.deepEqual(documentIds(state.controller), [idOf(1)]);
});

test('le scope est capturé à la création, pas emprunté à un objet modifiable', () => {
  const mutableScope = { ...scope };
  const controller = createController({ scope: mutableScope, isCurrent: () => true, read: async () => data() });
  mutableScope.userId = otherUserId;
  mutableScope.generation = 5;
  assert.equal(controller.applyUploadReport(report()), true);
  assert.equal(controller.applyUploadReport(report([document()], mutableScope)), false);
});

test('cancelPending invalide les réponses sans simuler un abort réseau et autorise une nouvelle lecture', async () => {
  const state = controlled();
  const first = state.controller.refresh();
  state.controller.cancelPending();
  const cancelled = state.controller.getSnapshot();
  state.reads[0].resolve(data([document(1)]));
  await first;
  assert.equal(state.controller.getSnapshot(), cancelled);
  await load(state, data([document(2)]));
  assert.deepEqual(documentIds(state.controller), [idOf(2)]);
  assert.equal(state.controller.getSnapshot().loading, false);
});

test('une resouscription après nettoyage ne reçoit pas les réponses d’une ancienne lecture', async () => {
  const state = controlled();
  const firstNotifications = [];
  const unsubscribe = state.controller.subscribe(() => { firstNotifications.push(state.controller.getSnapshot()); });
  const first = state.controller.refresh();
  unsubscribe();
  state.controller.cancelPending();
  const secondNotifications = [];
  const cleanup = state.controller.subscribe(() => { secondNotifications.push(state.controller.getSnapshot()); });
  const second = state.controller.refresh();
  state.reads[0].resolve(data([document(1)]));
  await first;
  state.reads[1].resolve(data([document(2)]));
  await second;
  cleanup();
  assert.equal(firstNotifications.length, 1);
  assert.equal(secondNotifications.length, 2);
  assert.deepEqual(secondNotifications.at(-1).documents.map((item) => item.id), [idOf(2)]);
});

const page = (first = 1, length = 20) => data(Array.from({ length }, (_, index) => document(first + index)));

test('pages de vingt : offsets, déduplication et dernier lot partiel', async () => {
  const state = controlled();
  await load(state, page());
  assert.equal(state.reads[0].offset, 0);
  assert.equal(state.controller.getSnapshot().hasMore, true);
  const next = state.controller.loadMore();
  assert.equal(state.reads.at(-1).offset, 20);
  assert.equal(state.controller.getSnapshot().loadingMore, true);
  await state.controller.loadMore();
  assert.equal(state.reads.length, 2);
  state.reads.at(-1).resolve(page(20));
  await next;
  assert.equal(state.controller.getSnapshot().documents.length, 39);
  const last = state.controller.loadMore();
  assert.equal(state.reads.at(-1).offset, 40);
  state.reads.at(-1).resolve(page(40, 3));
  await last;
  assert.equal(state.controller.getSnapshot().documents.length, 42);
  assert.equal(state.controller.getSnapshot().hasMore, false);
  await state.controller.loadMore();
  assert.equal(state.reads.length, 3);
});

test('mutation puis lecture échouée : reprendre à zéro avant de poursuivre la pagination', async () => {
  const state = controlled();
  await load(state, page());
  state.controller.removeDocument(idOf(1));
  const failed = state.controller.loadMore();
  assert.equal(state.reads.at(-1).offset, 0);
  state.reads.at(-1).reject(new Error('Hors ligne'));
  await failed;
  const retry = state.controller.loadMore();
  assert.equal(state.reads.at(-1).offset, 0);
  state.reads.at(-1).resolve(page(2));
  await retry;
  const next = state.controller.loadMore();
  assert.equal(state.reads.at(-1).offset, 20);
  state.reads.at(-1).resolve(page(22, 2));
  await next;
  assert.equal(state.controller.getSnapshot().documents.length, 22);
});

test('une mutation pendant une page tardive impose une nouvelle première page', async () => {
  const state = controlled();
  await load(state, page());
  const next = state.controller.loadMore();
  state.controller.removeDocument(idOf(1));
  state.reads.at(-1).resolve(page(21));
  await next;
  assert.equal(documentIds(state.controller).includes(idOf(1)), false);
  const reconcile = state.controller.loadMore();
  assert.equal(state.reads.at(-1).offset, 0);
  state.reads.at(-1).resolve(page(2));
  await reconcile;
  const resumed = state.controller.loadMore();
  assert.equal(state.reads.at(-1).offset, 20);
  state.reads.at(-1).resolve(page(22, 0));
  await resumed;
  assert.equal(state.controller.getSnapshot().hasMore, false);
});

test('une page trop grande ne remplace pas les données confirmées', async () => {
  const state = controlled();
  await load(state, page());
  const next = state.controller.loadMore();
  state.reads.at(-1).resolve(page(21, 21));
  await next;
  assert.equal(state.controller.getSnapshot().documents.length, 20);
  assert.ok(state.controller.getSnapshot().error);
});
