-- ==========================================================
-- AmphixDocs — V6 / recette LOT 0 : aperçus et pagination
-- Exécution MANUELLE, d'abord sur une base Supabase de test sauvegardée.
-- Prérequis : V5 appliquée et vérifiée ; ne pas rejouer V1–V5.
-- Aucun objet Storage ni aucune ligne métier n'est supprimé ou remplacé.
-- Les libellés école/matière V5 restent inchangés : aucune entité nouvelle.
-- ==========================================================

BEGIN;

DO $prerequisites$
BEGIN
  IF to_regclass('public.documents') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('storage.objects') IS NULL
    OR to_regclass('storage.buckets') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL
    OR to_regprocedure('public.is_admin()') IS NULL
    OR to_regprocedure('public.amphix_guard_document_write()') IS NULL
    OR to_regprocedure('public.set_document_trash(uuid,boolean)') IS NULL
  THEN
    RAISE EXCEPTION 'V6 : schéma incomplet. Appliquer et vérifier V5 avant cette migration.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.documents'::regclass
        AND conname = 'amphix_v5_document_classification' AND convalidated)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.documents'::regclass
        AND conname = 'amphix_v5_document_trash' AND convalidated)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.documents'::regclass AND tgname = 'amphix_v4_document_write'
        AND tgfoid = 'public.amphix_guard_document_write()'::regprocedure
        AND tgtype = 23 AND tgenabled IN ('O', 'A') AND NOT tgisinternal)
  THEN
    RAISE EXCEPTION 'V6 : contraintes ou garde de documents V5 absents/inactifs. Aucune migration partielle.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.documents'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.profiles'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'storage.objects'::regclass)
    OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'documents' AND public = false)
  THEN
    RAISE EXCEPTION 'V6 : vérifier les RLS et la confidentialité du bucket documents avant de continuer.';
  END IF;
  -- Ne pas substituer V6 à une V5 incomplète. Ses règles restent en place.
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('public.documents', 'amphix_v5_documents_'),
                 ('storage.objects', 'amphix_v5_storage_')) AS targets(relation_name, prefix)
    CROSS JOIN (VALUES ('select', 'r'), ('insert', 'a'), ('update', 'w'), ('delete', 'd')) AS operations(name, command)
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = to_regclass(targets.relation_name)
        AND policy.polname = targets.prefix || operations.name || '_guard'
        AND NOT policy.polpermissive AND policy.polcmd::text = operations.command
        AND (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') = ANY(policy.polroles))
  ) OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid = 'storage.objects'::regclass AND polname = 'amphix_v5_storage_client_role'
      AND NOT polpermissive AND polcmd = '*' AND 0::oid = ANY(polroles)) THEN
    RAISE EXCEPTION 'V6 : les policies restrictives V5 doivent être présentes. Inventorier les droits avant de continuer.';
  END IF;
END;
$prerequisites$;

LOCK TABLE public.documents IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS thumbnail_path TEXT,
  ADD COLUMN IF NOT EXISTS page_count INTEGER;

DO $preview_columns$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.documents'::regclass AND NOT attisdropped
      AND ((attname = 'thumbnail_path' AND atttypid <> 'text'::regtype)
        OR (attname = 'page_count' AND atttypid <> 'integer'::regtype)
        OR (attname IN ('thumbnail_path', 'page_count')
          AND (attnotnull OR atthasdef OR attgenerated <> '' OR attidentity <> '')))) THEN
    RAISE EXCEPTION 'V6 : colonnes d’aperçu homonymes incompatibles. TEXT/INTEGER nullable, sans valeur par défaut, sont requis.';
  END IF;
END;
$preview_columns$;

-- Seules les contraintes de cette version sont remplacées lors d'un rejeu.
-- Une donnée incompatible annule la transaction, sans correction silencieuse.
ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS amphix_v6_documents_page_count,
  DROP CONSTRAINT IF EXISTS amphix_v6_documents_preview_kind,
  DROP CONSTRAINT IF EXISTS amphix_v6_documents_thumbnail_path;
ALTER TABLE public.documents
  ADD CONSTRAINT amphix_v6_documents_page_count
    CHECK (page_count IS NULL OR page_count > 0),
  ADD CONSTRAINT amphix_v6_documents_preview_kind CHECK (
    (thumbnail_path IS NULL AND page_count IS NULL)
    OR (file_type IS NOT NULL AND (file_type = 'pdf'
      OR (file_type = 'image' AND (page_count IS NULL OR page_count = 1))))
  ),
  ADD CONSTRAINT amphix_v6_documents_thumbnail_path CHECK (
    thumbnail_path IS NULL
    OR thumbnail_path ~ ('^' || user_id::text || '/' || id::text || '/[0-9a-f]{64}[.]webp$')
  );

DO $preview_bucket$
DECLARE
  configured storage.buckets%ROWTYPE;
BEGIN
  -- ON CONFLICT sans UPDATE : ne jamais reconfigurer un bucket homonyme.
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('document-thumbnails', 'document-thumbnails', false, 1048576, ARRAY['image/webp']::text[])
  ON CONFLICT DO NOTHING;
  SELECT bucket.* INTO configured FROM storage.buckets AS bucket
    WHERE bucket.id = 'document-thumbnails' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V6 : nom de bucket document-thumbnails déjà occupé par une autre identité. Vérification manuelle nécessaire.';
  END IF;
  IF configured.name IS DISTINCT FROM 'document-thumbnails'
    OR configured.public IS DISTINCT FROM false
    OR configured.file_size_limit IS DISTINCT FROM 1048576::bigint
    OR configured.allowed_mime_types IS DISTINCT FROM ARRAY['image/webp']::text[]
    OR EXISTS (SELECT 1 FROM storage.buckets
      WHERE name = 'document-thumbnails' AND id <> 'document-thumbnails') THEN
    RAISE EXCEPTION 'V6 : bucket document-thumbnails incompatible. Attendu : privé, WebP uniquement, limite 1048576 octets. Aucun objet ni paramètre remplacé.';
  END IF;
END;
$preview_bucket$;

-- Même garde INVOKER que V5, augmenté de deux interdictions d'écriture.
-- Un GRANT de table ou hérité inconnu ne permet pas de contourner ce trigger.
-- Les RPC DEFINER gardent le modèle V5 : elles vérifient elles-mêmes les droits.
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
    IF NEW.thumbnail_path IS NOT NULL OR NEW.page_count IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Enregistrez le document sans aperçu, puis utilisez set_document_preview après le transfert de la miniature.';
    END IF;
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
    IF NEW.thumbnail_path IS DISTINCT FROM OLD.thumbnail_path OR NEW.page_count IS DISTINCT FROM OLD.page_count THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Les métadonnées d’aperçu sont réservées à set_document_preview, y compris pour l’administration.';
    END IF;
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
-- Le trigger amphix_v4_document_write vérifié ci-dessus garde la même fonction/OID.
REVOKE INSERT (thumbnail_path, page_count), UPDATE (thumbnail_path, page_count)
  ON public.documents FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_document_preview(
  p_document_id UUID, p_thumbnail_path TEXT, p_page_count INTEGER
)
RETURNS SETOF public.documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  target public.documents%ROWTYPE;
  preview_metadata JSONB;
  confirmed_page_count INTEGER;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Une session authentifiée est nécessaire pour enregistrer un aperçu.';
  END IF;
  -- Sérialise les demandes concurrentes, la modération et la mise en corbeille.
  SELECT document.* INTO target FROM public.documents AS document
    WHERE document.id = p_document_id FOR UPDATE;
  IF NOT FOUND OR target.deleted_at IS NOT NULL
    OR (target.user_id IS DISTINCT FROM actor AND NOT public.is_admin()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Ce document est absent, dans la corbeille ou vous ne pouvez pas enregistrer son aperçu.';
  END IF;
  IF target.file_type IS NULL OR target.file_type NOT IN ('pdf', 'image') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Les aperçus sont réservés aux PDF et aux images.';
  END IF;
  IF (target.file_type = 'pdf' AND (p_page_count IS NULL OR p_page_count <= 0))
    OR (target.file_type = 'image' AND p_page_count IS NOT NULL AND p_page_count <> 1) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Un PDF nécessite un nombre de pages strictement positif ; une image accepte NULL ou 1.';
  END IF;
  IF p_thumbnail_path IS NULL
    OR p_thumbnail_path !~ ('^' || target.user_id::text || '/' || target.id::text || '/[0-9a-f]{64}[.]webp$') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Chemin invalide : attendu auteur/document/empreinte-SHA256-minuscule.webp, sans autre segment.';
  END IF;
  IF target.thumbnail_path IS NOT NULL AND target.thumbnail_path IS DISTINCT FROM p_thumbnail_path THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Une miniature est déjà liée à ce document. Son chemin est immuable ; aucun remplacement effectué.';
  END IF;
  IF target.page_count IS NOT NULL AND p_page_count IS NOT NULL AND target.page_count IS DISTINCT FROM p_page_count THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Le nombre de pages déjà confirmé est différent. Aucun écrasement effectué.';
  END IF;

  -- Vérifier le bucket ET le nom. Le verrou protège cette association jusqu'au commit.
  SELECT object.metadata INTO preview_metadata FROM storage.objects AS object
    WHERE object.bucket_id = 'document-thumbnails' AND object.name = p_thumbnail_path FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La miniature doit être transférée dans document-thumbnails avant son association. Réessayez la vérification du transfert.';
  END IF;
  -- Ces métadonnées sont écrites par Storage, pas par les paramètres de la RPC.
  -- Vérifier la forme avant tout cast : pas d'erreur de cast ni de dépassement.
  IF preview_metadata IS NULL OR preview_metadata ->> 'mimetype' IS DISTINCT FROM 'image/webp'
    OR coalesce(preview_metadata ->> 'size', '') !~ '^[0-9]{1,7}$' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Les métadonnées Storage de la miniature sont absentes ou incompatibles avec un WebP.';
  END IF;
  IF (preview_metadata ->> 'size')::integer NOT BETWEEN 1 AND 1048576 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La miniature doit être non vide et ne pas dépasser 1 Mo (1048576 octets).';
  END IF;

  -- Un admin téléverse sous le préfixe de l'AUTEUR, pas sous son propre UUID.
  -- owner_id Storage peut donc être celui de cet admin. Les policies INSERT
  -- vérifient l'uploader ; le chemin canonique vérifie l'appartenance au document.
  confirmed_page_count := coalesce(target.page_count, p_page_count);
  IF target.thumbnail_path IS DISTINCT FROM p_thumbnail_path
    OR target.page_count IS DISTINCT FROM confirmed_page_count THEN
    UPDATE public.documents AS document
      SET thumbnail_path = p_thumbnail_path, page_count = confirmed_page_count
      WHERE document.id = target.id RETURNING document.* INTO target;
  END IF;
  -- Même appel = même ligne, sans UPDATE inutile ; le compte PDF manquant peut
  -- être complété avec le chemin déjà lié. NULL ne retire jamais un compte connu.
  RETURN NEXT target;
END;
$$;
REVOKE ALL ON FUNCTION public.set_document_preview(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_document_preview(UUID, TEXT, INTEGER) TO authenticated;

-- Garde TO PUBLIC sans requête métier : les autres buckets, y compris leurs
-- accès anon, ne sont ni autorisés ni bloqués par V6.
DROP POLICY IF EXISTS amphix_v6_thumbnail_client_role ON storage.objects;
CREATE POLICY amphix_v6_thumbnail_client_role ON storage.objects
  AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (bucket_id <> 'document-thumbnails' OR (current_user = 'authenticated' AND (SELECT auth.uid()) IS NOT NULL))
  WITH CHECK (bucket_id <> 'document-thumbnails' OR (current_user = 'authenticated' AND (SELECT auth.uid()) IS NOT NULL));

DO $thumbnail_storage_policies$
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
          WHERE document.thumbnail_path = storage.objects.name
            AND document.status = 'approved' AND document.deleted_at IS NULL
            AND storage.objects.name ~ ('^' || document.user_id::text || '/' || document.id::text || '/[0-9a-f]{64}[.]webp$'))
      )
    $read$, NULL::TEXT),
    ('insert', NULL::TEXT, $upload$
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.documents AS document
        WHERE document.deleted_at IS NULL AND document.file_type IN ('pdf', 'image')
          AND (document.user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
          AND storage.objects.name ~ ('^' || document.user_id::text || '/' || document.id::text || '/[0-9a-f]{64}[.]webp$')
          AND (document.thumbnail_path IS NULL OR document.thumbnail_path = storage.objects.name))
    $upload$),
    ('update', 'false', 'false'),
    ('delete', 'false', NULL::TEXT)
  ) AS rules(operation, using_expression, check_expression) LOOP
    FOREACH restrictive IN ARRAY ARRAY[false, true] LOOP
      policy_name := 'amphix_v6_thumbnail_storage_' || rule.operation || CASE WHEN restrictive THEN '_guard' ELSE '_allow' END;
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', policy_name);
      command := format('CREATE POLICY %I ON storage.objects AS %s FOR %s TO authenticated', policy_name,
        CASE WHEN restrictive THEN 'RESTRICTIVE' ELSE 'PERMISSIVE' END, upper(rule.operation));
      IF rule.using_expression IS NOT NULL THEN
        expression := CASE WHEN restrictive THEN 'bucket_id <> ''document-thumbnails'' OR (' ELSE 'bucket_id = ''document-thumbnails'' AND (' END || rule.using_expression || ')';
        command := command || format(' USING (%s)', expression);
      END IF;
      IF rule.check_expression IS NOT NULL THEN
        expression := CASE WHEN restrictive THEN 'bucket_id <> ''document-thumbnails'' OR (' ELSE 'bucket_id = ''document-thumbnails'' AND (' END || rule.check_expression || ')';
        command := command || format(' WITH CHECK (%s)', expression);
      END IF;
      EXECUTE command;
    END LOOP;
  END LOOP;
END;
$thumbnail_storage_policies$;
-- Les restrictions MIME/taille du bucket sont appliquées par l'API Storage.
-- Ne pas exiger metadata dans la policy INSERT : la préautorisation Storage
-- peut l'évaluer avant que les métadonnées du transfert soient disponibles.
-- La RPC exige ensuite les métadonnées effectives. Ni UPDATE/UPSERT, ni DELETE.

CREATE OR REPLACE FUNCTION public.list_library_documents(
  p_query TEXT DEFAULT '', p_trash BOOLEAN DEFAULT false, p_pending BOOLEAN DEFAULT false,
  p_offset INTEGER DEFAULT 0, p_ascending BOOLEAN DEFAULT false
)
RETURNS SETOF public.documents
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog SET row_security = on
AS $$
DECLARE
  search_term TEXT := lower(coalesce(p_query, ''));
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Une session authentifiée est nécessaire pour consulter la bibliothèque.';
  END IF;
  IF p_trash IS NULL OR p_pending IS NULL OR p_ascending IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Les filtres de bibliothèque doivent être des booléens explicites.';
  END IF;
  IF p_pending AND NOT public.is_admin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'La liste à approuver est réservée à l’administration.';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_offset > 100000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Le décalage doit être un entier compris entre 0 et 100000. Relancez la recherche depuis le début.';
  END IF;
  RETURN QUERY
    SELECT document.* FROM public.documents AS document
    WHERE ((NOT p_trash AND document.deleted_at IS NULL) OR (p_trash AND document.deleted_at IS NOT NULL))
      AND (NOT p_pending OR document.status = 'pending')
      -- strpos traite %, _, antislash et virgules littéralement, sans SQL dynamique.
      -- Appliquer la recherche AVANT le tri et la pagination, jamais sur 20 lignes déjà lues.
      AND (search_term = ''
        OR strpos(lower(coalesce(document.title, '')), search_term) > 0
        OR strpos(lower(coalesce(document.description, '')), search_term) > 0
        OR strpos(lower(coalesce(document.file_name, '')), search_term) > 0
        OR strpos(lower(coalesce(document.school_name, '')), search_term) > 0
        OR strpos(lower(coalesce(document.subject_name, '')), search_term) > 0)
    ORDER BY
      CASE WHEN p_ascending THEN document.created_at END ASC NULLS LAST,
      CASE WHEN NOT p_ascending THEN document.created_at END DESC NULLS LAST,
      CASE WHEN p_ascending THEN document.id END ASC NULLS LAST,
      CASE WHEN NOT p_ascending THEN document.id END DESC NULLS LAST
    LIMIT 20 OFFSET p_offset;
END;
$$;
REVOKE ALL ON FUNCTION public.list_library_documents(TEXT, BOOLEAN, BOOLEAN, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_library_documents(TEXT, BOOLEAN, BOOLEAN, INTEGER, BOOLEAN) TO authenticated;
-- L'offset est borné mais n'est pas un snapshot : après une modération ou une
-- mise en corbeille, le client recharge les pages depuis zéro pour éviter un saut.

CREATE OR REPLACE FUNCTION public.get_missing_document_previews(p_after_id UUID DEFAULT NULL)
RETURNS SETOF public.documents
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog SET row_security = on
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Le rattrapage des aperçus est réservé à l’administration.';
  END IF;
  RETURN QUERY
    SELECT document.* FROM public.documents AS document
    WHERE document.deleted_at IS NULL AND document.file_type IN ('pdf', 'image')
      AND (document.thumbnail_path IS NULL OR (document.file_type = 'pdf' AND document.page_count IS NULL))
      AND (p_after_id IS NULL OR document.id > p_after_id)
    ORDER BY document.id ASC
    LIMIT 20;
END;
$$;
REVOKE ALL ON FUNCTION public.get_missing_document_previews(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_missing_document_previews(UUID) TO authenticated;
-- Le client traite chaque page séquentiellement et avance au DERNIER UUID LU,
-- même en cas d'échec d'une génération/association. Un nouveau parcours depuis
-- NULL peut réessayer les échecs ; une même passe ne boucle pas sur ces lignes.

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Limites / recette à effectuer séparément :
-- * Les tests Node sont TEXTUELS : ni exécution PostgreSQL, ni preuve RLS réelle.
-- * Vérifier V5 puis V6, un rejeu V6, les conflits de bucket, A/B/admin/anon,
--   grants hérités, policies inconnues et appels concurrents sur une base de test.
-- * L'existence de storage.objects et ses métadonnées ne prouve pas les octets,
--   le décodage WebP, la fidélité à l'original, le SHA-256 ou le vrai nombre de pages.
--   Le client calcule l'empreinte des octets de miniature et le compte PDF.
-- * Authentifié auteur/admin : lecture de ses objets même en corbeille ; tiers :
--   seulement le chemin lié à un document approved actif. Pas de lecture anonyme.
-- * Upload sans upsert. Un échec après Storage peut laisser un objet non lié :
--   le conserver pour reprise, jamais le supprimer/remplacer automatiquement.
-- * Les URL signées déjà émises restent valides jusqu'à leur expiration.
-- * Ne pas exposer de rôle BYPASSRLS/service_role ni d'accès SQL privilégié au client.
