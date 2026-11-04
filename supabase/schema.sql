-- ==========================================================
-- AmphixDocs - Configuration Base de Données & Storage Supabase
-- Exécuter l'intégralité de ce script dans le SQL Editor de Supabase
-- ==========================================================

-- 1. Création de la table des documents
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
    title TEXT NOT NULL,
    description TEXT,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_type TEXT,
    file_size BIGINT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index pour optimiser les requêtes par utilisateur et date
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON public.documents(created_at DESC);

-- 2. Activation du Row Level Security (RLS) sur la table documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Politiques RLS pour public.documents
DROP POLICY IF EXISTS "Les utilisateurs peuvent lire leurs propres documents" ON public.documents;
CREATE POLICY "Les utilisateurs peuvent lire leurs propres documents"
    ON public.documents
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Les utilisateurs peuvent insérer leurs propres documents" ON public.documents;
CREATE POLICY "Les utilisateurs peuvent insérer leurs propres documents"
    ON public.documents
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Les utilisateurs peuvent modifier leurs propres documents" ON public.documents;
CREATE POLICY "Les utilisateurs peuvent modifier leurs propres documents"
    ON public.documents
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Les utilisateurs peuvent supprimer leurs propres documents" ON public.documents;
CREATE POLICY "Les utilisateurs peuvent supprimer leurs propres documents"
    ON public.documents
    FOR DELETE
    USING (auth.uid() = user_id);


-- 3. Configuration du Bucket Storage "documents"
-- Création du bucket privé s'il n'existe pas déjà
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'documents',
    'documents',
    false,
    20971520, -- 20 Mo limite
    NULL       -- Tous types acceptés
)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 20971520;

-- Politiques RLS sur storage.objects (Dossier isolé {auth.uid()}/...)
-- Lecture (fichiers dans {auth.uid()}/*)
DROP POLICY IF EXISTS "Lecture de documents personnels" ON storage.objects;
CREATE POLICY "Lecture de documents personnels"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'documents' 
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Insertion (fichiers dans {auth.uid()}/*)
DROP POLICY IF EXISTS "Upload de documents personnels" ON storage.objects;
CREATE POLICY "Upload de documents personnels"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'documents' 
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Mise à jour (fichiers dans {auth.uid()}/*)
DROP POLICY IF EXISTS "Modification de documents personnels" ON storage.objects;
CREATE POLICY "Modification de documents personnels"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'documents' 
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Suppression (fichiers dans {auth.uid()}/*)
DROP POLICY IF EXISTS "Suppression de documents personnels" ON storage.objects;
CREATE POLICY "Suppression de documents personnels"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'documents' 
        AND (storage.foldername(name))[1] = auth.uid()::text
    );
