import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Contrôles TEXTUELS de V7 : ne prouvent ni exécution PostgreSQL ni RLS distantes.
const sql = readFileSync(new URL('../supabase/migration_v7.sql', import.meta.url), 'utf8')
  .replace(/--[^\r\n]*/g, '');
const edge = readFileSync(new URL('../supabase/functions/leo-search/index.ts', import.meta.url), 'utf8');

test('V7 transactionnelle, prérequis V6, aucun remplacement des migrations antérieures', () => {
  assert.match(sql.trim(), /^BEGIN;/); assert.match(sql.trim(), /COMMIT;$/);
  for (const field of ['school_name', 'subject_name', 'deleted_at', 'thumbnail_path', 'page_count']) assert.ok(sql.includes(`attname = '${field}'`));
  assert.match(sql, /to_regprocedure\('public\.list_library_documents/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DISABLE ROW LEVEL SECURITY|ALTER TABLE public\.documents/i);
});
test('recherche INVOKER, RLS active et filtre explicitement plus étroit que les droits admin', () => {
  assert.match(sql, /RETURNS SETOF public\.documents LANGUAGE plpgsql STABLE SECURITY INVOKER/);
  assert.match(sql, /SET row_security = on/);
  assert.match(sql, /document\.deleted_at IS NULL AND \(document\.status = 'approved' OR document\.user_id = actor\)/);
  assert.match(sql, /LIMIT 30;/); assert.match(sql, /cardinality\(p_keywords\) > 8/);
  assert.match(sql, /SET statement_timeout = '5s'/);
  assert.doesNotMatch(sql, /GRANT[^;]+TO (?:PUBLIC|anon);/);
});
test('accents et fautes : dictionnaire fixé, schémas extensions réels et index GIN partiel', () => {
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS unaccent/); assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  assert.match(sql, /extension\.extnamespace/); assert.match(sql, /%I\.unaccent\(%L::regdictionary/);
  assert.match(sql, /IMMUTABLE PARALLEL SAFE SECURITY INVOKER/);
  assert.match(sql, /USING gin/); assert.match(sql, /%I\.gin_trgm_ops/); assert.match(sql, /WHERE deleted_at IS NULL/);
  assert.match(sql, /word_similarity/); assert.match(sql, /OPERATOR\(%1\$I\.<%%\)/);
});
test('quota glissant atomique : verrou par compte, compteur serveur, 20 par dix minutes', () => {
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('amphix-leo:' \|\| actor::text, 0\)\)/);
  assert.match(sql, /clock_timestamp\(\) - interval '10 minutes'/);
  assert.match(sql, /count\(\*\)[^;]+>= 20/s); assert.match(sql, /ERRCODE = 'PT429'/);
  assert.match(sql, /DELETE FROM amphix_private\.leo_requests WHERE user_id = actor AND started_at <= cutoff/);
  assert.match(sql, /REVOKE ALL ON amphix_private\.leo_requests FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /ALTER TABLE amphix_private\.leo_requests ENABLE ROW LEVEL SECURITY/);
});
test('registre sans prompt : étapes et candidats bornés, compte/expiration/verrou/rejeu contrôlés', () => {
  const table = sql.match(/CREATE TABLE IF NOT EXISTS amphix_private\.leo_requests \(([\s\S]*?)\n\);/)?.[1]; assert.ok(table);
  assert.doesNotMatch(table, /prompt|description|title|plan json/i);
  assert.match(table, /cardinality\(candidate_ids\) <= 30/);
  assert.match(sql, /id = p_request_id AND user_id = actor AND started_at > clock_timestamp\(\) - interval '10 minutes' FOR UPDATE/);
  assert.match(sql, /target\.stage <> expected_stage/); assert.match(sql, /target\.fingerprint IS DISTINCT FROM p_fingerprint/);
  assert.match(sql, /cardinality\(p_candidate_ids\) > 30/); assert.match(sql, /array_position\(p_candidate_ids, NULL\)/);
});
test('RPC de quota DEFINER à search_path fermé, sans lecture de documents privilégiée', () => {
  for (const name of ['leo_begin_request', 'leo_advance_request']) {
    const body = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`)); assert.ok(body);
    assert.match(body[0], /SECURITY DEFINER SET search_path = pg_catalog/);
    assert.match(body[1], /auth\.uid\(\)/); assert.doesNotMatch(body[1], /FROM public\.documents/);
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]+FROM PUBLIC, anon, authenticated;`));
  }
});
test('Edge crée seulement un client public avec JWT utilisateur vérifié et relit sous RLS', () => {
  assert.match(edge, /Deno\.env\.get\('SUPABASE_ANON_KEY'\)/);
  assert.match(edge, /Authorization: `Bearer \$\{token\}`/); assert.match(edge, /client\.auth\.getUser\(token\)/);
  assert.doesNotMatch(edge, /Deno\.env\.get\('[^']*(?:SERVICE_ROLE|SECRET_KEY)[^']*'\)/);
  assert.match(edge, /\.is\('deleted_at', null\)\.or\(`status\.eq\.approved,user_id\.eq\.\$\{userId\}`\)/);
  assert.match(edge, /Deno\.env\.get\('GEMINI_MODEL'\)/); assert.doesNotMatch(edge, /gemini-\d/);
});
