import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

// Vrais PostgreSQL/WASM, unaccent et pg_trgm, uniquement en mémoire.
// Auth, comptes et policies sont des fixtures : pas une recette du Supabase cible.
// Aucun .env, aucun accès distant, aucune dépendance ajoutée à l'application.
// npm exec --yes --ignore-scripts --package=@electric-sql/pglite@0.5.16 -- node --test scripts/test-leo-postgres.mjs
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const modulePaths = [root, ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map(path => resolve(path, '..'))];
async function loadExport(specifier, name) {
  try {
    const module = await import(pathToFileURL(require.resolve(specifier, { paths: modulePaths })).href);
    const value = module[name] ?? module.default?.[name];
    assert.ok(value, `Export ${name} absent.`);
    return value;
  } catch (cause) {
    throw new Error('Lancer ce banc via npm exec --yes --ignore-scripts --package=@electric-sql/pglite@0.5.16 -- node --test scripts/test-leo-postgres.mjs', { cause });
  }
}
const v7 = readFileSync(new URL('../supabase/migration_v7.sql', import.meta.url), 'utf8');
const v8 = readFileSync(new URL('../supabase/migration_v8.sql', import.meta.url), 'utf8');
const actor = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const admin = '33333333-3333-4333-8333-333333333333';
const id = n => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
let db, vite, planning, registryDefinitions;

async function definitions() {
  return (await db.query(`SELECT proname, pg_get_functiondef(oid) AS definition FROM pg_catalog.pg_proc
    WHERE oid IN ('public.leo_begin_request()'::regprocedure, 'public.leo_advance_request(uuid,text,text,uuid[])'::regprocedure)
    ORDER BY proname`)).rows;
}
before(async () => {
  const [PGlite, pg_trgm, unaccent] = await Promise.all([
    loadExport('@electric-sql/pglite', 'PGlite'),
    loadExport('@electric-sql/pglite/contrib/pg_trgm', 'pg_trgm'),
    loadExport('@electric-sql/pglite/contrib/unaccent', 'unaccent'),
  ]);
  db = new PGlite({ extensions: { pg_trgm, unaccent } });
  await db.waitReady;
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE SCHEMA fixture_extensions;
    CREATE EXTENSION unaccent WITH SCHEMA fixture_extensions;
    CREATE EXTENSION pg_trgm WITH SCHEMA fixture_extensions;
    CREATE TABLE auth.users (id UUID PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${actor}'), ('${other}'), ('${admin}');
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $auth$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $auth$;
    CREATE TABLE public.documents (
      id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES auth.users(id), title TEXT NOT NULL,
      description TEXT, file_name TEXT NOT NULL DEFAULT 'fixture.pdf', file_path TEXT NOT NULL DEFAULT 'fixture/document.pdf',
      file_type TEXT DEFAULT 'pdf', file_size BIGINT DEFAULT 1234, created_at TIMESTAMPTZ DEFAULT '2026-01-01T00:00:00Z',
      school_name TEXT, subject_name TEXT, status TEXT NOT NULL DEFAULT 'approved',
      rejection_reason TEXT, reviewed_by UUID, reviewed_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ, deleted_by UUID,
      thumbnail_path TEXT, page_count INTEGER
    );
    ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_documents_read ON public.documents FOR SELECT TO authenticated USING (true);
    CREATE POLICY amphix_v5_documents_fixture ON public.documents AS RESTRICTIVE FOR SELECT TO authenticated USING (
      current_setting('fixture.admin', true) = 'on' OR status = 'approved' OR user_id = auth.uid()
    );
    -- Ce document approuvé est autorisé par le WHERE de la RPC, mais interdit par RLS.
    CREATE POLICY fixture_additional_restriction ON public.documents AS RESTRICTIVE FOR SELECT TO authenticated
      USING (id <> '${id(999)}'::uuid);
    GRANT USAGE ON SCHEMA public, auth, fixture_extensions TO authenticated, anon;
    GRANT SELECT ON public.documents TO authenticated;
    CREATE FUNCTION public.list_library_documents(TEXT, BOOLEAN, BOOLEAN, INTEGER, BOOLEAN)
      RETURNS SETOF public.documents LANGUAGE sql SECURITY INVOKER AS 'SELECT * FROM public.documents LIMIT 0';
  `);
  await db.exec(v7);
  registryDefinitions = await definitions();
  await db.exec(v8);
  vite = await createServer({ root, configFile: false, envDir: false, optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
  planning = await vite.ssrLoadModule('/supabase/functions/leo-search/planning.ts');
});
after(async () => { await vite?.close(); await db?.close(); });
beforeEach(async () => { await db.exec('RESET ROLE; TRUNCATE public.documents;'); });

async function add(n, title, fields = {}) {
  await db.query(`INSERT INTO public.documents
    (id, user_id, title, description, file_name, file_type, school_name, subject_name, status, deleted_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [
    id(n), fields.user_id ?? other, title, fields.description ?? null, fields.file_name ?? 'fixture.pdf',
    fields.file_type ?? 'pdf', fields.school_name ?? null, fields.subject_name ?? null, fields.status ?? 'approved',
    fields.deleted_at ?? null, Object.hasOwn(fields, 'created_at') ? fields.created_at : '2026-01-01T00:00:00Z',
  ]);
}
async function asActor(user, operation, isAdmin = false) {
  await db.exec('SET ROLE authenticated;');
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false), set_config('fixture.admin', $2, false)", [user ?? '', isAdmin ? 'on' : 'off']);
    return await operation();
  } finally { await db.exec('RESET ROLE;'); }
}
async function search(keywords, filters = {}, user = actor, isAdmin = false) {
  return asActor(user, async () => (await db.query(`SELECT id, title FROM public.leo_search_documents(
    $1::text[], $2::text, $3::text, $4::text, $5::date, $6::date, $7::text
  )`, [keywords, filters.school ?? null, filters.subject ?? null, filters.type ?? null,
    filters.from ?? null, filters.to ?? null, Object.hasOwn(filters, 'sort') ? filters.sort : 'relevance'])).rows, isAdmin);
}
const ids = rows => rows.map(row => row.id);

test('V8 se rejoue sans changer le registre, les extensions, la signature ou les droits', async () => {
  const functionState = async () => (await db.query(`SELECT pg_get_functiondef(oid) AS definition, prosecdef, proconfig, proacl::text
    FROM pg_catalog.pg_proc WHERE oid = 'public.leo_search_documents(text[],text,text,text,date,date,text)'::regprocedure`)).rows;
  const first = await functionState();
  await db.exec(v8); await db.exec(v8);
  assert.deepEqual(await functionState(), first);
  assert.deepEqual(await definitions(), registryDefinitions);
  assert.equal(first[0].prosecdef, false);
  assert.ok(first[0].proconfig.includes('row_security=on'));
  assert.ok(first[0].proconfig.includes('search_path=pg_catalog'));
  const grants = (await db.query(`SELECT
    has_function_privilege('authenticated', 'public.leo_search_documents(text[],text,text,text,date,date,text)', 'EXECUTE') AS signed_in,
    has_function_privilege('anon', 'public.leo_search_documents(text[],text,text,text,date,date,text)', 'EXECUTE') AS anonymous`)).rows[0];
  assert.deepEqual(grants, { signed_in: true, anonymous: false });
  const schemas = (await db.query(`SELECT namespace.nspname FROM pg_catalog.pg_extension extension
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = extension.extnamespace
    WHERE extension.extname IN ('unaccent', 'pg_trgm')`)).rows;
  assert.ok(schemas.every(row => row.nspname === 'fixture_extensions'));
});

test('demande réelle : Cours Complet Language C précède coursROifri_2026', async () => {
  await add(1, 'Cours Complet Language C', { created_at: '2025-01-01T00:00:00Z' });
  await add(2, 'coursROifri_2026', { subject_name: 'Mathématiques', created_at: '2026-01-01T00:00:00Z' });
  await add(3, 'Histoire ancienne');
  const plan = planning.fallbackPlan('Je cherche le cours de langage C');
  assert.deepEqual(plan.keywords, ['cours', 'langage c']);
  assert.deepEqual(ids(await search(plan.keywords)), [id(1), id(2)]);
});
test('langage c correspond à Language C ; C/R restent des mots entiers', async () => {
  await add(1, 'Language C'); await add(2, 'Language R'); await add(3, 'Calcul vectoriel');
  for (const keywords of [planning.fallbackPlan('langage c').keywords, ['langage', 'c']]) {
    assert.deepEqual(ids(await search(keywords)), [id(1), id(2)]);
  }
  assert.deepEqual(ids(await search(planning.fallbackPlan('language R').keywords)), [id(2), id(1)]);
  assert.deepEqual(ids(await search(['c'])), []);
  assert.deepEqual(ids(await search(['r'])), []);
});
test('accents : algebre correspond à Algèbre avec le vrai unaccent', async () => {
  await add(1, 'Algèbre'); await add(2, 'Histoire ancienne');
  assert.deepEqual(ids(await search(planning.fallbackPlan('algebre').keywords)), [id(1)]);
  assert.deepEqual(ids(await search(['ALGÈBRE'])), [id(1)]);
});
test('cours de maths ifri : titre concaténé et matière Mathématiques', async () => {
  await add(1, 'coursROifri_2026', { subject_name: 'Mathématiques' });
  await add(2, 'Mathématiques'); await add(3, 'Histoire ancienne');
  const keywords = planning.fallbackPlan('cours de maths ifri').keywords;
  assert.deepEqual(keywords, ['cours', 'maths', 'ifri']);
  assert.deepEqual(ids(await search(keywords)), [id(1), id(2)]);
  for (const term of ['cours', 'ifri', 'maths']) assert.ok(ids(await search([term])).includes(id(1)), term);
});
test('tolérance aux fautes : vrais scores pg_trgm, pas une imitation JavaScript', async () => {
  await add(1, 'Algèbre'); await add(2, 'Language C');
  assert.deepEqual(ids(await search(['algerbe'])), [id(1)]);
  const similarity = (await db.query("SELECT fixture_extensions.word_similarity('langage', 'language c') AS score")).rows[0].score;
  assert.ok(similarity >= 0.4 && similarity < 1);
  assert.deepEqual(ids(await search(['langage c'])), [id(2)]);
});
test('un seul mot suffit, même si le premier mot-clé ne correspond pas', async () => {
  await add(1, 'Algèbre');
  assert.deepEqual(ids(await search(['zzqxv', 'algebre'])), [id(1)]);
  assert.deepEqual(ids(await search(['zzqxv'])), []);
  assert.deepEqual(ids(await search(['le', 'de', 'je'])), []);
});
test('classement par nombre de mots distincts, pas par répétition ni date récente', async () => {
  await add(1, 'Algèbre Algèbre Algèbre', { created_at: '2026-01-01T00:00:00Z' });
  await add(2, 'Maths Physique', { created_at: '2025-01-01T00:00:00Z' });
  assert.deepEqual(ids(await search(['Algèbre', 'algebre', 'ALGEBRE', 'maths', 'physique'])), [id(2), id(1)]);
});
test('expression de langage : bonus facultatif avant la similarité, sans exiger la paire', async () => {
  await add(1, 'Langage des bases en C', { created_at: '2026-01-01T00:00:00Z' });
  await add(2, 'Language C', { created_at: '2025-01-01T00:00:00Z' });
  await add(3, 'Langage général');
  assert.deepEqual(ids(await search(['langage c'])), [id(2), id(1), id(3)]);
});
test('les filtres école/matière/type/date restent des contraintes explicites', async () => {
  await add(1, 'Cours Algèbre', { school_name: 'EPAC', subject_name: 'Mathématiques', created_at: '2026-01-02T00:00:00Z' });
  await add(2, 'Cours Algèbre', { school_name: 'IFRI', subject_name: 'Mathématiques', created_at: '2026-01-02T00:00:00Z' });
  await add(3, 'Exercice Algèbre', { school_name: 'EPAC', subject_name: 'Mathématiques', created_at: '2026-01-02T00:00:00Z' });
  await add(4, 'Cours Algèbre', { school_name: 'EPAC', subject_name: 'Physique', created_at: '2026-01-02T00:00:00Z' });
  await add(5, 'Cours Algèbre', { school_name: 'EPAC', subject_name: 'Mathématiques', created_at: '2026-01-04T00:00:00Z' });
  assert.deepEqual(ids(await search(['algebre'], { school: 'EPAC', subject: 'maths', type: 'cours', from: '2026-01-02', to: '2026-01-03' })), [id(1)]);
  assert.deepEqual(ids(await search(['algebre'], { type: 'image' })), []);
});
test('tri explicite chronologique, bornes UTC inclusives, dates NULL à la fin', async () => {
  await add(1, 'Cours Language C', { created_at: '2026-01-02T00:00:00Z' });
  await add(2, 'Cours', { created_at: '2026-01-03T23:59:59Z' });
  await add(3, 'Cours', { created_at: '2026-01-04T00:00:00Z' });
  await add(4, 'Cours Language C', { created_at: null });
  assert.deepEqual(ids(await search(['cours', 'langage c'], { sort: 'newest' })), [id(3), id(2), id(1), id(4)]);
  assert.deepEqual(ids(await search(['cours', 'langage c'], { sort: 'oldest' })), [id(1), id(2), id(3), id(4)]);
  assert.deepEqual(ids(await search(['cours'], { from: '2026-01-02', to: '2026-01-03' })), [id(2), id(1)]);
});
test('RLS effective sur les fixtures : tiers privés, corbeille et restriction additionnelle', async () => {
  await add(1, 'Cours');
  await add(2, 'Cours', { status: 'pending' }); await add(3, 'Cours', { status: 'rejected' });
  await add(4, 'Cours', { user_id: actor, status: 'pending' });
  await add(5, 'Cours', { user_id: actor, status: 'rejected' });
  await add(6, 'Cours', { user_id: actor, deleted_at: '2026-01-01T00:00:00Z' });
  await add(999, 'Cours');
  assert.deepEqual(ids(await search(['cours'])), [id(1), id(4), id(5)]);
  assert.deepEqual(ids(await search(['cours'], {}, other)), [id(1), id(2), id(3)]);
  // La policy de test autorise le compte admin à lire les tiers : la RPC doit néanmoins les écarter.
  const directlyVisible = await asActor(admin, async () => (await db.query('SELECT id FROM public.documents ORDER BY id')).rows, true);
  assert.ok(ids(directlyVisible).includes(id(2)));
  assert.deepEqual(ids(await search(['cours'], {}, admin, true)), [id(1)]);
});
test('la limite de 30 porte sur les correspondances autorisées, jamais avant les droits', async () => {
  for (let n = 1; n <= 40; n++) await add(n, 'Cours Language C', { status: 'pending' });
  for (let n = 101; n <= 135; n++) await add(n, 'Cours');
  const rows = await search(['cours', 'langage c']);
  assert.equal(rows.length, 30);
  assert.deepEqual(ids(rows), Array.from({ length: 30 }, (_, index) => id(101 + index)));
});
test('aucun mot-clé : les filtres explicites fonctionnent toujours sous RLS', async () => {
  await add(1, 'Histoire ancienne'); await add(2, 'Cours', { status: 'pending' });
  assert.deepEqual(ids(await search([])), [id(1)]);
});
test('session obligatoire et rôle anon sans accès à la RPC', async () => {
  await assert.rejects(search(['cours'], {}, null), error => error.code === '42501');
  await db.exec('SET ROLE anon;');
  try {
    await assert.rejects(db.query("SELECT * FROM public.leo_search_documents(ARRAY['cours'])"), error => error.code === '42501');
  } finally { await db.exec('RESET ROLE;'); }
});
test('entrées invalides refusées : bornes, NULL, filtres et dates', async () => {
  for (const [keywords, filters] of [
    [null, {}], [[null], {}], [Array(9).fill('cours'), {}], [['x'.repeat(61)], {}],
    [['cours'], { school: 'x'.repeat(121) }], [['cours'], { subject: 'x'.repeat(121) }],
    [['cours'], { sort: null }], [['cours'], { sort: 'inconnu' }], [['cours'], { type: 'inconnu' }],
    [['cours'], { from: '1899-12-31' }], [['cours'], { to: '2101-01-01' }],
    [['cours'], { from: '2026-02-01', to: '2026-01-01' }],
  ]) await assert.rejects(search(keywords, filters), error => error.code === '22023');
});
