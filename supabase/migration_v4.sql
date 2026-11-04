-- ==========================================================
-- AmphixDocs — Migration V4 : droits SQL et Storage
-- Exécution MANUELLE dans le SQL Editor, d'abord sur une base de test.
-- Prérequis : schema.sql, migration_v2.sql, puis migration_v3.sql.
-- Ne rejoue pas les scripts d'initialisation sur une base existante.
-- Aucune ligne métier n'est supprimée ou réécrite par cette migration.
-- Une donnée incompatible fait échouer toute la transaction.
-- ==========================================================

BEGIN;

DO $prerequisites$
BEGIN
  IF to_regclass('public.profiles') IS NULL
    OR to_regclass('public.categories') IS NULL
    OR to_regclass('public.folders') IS NULL
    OR to_regclass('public.documents') IS NULL
    OR to_regclass('storage.objects') IS NULL
    OR to_regclass('storage.buckets') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL
    OR to_regprocedure('public.handle_new_user()') IS NULL
  THEN
    RAISE EXCEPTION 'Migration V4 : schéma incomplet. Vérifier les prérequis sans rejouer les anciens scripts.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.documents'::regclass
      AND conname = 'documents_user_id_profiles_fkey' AND convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.folders'::regclass
      AND conname = 'folders_user_id_profiles_fkey' AND convalidated
  ) THEN
    RAISE EXCEPTION 'Migration V4 : appliquer et vérifier la migration V3 avant V4.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'documents') THEN
    RAISE EXCEPTION 'Migration V4 : bucket documents absent. Vérifier sa configuration.';
  END IF;

  -- Le schéma Storage est géré par Supabase : ne pas modifier son ownership.
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
          WHERE oid = 'storage.objects'::regclass) THEN
    RAISE EXCEPTION 'Migration V4 : RLS Storage désactivé. Vérifier le schéma Storage géré par Supabase.';
  END IF;
END;
$prerequisites$;

-- Ne pas modifier allowed_mime_types : aucun nouveau choix de formats ici.
UPDATE storage.buckets
SET public = false, file_size_limit = 20971520
WHERE id = 'documents';

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Relation au profil réel, jamais aux métadonnées Google modifiables par le client.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
ALTER FUNCTION public.handle_new_user() SET search_path = pg_catalog;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Révoquer également les anciennes autorisations de colonnes : une révocation
-- au niveau table, seule, ne retire pas un GRANT UPDATE(colonne) préexistant.
REVOKE ALL PRIVILEGES ON TABLE
  public.profiles, public.categories, public.folders, public.documents
FROM PUBLIC, anon, authenticated;

DO $column_privileges$
DECLARE
  table_name TEXT;
  column_names TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['profiles', 'categories', 'folders', 'documents'] LOOP
    SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum)
    INTO column_names
    FROM pg_catalog.pg_attribute
    WHERE attrelid = format('public.%I', table_name)::regclass
      AND attnum > 0 AND NOT attisdropped;

    EXECUTE format(
      'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE public.%2$I FROM PUBLIC, anon, authenticated',
      column_names, table_name
    );
  END LOOP;
END;
$column_privileges$;

GRANT SELECT ON TABLE
  public.profiles, public.categories, public.folders, public.documents
TO authenticated;
GRANT UPDATE (role) ON TABLE public.profiles TO authenticated;
GRANT INSERT (id, user_id, name, category_id, status)
  ON TABLE public.folders TO authenticated;
GRANT UPDATE (name, status, rejection_reason)
  ON TABLE public.folders TO authenticated;
GRANT INSERT (id, user_id, title, description, file_name, file_path, file_type,
              file_size, folder_id, category_id, status)
  ON TABLE public.documents TO authenticated;
GRANT UPDATE (title, description, status, rejection_reason)
  ON TABLE public.documents TO authenticated;
GRANT DELETE ON TABLE public.folders, public.documents TO authenticated;

-- Les comptes admin du navigateur restent dans le rôle PostgreSQL authenticated.
-- Les triggers distinguent leur rôle métier ; aucun GRANT global supplémentaire.
-- Les fonctions sont INVOKER : les appels PostgREST gardent current_user =
-- authenticated. Les opérations SQL privilégiées et le trigger Auth existant
-- ne sont pas transformés en opérations navigateur par cette migration.
CREATE OR REPLACE FUNCTION public.amphix_guard_document_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  administrator BOOLEAN;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Une session authentifiée est nécessaire.';
  END IF;
  administrator := public.is_admin();

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Le propriétaire doit correspondre à la session.';
    END IF;
    IF NOT administrator AND (
      NEW.status IS DISTINCT FROM 'pending'
      OR NEW.rejection_reason IS NOT NULL
      OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Un dépôt ordinaire doit être en attente, sans métadonnées de modération.';
    END IF;

    -- Ne pas permettre un lien vers un dossier privé invisible via une simple FK.
    -- Les dossiers visibles déjà proposés par le formulaire restent utilisables.
    -- Aucune propagation du statut dossier/document n'est inventée ici.
    IF NEW.folder_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.folders WHERE id = NEW.folder_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Le dossier de destination est absent ou inaccessible.';
    END IF;

    -- Vérification des métadonnées Storage, pas une mesure des octets du fichier.
    -- Le CHECK de chemin ci-dessous impose aussi le préfixe du propriétaire.
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'documents' AND name = NEW.file_path
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Le fichier doit être transféré dans Storage avant son enregistrement.';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.file_path IS DISTINCT FROM OLD.file_path
      OR NEW.file_name IS DISTINCT FROM OLD.file_name
      OR NEW.file_type IS DISTINCT FROM OLD.file_type
      OR NEW.file_size IS DISTINCT FROM OLD.file_size
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'L’identité, le propriétaire et les références du fichier sont immuables depuis le client.';
    END IF;

    IF NOT administrator AND (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
      OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
      OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Les champs de modération sont réservés à l’administration.';
    END IF;
  END IF;

  -- Reviewer et date proviennent de la session et de l'horloge PostgreSQL.
  -- Le client n'a aucun droit UPDATE/INSERT sur ces deux colonnes.
  IF administrator THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status <> 'pending' THEN
        NEW.reviewed_by := auth.uid();
        NEW.reviewed_at := transaction_timestamp();
      ELSE
        NEW.reviewed_by := NULL;
        NEW.reviewed_at := NULL;
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
    THEN
      NEW.reviewed_by := auth.uid();
      NEW.reviewed_at := transaction_timestamp();
    END IF;
  END IF;
  IF NEW.status <> 'rejected' THEN
    NEW.rejection_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.amphix_guard_folder_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Une session authentifiée est nécessaire.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Le propriétaire doit correspondre à la session.';
    END IF;
    IF NEW.status IS DISTINCT FROM 'pending' OR NEW.rejection_reason IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Un nouveau dossier doit être en attente, sans motif de modération.';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'L’identité et le propriétaire du dossier sont immuables depuis le client.';
    END IF;
    IF NOT public.is_admin() AND (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Les champs de modération sont réservés à l’administration.';
    END IF;
  END IF;
  IF NEW.status <> 'rejected' THEN
    NEW.rejection_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.amphix_guard_document_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amphix_guard_folder_write() FROM PUBLIC, anon, authenticated;

-- Une cascade FK ignore les RLS de la table enfant. Un dossier approuvé peut
-- recevoir des fichiers d'autres auteurs : son propriétaire ne doit pas pouvoir
-- les supprimer indirectement, même lorsqu'ils lui sont masqués par les RLS.
-- Le helper ne renvoie aucune donnée privée et vérifie lui-même la session.
CREATE OR REPLACE FUNCTION public.amphix_assert_folder_delete_allowed(target_folder_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Une session authentifiée est nécessaire.';
  END IF;
  IF public.is_admin() THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.folders
    WHERE id = target_folder_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Ce dossier est absent ou sa suppression n’est pas autorisée.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.documents
    WHERE folder_id = target_folder_id AND user_id IS DISTINCT FROM auth.uid()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Ce dossier contient des fichiers d’autres auteurs. Sa suppression nécessite l’administration.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.amphix_assert_folder_delete_allowed(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amphix_assert_folder_delete_allowed(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.amphix_guard_folder_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    PERFORM public.amphix_assert_folder_delete_allowed(OLD.id);
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.amphix_guard_folder_delete() FROM PUBLIC, anon, authenticated;

-- EXECUTE est contrôlé lors de CREATE TRIGGER, pas à chaque déclenchement.
DROP TRIGGER IF EXISTS amphix_v4_document_write ON public.documents;
CREATE TRIGGER amphix_v4_document_write
  BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.amphix_guard_document_write();
DROP TRIGGER IF EXISTS amphix_v4_folder_write ON public.folders;
CREATE TRIGGER amphix_v4_folder_write
  BEFORE INSERT OR UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.amphix_guard_folder_write();
DROP TRIGGER IF EXISTS amphix_v4_folder_delete ON public.folders;
CREATE TRIGGER amphix_v4_folder_delete
  BEFORE DELETE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.amphix_guard_folder_delete();

-- Ces contraintes appartiennent à V4 ; leur remplacement transactionnel rend
-- une réexécution convergente, sans conserver une définition homonyme trop large.
-- Les verrous DDL empêchent les écritures concurrentes durant ce remplacement.
ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS amphix_v4_documents_description,
  DROP CONSTRAINT IF EXISTS amphix_v4_documents_size,
  DROP CONSTRAINT IF EXISTS amphix_v4_documents_path,
  DROP CONSTRAINT IF EXISTS amphix_v4_documents_file_path_unique;
ALTER TABLE public.documents
  ADD CONSTRAINT amphix_v4_documents_description
    CHECK (description IS NULL OR char_length(description) <= 200) NOT VALID,
  ADD CONSTRAINT amphix_v4_documents_size
    CHECK (file_size IS NOT NULL AND file_size >= 0 AND file_size <= 20971520) NOT VALID,
  ADD CONSTRAINT amphix_v4_documents_path
    CHECK (file_path LIKE (user_id::text || '/%')
           AND char_length(file_path) > char_length(user_id::text) + 1) NOT VALID,
  ADD CONSTRAINT amphix_v4_documents_file_path_unique UNIQUE (file_path);
ALTER TABLE public.documents VALIDATE CONSTRAINT amphix_v4_documents_description;
ALTER TABLE public.documents VALIDATE CONSTRAINT amphix_v4_documents_size;
ALTER TABLE public.documents VALIDATE CONSTRAINT amphix_v4_documents_path;

DO $existing_objects$
DECLARE
  missing_count BIGINT;
BEGIN
  SELECT count(*) INTO missing_count
  FROM public.documents AS document
  WHERE NOT EXISTS (
    SELECT 1 FROM storage.objects AS object
    WHERE object.bucket_id = 'documents' AND object.name = document.file_path
  );
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Migration V4 : % document(s) sans métadonnée Storage correspondante. Prévoir leur récupération ; aucune suppression automatique.', missing_count;
  END IF;
END;
$existing_objects$;

-- Remplacer uniquement les policies connues des anciens scripts.
-- Les policies supplémentaires ne sont pas supprimées aveuglément : des gardes
-- RESTRICTIVE capent leur combinaison permissive par OR. Une policy inconnue
-- plus stricte peut encore bloquer une opération et doit être inventoriée.
DROP POLICY IF EXISTS "Lecture des profils" ON public.profiles;
DROP POLICY IF EXISTS "Modification du rôle par admin uniquement" ON public.profiles;
DROP POLICY IF EXISTS "Lecture publique des catégories" ON public.categories;
DROP POLICY IF EXISTS "Lecture des dossiers" ON public.folders;
DROP POLICY IF EXISTS "Création de dossiers" ON public.folders;
DROP POLICY IF EXISTS "Modification de dossiers" ON public.folders;
DROP POLICY IF EXISTS "Suppression de dossiers" ON public.folders;
DROP POLICY IF EXISTS "Les utilisateurs peuvent lire leurs propres documents" ON public.documents;
DROP POLICY IF EXISTS "Les utilisateurs peuvent insérer leurs propres documents" ON public.documents;
DROP POLICY IF EXISTS "Les utilisateurs peuvent modifier leurs propres documents" ON public.documents;
DROP POLICY IF EXISTS "Les utilisateurs peuvent supprimer leurs propres documents" ON public.documents;
DROP POLICY IF EXISTS "Lecture des documents (proprietaire, admin ou approuve)" ON public.documents;
DROP POLICY IF EXISTS "Insertion de documents avec statut pending" ON public.documents;
DROP POLICY IF EXISTS "Mise a jour de documents" ON public.documents;
DROP POLICY IF EXISTS "Suppression de documents" ON public.documents;

-- Règles permissives + garde restrictive avec exactement le même périmètre.
DO $application_policies$
DECLARE
  rule RECORD;
  policy_name TEXT;
  restrictive BOOLEAN;
  mode_name TEXT;
  sql_command TEXT;
BEGIN
  FOR rule IN SELECT * FROM (VALUES
    ('profiles', 'select', 'auth.uid() IS NOT NULL AND (id = auth.uid() OR public.is_admin())', NULL::TEXT),
    ('profiles', 'update', 'auth.uid() IS NOT NULL AND public.is_admin()', 'auth.uid() IS NOT NULL AND public.is_admin()'),
    ('categories', 'select', 'auth.uid() IS NOT NULL', NULL::TEXT),
    ('folders', 'select', 'auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_admin() OR status = ''approved'')', NULL::TEXT),
    ('folders', 'insert', NULL::TEXT, 'auth.uid() IS NOT NULL AND user_id = auth.uid() AND status = ''pending'' AND rejection_reason IS NULL'),
    ('folders', 'update', 'auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_admin())', 'auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_admin())'),
    ('folders', 'delete', 'auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_admin())', NULL::TEXT),
    ('documents', 'select', 'auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_admin() OR status = ''approved'')', NULL::TEXT),
    ('documents', 'insert', NULL::TEXT, 'auth.uid() IS NOT NULL AND user_id = auth.uid() AND (public.is_admin() OR (status = ''pending'' AND rejection_reason IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL))'),
    ('documents', 'update', 'auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_admin())', 'auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_admin())'),
    ('documents', 'delete', 'auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_admin())', NULL::TEXT)
  ) AS rules(table_name, operation, using_expression, check_expression) LOOP
    FOREACH restrictive IN ARRAY ARRAY[false, true] LOOP
      mode_name := CASE WHEN restrictive THEN 'RESTRICTIVE' ELSE 'PERMISSIVE' END;
      policy_name := format('amphix_v4_%s_%s_%s', rule.table_name, rule.operation,
                            CASE WHEN restrictive THEN 'guard' ELSE 'allow' END);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, rule.table_name);
      sql_command := format('CREATE POLICY %I ON public.%I AS %s FOR %s TO authenticated',
                            policy_name, rule.table_name, mode_name, upper(rule.operation));
      IF rule.using_expression IS NOT NULL THEN
        sql_command := sql_command || format(' USING (%s)', rule.using_expression);
      END IF;
      IF rule.check_expression IS NOT NULL THEN
        sql_command := sql_command || format(' WITH CHECK (%s)', rule.check_expression);
      END IF;
      EXECUTE sql_command;
    END LOOP;
  END LOOP;
END;
$application_policies$;

-- Aucun INSERT/DELETE de profil ni aucune écriture de catégorie par le client,
-- même si une ancienne policy permissive subsiste. Le trigger Auth est privilégié.
DROP POLICY IF EXISTS amphix_v4_profiles_no_insert ON public.profiles;
CREATE POLICY amphix_v4_profiles_no_insert ON public.profiles
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS amphix_v4_profiles_no_delete ON public.profiles;
CREATE POLICY amphix_v4_profiles_no_delete ON public.profiles
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
DROP POLICY IF EXISTS amphix_v4_categories_no_write ON public.categories;
DROP POLICY IF EXISTS amphix_v4_categories_no_insert ON public.categories;
CREATE POLICY amphix_v4_categories_no_insert ON public.categories
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS amphix_v4_categories_no_update ON public.categories;
CREATE POLICY amphix_v4_categories_no_update ON public.categories
  AS RESTRICTIVE FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS amphix_v4_categories_no_delete ON public.categories;
CREATE POLICY amphix_v4_categories_no_delete ON public.categories
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
-- DELETE n'évalue pas WITH CHECK : sa garde USING est explicitement false.

DROP POLICY IF EXISTS "Lecture de documents personnels" ON storage.objects;
DROP POLICY IF EXISTS "Lecture de documents personnels ou approuves" ON storage.objects;
DROP POLICY IF EXISTS "Upload de documents personnels" ON storage.objects;
DROP POLICY IF EXISTS "Modification de documents personnels" ON storage.objects;
DROP POLICY IF EXISTS "Suppression de documents personnels" ON storage.objects;

-- Le garde commun ne consulte aucune table métier. Sinon une sous-requête
-- vers documents dans une policy TO PUBLIC ferait échouer aussi les accès
-- anon aux AUTRES buckets après révocation de leurs droits SQL métier.
DROP POLICY IF EXISTS amphix_v4_storage_client_role ON storage.objects;
CREATE POLICY amphix_v4_storage_client_role ON storage.objects
  AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (
    bucket_id <> 'documents'
    OR (current_user = 'authenticated' AND auth.uid() IS NOT NULL)
  )
  WITH CHECK (
    bucket_id <> 'documents'
    OR (current_user = 'authenticated' AND auth.uid() IS NOT NULL)
  );
-- Les rôles privilégiés avec BYPASSRLS ne sont pas des sessions navigateur.

-- Aucun UPDATE/UPSERT/renommage d'objet dans documents : le contenu approuvé
-- ne doit pas pouvoir être remplacé en conservant la même ligne approved.
-- Pour un remplacement futur, prévoir un nouveau dépôt et une nouvelle revue.
DO $storage_policies$
DECLARE
  rule RECORD;
  policy_name TEXT;
  restrictive BOOLEAN;
  mode_name TEXT;
  using_expression TEXT;
  check_expression TEXT;
  sql_command TEXT;
BEGIN
  FOR rule IN SELECT * FROM (VALUES
    ('select', $read$
      CASE WHEN auth.uid() IS NULL THEN false ELSE (
        (storage.foldername(name))[1] = auth.uid()::text
        OR public.is_admin()
        OR EXISTS (
          SELECT 1 FROM public.documents AS document
          WHERE document.file_path = storage.objects.name AND document.status = 'approved'
            AND (storage.foldername(storage.objects.name))[1] = document.user_id::text
        )
      ) END
    $read$, NULL::TEXT),
    ('insert', NULL::TEXT, $upload$
      CASE WHEN auth.uid() IS NULL THEN false ELSE (
        (storage.foldername(name))[1] = auth.uid()::text
        AND NOT EXISTS (
          SELECT 1 FROM public.documents AS document
          WHERE document.file_path = storage.objects.name
        )
      ) END
    $upload$),
    ('update', 'false', 'false'),
    ('delete', $remove$
      CASE WHEN auth.uid() IS NULL THEN false ELSE (
        (storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()
      ) END
    $remove$, NULL::TEXT)
  ) AS rules(operation, using_expression, check_expression) LOOP
    FOREACH restrictive IN ARRAY ARRAY[false, true] LOOP
      mode_name := CASE WHEN restrictive THEN 'RESTRICTIVE' ELSE 'PERMISSIVE' END;
      policy_name := format('amphix_v4_storage_%s_%s', rule.operation,
                            CASE WHEN restrictive THEN 'guard' ELSE 'allow' END);
      -- Les gardes métier sont réservées à authenticated : le garde commun
      -- TO PUBLIC ci-dessus bloque anon dans documents sans requête métier.
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', policy_name);
      sql_command := format('CREATE POLICY %I ON storage.objects AS %s FOR %s TO authenticated',
                            policy_name, mode_name, upper(rule.operation));
      using_expression := rule.using_expression;
      check_expression := rule.check_expression;
      IF using_expression IS NOT NULL THEN
        using_expression := CASE WHEN restrictive
          THEN format('bucket_id <> ''documents'' OR (%s)', using_expression)
          ELSE format('bucket_id = ''documents'' AND (%s)', using_expression) END;
        sql_command := sql_command || format(' USING (%s)', using_expression);
      END IF;
      IF check_expression IS NOT NULL THEN
        check_expression := CASE WHEN restrictive
          THEN format('bucket_id <> ''documents'' OR (%s)', check_expression)
          ELSE format('bucket_id = ''documents'' AND (%s)', check_expression) END;
        sql_command := sql_command || format(' WITH CHECK (%s)', check_expression);
      END IF;
      EXECUTE sql_command;
    END LOOP;
  END LOOP;
END;
$storage_policies$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Réserves :
-- * Inventorier aussi les GRANT hérités d'autres rôles, fonctions SECURITY
--   DEFINER et policies supplémentaires de l'environnement réel.
-- * SQL Editor en rôle privilégié n'est pas une recette RLS A/B/admin.
-- * La présence d'une ligne storage.objects n'atteste pas des octets distants.
-- * Storage DELETE + SQL DELETE restent deux opérations : reprise et nettoyage
--   des cascades dossiers relèvent de P0-05, non résolu par une policy.
-- * Aucun choix nouveau sur collaboration, propagation de statuts ou dernier
--   admin. La visibilité des dossiers existants est conservée ; ces décisions
--   produit et la recette restent ouvertes dans la roadmap.
