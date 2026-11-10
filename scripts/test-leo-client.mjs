import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

// Transport et contrôleur de production ; réseau/Auth simulés, sans .env.
let vite, client, sessionModule, navigation;
const root = fileURLToPath(new URL('../', import.meta.url));
const actor = '11111111-1111-4111-8111-111111111111';
const id = (n) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const plan = { keywords: ['algebre'], school: 'EPAC', subject: null, type: 'examen', period: { from: null, to: null }, sort: 'relevance', reformulation: 'Les sujets d’algèbre de l’EPAC.' };
const document = (n = 1, overrides = {}) => ({
  id: id(n), user_id: actor, title: 'Sujet d’algèbre', description: 'Épreuve de test',
  file_name: 'algebre.pdf', file_path: `${actor}/algebre.pdf`, file_type: 'pdf', file_size: 1234,
  created_at: '2026-01-02T00:00:00Z', school_name: 'EPAC', subject_name: 'Algèbre', status: 'approved',
  rejection_reason: null, reviewed_by: null, reviewed_at: null, deleted_at: null, deleted_by: null,
  thumbnail_path: null, page_count: 3, ...overrides,
});
const planned = (overrides = {}) => ({ action: 'plan', requestId: id(100), inScope: true, plan, fallback: false, ...overrides });
const searched = (overrides = {}) => ({ action: 'search', requestId: id(100), documents: [document()], fallback: false, ...overrides });
const ranked = (overrides = {}) => ({ action: 'rank', requestId: id(100), documents: [document()], explanations: [{ id: id(1), text: 'Le titre correspond.' }], fallback: false, ...overrides });
const scope = { userId: actor, projectUrl: 'https://leo.invalid', generation: 1 };
before(async () => {
  vite = await createServer({ root, configFile: false, envDir: false, optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
  client = await vite.ssrLoadModule('/src/lib/leo-client.ts');
  sessionModule = await vite.ssrLoadModule('/src/lib/leo-session.ts');
  navigation = await vite.ssrLoadModule('/src/lib/library-navigation.ts');
});
after(async () => { await vite?.close(); });
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise((done) => setImmediate(done));
function fixture(options = {}) {
  let current = true;
  const calls = [], snapshots = [];
  const session = sessionModule.createLeoSession({ scope, isCurrent: () => current, request: async (body, signal) => {
    calls.push({ body, signal });
    if (options.request) return options.request(body, signal);
    return body.action === 'plan' ? planned(options.plan) : body.action === 'search' ? searched(options.search) : ranked(options.rank);
  } });
  session.subscribe(() => snapshots.push(session.getSnapshot()));
  return { session, calls, snapshots, invalidate: () => { current = false; } };
}
function transport(options = {}) {
  const seen = [];
  const request = client.createLeoTransport({ ...scope, publicKey: 'PUBLIC_TEST_KEY', isCurrent: () => true,
    getSession: async () => ({ data: { session: { access_token: 'TEST_USER_JWT', user: { id: actor } } }, error: null }),
    fetch: async (url, init) => { seen.push({ url, init }); return Response.json(planned()); }, ...options });
  return { request, seen };
}

test('progression uniquement après les réponses réelles et appels séquentiels', async () => {
  const waits = [deferred(), deferred(), deferred()];
  const f = fixture({ request: (body) => waits[['plan', 'search', 'rank'].indexOf(body.action)].promise });
  const pending = f.session.submit('Sujets d’algèbre');
  await tick();
  assert.deepEqual(f.calls.map((call) => call.body.action), ['plan']);
  assert.deepEqual(f.session.getSnapshot().entries[0].steps, ['active', 'pending', 'pending']);
  waits[0].resolve(planned()); await tick();
  assert.deepEqual(f.calls.map((call) => call.body.action), ['plan', 'search']);
  assert.deepEqual(f.session.getSnapshot().entries[0].steps, ['complete', 'active', 'pending']);
  waits[1].resolve(searched()); await tick();
  assert.deepEqual(f.calls.map((call) => call.body.action), ['plan', 'search', 'rank']);
  assert.deepEqual(f.session.getSnapshot().entries[0].steps, ['complete', 'complete', 'active']);
  waits[2].resolve(ranked()); assert.equal(await pending, true);
  assert.deepEqual(f.session.getSnapshot().entries[0].steps, ['complete', 'complete', 'complete']);
  assert.equal(f.session.getSnapshot().busy, false);
  assert.deepEqual(Object.keys(f.calls[2].body).sort(), ['action', 'prompt', 'requestId', 'plan', 'fallback'].sort());
});
test('double envoi empêché avant le premier await', async () => {
  const wait = deferred(); const f = fixture({ request: () => wait.promise });
  const pending = f.session.submit('Algèbre');
  assert.equal(await f.session.submit('Physique'), false); await tick(); assert.equal(f.calls.length, 1);
  f.session.cancel(); assert.equal(await pending, false);
});
test('500 caractères maximum, pas d’appel pour une saisie vide ou invalide', async () => {
  const f = fixture();
  for (const value of ['', '   ', 'x'.repeat(501)]) assert.equal(await f.session.submit(value), false);
  assert.equal(f.calls.length, 0); assert.match(f.session.getSnapshot().validation, /500/);
});
test('hors périmètre : les deux étapes suivantes sont ignorées, pas simulées', async () => {
  const f = fixture({ plan: { inScope: false, plan: null } });
  assert.equal(await f.session.submit('Raconte une blague'), true);
  assert.equal(f.calls.length, 1); assert.equal(f.session.getSnapshot().entries[0].outcome, 'out-of-scope');
  assert.deepEqual(f.session.getSnapshot().entries[0].steps, ['complete', 'skipped', 'skipped']);
});
test('repli et zéro candidat font tout de même les trois appels', async () => {
  const f = fixture({ plan: { fallback: true }, search: { fallback: true, documents: [] }, rank: { fallback: true, documents: [], explanations: [] } });
  assert.equal(await f.session.submit('Algèbre'), true);
  assert.deepEqual(f.calls.map((call) => call.body.action), ['plan', 'search', 'rank']);
  assert.equal(f.session.getSnapshot().entries[0].fallback, true); assert.equal(f.session.getSnapshot().entries[0].candidateCount, 0);
});
test('erreur et quota conservés sans texte technique, réessai depuis un nouveau plan', async () => {
  for (const code of ['error', 'quota']) {
    let failed = false;
    const f = fixture({ request: async (body) => {
      if (body.action === 'search' && !failed) { failed = true; throw new client.LeoClientError(code); }
      return body.action === 'plan' ? planned() : body.action === 'search' ? searched() : ranked();
    } });
    f.session.setDraft('Algèbre'); assert.equal(await f.session.submit('Algèbre'), false);
    const entry = f.session.getSnapshot().entries[0];
    assert.equal(entry.error, code); assert.equal(f.session.getSnapshot().draft, 'Algèbre');
    assert.deepEqual(entry.steps, ['complete', 'error', 'skipped']);
    assert.equal(await f.session.retry(entry.id), true);
    assert.deepEqual(f.calls.map((call) => call.body.action), ['plan', 'search', 'plan', 'search', 'rank']);
  }
});
test('annulation à chacune des étapes : signal interrompu et réponse tardive ignorée', async () => {
  for (const action of ['plan', 'search', 'rank']) {
    const entered = deferred(), wait = deferred();
    const f = fixture({ request: async (body) => {
      if (body.action === action) { entered.resolve(); return wait.promise; }
      return body.action === 'plan' ? planned() : searched();
    } });
    const pending = f.session.submit('Algèbre'); await entered.promise; f.session.cancel();
    assert.equal(await pending, false); const before = f.calls.length;
    assert.equal(f.calls.at(-1).signal.aborted, true);
    wait.resolve(action === 'plan' ? planned() : action === 'search' ? searched() : ranked()); await tick();
    assert.equal(f.calls.length, before); assert.equal(f.session.getSnapshot().entries[0].outcome, 'cancelled');
    assert.equal(f.session.getSnapshot().entries[0].documents.length, 0);
  }
});
test('une ancienne tentative annulée ne peut ni écraser ni déverrouiller la suivante', async () => {
  const oldWait = deferred(), nextWait = deferred(), oldEntered = deferred(), nextEntered = deferred();
  const f = fixture({ request: (body) => {
    if (body.action === 'plan') {
      if (body.prompt === 'Ancienne demande') { oldEntered.resolve(); return oldWait.promise; }
      nextEntered.resolve(); return nextWait.promise;
    }
    return body.action === 'search' ? searched() : ranked();
  } });
  const old = f.session.submit('Ancienne demande'); await oldEntered.promise;
  f.session.cancel();
  const next = f.session.submit('Nouvelle demande'); await nextEntered.promise;
  assert.equal(await old, false);
  oldWait.resolve(planned()); await tick();
  assert.equal(f.session.getSnapshot().busy, true);
  assert.equal(await f.session.submit('Double demande'), false);
  assert.deepEqual(f.calls.map((call) => call.body.prompt), ['Ancienne demande', 'Nouvelle demande']);
  assert.equal(f.session.getSnapshot().entries[0].outcome, 'cancelled');
  assert.equal(f.session.getSnapshot().entries[1].outcome, 'running');
  nextWait.resolve(planned()); assert.equal(await next, true);
  assert.equal(f.session.getSnapshot().entries[1].prompt, 'Nouvelle demande');
  assert.equal(f.session.getSnapshot().entries[1].outcome, 'done');
  assert.equal(f.session.getSnapshot().busy, false);
});
test('un réessai réutilise la demande mais jamais l’identifiant serveur précédent', async () => {
  let plans = 0;
  const f = fixture({ request: async (body) => {
    if (body.action === 'plan') return planned({ requestId: id(100 + ++plans) });
    if (body.requestId === id(101)) throw new client.LeoClientError();
    return body.action === 'search' ? searched({ requestId: body.requestId }) : ranked({ requestId: body.requestId });
  } });
  assert.equal(await f.session.submit('Algèbre'), false);
  assert.equal(await f.session.retry(f.session.getSnapshot().entries[0].id), true);
  assert.deepEqual(f.calls.map(({ body }) => [body.action, body.requestId]), [
    ['plan', undefined], ['search', id(101)], ['plan', undefined], ['search', id(102)], ['rank', id(102)],
  ]);
});
test('changement de scope et destruction effacent historique et brouillon', async () => {
  const f = fixture(); await f.session.submit('Algèbre'); f.session.setDraft('Brouillon privé');
  f.invalidate(); f.session.clear();
  assert.equal(f.session.getSnapshot().entries.length, 0); assert.equal(f.session.getSnapshot().draft, '');
  assert.equal(await f.session.submit('Autre compte'), false);
  const other = fixture(); assert.equal(other.session.getSnapshot().entries.length, 0);
});
test('ancien compte : aucune publication tardive ni étape supplémentaire', async () => {
  const wait = deferred(), entered = deferred();
  const f = fixture({ request: () => { entered.resolve(); return wait.promise; } });
  const pending = f.session.submit('Algèbre'); await entered.promise;
  f.invalidate(); f.session.clear(); wait.resolve(planned()); assert.equal(await pending, false);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.session.getSnapshot().entries, []);
});
test('historique mémoire borné à 20 recherches, sélection et retour sans nouvel appel', async () => {
  const f = fixture(); for (let n = 0; n < 22; n++) await f.session.submit(`Algèbre ${n}`);
  assert.equal(f.session.getSnapshot().entries.length, 20);
  const entry = f.session.getSnapshot().entries[0], count = f.calls.length;
  f.session.select(entry.id); f.session.cancel(); assert.equal(f.session.getSnapshot().selectedId, entry.id);
  assert.equal(f.calls.length, count); assert.equal(f.session.getSnapshot().entries[0].documents.length, 1);
});
test('les résultats finaux ne peuvent pas ajouter un candidat absent de la recherche', async () => {
  const f = fixture({ rank: { documents: [document(99)], explanations: [] } });
  assert.equal(await f.session.submit('Algèbre'), false); assert.equal(f.session.getSnapshot().entries[0].error, 'error');
});
test('mutations confirmées : retrait des liens et explications devenus obsolètes', async () => {
  const f = fixture(); await f.session.submit('Algèbre');
  f.session.updateDocument(document(1, { title: 'Nouveau titre' }));
  assert.equal(f.session.getSnapshot().entries[0].documents[0].title, 'Nouveau titre');
  assert.equal(f.session.getSnapshot().entries[0].explanations.length, 0);
  f.session.removeDocument(id(1)); assert.equal(f.session.getSnapshot().entries[0].documents.length, 0);
  assert.equal(f.session.getSnapshot().entries[0].candidates.length, 0);
});
test('aperçu confirmé : résultats et candidats complétés sans perdre les explications', async () => {
  const existing = document(1, { title: 'Titre récent', description: 'Description récente' });
  const f = fixture({ rank: { documents: [existing] } });
  await f.session.submit('Algèbre');
  const previous = f.session.getSnapshot().entries[0];
  const preview = document(1, { thumbnail_path: `${actor}/${id(1)}/${'a'.repeat(64)}.jpg` });
  f.session.updateDocumentPreview(preview);
  const result = f.session.getSnapshot().entries[0];
  const expected = { ...existing, thumbnail_path: preview.thumbnail_path };
  assert.deepEqual(result.documents, [expected]);
  assert.deepEqual(result.candidates, [expected]);
  assert.equal(result.explanations, previous.explanations);
  assert.equal(f.calls.length, 3, 'Aucune nouvelle recherche ni classement.');
});
test('aperçu Léo : identité, compte immuable, retrait et ancien scope respectés', async () => {
  const f = fixture(); await f.session.submit('Algèbre');
  const existing = f.session.getSnapshot().entries[0].documents[0];
  const preview = document(1, { thumbnail_path: `${actor}/${id(1)}/${'a'.repeat(64)}.jpg` });
  for (const changes of [{ user_id: id(99) }, { file_path: 'autre.pdf' }, { page_count: 4 }, { deleted_at: '2026-01-03T00:00:00Z' }]) {
    f.session.updateDocumentPreview({ ...preview, ...changes });
    assert.equal(f.session.getSnapshot().entries[0].documents[0], existing);
  }
  f.session.updateDocumentPreview(document(99, { thumbnail_path: 'hors-resultats.jpg' }));
  assert.deepEqual(f.session.getSnapshot().entries[0].documents.map((item) => item.id), [id(1)]);
  f.session.removeDocument(id(1));
  f.session.updateDocumentPreview(preview);
  assert.deepEqual(f.session.getSnapshot().entries[0].documents, []);
  assert.deepEqual(f.session.getSnapshot().entries[0].candidates, []);
  f.invalidate();
  const before = f.session.getSnapshot();
  f.session.updateDocumentPreview(preview);
  assert.equal(f.session.getSnapshot(), before);
});
test('transport JWT utilisateur, clé publique, no-store, aucun secret Gemini', async () => {
  const f = transport(); const response = await f.request({ action: 'plan', prompt: 'Algèbre' }, new AbortController().signal);
  assert.equal(response.action, 'plan'); const sent = f.seen[0];
  assert.equal(sent.url, 'https://leo.invalid/functions/v1/leo-search');
  assert.equal(sent.init.headers.Authorization, 'Bearer TEST_USER_JWT'); assert.equal(sent.init.headers.apikey, 'PUBLIC_TEST_KEY');
  assert.equal(sent.init.cache, 'no-store'); assert.equal(sent.init.credentials, 'omit'); assert.equal(sent.init.redirect, 'error');
  assert.deepEqual(JSON.parse(sent.init.body), { action: 'plan', prompt: 'Algèbre' });
});
test('corps d’erreur HTTP jamais lu ni exposé : 429, 401, 400, 503', async () => {
  for (const [status, code] of [[429, 'quota'], [401, 'auth'], [400, 'invalid'], [503, 'error']]) {
    const f = transport({ fetch: async () => ({ ok: false, status, text: () => { throw new Error('Ne pas lire'); } }) });
    await assert.rejects(f.request({ action: 'plan', prompt: 'Algèbre' }, new AbortController().signal), (error) => error instanceof client.LeoClientError && error.code === code && !error.message.includes('SQL'));
  }
});
test('session absente ou autre compte : pas de fetch', async () => {
  for (const session of [null, { access_token: 'TEST_OTHER', user: { id: id(99) } }]) {
    const f = transport({ getSession: async () => ({ data: { session }, error: null }) });
    await assert.rejects(f.request({ action: 'plan', prompt: 'Algèbre' }, new AbortController().signal), (error) => error.code === 'auth');
    assert.equal(f.seen.length, 0);
  }
});
test('session relue après réseau : rejet du résultat d’un ancien compte', async () => {
  let reads = 0;
  const f = transport({ getSession: async () => ({ data: { session: { access_token: 'TEST_USER', user: { id: ++reads === 1 ? actor : id(99) } } }, error: null }) });
  await assert.rejects(f.request({ action: 'plan', prompt: 'Algèbre' }, new AbortController().signal), (error) => error.code === 'auth');
  assert.equal(reads, 2);
});
test('annulation et timeout interrompent aussi un fetch ou corps ignorant le signal', async () => {
  for (const body of [false, true]) {
    const f = transport({ timeoutMs: 20, fetch: async () => body ? { ok: true, text: () => new Promise(() => {}) } : new Promise(() => {}) });
    await assert.rejects(f.request({ action: 'plan', prompt: 'Algèbre' }, new AbortController().signal), (error) => error.code === 'error');
  }
  const controller = new AbortController(); controller.abort(); const f = transport();
  await assert.rejects(f.request({ action: 'plan', prompt: 'Algèbre' }, controller.signal), (error) => error.name === 'AbortError');
  assert.equal(f.seen.length, 0);
});
test('une lecture Auth bloquée est bornée avant et après la réponse réseau', async () => {
  for (const blockAfterNetwork of [false, true]) {
    let reads = 0;
    const waiting = deferred();
    const f = transport({ timeoutMs: 30, getSession: () => {
      reads++;
      if (!blockAfterNetwork || reads === 2) return waiting.promise;
      return Promise.resolve({ data: { session: { access_token: 'TEST_USER', user: { id: actor } } }, error: null });
    } });
    await assert.rejects(f.request({ action: 'plan', prompt: 'Algèbre' }, new AbortController().signal), (error) => error.code === 'error');
    const count = f.seen.length;
    assert.equal(count, blockAfterNetwork ? 1 : 0);
    waiting.resolve({ data: { session: { access_token: 'TEST_USER', user: { id: actor } } }, error: null });
    await tick();
    assert.equal(f.seen.length, count, 'Une lecture Auth tardive ne doit pas déclencher un nouvel appel.');
  }
});
test('annuler pendant Auth empêche tout envoi, même si Auth répond ensuite', async () => {
  const waiting = deferred(), entered = deferred(), controller = new AbortController();
  const f = transport({ getSession: () => { entered.resolve(); return waiting.promise; } });
  const result = f.request({ action: 'plan', prompt: 'Algèbre' }, controller.signal);
  await entered.promise; controller.abort();
  await assert.rejects(result, (error) => error.name === 'AbortError');
  waiting.resolve({ data: { session: { access_token: 'TEST_USER', user: { id: actor } } }, error: null });
  await tick(); assert.equal(f.seen.length, 0);
});
test('validation stricte : action, identifiant, documents, visibilité, explications et taille', () => {
  const body = { action: 'rank', prompt: 'Algèbre', requestId: id(100), plan, fallback: false };
  for (const value of [ranked({ action: 'search' }), ranked({ requestId: id(99) }), ranked({ injected: true }),
    ranked({ documents: [document(), document()] }), ranked({ documents: [document(1, { deleted_at: '2026-01-01' })] }),
    ranked({ documents: [document(1, { user_id: id(99), status: 'pending' })] }),
    ranked({ documents: Array.from({ length: 11 }, (_, n) => document(n)) }),
    ranked({ explanations: [{ id: id(99), text: 'Inventé' }] }), ranked({ explanations: [{ id: id(1), text: 'https://secret.invalid' }] }),
    ranked({ fallback: true }), ranked({ explanations: [{ id: id(1), text: 'x'.repeat(241) }] })]) {
    assert.throws(() => client.parseLeoResponse(value, body, actor));
  }
  const result = client.parseLeoResponse(planned({ message: 'SQL secret' }), { action: 'plan', prompt: 'Algèbre' }, actor);
  assert.equal(result.message, undefined);
});
test('le panneau Léo a une URL interne reconnue, sans masquer les autres panneaux', () => {
  assert.equal(navigation.readLibraryLocation('?panel=leo').panel, 'leo');
  assert.equal(navigation.dashboardUrl('search', { query: 'algèbre', panel: 'leo' }), '/dashboard?view=search&q=alg%C3%A8bre&panel=leo');
  assert.equal(navigation.readLibraryLocation(`?panel=leo&document=${id(1)}`).documentId, null);
  assert.equal(navigation.readLibraryLocation('?panel=upload').panel, 'upload');
  assert.equal(navigation.readLibraryLocation('?panel=profile').panel, 'profile');
});
