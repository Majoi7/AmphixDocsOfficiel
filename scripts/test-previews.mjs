import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Logique de production, rendu PDF/canvas injecté : ces tests ne décodent PAS un
// vrai PDF. Aucun réseau, aucune configuration .env, aucun paquet téléchargé.
const root = fileURLToPath(new URL('../', import.meta.url));
let vite, resources, generation, completion, backfill, zoom;
let networkAttempts = 0;
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async () => { networkAttempts++; throw new Error('Réseau interdit dans ces tests.'); };
  vite = await createServer({
    root, configFile: false, envDir: false,
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    appType: 'custom', logLevel: 'error',
  });
  [resources, generation, completion, backfill, zoom] = await Promise.all([
    '/src/lib/preview-resources.ts', '/src/lib/preview-generation.ts',
    '/src/lib/preview-completion.ts', '/src/lib/preview-backfill.ts', '/src/lib/image-zoom.ts',
  ].map((path) => vite.ssrLoadModule(path)));
});
after(async () => {
  try { await vite?.close(); assert.equal(networkAttempts, 0); }
  finally { globalThis.fetch = originalFetch; }
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const source = new Blob(['test'], { type: 'application/pdf' });
const thumbnail = () => new Blob(['miniature'], { type: 'image/jpeg' });
const author = '11111111-1111-4111-8111-111111111111';
function document(index = 1, overrides = {}) {
  const id = `${String(index).padStart(8, '0')}-3333-4333-8333-333333333333`;
  return {
    id, user_id: author, title: `Cours ${index}`, description: null,
    file_name: `cours-${index}.pdf`, file_path: `${author}/${id}-cours-${index}.pdf`,
    file_size: source.size, file_type: 'pdf', school_name: null, subject_name: null,
    deleted_at: null, deleted_by: null, status: 'pending', rejection_reason: null,
    reviewed_by: null, reviewed_at: null, created_at: '2026-01-01T00:00:00Z',
    thumbnail_path: null, page_count: null, ...overrides,
  };
}
function confirmed(item, pageCount = 24) {
  return { ...item, thumbnail_path: item.thumbnail_path || `${item.user_id}/${item.id}/${'a'.repeat(64)}.jpg`, page_count: pageCount };
}
function rendererFixture(options = {}) {
  const calls = { pages: [], renders: [], exports: [], images: [], fills: [], pdfClosed: 0, pageCleaned: 0, imageClosed: 0, cancelled: 0 };
  const canvases = [];
  const page = {
    getViewport: ({ scale }) => ({ width: (options.width ?? 600) * scale, height: (options.height ?? 900) * scale }),
    cleanup: () => { calls.pageCleaned++; },
    render: (parameters) => {
      calls.renders.push(parameters);
      return { promise: options.renderPromise ?? Promise.resolve(), cancel: () => { calls.cancelled++; options.cancel?.(); } };
    },
  };
  const renderer = {
    canvas: () => {
      const context = { fillStyle: '', fillRect: (...args) => calls.fills.push(args), drawImage: (...args) => calls.images.push(args) };
      const canvas = {
        width: 0, height: 0,
        getContext: () => options.noContext ? null : context,
        toBlob: (callback, mime, quality) => {
          calls.exports.push({ width: canvas.width, height: canvas.height, mime, quality });
          if (options.export) options.export(callback);
          else callback(Object.hasOwn(options, 'output') ? options.output : thumbnail());
        },
      };
      canvases.push(canvas);
      return canvas;
    },
    pdf: async () => ({ document: { numPages: options.pages ?? 24, getPage: async (number) => { calls.pages.push(number); return page; } }, dispose: async () => { calls.pdfClosed++; } }),
    image: async () => ({ source: {}, width: options.width ?? 1200, height: options.height ?? 800, dispose: () => { calls.imageClosed++; } }),
  };
  return { renderer, calls, canvases };
}

// Projection d'une confirmation : jamais de remplacement des métadonnées courantes.
test('fusion : seules la miniature et les pages complètent les métadonnées récentes', () => {
  const existing = document(1, { title: 'Titre corrigé', description: 'Description récente', status: 'approved', author_name: 'Auteur affiché' });
  const received = confirmed(document(1));
  const merged = completion.mergeDocumentPreview(existing, received);
  assert.deepEqual(merged, { ...existing, thumbnail_path: received.thumbnail_path, page_count: 24 });
  assert.equal(existing.thumbnail_path, null);
  assert.equal(completion.mergeDocumentPreview(merged, received), merged, 'Une confirmation déjà projetée conserve sa référence.');
});
test('fusion : identité, corbeille, format et confirmation incomplète sont refusés', () => {
  const existing = document();
  const received = confirmed(existing);
  for (const changes of [
    { id: document(2).id }, { user_id: document(2).id }, { file_path: 'autre.pdf' },
    { file_type: 'image' }, { deleted_at: '2026-01-03T00:00:00Z' },
    { thumbnail_path: null }, { page_count: null }, { page_count: 0 },
    { page_count: -1 }, { page_count: 1.5 }, { page_count: NaN }, { page_count: Infinity },
  ]) assert.equal(completion.mergeDocumentPreview(existing, { ...received, ...changes }), existing);
  const trashed = { ...existing, deleted_at: '2026-01-03T00:00:00Z' };
  assert.equal(completion.mergeDocumentPreview(trashed, received), trashed);
  const unsupported = document(1, { file_type: 'doc' });
  assert.equal(completion.mergeDocumentPreview(unsupported, confirmed(unsupported)), unsupported);
});
test('fusion : chemin historique et compte confirmés ne sont jamais remplacés', () => {
  const webp = document(1, { thumbnail_path: `${author}/${document().id}/${'b'.repeat(64)}.webp` });
  const completed = completion.mergeDocumentPreview(webp, confirmed(webp, 7));
  assert.equal(completed.thumbnail_path, webp.thumbnail_path);
  assert.equal(completed.page_count, 7);
  assert.equal(completion.mergeDocumentPreview(completed, confirmed(webp, 8)), completed);
  assert.equal(completion.mergeDocumentPreview(webp, confirmed(document())), webp);
  const counted = document(1, { page_count: 3 });
  assert.equal(completion.mergeDocumentPreview(counted, confirmed(counted, 4)), counted);
  assert.equal(completion.mergeDocumentPreview(counted, confirmed(counted, 3)).page_count, 3);
});
test('fusion image : miniature seule ou compte un, jamais plusieurs pages', () => {
  const image = document(1, { file_type: 'image' });
  for (const count of [null, 1]) {
    const received = confirmed(image, count);
    assert.deepEqual(completion.mergeDocumentPreview(image, received), received);
  }
  assert.equal(completion.mergeDocumentPreview(image, confirmed(image, 2)), image);
});

// Dimensions, concurrence et annulation des ressources partagées.
test('raster : 480 px, DPR plafonné à deux et ratio conservé', () => {
  assert.deepEqual(resources.rasterSize(600, 900, 480, 1), { width: 480, height: 720, scale: 0.8 });
  assert.deepEqual(resources.rasterSize(600, 900, 480, 5), { width: 960, height: 1440, scale: 1.6 });
  assert.equal(resources.rasterSize(600, 900, 480, NaN).width, 480);
  for (const dimensions of [[600, 100000], [100000, 600], [100000, 100000]]) {
    const size = resources.rasterSize(...dimensions, 480, 2);
    assert.ok(size.width * size.height <= 2_000_000);
    assert.ok(size.width <= 8192 && size.height <= 8192);
    assert.ok(size.width >= 1 && size.height >= 1);
  }
  for (const invalid of [0, -1, NaN, Infinity]) assert.throws(() => resources.rasterSize(invalid, 900, 480, 1), /Dimensions/);
});
test('limiteur : deux tâches maximum, une erreur libère sa place', async () => {
  for (const invalid of [0, -1, 1.5, NaN]) assert.throws(() => resources.createTaskLimiter(invalid), /Limite/);
  const limited = resources.createTaskLimiter(2);
  const gates = [deferred(), deferred(), deferred(), deferred()];
  let active = 0, maximum = 0;
  const started = [];
  const jobs = gates.map((gate, index) => limited(async () => {
    started.push(index); active++; maximum = Math.max(maximum, active);
    try { return await gate.promise; } finally { active--; }
  }));
  const results = Promise.allSettled(jobs);
  await tick();
  assert.deepEqual(started, [0, 1]);
  gates[0].reject(new Error('Échec simulé'));
  await tick();
  assert.deepEqual(started, [0, 1, 2]);
  gates[1].resolve(1); gates[2].resolve(2);
  await tick();
  gates[3].resolve(3);
  assert.deepEqual((await results).map((item) => item.status), ['rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
  assert.equal(maximum, 2);
});
test('limiteur : une tâche annulée en attente ne démarre jamais', async () => {
  const limited = resources.createTaskLimiter(1);
  const gate = deferred(), controller = new AbortController();
  let calls = 0;
  const first = limited(() => gate.promise);
  const cancelled = limited(async () => { calls++; }, controller.signal);
  const rejection = assert.rejects(cancelled, { name: 'AbortError' });
  const last = limited(async () => { calls++; return 'fin'; });
  controller.abort();
  await rejection;
  gate.resolve();
  await first;
  assert.equal(await last, 'fin');
  assert.equal(calls, 1);
  await assert.rejects(limited(async () => { calls++; }, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

// Génération : vrai orchestrateur avec canvas et moteur PDF simulés.
test('PDF : page 1 seulement, numPages, JPEG 0,8 puis libération canvas/page/document', async () => {
  const fixture = rendererFixture();
  const result = await generation.createPreviewGenerator(fixture.renderer)(source, 'pdf', { pixelRatio: 3 });
  assert.equal(result.pageCount, 24);
  assert.equal(result.blob.type, 'image/jpeg');
  assert.deepEqual(fixture.calls.pages, [1]);
  assert.deepEqual(fixture.calls.exports, [{ width: 960, height: 1440, mime: 'image/jpeg', quality: 0.8 }]);
  assert.equal(fixture.calls.renders[0].background, '#ffffff');
  assert.deepEqual(fixture.calls.fills, [[0, 0, 960, 1440]]);
  assert.equal(fixture.calls.pageCleaned, 1);
  assert.equal(fixture.calls.pdfClosed, 1);
  assert.ok(fixture.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
});
test('PDF avec miniature existante : compte seul sans page, canvas ni export', async () => {
  const fixture = rendererFixture({ pages: 7 });
  const result = await generation.createPreviewGenerator(fixture.renderer)(source, 'pdf', { thumbnail: false });
  assert.deepEqual(result, { blob: null, pageCount: 7 });
  assert.deepEqual(fixture.calls.pages, []);
  assert.equal(fixture.canvases.length, 0);
  assert.equal(fixture.calls.pdfClosed, 1);
});
test('image : 480 px sans agrandir les petits originaux, compte égal à un', async () => {
  for (const [width, height, expectedWidth, expectedHeight] of [[1200, 800, 480, 320], [240, 160, 240, 160]]) {
    const fixture = rendererFixture({ width, height });
    const result = await generation.createPreviewGenerator(fixture.renderer)(source, 'image', { pixelRatio: 5 });
    assert.equal(result.pageCount, 1);
    assert.deepEqual(fixture.calls.exports, [{ width: expectedWidth, height: expectedHeight, mime: 'image/jpeg', quality: 0.8 }]);
    assert.equal(fixture.calls.images.length, 1);
    assert.equal(fixture.calls.imageClosed, 1);
    assert.equal(fixture.calls.pdfClosed, 0);
    assert.ok(fixture.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
  }
});
test('formats sans aperçu : aucune ressource de rendu', async () => {
  const fixture = rendererFixture();
  const generate = generation.createPreviewGenerator(fixture.renderer);
  for (const type of ['word', 'powerpoint', 'text', 'other', null]) assert.equal(await generate(source, type), null);
  assert.equal(fixture.canvases.length, 0);
  assert.equal(fixture.calls.pdfClosed + fixture.calls.imageClosed, 0);
});
test('génération : compte PDF invalide refusé, document toujours fermé', async () => {
  for (const pages of [0, -1, 1.5, Infinity, NaN]) {
    const fixture = rendererFixture({ pages });
    await assert.rejects(generation.createPreviewGenerator(fixture.renderer)(source, 'pdf'), /Nombre de pages/);
    assert.equal(fixture.calls.pdfClosed, 1);
    assert.equal(fixture.canvases.length, 0);
  }
});
test('génération : canvas absent, export nul/MIME incorrect/vide/trop grand restent des échecs nettoyés', async () => {
  for (const options of [
    { noContext: true }, { output: null }, { output: new Blob(['png'], { type: 'image/png' }) },
    { output: new Blob([], { type: 'image/jpeg' }) }, { output: new Blob([new Uint8Array(1048577)], { type: 'image/jpeg' }) },
  ]) {
    const fixture = rendererFixture(options);
    await assert.rejects(generation.createPreviewGenerator(fixture.renderer)(source, 'pdf'));
    assert.equal(fixture.calls.pdfClosed, 1);
    assert.equal(fixture.calls.pageCleaned, 1);
    assert.ok(fixture.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
  }
});
test('génération : annuler un rendu actif annule pdf.js et nettoie toutes les ressources', async () => {
  const rendering = deferred(), controller = new AbortController();
  const fixture = rendererFixture({ renderPromise: rendering.promise, cancel: () => rendering.reject(new DOMException('Annulation simulée', 'AbortError')) });
  const job = generation.createPreviewGenerator(fixture.renderer)(source, 'pdf', { signal: controller.signal });
  const rejection = assert.rejects(job, { name: 'AbortError' });
  await tick();
  assert.equal(fixture.calls.renders.length, 1);
  controller.abort();
  await rejection;
  assert.equal(fixture.calls.cancelled, 1);
  assert.equal(fixture.calls.pdfClosed, 1);
  assert.equal(fixture.calls.pageCleaned, 1);
  assert.equal(fixture.calls.exports.length, 0);
  assert.equal(fixture.canvases[0].width, 0);
});
test('génération : un export tardif après annulation ne devient pas un succès', async () => {
  let exportCallback;
  const controller = new AbortController();
  const fixture = rendererFixture({ export: (callback) => { exportCallback = callback; } });
  const job = generation.createPreviewGenerator(fixture.renderer)(source, 'image', { signal: controller.signal });
  const rejection = assert.rejects(job, { name: 'AbortError' });
  await tick();
  assert.equal(typeof exportCallback, 'function');
  controller.abort();
  await rejection;
  exportCallback(thumbnail());
  assert.equal(fixture.calls.imageClosed, 1);
  assert.equal(fixture.canvases[0].width, 0);
});
test('générateur partagé : deux décodages maximum et troisième annulé sans allocation', async () => {
  const fixture = rendererFixture(), gates = [], controller = new AbortController();
  let active = 0, maximum = 0;
  fixture.renderer.image = async () => {
    active++; maximum = Math.max(maximum, active);
    const gate = deferred(); gates.push(gate);
    await gate.promise;
    return { source: {}, width: 1200, height: 800, dispose: () => { active--; } };
  };
  const generate = generation.createPreviewGenerator(fixture.renderer);
  const first = generate(source, 'image'), second = generate(source, 'image');
  const third = generate(source, 'image', { signal: controller.signal });
  const rejected = assert.rejects(third, { name: 'AbortError' });
  await tick();
  assert.equal(gates.length, 2);
  controller.abort(); await rejected;
  gates.forEach((gate) => gate.resolve());
  await Promise.all([first, second]);
  assert.equal(maximum, 2);
  assert.equal(active, 0);
  assert.equal(fixture.canvases.length, 2);
});

// Relecture de l'identité et confirmation SQL, indépendantes du renderer.
function completionDependencies(item, overrides = {}) {
  return {
    check: () => {}, read: async () => item, source: async () => source,
    generate: async () => ({ blob: thumbnail(), pageCount: 24 }),
    save: async (actual, preview) => confirmed(actual, preview.pageCount), ...overrides,
  };
}
test('besoin d’aperçu : actifs PDF/image seulement, compte PDF manquant compris', () => {
  assert.equal(completion.needsDocumentPreview(document()), true);
  assert.equal(completion.needsDocumentPreview(document(1, { thumbnail_path: 'existant.webp' })), true);
  assert.equal(completion.needsDocumentPreview(confirmed(document())), false);
  assert.equal(completion.needsDocumentPreview(document(1, { file_type: 'image', thumbnail_path: 'existant.webp' })), false);
  for (const patch of [{ deleted_at: '2026-01-02T00:00:00Z' }, { file_type: 'word' }, { file_type: null }]) {
    assert.equal(completion.needsDocumentPreview(document(1, patch)), false);
  }
});
test('complétion : original réutilisé, lecture/génération/sauvegarde dans cet ordre', async () => {
  const item = document(), calls = [];
  const result = await completion.finishDocumentPreview(item, completionDependencies(item, {
    read: async () => { calls.push('read'); return item; },
    source: async () => { assert.fail('Le fichier déjà en mémoire ne doit pas être téléchargé à nouveau.'); },
    generate: async (blob, type, options) => {
      calls.push('generate'); assert.equal(blob, source); assert.equal(type, 'pdf'); assert.equal(options.thumbnail, true);
      return { blob: thumbnail(), pageCount: 24 };
    },
    save: async (actual, preview) => { calls.push('save'); return confirmed(actual, preview.pageCount); },
  }), source);
  assert.deepEqual(calls, ['read', 'generate', 'save']);
  assert.equal(result.id, item.id);
  assert.equal(result.page_count, 24);
});
test('complétion : relecture déjà complète sans téléchargement ni rendu ni sauvegarde', async () => {
  const item = document(), saved = confirmed(item);
  const forbidden = async () => assert.fail('Travail inutile');
  assert.equal(await completion.finishDocumentPreview(item, completionDependencies(item, {
    read: async () => saved, source: forbidden, generate: forbidden, save: forbidden,
  })), saved);
});
test('complétion : identité changée ou mise en corbeille interdit tout téléchargement', async () => {
  const item = document();
  for (const patch of [{ id: document(2).id }, { user_id: 'autre-compte' }, { file_path: 'autre.pdf' }, { file_type: 'image' }, { deleted_at: '2026-01-02T00:00:00Z' }]) {
    await assert.rejects(completion.finishDocumentPreview(item, completionDependencies(item, {
      read: async () => ({ ...item, ...patch }), source: async () => assert.fail('Téléchargement interdit'),
    })), /plus disponible/);
  }
});
test('complétion : contenu vide, taille différente ou au-delà de 20 Mio refusé avant rendu', async () => {
  for (const blob of [new Blob(), new Blob(['différent']), new Blob([new Uint8Array(20 * 1024 * 1024 + 1)])]) {
    await assert.rejects(completion.finishDocumentPreview(document(), completionDependencies(document(), {
      generate: async () => assert.fail('Rendu interdit'),
    }), blob), /contenu du fichier/);
  }
});
test('complétion : conserve le chemin historique et demande seulement le compte', async () => {
  const item = document(1, { thumbnail_path: `${author}/${document().id}/${'b'.repeat(64)}.webp` });
  const result = await completion.finishDocumentPreview(item, completionDependencies(item, {
    generate: async (_source, _type, options) => { assert.equal(options.thumbnail, false); return { blob: null, pageCount: 8 }; },
  }));
  assert.equal(result.thumbnail_path, item.thumbnail_path);
  assert.equal(result.page_count, 8);
});
test('complétion : la réponse de sauvegarde doit confirmer un aperçu complet du même document', async () => {
  const item = document();
  for (const response of [item, confirmed(document(2)), confirmed({ ...item, deleted_at: '2026-01-02T00:00:00Z' })]) {
    await assert.rejects(completion.finishDocumentPreview(item, completionDependencies(item, { save: async () => response })));
  }
  for (const preview of [null, { blob: thumbnail(), pageCount: 0 }, { blob: thumbnail(), pageCount: 1.5 }]) {
    await assert.rejects(completion.finishDocumentPreview(item, completionDependencies(item, {
      generate: async () => preview, save: async () => assert.fail('Sauvegarde interdite'),
    })), /Aperçu incomplet/);
  }
  await assert.rejects(completion.finishDocumentPreview(document(1, { file_type: 'image' }), completionDependencies(document(1, { file_type: 'image' }))), /Aperçu incomplet/);
});
test('complétion : changement de scope après génération empêche la sauvegarde', async () => {
  let current = true;
  const item = document();
  await assert.rejects(completion.finishDocumentPreview(item, completionDependencies(item, {
    check: () => { if (!current) throw new Error('Scope périmé'); },
    generate: async () => { current = false; return { blob: thumbnail(), pageCount: 24 }; },
    save: async () => assert.fail('Sauvegarde interdite'),
  })), /Scope périmé/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(completion.finishDocumentPreview(item, completionDependencies(item, {
    read: async () => assert.fail('Lecture interdite'),
  }), undefined, controller.signal), { name: 'AbortError' });
});

// Rattrapage : RPC et écritures simulées, curseur et file de production.
test('rattrapage : découverte keyset complète avant total, puis un fichier à la fois', async () => {
  const documents = Array.from({ length: 21 }, (_, index) => document(index + 1));
  const cursors = [], snapshots = [], completed = [];
  let active = 0, maximum = 0;
  const queue = backfill.createPreviewBackfill({
    isCurrent: () => true,
    list: async (after) => { cursors.push(after); return after === null ? documents.slice(0, 20) : documents.slice(20); },
    complete: async (item) => {
      assert.deepEqual(cursors, [null, documents[19].id]);
      active++; maximum = Math.max(maximum, active); await tick(); active--; completed.push(item.id);
      return confirmed(item);
    },
  });
  queue.subscribe(() => snapshots.push(queue.getSnapshot()));
  await queue.start();
  assert.equal(maximum, 1);
  assert.deepEqual(completed, documents.map((item) => item.id));
  assert.ok(snapshots.filter((state) => state.phase === 'discovering').every((state) => state.total === 0));
  assert.ok(snapshots.filter((state) => state.phase === 'running').every((state) => state.total === 21));
  assert.deepEqual(queue.getSnapshot(), { phase: 'complete', total: 21, processed: 21, succeeded: 21, failures: [], currentFile: null, error: null });
});
test('rattrapage : une erreur de fichier est comptée par nom, pas exposée techniquement', async () => {
  const items = [document(1), document(2), document(3)];
  const queue = backfill.createPreviewBackfill({ isCurrent: () => true, list: async () => items,
    complete: async (item) => { if (item.id === items[1].id) throw new Error('provider-secret-fictif'); return confirmed(item); },
  });
  await queue.start();
  const state = queue.getSnapshot();
  assert.equal(state.phase, 'complete'); assert.equal(state.processed, 3); assert.equal(state.succeeded, 2);
  assert.deepEqual(state.failures, [{ id: items[1].id, fileName: items[1].file_name }]);
  assert.doesNotMatch(JSON.stringify(state), /provider-secret/);
});
test('rattrapage : pause après le fichier courant et reprise sans retraitement', async () => {
  const items = [document(1), document(2)], gate = deferred(), calls = [];
  let lists = 0;
  const queue = backfill.createPreviewBackfill({ isCurrent: () => true, list: async () => { lists++; return items; },
    complete: async (item) => { calls.push(item.id); if (calls.length === 1) await gate.promise; return confirmed(item); },
  });
  const first = queue.start();
  assert.equal(queue.start(), first, 'Les doubles clics partagent le même passage.');
  await tick(); queue.pause();
  assert.equal(queue.getSnapshot().processed, 0);
  gate.resolve(); await first;
  assert.equal(queue.getSnapshot().phase, 'paused');
  assert.equal(queue.getSnapshot().processed, 1);
  assert.deepEqual(calls, [items[0].id]);
  await queue.resume();
  assert.deepEqual(calls, items.map((item) => item.id));
  assert.equal(lists, 1);
  assert.equal(queue.getSnapshot().phase, 'complete');
});
test('rattrapage : nouveau passage redécouvre les manquants depuis null', async () => {
  const item = document(), cursors = [];
  let complete = false;
  const queue = backfill.createPreviewBackfill({ isCurrent: () => true,
    list: async (after) => { cursors.push(after); return complete ? [] : [item]; },
    complete: async (actual) => { complete = true; return confirmed(actual); },
  });
  await queue.start(); await queue.start();
  assert.deepEqual(cursors, [null, null]);
  assert.equal(queue.getSnapshot().total, 0);
  assert.equal(queue.getSnapshot().processed, 0);
});
test('rattrapage : ignore formats non prévisualisables, corbeille et éléments déjà complets', async () => {
  const queue = backfill.createPreviewBackfill({ isCurrent: () => true,
    list: async () => [confirmed(document(1)), document(2, { file_type: 'word' }), document(3, { deleted_at: '2026-01-02T00:00:00Z' })],
    complete: async () => assert.fail('Écriture interdite'),
  });
  await queue.start(); assert.equal(queue.getSnapshot().total, 0);
});
test('rattrapage : pages trop longues, doublons ou ordre non croissant refusés avant écriture', async () => {
  for (const items of [[document(), document()], [document(2), document(1)], Array.from({ length: 21 }, (_, index) => document(index + 1))]) {
    const queue = backfill.createPreviewBackfill({ isCurrent: () => true, list: async () => items,
      complete: async () => assert.fail('Écriture interdite'),
    });
    await queue.start();
    assert.equal(queue.getSnapshot().phase, 'error');
    assert.equal(queue.getSnapshot().processed, 0);
    assert.doesNotMatch(queue.getSnapshot().error, /curseur|incompatible/i);
  }
});
test('rattrapage : réponse incomplète ou d’un autre document n’est jamais un succès', async () => {
  for (const response of [document(), confirmed(document(2))]) {
    const queue = backfill.createPreviewBackfill({ isCurrent: () => true, list: async () => [document()], complete: async () => response });
    await queue.start(); assert.equal(queue.getSnapshot().succeeded, 0); assert.equal(queue.getSnapshot().failures.length, 1);
  }
});
test('rattrapage : ancien compte et réponses tardives ne modifient plus l’affichage', async () => {
  const gate = deferred(); let current = true, notices = 0;
  const queue = backfill.createPreviewBackfill({ isCurrent: () => current, list: async () => [document()],
    complete: async (item) => { await gate.promise; return confirmed(item); },
  });
  queue.subscribe(() => { notices++; });
  const task = queue.start(); await tick();
  const snapshot = queue.getSnapshot(), count = notices;
  current = false; gate.resolve(); await task; await queue.start();
  assert.equal(queue.getSnapshot(), snapshot); assert.equal(notices, count);
  assert.equal(snapshot.processed, 0);
});
test('rattrapage : annulation au démontage remet la file au repos et permet un nouveau passage', async () => {
  const gate = deferred(); let calls = 0;
  const queue = backfill.createPreviewBackfill({ isCurrent: () => true, list: async () => [document()],
    complete: async (item) => { if (++calls === 1) await gate.promise; return confirmed(item); },
  });
  const first = queue.start(); await tick(); queue.cancelPending();
  assert.equal(queue.getSnapshot().phase, 'idle');
  assert.equal(queue.getSnapshot().currentFile, null);
  const restarted = queue.start();
  gate.resolve(); await Promise.all([first, restarted]);
  assert.equal(calls, 2);
  assert.equal(queue.getSnapshot().phase, 'complete');
  assert.equal(queue.getSnapshot().failures.length, 0);
  assert.equal(queue.getSnapshot().succeeded, 1);
  queue.dispose(); await queue.start(); assert.equal(calls, 2);
});

test('zoom image : limites 1–4×, déplacements bornés et ancre de pincement préservée', () => {
  assert.deepEqual(zoom.boundImageTransform({ scale: 9, x: 9999, y: -9999 }, 320, 500), { scale: 4, x: 480, y: -750 });
  assert.deepEqual(zoom.boundImageTransform({ scale: 0.5, x: 100, y: 100 }, 320, 500), { scale: 1, x: 0, y: 0 });
  assert.deepEqual(zoom.boundImageTransform({ scale: NaN, x: Infinity, y: NaN }, 320, 500), { scale: 1, x: 0, y: 0 });
  assert.deepEqual(zoom.pinchImage({ scale: 1, x: 0, y: 0 }, { x: 20, y: 30 }, { x: 25, y: 35 }, 2, 320, 500), { scale: 2, x: -15, y: -25 });
});
