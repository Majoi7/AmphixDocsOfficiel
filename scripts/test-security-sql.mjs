import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// Vérifications STATIQUES du contrat SQL : aucun serveur, aucune connexion.
// Ces tests ne valident ni la syntaxe PostgreSQL ni les RLS effectivement installées.
const sql = await readFile(new URL('../supabase/migration_v4.sql', import.meta.url), 'utf8');
const initial = await Promise.all(['schema.sql', 'migration_v2.sql'].map((name) =>
  readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8')
));

const between = (start, end) => {
  const startIndex = sql.indexOf(start);
  const endIndex = sql.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Bloc SQL absent : ${start}`);
  return sql.slice(startIndex, endIndex);
};

test('V4 est transactionnelle et ne supprime aucune donnée métier', () => {
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
  assert.match(sql, /NOTIFY pgrst, 'reload schema';/);
  assert.doesNotMatch(sql, /\b(?:DELETE\s+FROM|TRUNCATE\s+(?:TABLE\s+)?|DROP\s+TABLE)\s+(?:public\.|storage\.)/i);
  assert.match(sql, /documents_user_id_profiles_fkey/);
  assert.match(sql, /folders_user_id_profiles_fkey/);
});

test('les droits table et colonne sont révoqués avant les GRANT limités', () => {
  const grants = between('REVOKE ALL PRIVILEGES ON TABLE', '-- Les comptes admin');
  assert.match(grants, /FROM PUBLIC, anon, authenticated/);
  assert.match(grants, /REVOKE SELECT \(%1\$s\), INSERT \(%1\$s\), UPDATE \(%1\$s\), REFERENCES \(%1\$s\)/);
  assert.match(grants, /GRANT UPDATE \(role\) ON TABLE public\.profiles TO authenticated;/);
  assert.match(grants, /GRANT UPDATE \(title, description, status, rejection_reason\)/);
  const documentUpdate = grants.match(/GRANT UPDATE \(([^)]*)\)\s+ON TABLE public\.documents/);
  assert.ok(documentUpdate);
  assert.doesNotMatch(documentUpdate[1], /reviewed_by|reviewed_at|user_id|file_path|file_size/);
  assert.doesNotMatch(grants, /GRANT (?:ALL|UPDATE) ON TABLE/);
});

test('le trigger document interdit les colonnes privilégiées et calcule la revue côté SQL', () => {
  const guard = between('CREATE OR REPLACE FUNCTION public.amphix_guard_document_write()', 'CREATE OR REPLACE FUNCTION public.amphix_guard_folder_write()');
  assert.match(guard, /SECURITY INVOKER\s+SET search_path = pg_catalog/);
  for (const field of ['id', 'user_id', 'file_path', 'file_name', 'file_type', 'file_size', 'created_at', 'status', 'reviewed_by', 'reviewed_at']) {
    assert.ok(guard.includes(`NEW.${field} IS DISTINCT FROM OLD.${field}`), `Garde absente : ${field}`);
  }
  assert.match(guard, /NEW\.reviewed_by := auth\.uid\(\)/);
  assert.match(guard, /NEW\.reviewed_at := transaction_timestamp\(\)/);
  assert.match(guard, /SELECT 1 FROM storage\.objects/);
  assert.match(sql, /BEFORE INSERT OR UPDATE ON public\.documents/);
});

test('les policies connues sont remplacées et leurs gardes sont restrictives', () => {
  for (const source of initial) {
    for (const match of source.matchAll(/CREATE POLICY "([^"]+)"\s+ON (public|storage)\.(\w+)/g)) {
      assert.ok(sql.includes(`DROP POLICY IF EXISTS "${match[1]}" ON ${match[2]}.${match[3]};`), `Ancienne policy non remplacée : ${match[1]}`);
    }
  }
  assert.match(sql, /FOREACH restrictive IN ARRAY ARRAY\[false, true\]/);
  assert.match(sql, /mode_name := CASE WHEN restrictive THEN 'RESTRICTIVE' ELSE 'PERMISSIVE' END/);
  assert.match(sql, /amphix_v4_profiles_no_insert[\s\S]*?AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK \(false\)/);
  assert.match(sql, /amphix_v4_profiles_no_delete[\s\S]*?AS RESTRICTIVE FOR DELETE TO authenticated USING \(false\)/);
});

test('Storage reste privé, limité à 20 Mo et sans remplacement de contenu approuvé', () => {
  assert.match(sql, /SET public = false, file_size_limit = 20971520\s+WHERE id = 'documents'/);
  assert.match(sql, /AS RESTRICTIVE FOR ALL TO PUBLIC/);
  assert.match(sql, /current_user = 'authenticated' AND auth\.uid\(\) IS NOT NULL/);
  const policies = between('DO $storage_policies$', '$storage_policies$;');
  assert.match(policies, /\('update', 'false', 'false'\)/);
  assert.match(policies, /document\.status = 'approved'/);
  assert.match(policies, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text OR public\.is_admin\(\)/);
  assert.match(policies, /bucket_id <> ''documents'' OR/);
  assert.match(sql, /char_length\(description\) <= 200/);
  assert.match(sql, /file_size IS NOT NULL AND file_size >= 0 AND file_size <= 20971520/);
  assert.match(sql, /UNIQUE \(file_path\)/);
});

test('la cascade dossier ne contourne pas les droits sur les fichiers d’autres auteurs', () => {
  const helper = between('CREATE OR REPLACE FUNCTION public.amphix_assert_folder_delete_allowed', 'CREATE OR REPLACE FUNCTION public.amphix_guard_folder_delete()');
  assert.match(helper, /SECURITY DEFINER\s+SET search_path = pg_catalog/);
  assert.match(helper, /auth\.uid\(\) IS NULL/);
  assert.match(helper, /id = target_folder_id AND user_id = auth\.uid\(\)/);
  assert.match(helper, /folder_id = target_folder_id AND user_id IS DISTINCT FROM auth\.uid\(\)/);
  assert.match(sql, /BEFORE DELETE ON public\.folders/);
  assert.match(sql, /PERFORM public\.amphix_assert_folder_delete_allowed\(OLD\.id\)/);
});
