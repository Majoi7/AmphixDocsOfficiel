-- LOT LÉO : à exécuter MANUELLEMENT après V6, dans une base de test d'abord.
-- Aucun contenu de fichier, prompt ni plan n'est conservé dans le registre de quota.
BEGIN;

DO $prerequisites$
BEGIN
  IF to_regclass('public.documents') IS NULL
    OR to_regprocedure('public.list_library_documents(text,boolean,boolean,integer,boolean)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.documents'::regclass AND attname = 'school_name' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.documents'::regclass AND attname = 'subject_name' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.documents'::regclass AND attname = 'deleted_at' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.documents'::regclass AND attname = 'thumbnail_path' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.documents'::regclass AND attname = 'page_count' AND NOT attisdropped)
  THEN
    RAISE EXCEPTION 'Appliquer les migrations V5 et V6 avant V7.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.documents'::regclass)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'public.documents'::regclass AND NOT polpermissive AND polname LIKE 'amphix_v5_documents_%')
  THEN
    RAISE EXCEPTION 'Les protections de la bibliothèque doivent être actives avant V7.';
  END IF;
END;
$prerequisites$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
-- Ne pas déplacer une extension déjà installée : utiliser son schéma réel.
DO $normalization$
DECLARE
  accent_schema TEXT;
  trigram_schema TEXT;
BEGIN
  SELECT namespace.nspname INTO STRICT accent_schema FROM pg_catalog.pg_extension AS extension
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = extension.extnamespace WHERE extension.extname = 'unaccent';
  SELECT namespace.nspname INTO STRICT trigram_schema FROM pg_catalog.pg_extension AS extension
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = extension.extnamespace WHERE extension.extname = 'pg_trgm';
  EXECUTE format($definition$
    CREATE OR REPLACE FUNCTION public.leo_normalize_text(value TEXT)
    RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = pg_catalog
    AS $body$
      SELECT trim(regexp_replace(lower(%I.unaccent(%L::regdictionary, coalesce(value, ''))), '[^[:alnum:]]+', ' ', 'g'));
    $body$;
  $definition$, accent_schema, accent_schema || '.unaccent');
  EXECUTE format($definition$
    CREATE INDEX IF NOT EXISTS amphix_v7_documents_search_idx ON public.documents USING gin
      (public.leo_normalize_text(coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(file_name, '') || ' ' || coalesce(school_name, '') || ' ' || coalesce(subject_name, '')) %I.gin_trgm_ops)
      WHERE deleted_at IS NULL;
  $definition$, trigram_schema);
END;
$normalization$;
REVOKE ALL ON FUNCTION public.leo_normalize_text(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leo_normalize_text(TEXT) TO authenticated;
-- Le dictionnaire unaccent est fixé dans la fonction IMMUTABLE pour l'index.
-- Après une modification manuelle de ce dictionnaire, reconstruire cet index.

CREATE SCHEMA IF NOT EXISTS amphix_private;
REVOKE ALL ON SCHEMA amphix_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS amphix_private.leo_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  stage TEXT NOT NULL DEFAULT 'planning' CHECK (stage IN ('planning', 'planned', 'searching', 'searched', 'ranking', 'done')),
  fingerprint TEXT CHECK (fingerprint IS NULL OR fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_ids UUID[] NOT NULL DEFAULT '{}' CHECK (cardinality(candidate_ids) <= 30)
);
CREATE INDEX IF NOT EXISTS amphix_v7_leo_user_time_idx ON amphix_private.leo_requests(user_id, started_at);
ALTER TABLE amphix_private.leo_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON amphix_private.leo_requests FROM PUBLIC, anon, authenticated;
-- Aucune policy cliente : accès uniquement par les deux RPC étroites ci-dessous.

CREATE OR REPLACE FUNCTION public.leo_begin_request()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  request_id UUID;
  cutoff TIMESTAMPTZ;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Session requise.'; END IF;
  -- Sérialise le compteur pour un même compte, y compris entre Edge instances.
  PERFORM pg_advisory_xact_lock(hashtextextended('amphix-leo:' || actor::text, 0));
  cutoff := clock_timestamp() - interval '10 minutes';
  DELETE FROM amphix_private.leo_requests WHERE user_id = actor AND started_at <= cutoff;
  IF (SELECT count(*) FROM amphix_private.leo_requests WHERE user_id = actor AND started_at > cutoff) >= 20 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT429', MESSAGE = 'Quota atteint.';
  END IF;
  INSERT INTO amphix_private.leo_requests(user_id) VALUES (actor) RETURNING id INTO request_id;
  RETURN request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.leo_begin_request() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leo_begin_request() TO authenticated;

CREATE OR REPLACE FUNCTION public.leo_advance_request(
  p_request_id UUID, p_action TEXT, p_fingerprint TEXT DEFAULT NULL, p_candidate_ids UUID[] DEFAULT NULL
)
RETURNS UUID[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  target amphix_private.leo_requests%ROWTYPE;
  expected_stage TEXT;
  next_stage TEXT;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Session requise.'; END IF;
  SELECT * INTO target FROM amphix_private.leo_requests
    WHERE id = p_request_id AND user_id = actor AND started_at > clock_timestamp() - interval '10 minutes' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recherche expirée.'; END IF;
  CASE p_action
    WHEN 'planned' THEN expected_stage := 'planning'; next_stage := 'planned';
    WHEN 'out_of_scope' THEN expected_stage := 'planning'; next_stage := 'done';
    WHEN 'search' THEN expected_stage := 'planned'; next_stage := 'searching';
    WHEN 'searched' THEN expected_stage := 'searching'; next_stage := 'searched';
    WHEN 'rank' THEN expected_stage := 'searched'; next_stage := 'ranking';
    WHEN 'ranked' THEN expected_stage := 'ranking'; next_stage := 'done';
    ELSE RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Étape invalide.';
  END CASE;
  IF target.stage <> expected_stage THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Étape déjà utilisée ou invalide.'; END IF;
  IF p_action <> 'out_of_scope' AND (p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recherche invalide.';
  END IF;
  IF p_action NOT IN ('planned', 'out_of_scope') AND target.fingerprint IS DISTINCT FROM p_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recherche modifiée.';
  END IF;
  IF p_action = 'searched' THEN
    IF p_candidate_ids IS NULL OR cardinality(p_candidate_ids) > 30
      OR array_position(p_candidate_ids, NULL) IS NOT NULL
      OR cardinality(p_candidate_ids) <> (SELECT count(DISTINCT candidate) FROM unnest(p_candidate_ids) candidate)
    THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Résultats invalides.'; END IF;
  ELSIF p_candidate_ids IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Résultats inattendus.';
  END IF;
  UPDATE amphix_private.leo_requests SET stage = next_stage,
    fingerprint = CASE WHEN p_action = 'planned' THEN p_fingerprint ELSE fingerprint END,
    candidate_ids = CASE WHEN p_action = 'searched' THEN p_candidate_ids WHEN next_stage = 'done' THEN '{}'::uuid[] ELSE candidate_ids END
    WHERE id = target.id;
  RETURN CASE WHEN p_action = 'rank' THEN target.candidate_ids ELSE '{}'::uuid[] END;
END;
$$;
REVOKE ALL ON FUNCTION public.leo_advance_request(UUID, TEXT, TEXT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leo_advance_request(UUID, TEXT, TEXT, UUID[]) TO authenticated;

-- Recherche séparée du registre : toujours INVOKER + RLS, jamais DEFINER.
DO $search_function$
DECLARE
  trigram_schema TEXT;
BEGIN
  SELECT namespace.nspname INTO STRICT trigram_schema FROM pg_catalog.pg_extension AS extension
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = extension.extnamespace WHERE extension.extname = 'pg_trgm';
  EXECUTE format($definition$
    CREATE OR REPLACE FUNCTION public.leo_search_documents(
      p_keywords TEXT[] DEFAULT '{}', p_school TEXT DEFAULT NULL, p_subject TEXT DEFAULT NULL,
      p_type TEXT DEFAULT NULL, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL, p_sort TEXT DEFAULT 'relevance'
    )
    RETURNS SETOF public.documents LANGUAGE plpgsql STABLE SECURITY INVOKER
    SET search_path = pg_catalog SET row_security = on SET pg_trgm.word_similarity_threshold = '0.4'
    SET statement_timeout = '5s'
    AS $body$
    DECLARE
      actor UUID := (SELECT auth.uid());
      terms TEXT[];
      first_term TEXT;
      school TEXT := public.leo_normalize_text(p_school);
      subject TEXT := public.leo_normalize_text(p_subject);
    BEGIN
      IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Session requise.'; END IF;
      IF p_keywords IS NULL OR cardinality(p_keywords) > 8 OR EXISTS (SELECT 1 FROM unnest(p_keywords) term WHERE term IS NULL OR length(term) > 60)
        OR length(coalesce(p_school, '')) > 120 OR length(coalesce(p_subject, '')) > 120
        OR p_sort IS NULL OR p_sort NOT IN ('relevance', 'newest', 'oldest')
        OR (p_type IS NOT NULL AND p_type NOT IN ('examen', 'cours', 'exercice', 'corrige', 'pdf', 'image', 'doc', 'autre'))
        OR (p_from IS NOT NULL AND (p_from < DATE '1900-01-01' OR p_from > DATE '2100-12-31'))
        OR (p_to IS NOT NULL AND (p_to < DATE '1900-01-01' OR p_to > DATE '2100-12-31')) OR p_from > p_to
      THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recherche invalide.'; END IF;
      SELECT coalesce(array_agg(normalized), '{}'::text[]) INTO terms
        FROM (SELECT public.leo_normalize_text(term) normalized FROM unnest(p_keywords) term) words WHERE normalized <> '';
      first_term := coalesce(terms[1], nullif(school, ''), nullif(subject, ''));
      RETURN QUERY
      WITH scored AS (
        SELECT document.id, document.created_at,
          (SELECT coalesce(sum(%1$I.word_similarity(term, public.leo_normalize_text(coalesce(document.title, '') || ' ' || coalesce(document.description, '') || ' ' || coalesce(document.file_name, '') || ' ' || coalesce(document.school_name, '') || ' ' || coalesce(document.subject_name, '')))), 0) FROM unnest(terms) term) AS score
        FROM public.documents document
        WHERE document.deleted_at IS NULL AND (document.status = 'approved' OR document.user_id = actor)
          AND (first_term IS NULL OR public.leo_normalize_text(coalesce(document.title, '') || ' ' || coalesce(document.description, '') || ' ' || coalesce(document.file_name, '') || ' ' || coalesce(document.school_name, '') || ' ' || coalesce(document.subject_name, '')) OPERATOR(%1$I.%%>) first_term
            OR public.leo_normalize_text(coalesce(document.title, '') || ' ' || coalesce(document.description, '') || ' ' || coalesce(document.file_name, '') || ' ' || coalesce(document.school_name, '') || ' ' || coalesce(document.subject_name, '')) LIKE '%%' || first_term || '%%')
          AND NOT EXISTS (SELECT 1 FROM unnest(terms) term
            WHERE strpos(public.leo_normalize_text(coalesce(document.title, '') || ' ' || coalesce(document.description, '') || ' ' || coalesce(document.file_name, '') || ' ' || coalesce(document.school_name, '') || ' ' || coalesce(document.subject_name, '')), term) = 0
              AND NOT (term OPERATOR(%1$I.<%%) public.leo_normalize_text(coalesce(document.title, '') || ' ' || coalesce(document.description, '') || ' ' || coalesce(document.file_name, '') || ' ' || coalesce(document.school_name, '') || ' ' || coalesce(document.subject_name, ''))))
          AND (school = '' OR strpos(public.leo_normalize_text(coalesce(document.school_name, '') || ' ' || document.title), school) > 0 OR school OPERATOR(%1$I.<%%) public.leo_normalize_text(coalesce(document.school_name, '') || ' ' || document.title))
          AND (subject = '' OR strpos(public.leo_normalize_text(coalesce(document.subject_name, '') || ' ' || document.title), subject) > 0 OR subject OPERATOR(%1$I.<%%) public.leo_normalize_text(coalesce(document.subject_name, '') || ' ' || document.title))
          AND (p_type IS NULL OR (p_type IN ('pdf', 'image', 'doc', 'autre') AND document.file_type = p_type)
            OR (p_type IN ('examen', 'cours', 'exercice', 'corrige') AND public.leo_normalize_text(document.title || ' ' || coalesce(document.description, '') || ' ' || document.file_name) ~
              CASE p_type WHEN 'examen' THEN '(examen|epreuve|sujet|partiel|exam)' WHEN 'cours' THEN '(cours|lecon|chapitre)' WHEN 'exercice' THEN '(exercice|entrainement|travaux|td|tp)' ELSE '(corrige|correction|solution)' END))
          AND (p_from IS NULL OR document.created_at >= (p_from::timestamp AT TIME ZONE 'UTC'))
          AND (p_to IS NULL OR document.created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC'))
      )
      SELECT document.* FROM scored JOIN public.documents document ON document.id = scored.id
      ORDER BY CASE WHEN p_sort = 'relevance' THEN scored.score END DESC,
        CASE WHEN p_sort = 'oldest' THEN scored.created_at END ASC NULLS LAST,
        CASE WHEN p_sort <> 'oldest' THEN scored.created_at END DESC NULLS LAST, document.id
      LIMIT 30;
    END;
    $body$;
  $definition$, trigram_schema);
END;
$search_function$;
REVOKE ALL ON FUNCTION public.leo_search_documents(TEXT[], TEXT, TEXT, TEXT, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leo_search_documents(TEXT[], TEXT, TEXT, TEXT, DATE, DATE, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
-- Recette : A/B/admin/anon, corbeille, accent/faute, 21 appels concurrents,
-- rejeu d'étapes et V7. Les tests textuels seuls ne valident pas PostgreSQL/RLS.
-- Les lignes périmées sont retirées au prochain appel du même compte ; aucun
-- prompt n'y figure. Un compte inactif conserve au plus ses 20 marqueurs sans contenu.
