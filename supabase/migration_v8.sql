-- LÉO V8 : recherche tolérante, à exécuter MANUELLEMENT après V7.
-- Rejouable : remplace uniquement la RPC de recherche, sans modifier V7 ni les RLS.
BEGIN;

DO $prerequisites$
BEGIN
  IF to_regclass('public.documents') IS NULL
    OR to_regprocedure('public.leo_normalize_text(text)') IS NULL
    OR to_regprocedure('public.leo_search_documents(text[],text,text,text,date,date,text)') IS NULL
    OR to_regprocedure('public.leo_begin_request()') IS NULL
    OR to_regprocedure('public.leo_advance_request(uuid,text,text,uuid[])') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'unaccent')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm')
  THEN
    RAISE EXCEPTION 'Appliquer la migration V7 avant V8.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.documents'::regclass)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'public.documents'::regclass AND NOT polpermissive AND polname LIKE 'amphix_v5_documents_%')
  THEN
    RAISE EXCEPTION 'Les protections de la bibliothèque doivent être actives avant V8.';
  END IF;
END;
$prerequisites$;

DO $search_function$
DECLARE
  trigram_schema TEXT;
BEGIN
  -- L'extension peut être installée ailleurs que dans extensions.
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
      fuzzy_terms TEXT[];
      substring_patterns TEXT[];
      letter_patterns TEXT[];
      language_letters TEXT[];
      school TEXT := public.leo_normalize_text(p_school);
      subject TEXT := public.leo_normalize_text(p_subject);
      stop_words TEXT[] := string_to_array('je tu il elle on nous vous ils elles le la les un une des du de d a au aux et ou pour par dans sur en avec sans tous toutes tout cherche chercher recherche recherches trouve trouver retrouve retrouver montre donne moi mes mon ma ton ta ses se ce ces cet cette quels quelles quel quelle est sont ai as ai besoin veux voudrais peux peut fichier fichiers document documents stp salut bonjour merci', ' ');
    BEGIN
      IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Session requise.'; END IF;
      IF p_keywords IS NULL OR cardinality(p_keywords) > 8 OR EXISTS (SELECT 1 FROM unnest(p_keywords) term WHERE term IS NULL OR length(term) > 60)
        OR length(coalesce(p_school, '')) > 120 OR length(coalesce(p_subject, '')) > 120
        OR p_sort IS NULL OR p_sort NOT IN ('relevance', 'newest', 'oldest')
        OR (p_type IS NOT NULL AND p_type NOT IN ('examen', 'cours', 'exercice', 'corrige', 'pdf', 'image', 'doc', 'autre'))
        OR (p_from IS NOT NULL AND (p_from < DATE '1900-01-01' OR p_from > DATE '2100-12-31'))
        OR (p_to IS NOT NULL AND (p_to < DATE '1900-01-01' OR p_to > DATE '2100-12-31')) OR p_from > p_to
      THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recherche invalide.'; END IF;

      -- Accepte aussi bien ['langage c'] que ['langage', 'c']. La lettre reste
      -- un mot entier, jamais une sous-chaîne ni une correspondance trigramme.
      -- Dédupliquer avant de compter ; borner l'expansion des 8 mots-clés à 16 mots.
      WITH tokens AS (
        SELECT word, position, lag(word) OVER (ORDER BY position) AS previous
        FROM regexp_split_to_table(public.leo_normalize_text(array_to_string(p_keywords, ' ')), ' ')
          WITH ORDINALITY AS token(word, position)
      ), significant AS (
        SELECT word, min(position) AS position
        FROM tokens
        WHERE (length(word) > 1 AND NOT word = ANY(stop_words))
          OR (word ~ '^[a-z]$' AND previous IN ('langage', 'language'))
        GROUP BY word ORDER BY min(position) LIMIT 16
      )
      SELECT coalesce((SELECT array_agg(word ORDER BY position) FROM significant), '{}'::text[]),
        coalesce((SELECT array_agg(DISTINCT word) FROM tokens
          WHERE word ~ '^[a-z]$' AND previous IN ('langage', 'language')
            AND word IN (SELECT word FROM significant)), '{}'::text[])
      INTO terms, language_letters;
      SELECT coalesce(array_agg(term) FILTER (WHERE length(term) > 1), '{}'::text[]),
        coalesce(array_agg('%%' || term || '%%') FILTER (WHERE length(term) > 1), '{}'::text[]),
        coalesce(array_agg('%% ' || term || ' %%') FILTER (WHERE length(term) = 1), '{}'::text[])
      INTO fuzzy_terms, substring_patterns, letter_patterns FROM unnest(terms) term;

      RETURN QUERY
      WITH eligible AS (
        SELECT document.id, document.created_at,
          public.leo_normalize_text(coalesce(document.title, '') || ' ' || coalesce(document.description, '') || ' ' || coalesce(document.file_name, '') || ' ' || coalesce(document.school_name, '') || ' ' || coalesce(document.subject_name, '')) AS searchable
        FROM public.documents document
        WHERE document.deleted_at IS NULL AND (document.status = 'approved' OR document.user_id = actor)
          -- Un seul mot significatif suffit. Aucun verrou sur le premier terme.
          -- Les sous-chaînes retrouvent cours/ifri dans coursROifri_2026.
          -- L'expression de gauche reste celle de l'index GIN V7.
          AND (cardinality(p_keywords) = 0
            OR public.leo_normalize_text(coalesce(document.title, '') || ' ' || coalesce(document.description, '') || ' ' || coalesce(document.file_name, '') || ' ' || coalesce(document.school_name, '') || ' ' || coalesce(document.subject_name, '')) LIKE ANY(substring_patterns)
            OR public.leo_normalize_text(coalesce(document.title, '') || ' ' || coalesce(document.description, '') || ' ' || coalesce(document.file_name, '') || ' ' || coalesce(document.school_name, '') || ' ' || coalesce(document.subject_name, '')) OPERATOR(%1$I.%%>) ANY(fuzzy_terms)
            OR (' ' || public.leo_normalize_text(coalesce(document.title, '') || ' ' || coalesce(document.description, '') || ' ' || coalesce(document.file_name, '') || ' ' || coalesce(document.school_name, '') || ' ' || coalesce(document.subject_name, '')) || ' ') LIKE ANY(letter_patterns))
          AND (school = '' OR strpos(public.leo_normalize_text(coalesce(document.school_name, '') || ' ' || document.title), school) > 0 OR school OPERATOR(%1$I.<%%) public.leo_normalize_text(coalesce(document.school_name, '') || ' ' || document.title))
          AND (subject = '' OR strpos(public.leo_normalize_text(coalesce(document.subject_name, '') || ' ' || document.title), subject) > 0 OR subject OPERATOR(%1$I.<%%) public.leo_normalize_text(coalesce(document.subject_name, '') || ' ' || document.title))
          AND (p_type IS NULL OR (p_type IN ('pdf', 'image', 'doc', 'autre') AND document.file_type = p_type)
            OR (p_type IN ('examen', 'cours', 'exercice', 'corrige') AND public.leo_normalize_text(document.title || ' ' || coalesce(document.description, '') || ' ' || document.file_name) ~
              CASE p_type WHEN 'examen' THEN '(examen|epreuve|sujet|partiel|exam)' WHEN 'cours' THEN '(cours|lecon|chapitre)' WHEN 'exercice' THEN '(exercice|entrainement|travaux|td|tp)' ELSE '(corrige|correction|solution)' END))
          AND (p_from IS NULL OR document.created_at >= (p_from::timestamp AT TIME ZONE 'UTC'))
          AND (p_to IS NULL OR document.created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC'))
      ), scored AS (
        SELECT eligible.id, eligible.created_at, matches.matched_words, matches.similarity_score,
          -- Bonus seulement pour une paire adjacente : "Language C" oui,
          -- "Language R ... C" non. La lettre exacte évite le flou sur C/R.
          (SELECT count(*) FROM unnest(language_letters) letter WHERE EXISTS (
            SELECT 1 FROM generate_subscripts(words.parts, 1) position
            WHERE position > 1 AND words.parts[position] = letter
              AND greatest(%1$I.word_similarity('langage', words.parts[position - 1]),
                %1$I.word_similarity('language', words.parts[position - 1])) >= 0.4
          )) AS phrase_bonus
        FROM eligible
        CROSS JOIN LATERAL (SELECT string_to_array(eligible.searchable, ' ') AS parts) words
        CROSS JOIN LATERAL (
          SELECT count(*) FILTER (WHERE similarity >= 0.4) AS matched_words,
            coalesce(sum(similarity) FILTER (WHERE similarity >= 0.4), 0) AS similarity_score
          FROM (
            SELECT CASE WHEN length(term) = 1 THEN CASE WHEN term = ANY(words.parts) THEN 1.0 ELSE 0.0 END
              WHEN strpos(eligible.searchable, term) > 0 THEN 1.0
              ELSE %1$I.word_similarity(term, eligible.searchable) END AS similarity
            FROM unnest(terms) term
          ) similarities
        ) matches
      )
      SELECT document.* FROM scored JOIN public.documents document ON document.id = scored.id
      ORDER BY CASE WHEN p_sort = 'relevance' THEN scored.matched_words END DESC,
        CASE WHEN p_sort = 'relevance' THEN scored.phrase_bonus END DESC,
        CASE WHEN p_sort = 'relevance' THEN scored.similarity_score END DESC,
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
-- Appliquer V8 puis redéployer leo-search (plan de secours et instructions modifiés).
-- Les tests locaux ne remplacent pas une recette avec les JWT/RLS du projet cible.
