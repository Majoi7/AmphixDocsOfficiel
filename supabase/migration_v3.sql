-- ==========================================================
-- AmphixDocs — Migration V3 : relations des auteurs vers profiles
-- À exécuter manuellement dans le SQL Editor de Supabase.
-- Prérequis : schema.sql puis migration_v2.sql déjà appliqués.
-- Les anciens scripts et les FK vers auth.users restent inchangés.
-- Cette migration ne modifie ni les rôles existants ni les RLS.
-- ==========================================================

BEGIN;

-- Échouer explicitement si le schéma attendu n'est pas installé.
DO $prerequisites$
BEGIN
  IF to_regclass('auth.users') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('public.documents') IS NULL
    OR to_regclass('public.folders') IS NULL
  THEN
    RAISE EXCEPTION 'Migration V3 : tables manquantes. Vérifier schema.sql et migration_v2.sql sans les rejouer aveuglément.';
  END IF;
END;
$prerequisites$;

-- Créer uniquement les profils absents. Ne pas écraser les informations
-- personnalisées ou rétrograder les comptes administrateurs existants.
INSERT INTO public.profiles (
  id, email, full_name, avatar_url, role, created_at, last_sign_in_at
)
SELECT
  users.id,
  users.email,
  COALESCE(
    NULLIF(users.raw_user_meta_data->>'full_name', ''),
    NULLIF(users.raw_user_meta_data->>'name', ''),
    NULLIF(split_part(users.email, '@', 1), '')
  ),
  COALESCE(
    NULLIF(users.raw_user_meta_data->>'avatar_url', ''),
    NULLIF(users.raw_user_meta_data->>'picture', ''),
    ''
  ),
  'user',
  COALESCE(users.created_at, now()),
  users.last_sign_in_at
FROM auth.users AS users
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles AS profile WHERE profile.id = users.id
)
ON CONFLICT (id) DO NOTHING;

-- Les noms stables sont utilisés comme hints par les requêtes PostgREST.
-- On ajoute ces relations sans supprimer les FK existantes vers auth.users.
-- Une contrainte homonyme incompatible provoque un échec, pas un remplacement.
DO $author_relations$
DECLARE
  target RECORD;
  owner_attribute SMALLINT;
  profile_attribute SMALLINT;
  existing_constraint pg_catalog.pg_constraint%ROWTYPE;
BEGIN
  SELECT attnum INTO STRICT profile_attribute
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.profiles'::regclass
    AND attname = 'id'
    AND NOT attisdropped;

  FOR target IN
    SELECT * FROM (VALUES
      ('documents', 'documents_user_id_profiles_fkey'),
      ('folders', 'folders_user_id_profiles_fkey')
    ) AS targets(table_name, constraint_name)
  LOOP
    SELECT attnum INTO STRICT owner_attribute
    FROM pg_catalog.pg_attribute
    WHERE attrelid = format('public.%I', target.table_name)::regclass
      AND attname = 'user_id'
      AND NOT attisdropped;

    SELECT * INTO existing_constraint
    FROM pg_catalog.pg_constraint
    WHERE conrelid = format('public.%I', target.table_name)::regclass
      AND conname = target.constraint_name;

    IF FOUND THEN
      IF existing_constraint.contype <> 'f'
        OR existing_constraint.confrelid <> 'public.profiles'::regclass
        OR existing_constraint.conkey IS DISTINCT FROM ARRAY[owner_attribute]::SMALLINT[]
        OR existing_constraint.confkey IS DISTINCT FROM ARRAY[profile_attribute]::SMALLINT[]
      THEN
        RAISE EXCEPTION 'Migration V3 : la contrainte % existe avec une définition incompatible. Aucun remplacement automatique.', target.constraint_name;
      END IF;
    ELSE
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE NOT VALID',
        target.table_name,
        target.constraint_name
      );
    END IF;

    -- La validation contrôle aussi les lignes existantes. Un propriétaire
    -- orphelin fait échouer toute la transaction : aucune ligne n'est effacée.
    EXECUTE format(
      'ALTER TABLE public.%I VALIDATE CONSTRAINT %I',
      target.table_name,
      target.constraint_name
    );
  END LOOP;
END;
$author_relations$;

-- Notification délivrée au COMMIT, après installation et validation des FK.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Réexécuter ce fichier n'ajoute ni profil existant ni contrainte homonyme.
-- Les suppressions en cascade concernent les métadonnées SQL uniquement :
-- elles ne nettoient pas les objets Storage. Aucune suppression n'est lancée ici.
-- Les RLS de profiles continuent de limiter la lecture à soi-même/admin :
-- réparer une relation ne rend pas les e-mails publics.
