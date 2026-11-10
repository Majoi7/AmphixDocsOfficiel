-- ==========================================================
-- AmphixDocs — V9 : miniatures JPEG et lecture active uniquement
-- Exécution MANUELLE, d'abord sur une base Supabase de test sauvegardée.
-- Prérequis : V5 puis V6 intégralement appliquées et vérifiées.
-- V7/V8 (Léo) ne sont ni remplacées, ni nécessaires à ce delta.
-- Rejeu : V9 seulement ; ne pas rejouer V6 après l'ajout de JPEG.
-- Aucun chemin historique, objet Storage ou document n'est réécrit/purgé.
-- Seuls le MIME du bucket, la contrainte de chemin, la RPC d'association
-- et les quatre policies V6 SELECT/INSERT changent. Les autres règles restent.
-- ==========================================================

BEGIN;
SET LOCAL search_path = pg_catalog;

DO $required_objects$
BEGIN
  IF to_regclass('public.documents') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('storage.objects') IS NULL
    OR to_regclass('storage.buckets') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL
    OR to_regprocedure('public.is_admin()') IS NULL
    OR to_regprocedure('public.amphix_guard_document_write()') IS NULL
    OR to_regprocedure('public.set_document_trash(uuid,boolean)') IS NULL
    OR to_regprocedure('public.set_document_preview(uuid,text,integer)') IS NULL
    OR to_regprocedure('public.list_library_documents(text,boolean,boolean,integer,boolean)') IS NULL
    OR to_regprocedure('public.get_missing_document_previews(uuid)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION 'V9 : schéma incomplet. Appliquer et vérifier V5 puis V6 ; aucune installation partielle ni réparation implicite.';
  END IF;
END;
$required_objects$;

-- Même ordre que la RPC : document puis objet. Les contrôles et le DDL sont
-- atomiques ; aucune fenêtre entre retrait et rétablissement d'une contrainte.
LOCK TABLE public.documents, storage.objects IN ACCESS EXCLUSIVE MODE;

DO $prerequisites$
DECLARE
  authenticated_role OID := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated');
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES ('thumbnail_path', 'text'::regtype), ('page_count', 'integer'::regtype)) AS expected(name, type_oid)
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.documents'::regclass AND attname = expected.name
        AND attnum > 0 AND NOT attisdropped AND atttypid = expected.type_oid
        AND NOT attnotnull AND NOT atthasdef AND attgenerated = '' AND attidentity = '')
  ) THEN
    RAISE EXCEPTION 'V9 : colonnes V6 absentes ou incompatibles. TEXT/INTEGER nullable sans valeur par défaut sont requis.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES ('amphix_v5_document_classification'), ('amphix_v5_document_trash'),
      ('amphix_v6_documents_page_count'), ('amphix_v6_documents_preview_kind'),
      ('amphix_v6_documents_thumbnail_path')) AS expected(name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.documents'::regclass AND conname = expected.name
        AND contype = 'c' AND convalidated)
  ) THEN
    RAISE EXCEPTION 'V9 : contraintes V5/V6 absentes ou non validées. Aucune donnée ne sera corrigée silencieusement.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.documents'::regclass AND tgname = 'amphix_v4_document_write'
      AND tgfoid = 'public.amphix_guard_document_write()'::regprocedure
      AND tgtype = 23 AND tgenabled IN ('O', 'A') AND NOT tgisinternal
      AND tgqual IS NULL AND tgnargs = 0 AND tgattr = ''::int2vector) THEN
    RAISE EXCEPTION 'V9 : trigger de protection V6 absent, filtré ou inactif. Ne pas contourner les écritures réservées à la RPC.';
  END IF;
  -- Empreintes du CORPS SQL livré (CRLF/LF acceptés), pas des miniatures.
  -- Refuser une fonction homonyme/personnalisée plutôt que l'écraser ou faire
  -- confiance à un simple nom de trigger. Le garde V6 n'est jamais remplacé.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid = 'public.amphix_guard_document_write()'::regprocedure
      AND NOT prosecdef AND prorettype = 'trigger'::regtype AND NOT proretset
      AND prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
      AND proconfig = ARRAY['search_path=pg_catalog']::text[]
      AND md5(replace(prosrc, chr(13), '')) = '7f23a90fb77a8bd44eb055a4c71b68f5') THEN
    RAISE EXCEPTION 'V9 : garde INVOKER différent de V6. Comparer la personnalisation avant de continuer, sans la remplacer.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid = 'public.set_document_preview(uuid,text,integer)'::regprocedure
      AND prokind = 'f' AND prosecdef AND proretset AND prorettype = 'public.documents'::regtype
      AND provolatile = 'v' AND NOT proleakproof AND NOT proisstrict
      AND prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
      AND pronargdefaults = 0 AND proargmodes IS NULL
      AND proargnames = ARRAY['p_document_id', 'p_thumbnail_path', 'p_page_count']::text[]
      AND proconfig = ARRAY['search_path=pg_catalog']::text[]
      AND proowner NOT IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated'))
      AND md5(replace(prosrc, chr(13), '')) IN (
        'a5fe6d55ff8a8e4ef3dff8d3dd24015d', -- V6
        '5894cffc96e39f725d5f5dbd67a0aa37' -- V9, autorise le rejeu exact
      ))
    OR has_function_privilege('anon', 'public.set_document_preview(uuid,text,integer)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.set_document_preview(uuid,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V9 : signature, corps, propriétaire ou droits de set_document_preview incompatibles avec V6/V9. Inventorier les différences avant de continuer.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.documents'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.profiles'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'storage.objects'::regclass)
    OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'documents' AND public = false) THEN
    RAISE EXCEPTION 'V9 : RLS ou confidentialité V5/V6 absentes. Aucun autre bucket ne sera reconfiguré.';
  END IF;
  -- Les gardes V5 continuent de s'appliquer ; ne jamais les supprimer pour
  -- faire fonctionner le nouveau bucket ni retirer une policy inconnue.
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('public.documents', 'amphix_v5_documents_'),
                 ('storage.objects', 'amphix_v5_storage_')) AS targets(relation_name, prefix)
    CROSS JOIN (VALUES ('select', 'r'), ('insert', 'a'), ('update', 'w'), ('delete', 'd')) AS operations(name, command)
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = to_regclass(targets.relation_name)
        AND policy.polname = targets.prefix || operations.name || '_guard'
        AND NOT policy.polpermissive AND policy.polcmd::text = operations.command
        AND authenticated_role = ANY(policy.polroles))
  ) OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid = 'storage.objects'::regclass AND polname = 'amphix_v5_storage_client_role'
      AND NOT polpermissive AND polcmd = '*' AND 0::oid = ANY(polroles)) THEN
    RAISE EXCEPTION 'V9 : policies restrictives V5 manquantes. V9 ne les répare ni ne les remplace.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('select', 'r'), ('insert', 'a'), ('update', 'w'), ('delete', 'd')) AS operations(name, command)
    CROSS JOIN (VALUES ('_allow', true), ('_guard', false)) AS kinds(suffix, permissive)
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = 'storage.objects'::regclass
        AND policy.polname = 'amphix_v6_thumbnail_storage_' || operations.name || kinds.suffix
        AND policy.polcmd::text = operations.command AND policy.polpermissive = kinds.permissive
        AND policy.polroles = ARRAY[authenticated_role]::oid[]
        AND (policy.polqual IS NOT NULL) = (operations.name <> 'insert')
        AND (policy.polwithcheck IS NOT NULL) = (operations.name IN ('insert', 'update')))
  ) OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid = 'storage.objects'::regclass AND polname = 'amphix_v6_thumbnail_client_role'
      AND NOT polpermissive AND polcmd = '*' AND polroles = ARRAY[0::oid]
      AND polqual IS NOT NULL AND polwithcheck IS NOT NULL) THEN
    RAISE EXCEPTION 'V9 : policies V6 absentes ou de forme incompatible. SELECT/INSERT seulement peuvent être adaptées.';
  END IF;
  -- Vérifier les interdictions effectives connues, pas seulement leur nom.
  -- Retirer espaces/parenthèses suffit pour ces expressions V6 fixes. Cette
  -- garde PUBLIC simple ne consulte aucune table métier et n'est pas remplacée.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'storage.objects'::regclass AND policy.polname = 'amphix_v6_thumbnail_client_role'
      AND (regexp_replace(pg_get_expr(policy.polqual, policy.polrelid), '[[:space:]()]', '', 'g')
        IS DISTINCT FROM 'bucket_id<>''document-thumbnails''::textORCURRENT_USER=''authenticated''::nameANDSELECTauth.uidASuidISNOTNULL'
        OR regexp_replace(pg_get_expr(policy.polwithcheck, policy.polrelid), '[[:space:]()]', '', 'g')
          IS DISTINCT FROM 'bucket_id<>''document-thumbnails''::textORCURRENT_USER=''authenticated''::nameANDSELECTauth.uidASuidISNOTNULL')) THEN
    RAISE EXCEPTION 'V9 : garde de rôle Storage V6 personnalisée. Comparer la policy avant de continuer, sans la remplacer.';
  END IF;
  -- Les gardes UPDATE/DELETE simples n'ont que deux termes ; elles ne sont
  -- PAS réécrites par V9, même si un droit permissif inconnu existe ailleurs.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'storage.objects'::regclass
      AND policy.polname IN ('amphix_v6_thumbnail_storage_update_guard', 'amphix_v6_thumbnail_storage_delete_guard')
      AND (regexp_replace(pg_get_expr(policy.polqual, policy.polrelid), '[[:space:]()]', '', 'g')
        IS DISTINCT FROM 'bucket_id<>''document-thumbnails''::textORfalse'
        OR (policy.polname = 'amphix_v6_thumbnail_storage_update_guard'
          AND regexp_replace(pg_get_expr(policy.polwithcheck, policy.polrelid), '[[:space:]()]', '', 'g')
            IS DISTINCT FROM 'bucket_id<>''document-thumbnails''::textORfalse'))) THEN
    RAISE EXCEPTION 'V9 : interdictions UPDATE/DELETE V6 modifiées. Aucun upsert, remplacement ou nettoyage client ne doit être autorisé.';
  END IF;
END;
$prerequisites$;

DO $preview_bucket$
DECLARE
  configured storage.buckets%ROWTYPE;
BEGIN
  SELECT bucket.* INTO configured FROM storage.buckets AS bucket
    WHERE bucket.id = 'document-thumbnails' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V9 : bucket document-thumbnails V6 absent. Aucun bucket homonyme ne sera créé.';
  END IF;
  IF configured.name IS DISTINCT FROM 'document-thumbnails'
    OR configured.public IS DISTINCT FROM false
    OR configured.file_size_limit IS DISTINCT FROM 1048576::bigint
    OR (configured.allowed_mime_types IS DISTINCT FROM ARRAY['image/webp']::text[]
      AND configured.allowed_mime_types IS DISTINCT FROM ARRAY['image/webp', 'image/jpeg']::text[]
      AND configured.allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg', 'image/webp']::text[])
    OR EXISTS (SELECT 1 FROM storage.buckets
      WHERE name = 'document-thumbnails' AND id <> 'document-thumbnails') THEN
    RAISE EXCEPTION 'V9 : bucket incompatible. Attendu : privé, 1048576 octets, WebP seul (V6) ou WebP et JPEG exclusivement (V9). Aucun paramètre inattendu ne sera écrasé.';
  END IF;
  -- Seul ajout autorisé : JPEG. Ne pas toucher au nom, au mode privé, à la
  -- taille, aux autres buckets, aux objets ou à une liste MIME plus restrictive.
  UPDATE storage.buckets SET allowed_mime_types = ARRAY['image/webp', 'image/jpeg']::text[]
    WHERE id = 'document-thumbnails' AND allowed_mime_types = ARRAY['image/webp']::text[];
END;
$preview_bucket$;

-- La présence et la validation de la contrainte V6 ont été exigées plus haut.
-- Le rejeu valide encore toutes les lignes ; aucune conversion WebP vers JPEG.
-- Les contraintes de pages, de type de document et toutes celles de V5 restent.
ALTER TABLE public.documents DROP CONSTRAINT amphix_v6_documents_thumbnail_path;
ALTER TABLE public.documents ADD CONSTRAINT amphix_v6_documents_thumbnail_path CHECK (
  thumbnail_path IS NULL
  OR thumbnail_path ~ ('^' || user_id::text || '/' || id::text || '/[0-9a-f]{64}[.](webp|jpg)$')
);

-- Même signature/OID/propriétaire et même frontière DEFINER que V6.
-- Seuls le suffixe de chemin et le MIME correspondant sont étendus.
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
    OR p_thumbnail_path !~ ('^' || target.user_id::text || '/' || target.id::text || '/[0-9a-f]{64}[.](webp|jpg)$') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Chemin invalide : attendu auteur/document/empreinte-SHA256-minuscule.webp ou .jpg, sans autre segment.';
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
  IF preview_metadata IS NULL OR preview_metadata ->> 'mimetype' IS DISTINCT FROM (
      CASE WHEN right(p_thumbnail_path, 4) = '.jpg' THEN 'image/jpeg' ELSE 'image/webp' END
    )
    OR coalesce(preview_metadata ->> 'size', '') !~ '^[0-9]{1,7}$' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Les métadonnées Storage de la miniature sont absentes ou incompatibles avec le suffixe WebP/JPEG demandé.';
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

DO $thumbnail_storage_policies$
DECLARE
  rule RECORD;
  restrictive BOOLEAN;
  expression TEXT;
  policy_name TEXT;
BEGIN
  FOR rule IN SELECT * FROM (VALUES
    ('select', $read$
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.documents AS document
        WHERE document.deleted_at IS NULL
          AND storage.objects.name ~ ('^' || document.user_id::text || '/' || document.id::text || '/[0-9a-f]{64}[.](webp|jpg)$')
          AND (document.user_id = (SELECT auth.uid()) OR (SELECT public.is_admin())
            OR (document.thumbnail_path = storage.objects.name AND document.status = 'approved')))
    $read$),
    ('insert', $upload$
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.documents AS document
        WHERE document.deleted_at IS NULL AND document.file_type IN ('pdf', 'image')
          AND (document.user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
          AND storage.objects.name ~ ('^' || document.user_id::text || '/' || document.id::text || '/[0-9a-f]{64}[.](webp|jpg)$')
          AND (document.thumbnail_path IS NULL OR document.thumbnail_path = storage.objects.name))
    $upload$)
  ) AS rules(operation, predicate) LOOP
    FOREACH restrictive IN ARRAY ARRAY[false, true] LOOP
      policy_name := 'amphix_v6_thumbnail_storage_' || rule.operation || CASE WHEN restrictive THEN '_guard' ELSE '_allow' END;
      expression := CASE WHEN restrictive THEN 'bucket_id <> ''document-thumbnails'' OR (' ELSE 'bucket_id = ''document-thumbnails'' AND (' END || rule.predicate || ')';
      -- ALTER conserve nom, rôle et mode permissif/restrictif vérifiés plus haut.
      -- Ni suppression de policies, ni modification des gardes client/UPDATE/DELETE.
      IF rule.operation = 'select' THEN
        EXECUTE format('ALTER POLICY %I ON storage.objects USING (%s)', policy_name, expression);
      ELSE
        EXECUTE format('ALTER POLICY %I ON storage.objects WITH CHECK (%s)', policy_name, expression);
      END IF;
    END LOOP;
  END LOOP;
END;
$thumbnail_storage_policies$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Limites / recette séparée :
-- * Les tests Node sont TEXTUELS : ni exécution PostgreSQL, ni preuve RLS réelle.
-- * Tester V6 -> V9 puis le rejeu V9, les conflits de bucket/prérequis et
--   auteur/tiers/admin/anon, policies supplémentaires, grants hérités et concurrence.
-- * Une NOUVELLE lecture exige un document actif, même pour auteur/admin ; un
--   objet canonique non lié reste lisible par auteur/admin pour reprise seulement
--   tant que le document est actif. Aucun accès tiers sans lien approved actif.
-- * Les URL signées déjà émises restent valides jusqu'à leur expiration.
-- * MIME/taille du bucket : contrôlés par l'API Storage ; ne pas les imposer
--   à INSERT RLS avant disponibilité des metadata. La RPC vérifie ensuite l'objet.
-- * metadata ne prouve ni les octets JPEG/WebP, ni le SHA-256 ou le vrai nombre
--   de pages. Le producteur calcule l'empreinte SHA-256 des octets de miniature.
-- * Upload sans upsert, UPDATE ou DELETE. Un objet non lié est conservé pour
--   reprise ; ni purge ni remplacement automatique. Le garde V6 interdit toujours
--   INSERT/UPDATE navigateur des métadonnées d'aperçu, y compris pour un admin.
-- * Ne pas exposer de rôle BYPASSRLS/service_role ni d'accès SQL privilégié au client.
