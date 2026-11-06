import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// Contrôleur de production, lectures contrôlées et aucun accès Supabase réel.
// Vite ne charge ni la configuration de l’application ni les fichiers .env.
const root = fileURLToPath(new URL('../', import.meta.url));
const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '99999999-9999-4999-8999-999999999999';
const projectUrl = 'https://dashboard-library-test.invalid';
const folderId = '22222222-2222-4222-8222-222222222222';
const categoryId = '44444444-4444-4444-8444-444444444444';
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
    file_size: 4, file_type: 'pdf', folder_id: null, category_id: null,
    status: 'pending', rejection_reason: null, reviewed_by: null, reviewed_at: null,
    created_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}
function folder(overrides = {}) {
  return {
    id: folderId, user_id: userId, name: 'Dossier du lot', category_id: null,
    status: 'pending', rejection_reason: null, document_count: 500,
    created_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}
const category = { id: categoryId, name: 'Cours', icon: null, color: null };
const data = (documents = [], folders = [], categories = []) => ({ documents, folders, categories });
function report(documents = [document()], uploadedFolder, overrides = {}) {
  return {
    ...scope, documents, folder: uploadedFolder, entries: [], complete: true, ...overrides,
  };
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
    read: () => { const pending = deferred(); reads.push(pending); return pending.promise; },
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
  assert.deepEqual(initial, { ...data(), loading: true, error: null });
  let notifications = 0;
  const unsubscribe = controller.subscribe(() => { notifications++; });
  await load(state, data([document()], [folder()], [category]));
  assert.equal(notifications, 2);
  const loaded = controller.getSnapshot();
  assert.notEqual(loaded, initial);
  assert.equal(controller.getSnapshot(), loaded);
  assert.equal(loaded.loading, false);
  assert.equal(loaded.error, null);
  assert.equal(loaded.folders[0].document_count, 0);
  assert.deepEqual(loaded.categories, [category]);
  unsubscribe();
  controller.removeDocument(idOf(1));
  assert.equal(notifications, 2);
});

test('une lecture publie documents, dossiers, catégories et compteurs ensemble', async () => {
  const state = controlled();
  const observations = [];
  state.controller.subscribe(() => { observations.push(state.controller.getSnapshot()); });
  const incoming = data([document(1, { folder_id: folderId }), document(2)], [folder()], [category]);
  await load(state, incoming);
  assert.equal(observations.length, 2);
  assert.equal(observations[0].loading, true);
  assert.equal(observations[0].documents.length, 0);
  assert.equal(observations[1].loading, false);
  assert.equal(observations[1].documents.length, 2);
  assert.equal(observations[1].folders[0].document_count, 1);
  assert.deepEqual(observations[1].categories, [category]);
  assert.equal(incoming.folders[0].document_count, 500);
});

test('une confirmation de lot pendant une lecture tardive n’est pas effacée par sa réponse', async () => {
  const state = controlled();
  const loading = state.controller.refresh();
  const received = report([document(1, { folder_id: folderId }), document(2, { folder_id: folderId })], folder());
  assert.equal(state.controller.applyUploadReport(received), true);
  assert.equal(state.controller.getSnapshot().loading, true);
  assert.deepEqual(documentIds(state.controller), [idOf(1), idOf(2)]);
  state.reads[0].resolve(data([document(3)], [], [category]));
  await loading;
  assert.deepEqual(documentIds(state.controller), [idOf(1), idOf(2), idOf(3)]);
  assert.equal(state.controller.getSnapshot().folders[0].document_count, 2);
  assert.deepEqual(state.controller.getSnapshot().categories, [category]);
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

test('modification puis suppression confirmées pendant une lecture sont réappliquées dans l’ordre', async () => {
  const state = controlled();
  await load(state, data([document(1), document(2, { folder_id: folderId })], [folder()]));
  const loading = state.controller.refresh();
  state.controller.updateDocumentMetadata(idOf(1), '  Titre confirmé  ', '  Description confirmée  ');
  state.controller.removeDocument(idOf(2));
  state.reads.at(-1).resolve(data([document(1), document(2, { folder_id: folderId })], [folder()]));
  await loading;
  assert.deepEqual(documentIds(state.controller), [idOf(1)]);
  assert.equal(state.controller.getSnapshot().documents[0].title, 'Titre confirmé');
  assert.equal(state.controller.getSnapshot().documents[0].description, 'Description confirmée');
  assert.equal(state.controller.getSnapshot().folders[0].document_count, 0);
});

test('la suppression d’un dossier confirmée pendant une lecture retire aussi ses enfants', async () => {
  const state = controlled();
  const old = data([document(1, { folder_id: folderId }), document(2)], [folder()]);
  await load(state, old);
  const loading = state.controller.refresh();
  assert.equal(state.controller.removeFolder(folderId), true);
  state.reads.at(-1).resolve(old);
  await loading;
  assert.deepEqual(documentIds(state.controller), [idOf(2)]);
  assert.deepEqual(state.controller.getSnapshot().folders, []);
});

test('une lecture ultérieure reste l’autorité sur les éléments devenus absents', async () => {
  const state = controlled();
  const received = report([document(1, { folder_id: folderId })], folder());
  state.controller.applyUploadReport(received);
  await load(state, data());
  assert.deepEqual(documentIds(state.controller), []);
  assert.deepEqual(state.controller.getSnapshot().folders, []);
  assert.equal(state.controller.applyUploadReport(received), true);
  assert.deepEqual(documentIds(state.controller), []);
  assert.deepEqual(state.controller.getSnapshot().folders, []);
});

test('des rapports cumulatifs répétés ajoutent les nouveautés, sans écraser une modification confirmée', async () => {
  const state = controlled();
  await load(state);
  const first = report([document(1, { folder_id: folderId })], folder());
  state.controller.applyUploadReport(first);
  state.controller.updateDocumentMetadata(idOf(1), 'Nouveau titre', '  ');
  const cumulative = report([document(1, { folder_id: folderId }), document(2, { folder_id: folderId })], folder());
  state.controller.applyUploadReport(cumulative);
  const snapshot = state.controller.getSnapshot();
  assert.equal(snapshot.documents.length, 2);
  assert.equal(snapshot.documents.find((item) => item.id === idOf(1)).title, 'Nouveau titre');
  assert.equal(snapshot.documents.find((item) => item.id === idOf(1)).description, null);
  assert.equal(snapshot.folders[0].document_count, 2);
  state.controller.applyUploadReport(cumulative);
  assert.equal(state.controller.getSnapshot(), snapshot);
});

test('un rapport ancien ne rétablit pas un document supprimé avant sa première réception', async () => {
  const state = controlled();
  await load(state, data([document(1)]));
  state.controller.removeDocument(idOf(1));
  state.controller.applyUploadReport(report([document(1), document(2)]));
  assert.deepEqual(documentIds(state.controller), [idOf(2)]);
});

test('un rapport ancien ne rétablit pas un dossier supprimé ni un enfant encore inconnu', async () => {
  const state = controlled();
  await load(state, data([document(1, { folder_id: folderId })], [folder()]));
  state.controller.removeFolder(folderId);
  state.controller.applyUploadReport(report([
    document(1, { folder_id: folderId }), document(2, { folder_id: folderId }), document(3),
  ], folder()));
  assert.deepEqual(documentIds(state.controller), [idOf(3)]);
  assert.deepEqual(state.controller.getSnapshot().folders, []);
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
  state.reads[1].resolve(data([document(2)], [folder()], [category]));
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
  await load(state, data([document(1)], [folder()], [category]));
  const failing = state.controller.refresh();
  state.controller.applyUploadReport(report([document(2, { folder_id: folderId })]));
  state.reads.at(-1).reject(new Error('Lecture locale indisponible'));
  await failing;
  const failed = state.controller.getSnapshot();
  assert.deepEqual(documentIds(state.controller), [idOf(2), idOf(1)]);
  assert.equal(failed.loading, false);
  assert.match(failed.error, /Lecture locale indisponible/);
  assert.equal(failed.folders[0].document_count, 1);
  assert.deepEqual(failed.categories, [category]);
  const retry = state.controller.refresh();
  assert.equal(state.controller.getSnapshot().loading, true);
  assert.equal(state.controller.getSnapshot().error, null);
  state.reads.at(-1).resolve(data([document(1), document(2, { folder_id: folderId })], [folder()], [category]));
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
  assert.equal(state.controller.removeFolder(folderId), false);
  await state.controller.refresh();
  assert.equal(state.reads.length, 1);
  assert.equal(state.controller.getSnapshot(), current);
});

test('les rapports d’un autre compte, projet, génération ou propriétaire sont refusés sans effet partiel', async () => {
  const state = controlled();
  await load(state);
  const initial = state.controller.getSnapshot();
  for (const incompatible of [
    report([document()], undefined, { userId: otherUserId }),
    report([document()], undefined, { projectUrl: 'https://autre-projet.invalid' }),
    report([document()], undefined, { generation: 5 }),
    report([document(1), document(2, { user_id: otherUserId })]),
    report([document()], folder({ user_id: otherUserId })),
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
  assert.equal(controller.applyUploadReport(report([document()], undefined, mutableScope)), false);
});

test('les compteurs portent sur les enfants visibles, pas sur le statut seul ni les documents racine', async () => {
  const state = controlled();
  await load(state, data([
    document(1, { folder_id: folderId, status: 'approved' }),
    document(2, { folder_id: folderId, status: 'pending' }),
    document(3, { folder_id: folderId, status: 'rejected' }),
    document(4),
  ], [folder()]));
  assert.equal(state.controller.getSnapshot().folders[0].document_count, 3);
  state.controller.removeDocument(idOf(2));
  assert.equal(state.controller.getSnapshot().folders[0].document_count, 2);
  state.controller.applyUploadReport(report([document(5, { folder_id: folderId })]));
  assert.equal(state.controller.getSnapshot().folders[0].document_count, 3);
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
