-- ==========================================================
-- AmphixDocs — V5 / LOT 1 : bibliothèque sans dossiers
-- Exécution MANUELLE, d'abord sur une base de test sauvegardée.
-- Prérequis : V4 réellement appliquée. Ne pas rejouer V1–V4.
-- Prévoir une fenêtre de maintenance : verrous sur documents/profiles.
-- Les classements sont déplacés dans un schéma privé ; AUCUN fichier,
-- objet Storage, UUID, statut ou donnée de revue n'est supprimé.
-- École/matière : libellés transitoires ; les entités relèvent de V6.
-- ==========================================================

BEGIN;

DO $prerequisites$
BEGIN
  IF to_regclass('public.documents') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('storage.objects') IS NULL
    OR to_regprocedure('public.amphix_guard_document_write()') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.documents'::regclass
        AND conname = 'amphix_v4_documents_size' AND convalidated
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.documents'::regclass
        AND conname = 'documents_user_id_profiles_fkey' AND convalidated
    )
  THEN
    RAISE EXCEPTION 'V5 : vérifier V3/V4 et leurs contraintes avant cette migration.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'documents' AND NOT public)
    OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'storage.objects'::regclass)
  THEN
    RAISE EXCEPTION 'V5 : le bucket documents doit être privé et les RLS Storage activées.';
  END IF;
END;
$prerequisites$;

LOCK TABLE public.documents, public.profiles IN ACCESS EXCLUSIVE MODE;

CREATE SCHEMA IF NOT EXISTS amphix_private;
REVOKE ALL ON SCHEMA amphix_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS amphix_private.legacy_document_links (
  document_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  folder_id UUID,
  category_id UUID,
  original_row JSONB NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp()
);
-- Pas de FK/cascade : la trace historique ne doit pas suivre la suppression
-- future d'un compte ou d'une ligne. Aucun accès navigateur à cette archive.

DROP TRIGGER IF EXISTS amphix_v4_document_write ON public.documents;

DO $archive_classification$
DECLARE
  has_folder BOOLEAN;
  has_category BOOLEAN;
  before_count BIGINT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.documents'::regclass AND attname = 'folder_id' AND NOT attisdropped)
    INTO has_folder;
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.documents'::regclass AND attname = 'category_id' AND NOT attisdropped)
    INTO has_category;
  IF has_folder IS DISTINCT FROM has_category THEN
    RAISE EXCEPTION 'V5 : classement partiellement migré. Transaction annulée, vérifier le schéma.';
  END IF;
  IF has_folder THEN
    IF to_regclass('public.folders') IS NULL OR to_regclass('public.categories') IS NULL
      OR to_regclass('amphix_private.legacy_folders') IS NOT NULL
      OR to_regclass('amphix_private.legacy_categories') IS NOT NULL
    THEN
      RAISE EXCEPTION 'V5 : archive homonyme ou tables historiques absentes. Aucun remplacement automatique.';
    END IF;
    SELECT count(*) INTO before_count FROM public.documents;
    INSERT INTO amphix_private.legacy_document_links
      (document_id, user_id, folder_id, category_id, original_row)
    SELECT id, user_id, folder_id, category_id, to_jsonb(document)
    FROM public.documents AS document
    ON CONFLICT (document_id) DO NOTHING;
    IF EXISTS (
      SELECT 1 FROM public.documents AS document
      LEFT JOIN amphix_private.legacy_document_links AS archive ON archive.document_id = document.id
      WHERE archive.document_id IS NULL OR archive.original_row IS DISTINCT FROM to_jsonb(document)
    ) THEN
      RAISE EXCEPTION 'V5 : copie du classement non confirmée. Aucun retrait effectué.';
    END IF;

    DROP TRIGGER IF EXISTS amphix_v4_folder_write ON public.folders;
    DROP TRIGGER IF EXISTS amphix_v4_folder_delete ON public.folders;
    -- SET SCHEMA conserve les lignes, index et contraintes des classements.
    ALTER TABLE public.folders SET SCHEMA amphix_private;
    ALTER TABLE amphix_private.folders RENAME TO legacy_folders;
    ALTER TABLE public.categories SET SCHEMA amphix_private;
    ALTER TABLE amphix_private.categories RENAME TO legacy_categories;
    -- Retirer les FK avec les colonnes, jamais DROP CASCADE ni DELETE d'un dossier.
    ALTER TABLE public.documents DROP COLUMN folder_id, DROP COLUMN category_id;

    IF (SELECT count(*) FROM public.documents) <> before_count OR EXISTS (
      SELECT 1 FROM public.documents AS document
      JOIN amphix_private.legacy_document_links AS archive ON archive.document_id = document.id
      WHERE to_jsonb(document) IS DISTINCT FROM (archive.original_row - 'folder_id' - 'category_id')
    ) THEN
      RAISE EXCEPTION 'V5 : conservation des fichiers non confirmée. Toute la transaction est annulée.';
    END IF;
  ELSIF to_regclass('amphix_private.legacy_folders') IS NULL
    OR to_regclass('amphix_private.legacy_categories') IS NULL THEN
    RAISE EXCEPTION 'V5 : archive historique absente après retrait du classement.';
  END IF;
END;
$archive_classification$;

DROP FUNCTION IF EXISTS public.amphix_guard_folder_write();
DROP FUNCTION IF EXISTS public.amphix_guard_folder_delete();
DROP FUNCTION IF EXISTS public.amphix_assert_folder_delete_allowed(UUID);

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS school_name TEXT,
  ADD COLUMN IF NOT EXISTS subject_name TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID;
-- Historique : NULL signifie « non renseigné », aucune école n'est inventée.
ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS amphix_v5_document_classification,
  DROP CONSTRAINT IF EXISTS amphix_v5_document_trash;
ALTER TABLE public.documents
  ADD CONSTRAINT amphix_v5_document_classification CHECK (
    (school_name IS NULL AND subject_name IS NULL)
    OR (school_name IS NOT NULL AND subject_name IS NOT NULL
      AND school_name = btrim(school_name) AND subject_name = btrim(subject_name)
      AND char_length(school_name) BETWEEN 1 AND 120
      AND char_length(subject_name) BETWEEN 1 AND 120)
  ),
  ADD CONSTRAINT amphix_v5_document_trash CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL) OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
  );
CREATE INDEX IF NOT EXISTS documents_deleted_at_idx ON public.documents (deleted_at);
CREATE INDEX IF NOT EXISTS documents_status_active_idx ON public.documents (status, created_at DESC) WHERE deleted_at IS NULL;

-- Protection concurrente du dernier admin : l'UPDATE du singleton sérialise
-- les démotions/suppressions, sa condition est réévaluée après attente du verrou.
-- Un COUNT suivi d'un UPDATE, même sous advisory lock, ne suffirait pas.
CREATE TABLE IF NOT EXISTS amphix_private.admin_guard (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  admin_count BIGINT NOT NULL CHECK (admin_count >= 0)
);
INSERT INTO amphix_private.admin_guard (singleton, admin_count)
SELECT true, count(*) FROM public.profiles WHERE role = 'admin'
ON CONFLICT (singleton) DO UPDATE SET admin_count = EXCLUDED.admin_count;
-- Zéro admin historique est accepté ; promouvoir le premier par une opération
-- privilégiée manuelle. Une fois présent, le dernier ne peut plus être retiré.
CREATE OR REPLACE FUNCTION public.amphix_guard_last_admin()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  delta INTEGER := 0;
  remaining BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'admin' THEN delta := 1; END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.role = 'admin' THEN delta := -1; END IF;
  ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
    delta := CASE WHEN NEW.role = 'admin' THEN 1 ELSE -1 END;
  END IF;
  IF delta <> 0 THEN
    UPDATE amphix_private.admin_guard
      SET admin_count = admin_count + delta
      WHERE singleton AND (delta > 0 OR admin_count > 1)
      RETURNING admin_count INTO remaining;
    IF remaining IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Le dernier compte administrateur ne peut pas être rétrogradé ou supprimé. Promouvez d’abord un autre compte.';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.amphix_guard_last_admin() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS amphix_v5_last_admin ON public.profiles;
CREATE TRIGGER amphix_v5_last_admin
  AFTER INSERT OR UPDATE OF role OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.amphix_guard_last_admin();

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin');
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- Les RPC privilégiées ci-dessous vérifient explicitement propriétaire/session.
-- Le trigger INVOKER protège aussi les colonnes si des grants inconnus subsistent.
CREATE OR REPLACE FUNCTION public.amphix_guard_document_write()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  administrator BOOLEAN;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN RETURN NEW; END IF;
  IF actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Une session authentifiée est nécessaire.';
  END IF;
  administrator := public.is_admin();
  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM actor OR NEW.status IS DISTINCT FROM 'pending'
      OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.rejection_reason IS NOT NULL
      OR NEW.deleted_at IS NOT NULL OR NEW.deleted_by IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Un dépôt doit appartenir à la session, être en attente et sans données de modération ou de corbeille.';
    END IF;
    IF NEW.school_name IS NULL OR NEW.subject_name IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Renseignez une école et une matière pour ce dépôt.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'documents' AND name = NEW.file_path) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Le fichier doit être transféré avant son enregistrement.';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.file_path IS DISTINCT FROM OLD.file_path OR NEW.file_name IS DISTINCT FROM OLD.file_name
      OR NEW.file_type IS DISTINCT FROM OLD.file_type OR NEW.file_size IS DISTINCT FROM OLD.file_size
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.school_name IS DISTINCT FROM OLD.school_name OR NEW.subject_name IS DISTINCT FROM OLD.subject_name
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Identité et classement immuables ; utilisez la corbeille dédiée pour retirer ou restaurer un fichier.';
    END IF;
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Restaurez ce fichier avant de le modifier ou de le modérer.';
    END IF;
    IF NOT administrator AND (
      NEW.status IS DISTINCT FROM OLD.status OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
      OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'La modération est réservée à l’administration.';
    END IF;
    IF administrator AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason) THEN
      NEW.reviewed_by := actor;
      NEW.reviewed_at := transaction_timestamp();
    END IF;
  END IF;
  IF NOT length(btrim(NEW.title)) > 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Le titre est obligatoire.';
  END IF;
  IF NEW.status <> 'rejected' THEN NEW.rejection_reason := NULL; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.amphix_guard_document_write() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER amphix_v4_document_write
  BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.amphix_guard_document_write();

CREATE OR REPLACE FUNCTION public.set_document_trash(p_document_id UUID, p_deleted BOOLEAN)
RETURNS TABLE (id UUID, deleted_at TIMESTAMPTZ, deleted_by UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  target public.documents%ROWTYPE;
BEGIN
  IF actor IS NULL OR p_deleted IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Une session et une action de corbeille explicite sont nécessaires.';
  END IF;
  SELECT document.* INTO target FROM public.documents AS document WHERE document.id = p_document_id FOR UPDATE;
  IF NOT FOUND OR (target.user_id <> actor AND NOT public.is_admin()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Ce fichier est absent ou cette action n’est pas autorisée.';
  END IF;
  IF p_deleted AND target.deleted_at IS NULL THEN
    UPDATE public.documents AS document SET deleted_at = transaction_timestamp(), deleted_by = actor
      WHERE document.id = p_document_id RETURNING document.* INTO target;
  ELSIF NOT p_deleted AND target.deleted_at IS NOT NULL THEN
    UPDATE public.documents AS document SET deleted_at = NULL, deleted_by = NULL
      WHERE document.id = p_document_id RETURNING document.* INTO target;
  END IF;
  -- Idempotence : la seconde demande renvoie l'état confirmé sans nouvelle date.
  RETURN QUERY SELECT target.id, target.deleted_at, target.deleted_by;
END;
$$;
REVOKE ALL ON FUNCTION public.set_document_trash(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_document_trash(UUID, BOOLEAN) TO authenticated;

-- Pont de reprise V1 : jamais de création de dossier, aucun accès aux archives.
-- L'auteur peut vérifier une identité et son ancien classement exact. Une
-- identité déjà affectée à un autre classement ne devient pas une nouvelle ligne.
CREATE OR REPLACE FUNCTION public.get_legacy_upload_document(p_document_id UUID, p_folder_id UUID, p_category_id UUID)
RETURNS SETOF public.documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  target public.documents%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Session nécessaire pour vérifier une reprise.'; END IF;
  SELECT * INTO target FROM public.documents WHERE id = p_document_id AND user_id = actor;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM amphix_private.legacy_document_links AS archive
    WHERE archive.document_id = target.id AND archive.user_id = actor
      AND archive.folder_id IS NOT DISTINCT FROM p_folder_id
      AND archive.category_id IS NOT DISTINCT FROM p_category_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Le classement historique ne correspond pas à cette identité de dépôt.';
  END IF;
  RETURN NEXT target;
END;
$$;
REVOKE ALL ON FUNCTION public.get_legacy_upload_document(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_legacy_upload_document(UUID, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_legacy_upload(
  p_document_id UUID, p_title TEXT, p_description TEXT, p_file_name TEXT,
  p_file_path TEXT, p_file_type TEXT, p_file_size BIGINT,
  p_folder_id UUID, p_category_id UUID, p_school_name TEXT, p_subject_name TEXT
)
RETURNS SETOF public.documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  target public.documents%ROWTYPE;
  inserted BOOLEAN;
BEGIN
  IF actor IS NULL OR p_document_id IS NULL OR length(btrim(p_title)) IS NULL OR length(btrim(p_title)) = 0
    OR p_file_name IS NULL OR length(p_file_name) = 0
    OR p_file_type IS NULL OR p_file_type NOT IN ('pdf', 'image', 'doc', 'autre')
    OR p_file_size IS NULL OR p_file_size < 0 OR p_file_size > 20971520
    OR char_length(coalesce(p_description, '')) > 200
    OR p_school_name IS NULL OR p_subject_name IS NULL
    OR char_length(btrim(p_school_name)) NOT BETWEEN 1 AND 120
    OR char_length(btrim(p_subject_name)) NOT BETWEEN 1 AND 120
    OR p_file_path IS NULL OR p_file_path NOT LIKE (actor::text || '/' || p_document_id::text || '-%') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Les métadonnées de reprise sont invalides. Aucun fichier n’a été remplacé.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'documents' AND name = p_file_path) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Le fichier doit être transféré avant la reprise SQL.';
  END IF;
  INSERT INTO public.documents (id, user_id, title, description, file_name, file_path,
    file_type, file_size, school_name, subject_name, status)
  VALUES (p_document_id, actor, btrim(p_title), nullif(btrim(p_description), ''), p_file_name, p_file_path,
    p_file_type, p_file_size, btrim(p_school_name), btrim(p_subject_name), 'pending')
  ON CONFLICT (id) DO NOTHING;
  inserted := FOUND;
  SELECT * INTO target FROM public.documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND OR target.user_id <> actor OR target.file_path IS DISTINCT FROM p_file_path
    OR target.file_name IS DISTINCT FROM p_file_name OR target.file_type IS DISTINCT FROM p_file_type
    OR target.file_size IS DISTINCT FROM p_file_size OR target.title IS DISTINCT FROM btrim(p_title)
    OR target.description IS DISTINCT FROM nullif(btrim(p_description), '')
    OR (target.school_name IS NOT NULL AND (target.school_name IS DISTINCT FROM btrim(p_school_name)
      OR target.subject_name IS DISTINCT FROM btrim(p_subject_name))) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'L’identité de reprise est incompatible. Aucun écrasement effectué.';
  END IF;
  IF inserted THEN
    INSERT INTO amphix_private.legacy_document_links (document_id, user_id, folder_id, category_id, original_row)
    VALUES (target.id, actor, p_folder_id, p_category_id,
      to_jsonb(target) || jsonb_build_object('folder_id', p_folder_id, 'category_id', p_category_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM amphix_private.legacy_document_links AS archive
    WHERE archive.document_id = target.id AND archive.user_id = actor
      AND archive.folder_id IS NOT DISTINCT FROM p_folder_id
      AND archive.category_id IS NOT DISTINCT FROM p_category_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Le classement historique est incompatible avec la reprise.';
  END IF;
  RETURN NEXT target;
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_legacy_upload(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_legacy_upload(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, UUID, UUID, TEXT, TEXT) TO authenticated;

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.documents, public.profiles FROM PUBLIC, anon, authenticated;
DO $column_privileges$
DECLARE
  table_name TEXT;
  columns TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['documents', 'profiles'] LOOP
    SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum) INTO columns
      FROM pg_catalog.pg_attribute WHERE attrelid = format('public.%I', table_name)::regclass AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON public.%2$I FROM PUBLIC, anon, authenticated', columns, table_name);
  END LOOP;
END;
$column_privileges$;
GRANT SELECT ON public.documents, public.profiles TO authenticated;
GRANT INSERT (id, user_id, title, description, file_name, file_path, file_type, file_size, school_name, subject_name, status)
  ON public.documents TO authenticated;
GRANT UPDATE (title, description, status, rejection_reason) ON public.documents TO authenticated;
GRANT UPDATE (role) ON public.profiles TO authenticated;
-- Aucun GRANT DELETE ni droit direct d'écriture des colonnes deleted_*.

-- Retirer les policies V4 connues, dont ses gardes devenues contradictoires.
DO $remove_v4_policies$
DECLARE
  table_name TEXT;
  operation TEXT;
  suffix TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['documents', 'profiles'] LOOP
    FOREACH operation IN ARRAY ARRAY['select', 'insert', 'update', 'delete'] LOOP
      FOREACH suffix IN ARRAY ARRAY['allow', 'guard'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'amphix_v4_' || table_name || '_' || operation || '_' || suffix, table_name);
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH operation IN ARRAY ARRAY['select', 'insert', 'update', 'delete'] LOOP
    FOREACH suffix IN ARRAY ARRAY['allow', 'guard'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', 'amphix_v4_storage_' || operation || '_' || suffix);
    END LOOP;
  END LOOP;
END;
$remove_v4_policies$;
DROP POLICY IF EXISTS amphix_v4_storage_client_role ON storage.objects;

DO $application_policies$
DECLARE
  rule RECORD;
  restrictive BOOLEAN;
  command TEXT;
  policy_name TEXT;
BEGIN
  FOR rule IN SELECT * FROM (VALUES
    ('profiles', 'select', '(SELECT auth.uid()) IS NOT NULL AND (id = (SELECT auth.uid()) OR (SELECT public.is_admin()))', NULL::TEXT),
    ('profiles', 'update', '(SELECT auth.uid()) IS NOT NULL AND (SELECT public.is_admin())', '(SELECT auth.uid()) IS NOT NULL AND (SELECT public.is_admin())'),
    ('profiles', 'insert', NULL::TEXT, 'false'),
    ('profiles', 'delete', 'false', NULL::TEXT),
    ('documents', 'select', '(SELECT auth.uid()) IS NOT NULL AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()) OR (status = ''approved'' AND deleted_at IS NULL))', NULL::TEXT),
    ('documents', 'insert', NULL::TEXT, '(SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()) AND status = ''pending'' AND rejection_reason IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL AND deleted_at IS NULL AND deleted_by IS NULL AND school_name IS NOT NULL AND subject_name IS NOT NULL'),
    ('documents', 'update', '(SELECT auth.uid()) IS NOT NULL AND deleted_at IS NULL AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))', '(SELECT auth.uid()) IS NOT NULL AND deleted_at IS NULL AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))'),
    ('documents', 'delete', 'false', NULL::TEXT)
  ) AS rules(table_name, operation, using_expression, check_expression) LOOP
    FOREACH restrictive IN ARRAY ARRAY[false, true] LOOP
      policy_name := 'amphix_v5_' || rule.table_name || '_' || rule.operation || CASE WHEN restrictive THEN '_guard' ELSE '_allow' END;
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, rule.table_name);
      command := format('CREATE POLICY %I ON public.%I AS %s FOR %s TO authenticated', policy_name, rule.table_name,
        CASE WHEN restrictive THEN 'RESTRICTIVE' ELSE 'PERMISSIVE' END, upper(rule.operation));
      IF rule.using_expression IS NOT NULL THEN command := command || format(' USING (%s)', rule.using_expression); END IF;
      IF rule.check_expression IS NOT NULL THEN command := command || format(' WITH CHECK (%s)', rule.check_expression); END IF;
      EXECUTE command;
    END LOOP;
  END LOOP;
END;
$application_policies$;

-- Garde sans requête métier pour anon : ne pas casser les autres buckets.
DROP POLICY IF EXISTS amphix_v5_storage_client_role ON storage.objects;
CREATE POLICY amphix_v5_storage_client_role ON storage.objects
  AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (bucket_id <> 'documents' OR (current_user = 'authenticated' AND (SELECT auth.uid()) IS NOT NULL))
  WITH CHECK (bucket_id <> 'documents' OR (current_user = 'authenticated' AND (SELECT auth.uid()) IS NOT NULL));
DO $storage_policies$
DECLARE
  rule RECORD;
  restrictive BOOLEAN;
  command TEXT;
  expression TEXT;
  policy_name TEXT;
BEGIN
  FOR rule IN SELECT * FROM (VALUES
    ('select', $read$
      (SELECT auth.uid()) IS NOT NULL AND (
        (storage.foldername(name))[1] = (SELECT auth.uid())::text OR (SELECT public.is_admin())
        OR EXISTS (SELECT 1 FROM public.documents AS document
          WHERE document.file_path = storage.objects.name AND document.status = 'approved' AND document.deleted_at IS NULL
            AND (storage.foldername(storage.objects.name))[1] = document.user_id::text)
      )
    $read$, NULL::TEXT),
    ('insert', NULL::TEXT, $upload$
      (SELECT auth.uid()) IS NOT NULL AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
      AND NOT EXISTS (SELECT 1 FROM public.documents AS document WHERE document.file_path = storage.objects.name)
    $upload$),
    ('update', 'false', 'false'),
    ('delete', 'false', NULL::TEXT)
  ) AS rules(operation, using_expression, check_expression) LOOP
    FOREACH restrictive IN ARRAY ARRAY[false, true] LOOP
      policy_name := 'amphix_v5_storage_' || rule.operation || CASE WHEN restrictive THEN '_guard' ELSE '_allow' END;
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', policy_name);
      command := format('CREATE POLICY %I ON storage.objects AS %s FOR %s TO authenticated', policy_name,
        CASE WHEN restrictive THEN 'RESTRICTIVE' ELSE 'PERMISSIVE' END, upper(rule.operation));
      IF rule.using_expression IS NOT NULL THEN
        expression := CASE WHEN restrictive THEN 'bucket_id <> ''documents'' OR (' ELSE 'bucket_id = ''documents'' AND (' END || rule.using_expression || ')';
        command := command || format(' USING (%s)', expression);
      END IF;
      IF rule.check_expression IS NOT NULL THEN
        expression := CASE WHEN restrictive THEN 'bucket_id <> ''documents'' OR (' ELSE 'bucket_id = ''documents'' AND (' END || rule.check_expression || ')';
        command := command || format(' WITH CHECK (%s)', expression);
      END IF;
      EXECUTE command;
    END LOOP;
  END LOOP;
END;
$storage_policies$;
UPDATE storage.buckets SET public = false, file_size_limit = 20971520 WHERE id = 'documents';

-- Retirer aussi les anciens grants de colonnes des tables déplacées.
REVOKE ALL ON ALL TABLES IN SCHEMA amphix_private FROM PUBLIC, anon, authenticated;
DO $archive_column_privileges$
DECLARE
  target RECORD;
  columns TEXT;
BEGIN
  FOR target IN SELECT oid, relname FROM pg_catalog.pg_class WHERE relnamespace = 'amphix_private'::regnamespace AND relkind = 'r' LOOP
    SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum) INTO columns
      FROM pg_catalog.pg_attribute WHERE attrelid = target.oid AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON amphix_private.%2$I FROM PUBLIC, anon, authenticated', columns, target.relname);
  END LOOP;
END;
$archive_column_privileges$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Réserves / recette :
-- * Vérifier la syntaxe et les RLS sur une base Supabase de test : les tests
--   Node statiques ne constituent PAS une exécution PostgreSQL.
-- * Contrôler les grants hérités, policies inconnues et fonctions privilégiées.
-- * Tester deux démotions concurrentes avec deux sessions distinctes.
-- * Interdire TRUNCATE profiles et la désactivation du trigger aux rôles client.
-- * Les liens signés émis avant une mise en corbeille restent valides jusqu'à
--   leur expiration (60 secondes dans le client actuel).
-- * La corbeille conserve l'espace Storage ; aucune purge n'est implémentée.
-- * Les RPC legacy sont transitoires, à retirer après vidage des traces V1,
--   pas avant. Elles n'approuvent jamais un dépôt et ne créent aucun classement.
