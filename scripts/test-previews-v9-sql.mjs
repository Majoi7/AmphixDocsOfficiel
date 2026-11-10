import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Contrôles TEXTUELS du delta V6 -> V9, sans PostgreSQL, Supabase, réseau ou .env.
// Même les exemples de chemins sont évalués en JavaScript, PAS dans PostgreSQL.
// Ces tests ne prouvent ni l'exécution SQL, ni les grants/RLS d'une base réelle.
// Exécution explicite : node --test scripts/test-previews-v9-sql.mjs
const source = readFileSync(new URL('../supabase/migration_v9.sql', import.meta.url), 'utf8');
const v6Source = readFileSync(new URL('../supabase/migration_v6.sql', import.meta.url), 'utf8');
const v5Source = readFileSync(new URL('../supabase/migration_v5.sql', import.meta.url), 'utf8');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\r\n]*/g, '');
const compact = (text) => text.replace(/\s+/g, ' ').trim();
const sql = stripComments(source);
const v6 = stripComments(v6Source);
const v5 = stripComments(v5Source);
const textual = (name, run) => test(`[TEXTUEL V9] ${name}`, run);

function functionParts(text, name) {
  const match = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\(([\\s\\S]*?)\\)`
    + `\\s*(RETURNS[\\s\\S]*?)AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'i').exec(text);
  assert.ok(match, `Fonction ${name} attendue avec délimiteur $$.`);
  return { args: compact(match[1]), header: compact(match[2]), body: match[3] };
}
function tagged(text, name) {
  const match = new RegExp(`\\$${name}\\$([\\s\\S]*?)\\$${name}\\$`).exec(text);
  assert.ok(match, `Bloc ${name} attendu.`);
  return match[1];
}
function before(text, first, second) {
  assert.ok(text.includes(first), `Texte attendu : ${first}`);
  assert.ok(text.indexOf(second) > text.indexOf(first), `${first} précède ${second}.`);
}
function md5(body) {
  return createHash('md5').update(body.replaceAll('\r', '')).digest('hex');
}
const required = tagged(sql, 'required_objects');
const prerequisites = tagged(sql, 'prerequisites');
const bucket = tagged(sql, 'preview_bucket');
const policies = tagged(sql, 'thumbnail_storage_policies');
const read = tagged(policies, 'read');
const upload = tagged(policies, 'upload');
const rpc = functionParts(sql, 'set_document_preview');
const v6Rpc = functionParts(v6, 'set_document_preview');
const pathSuffix = '/[0-9a-f]{64}[.](webp|jpg)$';

textual('transaction, V6 obligatoire et contrôle avant tout changement', () => {
  assert.match(sql.trim(), /^BEGIN;\s*SET LOCAL search_path = pg_catalog;/);
  assert.match(sql.trim(), /NOTIFY pgrst, 'reload schema';\s*COMMIT;$/);
  for (const name of ['public.documents', 'public.profiles', 'storage.objects', 'storage.buckets']) {
    assert.ok(required.includes(`to_regclass('${name}') IS NULL`));
  }
  for (const name of ['auth.uid()', 'public.is_admin()', 'public.amphix_guard_document_write()',
    'public.set_document_trash(uuid,boolean)', 'public.set_document_preview(uuid,text,integer)',
    'public.list_library_documents(text,boolean,boolean,integer,boolean)', 'public.get_missing_document_previews(uuid)']) {
    assert.ok(required.includes(`to_regprocedure('${name}') IS NULL`));
  }
  before(sql, '$required_objects$;', 'LOCK TABLE public.documents, storage.objects IN ACCESS EXCLUSIVE MODE;');
  before(sql, 'LOCK TABLE public.documents, storage.objects IN ACCESS EXCLUSIVE MODE;', 'DO $prerequisites$');
  before(sql, '$prerequisites$;', 'DO $preview_bucket$');
  before(sql, '$preview_bucket$;', 'ALTER TABLE public.documents');
  assert.doesNotMatch(sql, /\bamphix_v[78]_\w+|\bpublic\.leo_\w+|\bADD COLUMN\b/i);
});

textual('colonnes, contraintes validées, RLS et trigger V6 actif non filtré exigés', () => {
  for (const name of ['amphix_v5_document_classification', 'amphix_v5_document_trash',
    'amphix_v6_documents_page_count', 'amphix_v6_documents_preview_kind', 'amphix_v6_documents_thumbnail_path']) {
    assert.ok(prerequisites.includes(name));
  }
  assert.match(prerequisites, /contype = 'c' AND convalidated/);
  assert.match(prerequisites, /\('thumbnail_path', 'text'::regtype\), \('page_count', 'integer'::regtype\)/);
  assert.match(prerequisites, /NOT attisdropped AND atttypid = expected\.type_oid/);
  assert.match(prerequisites, /NOT attnotnull AND NOT atthasdef AND attgenerated = '' AND attidentity = ''/);
  assert.match(prerequisites, /tgfoid = 'public\.amphix_guard_document_write\(\)'::regprocedure/);
  assert.match(prerequisites, /tgtype = 23 AND tgenabled IN \('O', 'A'\) AND NOT tgisinternal/);
  assert.match(prerequisites, /tgqual IS NULL AND tgnargs = 0 AND tgattr = ''::int2vector/);
  for (const relation of ['public.documents', 'public.profiles', 'storage.objects']) {
    assert.ok(prerequisites.includes(`SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = '${relation}'::regclass`));
  }
  assert.match(prerequisites, /storage\.buckets WHERE id = 'documents' AND public = false/);
});

textual('empreintes exactes V6/V9, signature et privilèges refusent les fonctions homonymes', () => {
  // Comparer les corps BRUTS, commentaires inclus : c'est bien pg_proc.prosrc.
  const guardHash = md5(functionParts(v6Source, 'amphix_guard_document_write').body);
  const oldRpcHash = md5(functionParts(v6Source, 'set_document_preview').body);
  const newRpcHash = md5(functionParts(source, 'set_document_preview').body);
  assert.ok(prerequisites.includes(`md5(replace(prosrc, chr(13), '')) = '${guardHash}'`));
  assert.match(prerequisites, /md5\(replace\(prosrc, chr\(13\), ''\)\) IN \(/);
  assert.ok(prerequisites.includes(`'${oldRpcHash}'`));
  assert.ok(prerequisites.includes(`'${newRpcHash}'`));
  assert.notEqual(oldRpcHash, newRpcHash);
  assert.doesNotMatch(source, /V9_PREVIEW_BODY_MD5/);
  assert.match(prerequisites, /NOT prosecdef AND prorettype = 'trigger'::regtype AND NOT proretset/);
  assert.match(prerequisites, /prokind = 'f' AND prosecdef AND proretset AND prorettype = 'public\.documents'::regtype/);
  assert.match(prerequisites, /proargnames = ARRAY\['p_document_id', 'p_thumbnail_path', 'p_page_count'\]::text\[\]/);
  assert.match(prerequisites, /pronargdefaults = 0 AND proargmodes IS NULL/);
  assert.match(prerequisites, /proconfig = ARRAY\['search_path=pg_catalog'\]::text\[\]/);
  assert.equal(prerequisites.split("prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')").length - 1, 2);
  assert.match(prerequisites, /NOT proleakproof AND NOT proisstrict/);
  assert.match(prerequisites, /proowner NOT IN \(SELECT oid FROM pg_catalog\.pg_roles WHERE rolname IN \('anon', 'authenticated'\)\)/);
  assert.match(prerequisites, /OR has_function_privilege\('anon', 'public\.set_document_preview\(uuid,text,integer\)', 'EXECUTE'\)/);
  assert.match(prerequisites, /OR NOT has_function_privilege\('authenticated', 'public\.set_document_preview\(uuid,text,integer\)', 'EXECUTE'\)/);
});

textual('toutes les gardes V5 et toutes les policies V6 doivent préexister', () => {
  assert.match(prerequisites, /\('public\.documents', 'amphix_v5_documents_'\)/);
  assert.match(prerequisites, /\('storage\.objects', 'amphix_v5_storage_'\)/);
  assert.match(prerequisites, /NOT policy\.polpermissive AND policy\.polcmd::text = operations\.command/);
  assert.match(prerequisites, /authenticated_role = ANY\(policy\.polroles\)/);
  assert.match(prerequisites, /polname = 'amphix_v5_storage_client_role'/);
  assert.match(prerequisites, /NOT polpermissive AND polcmd = '\*' AND 0::oid = ANY\(polroles\)/);
  assert.match(prerequisites, /\('select', 'r'\), \('insert', 'a'\), \('update', 'w'\), \('delete', 'd'\)/);
  assert.match(prerequisites, /\('_allow', true\), \('_guard', false\)/);
  assert.match(prerequisites, /policy\.polcmd::text = operations\.command AND policy\.polpermissive = kinds\.permissive/);
  assert.match(prerequisites, /policy\.polroles = ARRAY\[authenticated_role\]::oid\[\]/);
  assert.match(prerequisites, /\(policy\.polqual IS NOT NULL\) = \(operations\.name <> 'insert'\)/);
  assert.match(prerequisites, /\(policy\.polwithcheck IS NOT NULL\) = \(operations\.name IN \('insert', 'update'\)\)/);
  assert.match(prerequisites, /polname = 'amphix_v6_thumbnail_client_role'/);
  assert.match(prerequisites, /polroles = ARRAY\[0::oid\]/);
  assert.match(prerequisites, /pg_get_expr\(policy\.polqual, policy\.polrelid\)/);
  assert.match(prerequisites, /pg_get_expr\(policy\.polwithcheck, policy\.polrelid\)/);
  assert.equal(prerequisites.split("IS DISTINCT FROM 'bucket_id<>''document-thumbnails''::textORfalse'").length - 1, 2);
  assert.equal(prerequisites.split("IS DISTINCT FROM 'bucket_id<>''document-thumbnails''::textORCURRENT_USER=''authenticated''::nameANDSELECTauth.uidASuidISNOTNULL'").length - 1, 2);
});

textual('bucket privé 1 Mo : seul ajout JPEG, refus des conflits et rejeu sans UPDATE', () => {
  assert.match(bucket, /WHERE bucket\.id = 'document-thumbnails' FOR UPDATE;/);
  assert.match(bucket, /IF NOT FOUND THEN\s*RAISE EXCEPTION/);
  for (const condition of ["configured.name IS DISTINCT FROM 'document-thumbnails'",
    'configured.public IS DISTINCT FROM false', 'configured.file_size_limit IS DISTINCT FROM 1048576::bigint',
    "configured.allowed_mime_types IS DISTINCT FROM ARRAY['image/webp']::text[]",
    "configured.allowed_mime_types IS DISTINCT FROM ARRAY['image/webp', 'image/jpeg']::text[]",
    "configured.allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg', 'image/webp']::text[]",
    "name = 'document-thumbnails' AND id <> 'document-thumbnails'"]) {
    assert.ok(bucket.includes(condition), `Refus de conflit : ${condition}`);
  }
  assert.match(bucket, /UPDATE storage\.buckets SET allowed_mime_types = ARRAY\['image\/webp', 'image\/jpeg'\]::text\[\]\s*WHERE id = 'document-thumbnails' AND allowed_mime_types = ARRAY\['image\/webp'\]::text\[\];/);
  assert.equal((sql.match(/UPDATE storage\.buckets/g) ?? []).length, 1);
  assert.doesNotMatch(bucket, /\bINSERT\b|\bDELETE\b|\bTRUNCATE\b|SET public|SET file_size_limit|ON CONFLICT/i);
  before(bucket, 'RAISE EXCEPTION', 'UPDATE storage.buckets');
});

textual('seule la contrainte de chemin change ; null et WebP historiques restent admis', () => {
  const alterations = [...sql.matchAll(/ALTER TABLE[\s\S]*?;/g)].map(([statement]) => compact(statement));
  assert.deepEqual(alterations, [
    'ALTER TABLE public.documents DROP CONSTRAINT amphix_v6_documents_thumbnail_path;',
    'ALTER TABLE public.documents ADD CONSTRAINT amphix_v6_documents_thumbnail_path CHECK ( '
      + `thumbnail_path IS NULL OR thumbnail_path ~ ('^' || user_id::text || '/' || id::text || '${pathSuffix}') );`,
  ]);
  assert.doesNotMatch(sql, /NOT VALID|DROP CONSTRAINT[^;]+(?:page_count|preview_kind|amphix_v5_)/i);
  assert.ok(rpc.body.includes(`p_thumbnail_path !~ ('^' || target.user_id::text || '/' || target.id::text || '${pathSuffix}')`));
  for (const expression of [read, upload]) {
    assert.ok(expression.includes(`storage.objects.name ~ ('^' || document.user_id::text || '/' || document.id::text || '${pathSuffix}')`));
  }
  assert.equal(sql.split(pathSuffix).length - 1, 4);
});

textual('exemples JavaScript du motif écrit : SHA-256 minuscule .jpg/.webp seulement', () => {
  const author = '10000000-0000-4000-8000-000000000001';
  const document = '20000000-0000-4000-8000-000000000002';
  const hash = 'ab'.repeat(32);
  const match = sql.match(/thumbnail_path ~ \('\^' \|\| user_id::text \|\| '\/' \|\| id::text \|\| '([^']+)'\)/);
  assert.ok(match);
  const pattern = new RegExp(`^${author}/${document}${match[1]}`);
  for (const extension of ['jpg', 'webp']) assert.ok(pattern.test(`${author}/${document}/${hash}.${extension}`));
  for (const invalid of [
    `${author}/${document}/${hash}.jpeg`, `${author}/${document}/${hash}.png`,
    `${author}/${document}/${hash}.JPG`, `${author}/${document}/${hash.toUpperCase()}.jpg`,
    `${author}/${document}/${hash.slice(1)}.jpg`, `${author}/${document}/${hash}a.jpg`,
    `${document}/${author}/${hash}.jpg`, `${author}/${document}/extra/${hash}.jpg`,
    `${author}/${document}/../${hash}.jpg`, `${author}/${document}/${hash}.jpg/extra`,
    `${author}/${document}/${hash}.jpg?x=1`, `${author}/${document}/${hash}.jpg `,
  ]) assert.equal(pattern.test(invalid), false, invalid);
});

textual('RPC V9 identique à V6 hormis extension et vérification du MIME associé', () => {
  assert.equal(rpc.args, v6Rpc.args);
  assert.equal(rpc.args, 'p_document_id UUID, p_thumbnail_path TEXT, p_page_count INTEGER');
  assert.equal(rpc.header, v6Rpc.header);
  assert.equal(rpc.header, 'RETURNS SETOF public.documents LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog');
  const normalized = rpc.body
    .replaceAll(pathSuffix, '/[0-9a-f]{64}[.]webp$')
    .replace('empreinte-SHA256-minuscule.webp ou .jpg', 'empreinte-SHA256-minuscule.webp')
    .replace(/IS DISTINCT FROM \(\s*CASE WHEN right\(p_thumbnail_path, 4\) = '\.jpg' THEN 'image\/jpeg' ELSE 'image\/webp' END\s*\)/,
      "IS DISTINCT FROM 'image/webp'")
    .replace('avec le suffixe WebP/JPEG demandé', 'avec un WebP');
  assert.equal(compact(normalized), compact(v6Rpc.body),
    'Droits auteur/admin, types/pages, verrous, immutabilité, idempotence et mise à jour ne doivent pas diverger de V6.');
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.set_document_preview\(UUID, TEXT, INTEGER\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.set_document_preview\(UUID, TEXT, INTEGER\) TO authenticated;/);
  assert.equal((sql.match(/\bGRANT\b/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /ALTER FUNCTION|DROP FUNCTION|CREATE OR REPLACE FUNCTION public\.(?!set_document_preview\b)/i);
});

textual('RPC exige session, document actif et auteur/admin sous verrou avant accès Storage', () => {
  assert.match(rpc.body, /actor UUID := \(SELECT auth\.uid\(\)\)/);
  assert.match(rpc.body, /IF actor IS NULL THEN\s*RAISE EXCEPTION USING ERRCODE = '42501'/);
  assert.match(rpc.body, /WHERE document\.id = p_document_id FOR UPDATE/);
  assert.match(rpc.body, /IF NOT FOUND OR target\.deleted_at IS NOT NULL\s*OR \(target\.user_id IS DISTINCT FROM actor AND NOT public\.is_admin\(\)\) THEN/);
  before(rpc.body, 'IF actor IS NULL', 'SELECT document.*');
  before(rpc.body, 'IF NOT FOUND OR target.deleted_at IS NOT NULL', 'SELECT object.metadata');
  before(rpc.body, 'SELECT object.metadata', 'UPDATE public.documents');
  assert.match(rpc.body, /target\.file_type IS NULL OR target\.file_type NOT IN \('pdf', 'image'\)/);
  assert.match(rpc.body, /target\.file_type = 'pdf' AND \(p_page_count IS NULL OR p_page_count <= 0\)/);
  assert.match(rpc.body, /target\.file_type = 'image' AND p_page_count IS NOT NULL AND p_page_count <> 1/);
});

textual('existence et MIME correspondant, taille bornée validée avant cast, pas de contenu prétendu vérifié', () => {
  assert.match(rpc.body, /FROM storage\.objects AS object\s*WHERE object\.bucket_id = 'document-thumbnails' AND object\.name = p_thumbnail_path FOR SHARE;/);
  assert.match(rpc.body, /SELECT object\.metadata[\s\S]*?IF NOT FOUND THEN\s*RAISE EXCEPTION/);
  assert.match(rpc.body, /preview_metadata IS NULL OR preview_metadata ->> 'mimetype' IS DISTINCT FROM \(\s*CASE WHEN right\(p_thumbnail_path, 4\) = '\.jpg' THEN 'image\/jpeg' ELSE 'image\/webp' END\s*\)/);
  assert.match(rpc.body, /coalesce\(preview_metadata ->> 'size', ''\) !~ '\^\[0-9\]\{1,7\}\$'/);
  assert.match(rpc.body, /\(preview_metadata ->> 'size'\)::integer NOT BETWEEN 1 AND 1048576/);
  before(rpc.body, "!~ '^[0-9]{1,7}$'", "(preview_metadata ->> 'size')::integer");
  assert.doesNotMatch(rpc.body, /owner_id|image\/png|image\/jpg|mimetype[^;]+\bIN\s*\(/i);
});

textual('aucun remplacement de chemin/compte ; même appel ne fait aucun UPDATE inutile', () => {
  assert.match(rpc.body, /IF target\.thumbnail_path IS NOT NULL AND target\.thumbnail_path IS DISTINCT FROM p_thumbnail_path THEN\s*RAISE EXCEPTION/);
  assert.match(rpc.body, /IF target\.page_count IS NOT NULL AND p_page_count IS NOT NULL AND target\.page_count IS DISTINCT FROM p_page_count THEN\s*RAISE EXCEPTION/);
  assert.match(rpc.body, /confirmed_page_count := coalesce\(target\.page_count, p_page_count\);/);
  assert.match(rpc.body, /IF target\.thumbnail_path IS DISTINCT FROM p_thumbnail_path\s*OR target\.page_count IS DISTINCT FROM confirmed_page_count THEN\s*UPDATE public\.documents/);
  assert.match(rpc.body, /RETURN NEXT target;/);
  assert.equal((rpc.body.match(/UPDATE public\.documents/g) ?? []).length, 1);
});

textual('SELECT exige actif et canonique pour TOUS, tiers uniquement lien approved', () => {
  assert.equal(compact(read), compact(`
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.documents AS document
      WHERE document.deleted_at IS NULL
        AND storage.objects.name ~ ('^' || document.user_id::text || '/' || document.id::text || '${pathSuffix}')
        AND (document.user_id = (SELECT auth.uid()) OR (SELECT public.is_admin())
          OR (document.thumbnail_path = storage.objects.name AND document.status = 'approved')))
  `), 'Aucune branche auteur/admin en dehors du EXISTS document actif.');
  assert.doesNotMatch(read, /foldername|owner_id|split_part|::uuid/i);
  before(read, 'document.deleted_at IS NULL', 'document.user_id = (SELECT auth.uid())');
  assert.equal((read.match(/document\.thumbnail_path = storage\.objects\.name/g) ?? []).length, 1,
    'Auteur/admin peuvent encore lire un objet canonique non lié d’un document actif.');
});

textual('INSERT est strictement V6 plus .jpg : auteur/admin actif PDF/image, sans upsert', () => {
  const v6Upload = tagged(tagged(v6, 'thumbnail_storage_policies'), 'upload');
  assert.equal(compact(upload.replaceAll(pathSuffix, '/[0-9a-f]{64}[.]webp$')), compact(v6Upload));
  assert.match(upload, /document\.deleted_at IS NULL AND document\.file_type IN \('pdf', 'image'\)/);
  assert.match(upload, /document\.user_id = \(SELECT auth\.uid\(\)\) OR \(SELECT public\.is_admin\(\)\)/);
  assert.match(upload, /document\.thumbnail_path IS NULL OR document\.thumbnail_path = storage\.objects\.name/);
  assert.doesNotMatch(upload, /metadata|owner_id|ON CONFLICT|::uuid/i);
});

textual('ALTER des seules quatre policies SELECT/INSERT, gardes autres buckets intactes', () => {
  assert.deepEqual([...policies.matchAll(/\('(\w+)', \$/g)].map((match) => match[1]), ['select', 'insert']);
  assert.match(policies, /FOREACH restrictive IN ARRAY ARRAY\[false, true\]/);
  assert.match(policies, /'amphix_v6_thumbnail_storage_' \|\| rule\.operation \|\| CASE WHEN restrictive THEN '_guard' ELSE '_allow' END/);
  assert.match(policies, /CASE WHEN restrictive THEN 'bucket_id <> ''document-thumbnails'' OR \(' ELSE 'bucket_id = ''document-thumbnails'' AND \(' END/);
  assert.match(policies, /IF rule\.operation = 'select' THEN\s*EXECUTE format\('ALTER POLICY %I ON storage\.objects USING \(%s\)'/);
  assert.match(policies, /ELSE\s*EXECUTE format\('ALTER POLICY %I ON storage\.objects WITH CHECK \(%s\)'/);
  assert.equal((sql.match(/ALTER POLICY/g) ?? []).length, 2);
  assert.doesNotMatch(policies, /\b(?:update|delete|client_role)\b|CREATE POLICY|DROP POLICY/i);
  assert.doesNotMatch(sql, /(?:DROP|CREATE) POLICY|ALTER POLICY[^;]*ON public\./i);
});

textual('pas d’affaiblissement des interdictions navigateur, V5, client, UPDATE/DELETE', () => {
  const guard = functionParts(v6, 'amphix_guard_document_write');
  const oldGuard = functionParts(v5, 'amphix_guard_document_write');
  assert.match(guard.body, /IF NEW\.thumbnail_path IS NOT NULL OR NEW\.page_count IS NOT NULL THEN\s*RAISE EXCEPTION/);
  assert.match(guard.body, /IF NEW\.thumbnail_path IS DISTINCT FROM OLD\.thumbnail_path OR NEW\.page_count IS DISTINCT FROM OLD\.page_count THEN\s*RAISE EXCEPTION/);
  const originalBody = guard.body
    .replace(/\s*IF NEW\.thumbnail_path IS NOT NULL OR NEW\.page_count IS NOT NULL THEN\s*RAISE EXCEPTION[^;]+;\s*END IF;/, '')
    .replace(/\s*IF NEW\.thumbnail_path IS DISTINCT FROM OLD\.thumbnail_path OR NEW\.page_count IS DISTINCT FROM OLD\.page_count THEN\s*RAISE EXCEPTION[^;]+;\s*END IF;/, '');
  assert.equal(compact(originalBody), compact(oldGuard.body));
  assert.match(v6, /REVOKE INSERT \(thumbnail_path, page_count\), UPDATE \(thumbnail_path, page_count\)\s*ON public\.documents FROM PUBLIC, anon, authenticated;/);
  const oldPolicies = tagged(v6, 'thumbnail_storage_policies');
  assert.match(oldPolicies, /\('update', 'false', 'false'\)/);
  assert.match(oldPolicies, /\('delete', 'false', NULL::TEXT\)/);
  assert.match(v6, /CREATE POLICY amphix_v6_thumbnail_client_role ON storage\.objects\s*AS RESTRICTIVE FOR ALL TO PUBLIC/);
  assert.doesNotMatch(sql, /(?:CREATE|ALTER|DROP|DISABLE) TRIGGER|session_replication_role|DISABLE ROW LEVEL SECURITY|ALTER ROLE|SET ROLE/i);
  assert.doesNotMatch(sql, /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)|REVOKE[^;]+ON (?:TABLE )?public\.documents/i);
});

textual('aucune mutation de données hors RPC et liste MIME explicitement bornée', () => {
  assert.doesNotMatch(sql, /\b(?:DELETE FROM|INSERT INTO|TRUNCATE|DROP COLUMN|DROP TABLE|DROP SCHEMA|CASCADE)\b/i);
  assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT INTO|DELETE FROM) storage\.objects\b/i);
  const writes = [...sql.matchAll(/\bUPDATE\s+([a-z_]+\.[a-z_]+)\s+(?:AS [a-z_]+\s+)?SET\b/gi)].map((match) => match[1]);
  assert.deepEqual(writes, ['storage.buckets', 'public.documents']);
  assert.equal((sql.match(/\bDROP\b/g) ?? []).length, 1, 'Seule la contrainte de chemin est remplacée, dans la transaction.');
  assert.equal((sql.match(/\bCREATE OR REPLACE FUNCTION\b/g) ?? []).length, 1);
});

textual('réserves écrites : SQL non exécuté, reprise sans purge et URL signées non révoquées', () => {
  for (const phrase of ['Les tests Node sont TEXTUELS', 'ni preuve RLS réelle',
    'ne pas rejouer V6', 'Les URL signées déjà émises restent valides',
    'ni le SHA-256 ou le vrai nombre', 'Upload sans upsert', 'Un objet non lié est conservé']) {
    assert.ok(source.includes(phrase), `Réserve attendue : ${phrase}`);
  }
});
