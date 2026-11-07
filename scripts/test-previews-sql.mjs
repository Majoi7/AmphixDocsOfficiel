import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Contrôles TEXTUELS seulement : aucun PostgreSQL, Supabase, réseau ou .env.
// Ces assertions signalent des régressions du contrat écrit ; elles ne prouvent
// ni la syntaxe acceptée par PostgreSQL, ni les grants/RLS d'une base réelle.
const migrationUrl = new URL('../supabase/migration_v6.sql', import.meta.url);
const previousUrl = new URL('../supabase/migration_v5.sql', import.meta.url);
const source = readFileSync(migrationUrl, 'utf8');
const previousSource = readFileSync(previousUrl, 'utf8');
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\r\n]*/g, '');
const sql = withoutComments(source);
const previousSql = withoutComments(previousSource);
const compact = (text) => text.replace(/\s+/g, ' ').trim();

function functionParts(text, name) {
  const pattern = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\(([\\s\\S]*?)\\)`
    + `\\s*(RETURNS[\\s\\S]*?)AS \\$\\$([\\s\\S]*?)\\$\\$;`,
    'i',
  );
  const match = pattern.exec(text);
  assert.ok(match, `Fonction SQL ${name} présente avec délimiteur $$.`);
  return { args: compact(match[1]), header: compact(match[2]), body: match[3] };
}
function block(name) {
  const match = new RegExp(`DO \\$${name}\\$([\\s\\S]*?)\\$${name}\\$;`).exec(sql);
  assert.ok(match, `Bloc SQL ${name} présent.`);
  return match[1];
}
function tagged(text, name) {
  const match = new RegExp(`\\$${name}\\$([\\s\\S]*?)\\$${name}\\$`).exec(text);
  assert.ok(match, `Expression ${name} présente.`);
  return match[1];
}
function before(text, first, second) {
  assert.ok(text.indexOf(first) >= 0, `Texte attendu : ${first}`);
  assert.ok(text.indexOf(second) > text.indexOf(first), `${first} doit précéder ${second}`);
}
function authenticatedOnly(name, signature) {
  const suffix = `${name}(${signature})`;
  assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${suffix} FROM PUBLIC, anon, authenticated;`));
  assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${suffix} TO authenticated;`));
  assert.doesNotMatch(sql, new RegExp(`GRANT[^;]+public\\.${name}\\([^;]+TO (?:PUBLIC|anon)`, 'i'));
}
const guard = functionParts(sql, 'amphix_guard_document_write');
const setPreview = functionParts(sql, 'set_document_preview');
const library = functionParts(sql, 'list_library_documents');
const missing = functionParts(sql, 'get_missing_document_previews');
const policies = block('thumbnail_storage_policies');

// Préconditions et rejeu : pas de données métier écrasées pour faire passer V6.
test('V6 est transactionnelle, attend V5 et recharge le cache de schéma', () => {
  assert.match(sql.trim(), /^BEGIN;/);
  assert.match(sql.trim(), /COMMIT;$/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*COMMIT;/);
  const prerequisites = block('prerequisites');
  for (const required of ['amphix_v5_document_classification', 'amphix_v5_document_trash',
    'amphix_v4_document_write', 'amphix_v5_documents_', 'amphix_v5_storage_']) {
    assert.ok(prerequisites.includes(required), `Prérequis ${required}.`);
  }
  assert.match(prerequisites, /tgtype = 23 AND tgenabled IN \('O', 'A'\)/);
  assert.match(prerequisites, /NOT policy\.polpermissive/);
  for (const relation of ['public.documents', 'public.profiles', 'storage.objects']) {
    assert.ok(prerequisites.includes(`SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = '${relation}'::regclass`));
  }
  before(sql, 'LOCK TABLE public.documents IN ACCESS EXCLUSIVE MODE;', 'ADD COLUMN IF NOT EXISTS thumbnail_path');
});

test('colonnes nullable, types exacts et page_count strictement positif', () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS thumbnail_path TEXT,\s*ADD COLUMN IF NOT EXISTS page_count INTEGER;/);
  assert.match(sql, /CHECK \(page_count IS NULL OR page_count > 0\)/);
  const columns = block('preview_columns');
  assert.match(columns, /attname = 'thumbnail_path' AND atttypid <> 'text'::regtype/);
  assert.match(columns, /attname = 'page_count' AND atttypid <> 'integer'::regtype/);
  assert.match(columns, /attnotnull OR atthasdef OR attgenerated <> '' OR attidentity <> ''/);
  assert.match(sql, /file_type = 'image' AND \(page_count IS NULL OR page_count = 1\)/);
  assert.doesNotMatch(sql, /ALTER COLUMN (?:thumbnail_path|page_count) SET (?:DEFAULT|NOT NULL)/i);
});

test('le bucket est privé, WebP uniquement, à 1 Mo et refuse les conflits sans les réécrire', () => {
  const bucket = block('preview_bucket');
  assert.match(bucket, /VALUES \('document-thumbnails', 'document-thumbnails', false, 1048576, ARRAY\['image\/webp'\]::text\[\]\)/);
  assert.match(bucket, /ON CONFLICT DO NOTHING/);
  assert.doesNotMatch(bucket, /DO UPDATE|UPDATE storage\.buckets|DELETE|TRUNCATE/i);
  for (const check of [
    "configured.name IS DISTINCT FROM 'document-thumbnails'",
    'configured.public IS DISTINCT FROM false',
    'configured.file_size_limit IS DISTINCT FROM 1048576::bigint',
    "configured.allowed_mime_types IS DISTINCT FROM ARRAY['image/webp']::text[]",
    "name = 'document-thumbnails' AND id <> 'document-thumbnails'",
  ]) assert.ok(bucket.includes(check), `Conflit vérifié : ${check}`);
  assert.match(bucket, /IF NOT FOUND THEN\s*RAISE EXCEPTION/);
  assert.match(bucket, /FOR UPDATE;/);
});

test('le garde reste INVOKER et bloque INSERT/UPDATE direct des deux colonnes', () => {
  assert.equal(guard.header, 'RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog');
  assert.match(guard.body, /IF current_user NOT IN \('anon', 'authenticated'\) THEN RETURN NEW;/);
  assert.match(guard.body, /IF NEW\.thumbnail_path IS NOT NULL OR NEW\.page_count IS NOT NULL THEN\s*RAISE EXCEPTION USING ERRCODE = '42501'/);
  assert.match(guard.body, /IF NEW\.thumbnail_path IS DISTINCT FROM OLD\.thumbnail_path OR NEW\.page_count IS DISTINCT FROM OLD\.page_count THEN\s*RAISE EXCEPTION USING ERRCODE = '42501'/);
  assert.match(sql, /REVOKE INSERT \(thumbnail_path, page_count\), UPDATE \(thumbnail_path, page_count\)\s*ON public\.documents FROM PUBLIC, anon, authenticated;/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE)[^;]*(?:thumbnail_path|page_count)/i);
});

test('le remplacement conserve intégralement le corps du garde V5 hors deux ajouts', () => {
  const oldGuard = functionParts(previousSql, 'amphix_guard_document_write');
  const withoutPreviewChecks = guard.body
    .replace(/\s*IF NEW\.thumbnail_path IS NOT NULL OR NEW\.page_count IS NOT NULL THEN\s*RAISE EXCEPTION[^;]+;\s*END IF;/, '')
    .replace(/\s*IF NEW\.thumbnail_path IS DISTINCT FROM OLD\.thumbnail_path OR NEW\.page_count IS DISTINCT FROM OLD\.page_count THEN\s*RAISE EXCEPTION[^;]+;\s*END IF;/, '');
  assert.equal(compact(withoutPreviewChecks), compact(oldGuard.body),
    'Identité, modération, corbeille, titre, classement et existence Storage V5 doivent rester protégés.');
  assert.doesNotMatch(sql, /DROP TRIGGER|DISABLE TRIGGER|session_replication_role/i);
});

test('set_document_preview expose la signature exacte et une frontière DEFINER explicite', () => {
  assert.equal(setPreview.args, 'p_document_id UUID, p_thumbnail_path TEXT, p_page_count INTEGER');
  assert.equal(setPreview.header, 'RETURNS SETOF public.documents LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog');
  authenticatedOnly('set_document_preview', 'UUID, TEXT, INTEGER');
  assert.match(setPreview.body, /actor UUID := \(SELECT auth\.uid\(\)\)/);
  assert.match(setPreview.body, /IF actor IS NULL THEN\s*RAISE EXCEPTION USING ERRCODE = '42501'/);
  assert.match(setPreview.body, /WHERE document\.id = p_document_id FOR UPDATE/);
  assert.match(setPreview.body, /IF NOT FOUND OR target\.deleted_at IS NOT NULL\s*OR \(target\.user_id IS DISTINCT FROM actor AND NOT public\.is_admin\(\)\) THEN/);
  before(setPreview.body, 'IF NOT FOUND OR target.deleted_at IS NOT NULL', 'SELECT object.metadata');
  before(setPreview.body, 'SELECT object.metadata', 'UPDATE public.documents');
});

test('le chemin canonique lie auteur, document et SHA-256 WebP dans SQL et RLS', () => {
  const suffix = "'/[0-9a-f]{64}[.]webp$'";
  assert.ok(sql.includes(`thumbnail_path ~ ('^' || user_id::text || '/' || id::text || ${suffix})`));
  assert.ok(setPreview.body.includes(`p_thumbnail_path !~ ('^' || target.user_id::text || '/' || target.id::text || ${suffix})`));
  for (const operation of ['read', 'upload']) {
    const expression = tagged(policies, operation);
    assert.ok(expression.includes(`storage.objects.name ~ ('^' || document.user_id::text || '/' || document.id::text || ${suffix})`));
  }
  assert.match(setPreview.body, /IF p_thumbnail_path IS NULL/);
  // Pas de cast UUID d'un segment de nom non fiable ; un nom invalide est refusé.
  assert.doesNotMatch(policies, /\]\s*::uuid|split_part\([^\n]+::uuid/i);
  // Ne pas confondre uploader admin et auteur réel du document.
  assert.doesNotMatch(tagged(policies, 'upload'), /document\.user_id\s*=\s*(?:storage\.objects\.)?owner_id/);
});

test('la RPC valide PDF/images et refuse un remplacement des métadonnées confirmées', () => {
  assert.match(setPreview.body, /target\.file_type IS NULL OR target\.file_type NOT IN \('pdf', 'image'\)/);
  assert.match(setPreview.body, /target\.file_type = 'pdf' AND \(p_page_count IS NULL OR p_page_count <= 0\)/);
  assert.match(setPreview.body, /target\.file_type = 'image' AND p_page_count IS NOT NULL AND p_page_count <> 1/);
  assert.match(setPreview.body, /IF target\.thumbnail_path IS NOT NULL AND target\.thumbnail_path IS DISTINCT FROM p_thumbnail_path THEN\s*RAISE EXCEPTION/);
  assert.match(setPreview.body, /IF target\.page_count IS NOT NULL AND p_page_count IS NOT NULL AND target\.page_count IS DISTINCT FROM p_page_count THEN\s*RAISE EXCEPTION/);
  assert.match(setPreview.body, /confirmed_page_count := coalesce\(target\.page_count, p_page_count\);/);
  assert.match(setPreview.body, /IF target\.thumbnail_path IS DISTINCT FROM p_thumbnail_path\s*OR target\.page_count IS DISTINCT FROM confirmed_page_count THEN\s*UPDATE public\.documents/);
  assert.match(setPreview.body, /RETURN NEXT target;/);
  assert.equal((setPreview.body.match(/UPDATE public\.documents/g) || []).length, 1);
});

test('l’objet Storage doit exister avec des métadonnées WebP valides avant association', () => {
  assert.match(setPreview.body, /FROM storage\.objects AS object\s*WHERE object\.bucket_id = 'document-thumbnails' AND object\.name = p_thumbnail_path FOR SHARE;/);
  assert.match(setPreview.body, /SELECT object\.metadata[\s\S]*?IF NOT FOUND THEN\s*RAISE EXCEPTION/);
  assert.match(setPreview.body, /preview_metadata ->> 'mimetype' IS DISTINCT FROM 'image\/webp'/);
  assert.match(setPreview.body, /coalesce\(preview_metadata ->> 'size', ''\) !~ '\^\[0-9\]\{1,7\}\$'/);
  assert.match(setPreview.body, /\(preview_metadata ->> 'size'\)::integer NOT BETWEEN 1 AND 1048576/);
  before(setPreview.body, "!~ '^[0-9]{1,7}$'", "(preview_metadata ->> 'size')::integer");
  assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT INTO|DELETE FROM) storage\.objects\b/i);
});

test('les policies V6 sont par paires permissives/restrictives, limitées au nouveau bucket', () => {
  assert.match(policies, /FOREACH restrictive IN ARRAY ARRAY\[false, true\]/);
  assert.match(policies, /CASE WHEN restrictive THEN 'RESTRICTIVE' ELSE 'PERMISSIVE' END/);
  assert.match(policies, /CREATE POLICY %I ON storage\.objects AS %s FOR %s TO authenticated/);
  const scopes = "CASE WHEN restrictive THEN 'bucket_id <> ''document-thumbnails'' OR (' ELSE 'bucket_id = ''document-thumbnails'' AND (' END";
  assert.equal(policies.split(scopes).length - 1, 2, 'USING et WITH CHECK ont chacun le scope correct.');
  assert.match(policies, /'amphix_v6_thumbnail_storage_' \|\| rule\.operation/);
  assert.match(policies, /\('update', 'false', 'false'\)/);
  assert.match(policies, /\('delete', 'false', NULL::TEXT\)/);
  assert.match(policies, /DROP POLICY IF EXISTS %I ON storage\.objects/);
});

test('la garde PUBLIC ne consulte aucune table métier et laisse les autres buckets inchangés', () => {
  const match = sql.match(/CREATE POLICY amphix_v6_thumbnail_client_role ON storage\.objects([\s\S]*?);/);
  assert.ok(match);
  const roleGuard = match[1];
  assert.match(roleGuard, /AS RESTRICTIVE FOR ALL TO PUBLIC/);
  assert.equal((roleGuard.match(/bucket_id <> 'document-thumbnails'/g) || []).length, 2);
  assert.equal((roleGuard.match(/current_user = 'authenticated'/g) || []).length, 2);
  assert.doesNotMatch(roleGuard, /public\.documents|public\.profiles|public\.is_admin/);
  assert.doesNotMatch(sql, /DROP POLICY[^;]*amphix_v[45]_|DROP POLICY[^;]*ON public\.documents/i);
  assert.doesNotMatch(sql, /UPDATE storage\.buckets|DISABLE ROW LEVEL SECURITY|DROP TABLE|DROP SCHEMA|TRUNCATE/i);
});

test('lecture : auteur/admin ou chemin lié à un document approuvé actif, jamais un simple préfixe pour tiers', () => {
  const read = tagged(policies, 'read');
  assert.match(read, /\(SELECT auth\.uid\(\)\) IS NOT NULL/);
  assert.match(read, /\(storage\.foldername\(name\)\)\[1\] = \(SELECT auth\.uid\(\)\)::text OR \(SELECT public\.is_admin\(\)\)/);
  assert.match(read, /document\.thumbnail_path = storage\.objects\.name/);
  assert.match(read, /document\.status = 'approved' AND document\.deleted_at IS NULL/);
});

test('insertion : auteur/admin, document actif PDF/image et chemin correspondant uniquement', () => {
  const upload = tagged(policies, 'upload');
  assert.match(upload, /document\.deleted_at IS NULL AND document\.file_type IN \('pdf', 'image'\)/);
  assert.match(upload, /document\.user_id = \(SELECT auth\.uid\(\)\) OR \(SELECT public\.is_admin\(\)\)/);
  assert.match(upload, /document\.thumbnail_path IS NULL OR document\.thumbnail_path = storage\.objects\.name/);
  assert.doesNotMatch(upload, /metadata|owner_id/);
});

test('pagination : signature exacte, INVOKER, RLS actives, session/admin et offset borné', () => {
  assert.equal(library.args, "p_query TEXT DEFAULT '', p_trash BOOLEAN DEFAULT false, p_pending BOOLEAN DEFAULT false, p_offset INTEGER DEFAULT 0, p_ascending BOOLEAN DEFAULT false");
  assert.equal(library.header, 'RETURNS SETOF public.documents LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog SET row_security = on');
  authenticatedOnly('list_library_documents', 'TEXT, BOOLEAN, BOOLEAN, INTEGER, BOOLEAN');
  assert.match(library.body, /IF \(SELECT auth\.uid\(\)\) IS NULL THEN/);
  assert.match(library.body, /IF p_trash IS NULL OR p_pending IS NULL OR p_ascending IS NULL THEN/);
  assert.match(library.body, /IF p_pending AND NOT public\.is_admin\(\) THEN\s*RAISE EXCEPTION USING ERRCODE = '42501'/);
  assert.match(library.body, /IF p_offset IS NULL OR p_offset < 0 OR p_offset > 100000 THEN\s*RAISE EXCEPTION USING ERRCODE = '22023'/);
  assert.match(library.body, /\(NOT p_trash AND document\.deleted_at IS NULL\) OR \(p_trash AND document\.deleted_at IS NOT NULL\)/);
  assert.match(library.body, /NOT p_pending OR document\.status = 'pending'/);
  before(library.body, 'IF p_pending AND NOT public.is_admin()', 'RETURN QUERY');
});

test('la recherche SQL est littérale, insensible à la casse, sur les cinq champs avant LIMIT 20', () => {
  assert.match(library.body, /search_term TEXT := lower\(coalesce\(p_query, ''\)\)/);
  for (const field of ['title', 'description', 'file_name', 'school_name', 'subject_name']) {
    const expression = `strpos(lower(coalesce(document.${field}, '')), search_term) > 0`;
    assert.ok(library.body.includes(expression), `Recherche dans ${field}.`);
    before(library.body, expression, 'ORDER BY');
  }
  assert.doesNotMatch(library.body, /\b(?:ILIKE|LIKE|EXECUTE)\b|format\(/i);
  assert.equal((library.body.match(/\bLIMIT\b/gi) || []).length, 1);
  assert.match(library.body, /LIMIT 20 OFFSET p_offset;/);
  assert.doesNotMatch(library.args, /p_limit|page_size/i);
});

test('le tri paginé utilise created_at puis id dans les deux sens, NULLS LAST', () => {
  const order = compact(library.body.slice(library.body.indexOf('ORDER BY'), library.body.indexOf('LIMIT 20')));
  assert.equal(order,
    'ORDER BY CASE WHEN p_ascending THEN document.created_at END ASC NULLS LAST, '
    + 'CASE WHEN NOT p_ascending THEN document.created_at END DESC NULLS LAST, '
    + 'CASE WHEN p_ascending THEN document.id END ASC NULLS LAST, '
    + 'CASE WHEN NOT p_ascending THEN document.id END DESC NULLS LAST');
});

test('rattrapage : INVOKER, admin SQL, documents actifs incomplets et curseur UUID strict', () => {
  assert.equal(missing.args, 'p_after_id UUID DEFAULT NULL');
  assert.equal(missing.header, 'RETURNS SETOF public.documents LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog SET row_security = on');
  authenticatedOnly('get_missing_document_previews', 'UUID');
  assert.match(missing.body, /IF \(SELECT auth\.uid\(\)\) IS NULL OR NOT public\.is_admin\(\) THEN\s*RAISE EXCEPTION USING ERRCODE = '42501'/);
  assert.match(missing.body, /document\.deleted_at IS NULL AND document\.file_type IN \('pdf', 'image'\)/);
  assert.match(missing.body, /document\.thumbnail_path IS NULL OR \(document\.file_type = 'pdf' AND document\.page_count IS NULL\)/);
  assert.match(missing.body, /p_after_id IS NULL OR document\.id > p_after_id/);
  assert.match(missing.body, /ORDER BY document\.id ASC\s*LIMIT 20;/);
  assert.doesNotMatch(missing.body, /\bOFFSET\b|>= p_after_id|document\.status = 'approved'/);
  before(missing.body, 'NOT public.is_admin()', 'RETURN QUERY');
});

test('les réserves écrites distinguent le SQL, Storage réel et la pagination cliente', () => {
  for (const phrase of ['Les tests Node sont TEXTUELS', 'SHA-256 ou le vrai nombre de pages',
    'DERNIER UUID LU', 'même en cas d’échec', 'recharge les pages depuis zéro']) {
    assert.ok(source.replaceAll("'", '’').includes(phrase.replaceAll("'", '’')), `Réserve documentée : ${phrase}`);
  }
  assert.doesNotMatch(sql, /DELETE FROM|DROP COLUMN|DROP TABLE|DROP SCHEMA|CASCADE/i);
});
