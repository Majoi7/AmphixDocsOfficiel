-- ==========================================================
-- AmphixDocs - Migration V2 : Approbation, Dossiers & Admin
-- À exécuter dans le SQL Editor de Supabase
-- ==========================================================

-- 1. Table des profils utilisateurs
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ DEFAULT now(),
    last_sign_in_at TIMESTAMPTZ DEFAULT now()
);

-- Index pour requêtes rapides par rôle et email
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Activation de RLS sur profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. Fonction is_admin() en Security Definer pour éviter les boucles récursives RLS
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
$$;

-- Trigger pour créer automatiquement le profil lors d'une nouvelle inscription
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url, role, created_at, last_sign_in_at)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', ''),
        'user',
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
        last_sign_in_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Migrer les utilisateurs existants s'il y en a déjà dans auth.users
INSERT INTO public.profiles (id, email, full_name, avatar_url, role, created_at, last_sign_in_at)
SELECT 
    id,
    email,
    COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1)),
    COALESCE(raw_user_meta_data->>'avatar_url', raw_user_meta_data->>'picture', ''),
    'user',
    created_at,
    last_sign_in_at
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Policies RLS sur public.profiles
DROP POLICY IF EXISTS "Lecture des profils" ON public.profiles;
CREATE POLICY "Lecture des profils"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "Modification du rôle par admin uniquement" ON public.profiles;
CREATE POLICY "Modification du rôle par admin uniquement"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- 3. Table des catégories
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#ff6a2b'
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lecture publique des catégories" ON public.categories;
CREATE POLICY "Lecture publique des catégories"
    ON public.categories FOR SELECT
    TO authenticated
    USING (true);

-- Insertion des catégories par défaut
INSERT INTO public.categories (name, color) VALUES
    ('Contrats', '#ff6a2b'),
    ('Factures', '#ffd23f'),
    ('Cours', '#4a6cf0'),
    ('Photos', '#ffb6e1'),
    ('Autres', '#9ab8ff')
ON CONFLICT (name) DO NOTHING;

-- 4. Table des dossiers (folders)
CREATE TABLE IF NOT EXISTS public.folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
    name TEXT NOT NULL,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_folders_user_id ON public.folders(user_id);
CREATE INDEX IF NOT EXISTS idx_folders_status ON public.folders(status);

ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

-- Policies RLS sur public.folders
DROP POLICY IF EXISTS "Lecture des dossiers" ON public.folders;
CREATE POLICY "Lecture des dossiers"
    ON public.folders FOR SELECT
    TO authenticated
    USING (user_id = auth.uid() OR public.is_admin() OR status = 'approved');

DROP POLICY IF EXISTS "Création de dossiers" ON public.folders;
CREATE POLICY "Création de dossiers"
    ON public.folders FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid() AND status = 'pending');

DROP POLICY IF EXISTS "Modification de dossiers" ON public.folders;
CREATE POLICY "Modification de dossiers"
    ON public.folders FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Suppression de dossiers" ON public.folders;
CREATE POLICY "Suppression de dossiers"
    ON public.folders FOR DELETE
    TO authenticated
    USING (user_id = auth.uid() OR public.is_admin());

-- 5. Mise à jour de la table public.documents
ALTER TABLE public.documents 
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_documents_status ON public.documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_folder_id ON public.documents(folder_id);

-- Mise à jour des policies RLS sur public.documents
DROP POLICY IF EXISTS "Les utilisateurs peuvent lire leurs propres documents" ON public.documents;
DROP POLICY IF EXISTS "Lecture des documents (proprietaire, admin ou approuve)" ON public.documents;
CREATE POLICY "Lecture des documents (proprietaire, admin ou approuve)"
    ON public.documents
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid() OR public.is_admin() OR status = 'approved');

DROP POLICY IF EXISTS "Les utilisateurs peuvent insérer leurs propres documents" ON public.documents;
DROP POLICY IF EXISTS "Insertion de documents avec statut pending" ON public.documents;
CREATE POLICY "Insertion de documents avec statut pending"
    ON public.documents
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid() AND (status = 'pending' OR public.is_admin()));

DROP POLICY IF EXISTS "Les utilisateurs peuvent modifier leurs propres documents" ON public.documents;
DROP POLICY IF EXISTS "Mise a jour de documents" ON public.documents;
CREATE POLICY "Mise a jour de documents"
    ON public.documents
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Les utilisateurs peuvent supprimer leurs propres documents" ON public.documents;
DROP POLICY IF EXISTS "Suppression de documents" ON public.documents;
CREATE POLICY "Suppression de documents"
    ON public.documents
    FOR DELETE
    TO authenticated
    USING (user_id = auth.uid() OR public.is_admin());

-- 6. Storage Policies étendues pour Storage.objects
-- Lecture autorisée si propriétaire, ou admin, ou si document approuvé
DROP POLICY IF EXISTS "Lecture de documents personnels ou approuves" ON storage.objects;
CREATE POLICY "Lecture de documents personnels ou approuves"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'documents' AND (
            (storage.foldername(name))[1] = auth.uid()::text 
            OR public.is_admin()
            OR EXISTS (
                SELECT 1 FROM public.documents
                WHERE file_path = name AND status = 'approved'
            )
        )
    );

-- 7. COMMANDE POUR VOUS NOMMER ADMIN :
-- Remplacez l'email ci-dessous par votre email Google puis exécutez la ligne :
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'jehovalyyeger@gmail.com';
