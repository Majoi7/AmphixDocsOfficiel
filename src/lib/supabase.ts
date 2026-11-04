import { createClient } from '@supabase/supabase-js';

// Lecture des variables depuis import.meta.env ou localStorage
export const getStoredSupabaseConfig = () => {
  const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  
  const localUrl = typeof window !== 'undefined' ? localStorage.getItem('amphix_supabase_url') || '' : '';
  const localKey = typeof window !== 'undefined' ? localStorage.getItem('amphix_supabase_anon_key') || '' : '';

  const url = localUrl || envUrl;
  const key = localKey || envKey;

  const isConfigured = Boolean(
    url &&
    key &&
    url.startsWith('https://') &&
    !url.includes('your-project') &&
    key !== 'your-anon-key'
  );

  return { url, key, isConfigured };
};

export const isSupabaseConfigured = (): boolean => {
  return getStoredSupabaseConfig().isConfigured;
};

const initialConfig = getStoredSupabaseConfig();

// Client Supabase instancié
export let supabase = createClient(
  initialConfig.isConfigured ? initialConfig.url : 'https://dummy-amphix.supabase.co',
  initialConfig.isConfigured ? initialConfig.key : 'dummy-key'
);

export const reinitializeSupabase = (url: string, key: string) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('amphix_supabase_url', url);
    localStorage.setItem('amphix_supabase_anon_key', key);
  }
  supabase = createClient(url, key);
};

export type FileCategory = 'pdf' | 'image' | 'doc' | 'autre';
export type ItemStatus = 'pending' | 'approved' | 'rejected';
export type UserRole = 'user' | 'admin';

export interface CategoryItem {
  id: string;
  name: string;
  color: string;
}

export interface FolderItem {
  id: string;
  user_id: string;
  name: string;
  category_id?: string | null;
  status: ItemStatus;
  rejection_reason?: string | null;
  created_at: string;
  document_count?: number;
  author_name?: string;
  author_avatar?: string;
  author_email?: string;
}

export interface DocumentItem {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  file_name: string;
  file_path: string;
  file_type: FileCategory;
  file_size: number;
  created_at: string;
  file_blob_url?: string;
  folder_id?: string | null;
  category_id?: string | null;
  status: ItemStatus;
  rejection_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  author_name?: string;
  author_avatar?: string;
  author_email?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string;
  role: UserRole;
  created_at: string;
  last_sign_in_at: string;
  document_count?: number;
}

export function detectFileCategory(fileName: string, mimeType?: string): FileCategory {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mime = (mimeType || '').toLowerCase();

  if (ext === 'pdf' || mime.includes('pdf')) {
    return 'pdf';
  }
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext) || mime.startsWith('image/')) {
    return 'image';
  }
  if (['doc', 'docx', 'odt', 'txt', 'rtf', 'md', 'pages', 'csv', 'xls', 'xlsx'].includes(ext) || 
      mime.includes('word') || mime.includes('document') || mime.includes('text/')) {
    return 'doc';
  }
  return 'autre';
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 Ko';
  const k = 1024;
  const sizes = ['Octets', 'Ko', 'Mo', 'Go'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatDateFrench(dateString: string): string {
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateString;
  }
}

// Couleurs pastille selon spécification stricte :
// pdf = orange (#ff6a2b), image = rose (#ffb6e1), doc = bleu clair (#9ab8ff), autre = jaune (#ffd23f)
export const FILE_BADGES: Record<FileCategory, { label: string; bg: string; text: string; dot: string; border: string }> = {
  pdf: {
    label: 'PDF',
    bg: 'bg-[#ff6a2b]/15',
    text: 'text-[#ff6a2b]',
    dot: 'bg-[#ff6a2b]',
    border: 'border-[#ff6a2b]/30'
  },
  image: {
    label: 'Image',
    bg: 'bg-[#ffb6e1]/30',
    text: 'text-[#a11b61]',
    dot: 'bg-[#ffb6e1]',
    border: 'border-[#ffb6e1]/60'
  },
  doc: {
    label: 'Document',
    bg: 'bg-[#9ab8ff]/25',
    text: 'text-[#2a4cb8]',
    dot: 'bg-[#9ab8ff]',
    border: 'border-[#9ab8ff]/50'
  },
  autre: {
    label: 'Fichier',
    bg: 'bg-[#ffd23f]/25',
    text: 'text-[#8a6800]',
    dot: 'bg-[#ffd23f]',
    border: 'border-[#ffd23f]/50'
  }
};

// Statuts d'approbation
export const STATUS_CONFIG: Record<ItemStatus, { label: string; bg: string; text: string; border: string }> = {
  pending: {
    label: 'En attente',
    bg: 'bg-[#ffd23f]/20',
    text: 'text-[#946200]',
    border: 'border-[#ffd23f]/60'
  },
  approved: {
    label: 'Approuvé',
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-700',
    border: 'border-emerald-500/30'
  },
  rejected: {
    label: 'Refusé',
    bg: 'bg-[#ffb6e1]/30',
    text: 'text-[#b0245e]',
    border: 'border-[#ffb6e1]/70'
  }
};

export const DEFAULT_CATEGORIES: CategoryItem[] = [
  { id: 'cat-contrats', name: 'Contrats', color: '#ff6a2b' },
  { id: 'cat-factures', name: 'Factures', color: '#ffd23f' },
  { id: 'cat-cours', name: 'Cours', color: '#4a6cf0' },
  { id: 'cat-photos', name: 'Photos', color: '#ffb6e1' },
  { id: 'cat-autres', name: 'Autres', color: '#9ab8ff' },
];

// Données démo enrichies pour mode local ou transition
const DEMO_STORAGE_KEY_DOCS = 'amphixdocs_v2_docs';
const DEMO_STORAGE_KEY_FOLDERS = 'amphixdocs_v2_folders';
const DEMO_STORAGE_KEY_USERS = 'amphixdocs_v2_users';

const INITIAL_DEMO_FOLDERS: FolderItem[] = [
  {
    id: 'folder-1',
    user_id: 'demo-user-12345',
    name: 'Projet Studio 2026',
    category_id: 'cat-contrats',
    status: 'approved',
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    document_count: 2,
    author_name: 'Marie Curie',
    author_avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    author_email: 'marie.curie@amphix.site',
  },
  {
    id: 'folder-2',
    user_id: 'demo-user-12345',
    name: 'Comptabilité Q3',
    category_id: 'cat-factures',
    status: 'pending',
    created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    document_count: 1,
    author_name: 'Marie Curie',
    author_avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    author_email: 'marie.curie@amphix.site',
  },
  {
    id: 'folder-3',
    user_id: 'user-thomas',
    name: 'Design System & Assets',
    category_id: 'cat-photos',
    status: 'approved',
    created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    document_count: 3,
    author_name: 'Thomas Pesquet',
    author_avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    author_email: 'thomas.pesquet@amphix.site',
  }
];

const INITIAL_DEMO_DOCUMENTS: DocumentItem[] = [
  {
    id: 'demo-1',
    user_id: 'demo-user-12345',
    title: 'Charte Graphique Studio Amphix',
    description: 'Directives de marque, palette de couleurs créative et règles typographiques DM Sans.',
    file_name: 'charte-graphique-amphix.pdf',
    file_path: 'demo-user/charte-graphique.pdf',
    file_type: 'pdf',
    file_size: 4200000,
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    category_id: 'cat-contrats',
    folder_id: 'folder-1',
    status: 'approved',
    author_name: 'Marie Curie',
    author_avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    author_email: 'marie.curie@amphix.site',
  },
  {
    id: 'demo-2',
    user_id: 'demo-user-12345',
    title: 'Planche Moodboard Novembre',
    description: 'Sélection visuelle d\'inspirations éditoriales, stickers découpés et papiers texturés.',
    file_name: 'moodboard-novembre.png',
    file_path: 'demo-user/moodboard.png',
    file_type: 'image',
    file_size: 2850000,
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
    category_id: 'cat-photos',
    folder_id: 'folder-1',
    status: 'approved',
    author_name: 'Marie Curie',
    author_avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    author_email: 'marie.curie@amphix.site',
  },
  {
    id: 'demo-3',
    user_id: 'demo-user-12345',
    title: 'Facture Hébergement & Cloud #4892',
    description: 'Dépense serveur et stockage pour validation comptable.',
    file_name: 'facture-4892.pdf',
    file_path: 'demo-user/facture-4892.pdf',
    file_type: 'pdf',
    file_size: 320000,
    created_at: new Date().toISOString(),
    category_id: 'cat-factures',
    folder_id: 'folder-2',
    status: 'pending',
    author_name: 'Marie Curie',
    author_avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    author_email: 'marie.curie@amphix.site',
  },
  {
    id: 'demo-4',
    user_id: 'user-thomas',
    title: 'Guide d\'intégration React Motion',
    description: 'Architecture des hooks d\'animation et springs réactifs pour les composants.',
    file_name: 'guide-motion-react.docx',
    file_path: 'user-thomas/guide-motion-react.docx',
    file_type: 'doc',
    file_size: 980000,
    created_at: new Date(Date.now() - 6 * 86400000).toISOString(),
    category_id: 'cat-cours',
    folder_id: null,
    status: 'approved',
    author_name: 'Thomas Pesquet',
    author_avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    author_email: 'thomas.pesquet@amphix.site',
  },
  {
    id: 'demo-5',
    user_id: 'user-clara',
    title: 'Spécifications API Non Validées',
    description: 'Document provisoire contenant des données erronées.',
    file_name: 'draft-spec.txt',
    file_path: 'user-clara/draft-spec.txt',
    file_type: 'autre',
    file_size: 45000,
    created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    category_id: 'cat-autres',
    folder_id: null,
    status: 'rejected',
    rejection_reason: 'Informations incomplètes et schéma obsolète. Merci de mettre à jour.',
    author_name: 'Clara Schumann',
    author_avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    author_email: 'clara.schumann@amphix.site',
  }
];

const INITIAL_DEMO_USERS: UserProfile[] = [
  {
    id: 'demo-user-12345',
    email: 'marie.curie@amphix.site',
    full_name: 'Marie Curie',
    avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    role: 'admin',
    created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    last_sign_in_at: new Date().toISOString(),
    document_count: 3,
  },
  {
    id: 'user-thomas',
    email: 'thomas.pesquet@amphix.site',
    full_name: 'Thomas Pesquet',
    avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    role: 'user',
    created_at: new Date(Date.now() - 15 * 86400000).toISOString(),
    last_sign_in_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    document_count: 1,
  },
  {
    id: 'user-clara',
    email: 'clara.schumann@amphix.site',
    full_name: 'Clara Schumann',
    avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    role: 'user',
    created_at: new Date(Date.now() - 40 * 86400000).toISOString(),
    last_sign_in_at: new Date(Date.now() - 8 * 86400000).toISOString(),
    document_count: 1,
  }
];

// Helper mock storage
function getLocalDocs(): DocumentItem[] {
  const raw = localStorage.getItem(DEMO_STORAGE_KEY_DOCS);
  if (!raw) {
    localStorage.setItem(DEMO_STORAGE_KEY_DOCS, JSON.stringify(INITIAL_DEMO_DOCUMENTS));
    return INITIAL_DEMO_DOCUMENTS;
  }
  try { return JSON.parse(raw); } catch { return INITIAL_DEMO_DOCUMENTS; }
}

function setLocalDocs(docs: DocumentItem[]) {
  localStorage.setItem(DEMO_STORAGE_KEY_DOCS, JSON.stringify(docs));
}

function getLocalFolders(): FolderItem[] {
  const raw = localStorage.getItem(DEMO_STORAGE_KEY_FOLDERS);
  if (!raw) {
    localStorage.setItem(DEMO_STORAGE_KEY_FOLDERS, JSON.stringify(INITIAL_DEMO_FOLDERS));
    return INITIAL_DEMO_FOLDERS;
  }
  try { return JSON.parse(raw); } catch { return INITIAL_DEMO_FOLDERS; }
}

function setLocalFolders(folders: FolderItem[]) {
  localStorage.setItem(DEMO_STORAGE_KEY_FOLDERS, JSON.stringify(folders));
}

function getLocalUsers(): UserProfile[] {
  const raw = localStorage.getItem(DEMO_STORAGE_KEY_USERS);
  if (!raw) {
    localStorage.setItem(DEMO_STORAGE_KEY_USERS, JSON.stringify(INITIAL_DEMO_USERS));
    return INITIAL_DEMO_USERS;
  }
  try { return JSON.parse(raw); } catch { return INITIAL_DEMO_USERS; }
}

function setLocalUsers(users: UserProfile[]) {
  localStorage.setItem(DEMO_STORAGE_KEY_USERS, JSON.stringify(users));
}

// -------------------------------------------------------------
// REQUÊTES VERS SUPABASE (AVEC GESTION TRANSPARENTE DU RETOUR)
// -------------------------------------------------------------

export async function fetchUserRole(userId: string): Promise<UserRole> {
  // Rôle forcé localement pour test si souhaité
  const localAdminOverride = localStorage.getItem('amphix_force_admin');
  if (localAdminOverride === 'true') return 'admin';

  if (!isSupabaseConfigured()) {
    const users = getLocalUsers();
    const u = users.find((usr) => usr.id === userId);
    return u?.role || 'admin'; // Par défaut admin en mode démo pour tout tester
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      return 'user';
    }
    return (data.role as UserRole) || 'user';
  } catch {
    return 'user';
  }
}

export async function fetchCategories(): Promise<CategoryItem[]> {
  if (!isSupabaseConfigured()) {
    return DEFAULT_CATEGORIES;
  }

  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('name');

    if (error || !data || data.length === 0) {
      return DEFAULT_CATEGORIES;
    }
    return data;
  } catch {
    return DEFAULT_CATEGORIES;
  }
}

export async function fetchDashboardData(userId: string, isAdmin: boolean): Promise<{
  documents: DocumentItem[];
  folders: FolderItem[];
  categories: CategoryItem[];
}> {
  const categories = await fetchCategories();

  if (!isSupabaseConfigured()) {
    const allDocs = getLocalDocs();
    const allFolders = getLocalFolders();

    // Règle d'approbation :
    // - L'auteur voit toujours ses éléments (pending, approved, rejected)
    // - Les admins voient tout
    // - Les autres voient uniquement ce qui est 'approved'
    const visibleDocs = allDocs.filter(
      (d) => isAdmin || d.user_id === userId || d.status === 'approved'
    );
    const visibleFolders = allFolders.filter(
      (f) => isAdmin || f.user_id === userId || f.status === 'approved'
    );

    // Mettre à jour le compteur de documents par dossier
    const foldersWithCounts = visibleFolders.map((folder) => {
      const count = visibleDocs.filter((d) => d.folder_id === folder.id).length;
      return { ...folder, document_count: count };
    });

    return {
      documents: visibleDocs,
      folders: foldersWithCounts,
      categories,
    };
  }

  try {
    // Relations explicites vers profiles, déclarées dans migration_v3.sql.
    // Les RLS de profiles restent applicables aux champs de l'auteur.
    const foldersQuery = supabase
      .from('folders')
      .select('*, profiles:profiles!folders_user_id_profiles_fkey(full_name, avatar_url, email)')
      .order('created_at', { ascending: false });

    const docsQuery = supabase
      .from('documents')
      .select('*, profiles:profiles!documents_user_id_profiles_fkey(full_name, avatar_url, email)')
      .order('created_at', { ascending: false });

    const [foldersRes, docsRes] = await Promise.all([foldersQuery, docsQuery]);

    const rawFolders = foldersRes.data || [];
    const rawDocs = docsRes.data || [];

    const documents: DocumentItem[] = rawDocs.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      title: row.title,
      description: row.description,
      file_name: row.file_name,
      file_path: row.file_path,
      file_type: (row.file_type as FileCategory) || 'autre',
      file_size: Number(row.file_size) || 0,
      created_at: row.created_at,
      folder_id: row.folder_id || null,
      category_id: row.category_id || null,
      status: (row.status as ItemStatus) || 'pending',
      rejection_reason: row.rejection_reason || null,
      author_name: row.profiles?.full_name || 'Utilisateur',
      author_avatar: row.profiles?.avatar_url || '',
      author_email: row.profiles?.email || '',
    }));

    const folders: FolderItem[] = rawFolders.map((row: any) => {
      const count = documents.filter((d) => d.folder_id === row.id).length;
      return {
        id: row.id,
        user_id: row.user_id,
        name: row.name,
        category_id: row.category_id || null,
        status: (row.status as ItemStatus) || 'pending',
        rejection_reason: row.rejection_reason || null,
        created_at: row.created_at,
        document_count: count,
        author_name: row.profiles?.full_name || 'Utilisateur',
        author_avatar: row.profiles?.avatar_url || '',
        author_email: row.profiles?.email || '',
      };
    });

    return { documents, folders, categories };
  } catch (err) {
    console.warn('Erreur fetchDashboardData (fallback démo):', err);
    return {
      documents: getLocalDocs(),
      folders: getLocalFolders(),
      categories,
    };
  }
}

export async function createFolderItem(
  name: string,
  categoryId: string | null,
  userId: string,
  userName?: string,
  userAvatar?: string
): Promise<FolderItem> {
  const newFolderId = crypto.randomUUID();

  if (!isSupabaseConfigured()) {
    const newFolder: FolderItem = {
      id: newFolderId,
      user_id: userId,
      name: name.trim(),
      category_id: categoryId || null,
      status: 'pending',
      created_at: new Date().toISOString(),
      document_count: 0,
      author_name: userName || 'Marie Curie',
      author_avatar: userAvatar || '',
      author_email: 'marie.curie@amphix.site',
    };
    const current = getLocalFolders();
    setLocalFolders([newFolder, ...current]);
    return newFolder;
  }

  const { data, error } = await supabase
    .from('folders')
    .insert([
      {
        id: newFolderId,
        user_id: userId,
        name: name.trim(),
        category_id: categoryId || null,
        status: 'pending',
      },
    ])
    .select('*, profiles:profiles!folders_user_id_profiles_fkey(full_name, avatar_url, email)')
    .single();

  if (error) {
    throw new Error(`Échec de création du dossier : ${error.message}`);
  }

  return {
    id: data.id,
    user_id: data.user_id,
    name: data.name,
    category_id: data.category_id,
    status: data.status,
    rejection_reason: data.rejection_reason,
    created_at: data.created_at,
    document_count: 0,
    author_name: data.profiles?.full_name || userName || 'Utilisateur',
    author_avatar: data.profiles?.avatar_url || userAvatar || '',
    author_email: data.profiles?.email || '',
  };
}

export async function uploadUserDocument(
  file: File,
  title: string,
  description: string,
  userId: string,
  folderId?: string | null,
  categoryId?: string | null,
  onProgress?: (percent: number) => void,
  authorInfo?: { name?: string; avatar?: string; email?: string }
): Promise<DocumentItem> {
  const category = detectFileCategory(file.name, file.type);
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const uniqueId = crypto.randomUUID();
  const storagePath = `${userId}/${uniqueId}-${safeName}`;

  if (!isSupabaseConfigured()) {
    await new Promise<void>((resolve) => {
      let prog = 15;
      onProgress?.(prog);
      const interval = setInterval(() => {
        prog += Math.min(30, 100 - prog);
        onProgress?.(prog);
        if (prog >= 100) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });

    const newDoc: DocumentItem = {
      id: uniqueId,
      user_id: userId,
      title: title.trim(),
      description: description.trim() || null,
      file_name: file.name,
      file_path: storagePath,
      file_type: category,
      file_size: file.size,
      created_at: new Date().toISOString(),
      file_blob_url: URL.createObjectURL(file),
      folder_id: folderId || null,
      category_id: categoryId || null,
      status: 'pending', // Par défaut en attente d'approbation
      author_name: authorInfo?.name || 'Marie Curie',
      author_avatar: authorInfo?.avatar || '',
      author_email: authorInfo?.email || 'marie.curie@amphix.site',
    };

    const current = getLocalDocs();
    setLocalDocs([newDoc, ...current]);
    return newDoc;
  }

  // Upload Supabase Storage
  let progress = 20;
  onProgress?.(progress);
  const progressTimer = setInterval(() => {
    if (progress < 85) {
      progress += 15;
      onProgress?.(progress);
    }
  }, 120);

  const { error: storageError } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
    });

  clearInterval(progressTimer);

  if (storageError) {
    throw new Error(`Échec de l'upload fichier : ${storageError.message}`);
  }

  onProgress?.(90);

  // Insertion dans public.documents
  const { data: dbData, error: dbError } = await supabase
    .from('documents')
    .insert([
      {
        id: uniqueId,
        user_id: userId,
        title: title.trim(),
        description: description.trim() || null,
        file_name: file.name,
        file_path: storagePath,
        file_type: category,
        file_size: file.size,
        folder_id: folderId || null,
        category_id: categoryId || null,
        status: 'pending',
      },
    ])
    .select('*, profiles:profiles!documents_user_id_profiles_fkey(full_name, avatar_url, email)')
    .single();

  if (dbError) {
    await supabase.storage.from('documents').remove([storagePath]);
    throw new Error(`Échec de l'enregistrement en base : ${dbError.message}`);
  }

  onProgress?.(100);

  return {
    id: dbData.id,
    user_id: dbData.user_id,
    title: dbData.title,
    description: dbData.description,
    file_name: dbData.file_name,
    file_path: dbData.file_path,
    file_type: (dbData.file_type as FileCategory) || 'autre',
    file_size: Number(dbData.file_size) || 0,
    created_at: dbData.created_at,
    folder_id: dbData.folder_id || null,
    category_id: dbData.category_id || null,
    status: (dbData.status as ItemStatus) || 'pending',
    rejection_reason: dbData.rejection_reason || null,
    author_name: dbData.profiles?.full_name || authorInfo?.name || 'Utilisateur',
    author_avatar: dbData.profiles?.avatar_url || authorInfo?.avatar || '',
    author_email: dbData.profiles?.email || authorInfo?.email || '',
  };
}

export async function getDocumentSignedUrl(filePath: string, blobUrlFallback?: string): Promise<string> {
  if (!isSupabaseConfigured()) {
    if (blobUrlFallback) return blobUrlFallback;
    const sampleBlob = new Blob([`Contenu du document AmphixDocs : ${filePath}`], { type: 'text/plain;charset=utf-8' });
    return URL.createObjectURL(sampleBlob);
  }

  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(filePath, 60);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Impossible de générer le lien de téléchargement.');
  }

  return data.signedUrl;
}

export async function updateDocumentMetadata(
  id: string,
  title: string,
  description: string,
  userId: string
): Promise<void> {
  if (!isSupabaseConfigured()) {
    const docs = getLocalDocs();
    const idx = docs.findIndex((d) => d.id === id);
    if (idx !== -1) {
      docs[idx].title = title.trim();
      docs[idx].description = description.trim() || null;
      setLocalDocs(docs);
    }
    return;
  }

  const { error } = await supabase
    .from('documents')
    .update({
      title: title.trim(),
      description: description.trim() || null,
    })
    .eq('id', id);

  if (error) throw new Error(error.message);
}

export async function deleteDocumentItem(id: string, filePath: string, userId: string): Promise<void> {
  if (!isSupabaseConfigured()) {
    const docs = getLocalDocs();
    setLocalDocs(docs.filter((d) => d.id !== id));
    return;
  }

  await supabase.storage.from('documents').remove([filePath]);
  const { error } = await supabase.from('documents').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteFolderItem(id: string): Promise<void> {
  if (!isSupabaseConfigured()) {
    const folders = getLocalFolders();
    setLocalFolders(folders.filter((f) => f.id !== id));
    // Dépile aussi les documents du dossier
    const docs = getLocalDocs();
    setLocalDocs(docs.filter((d) => d.folder_id !== id));
    return;
  }

  const { error } = await supabase.from('folders').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// -------------------------------------------------------------
// FONCTIONS ADMIN : APPROBATION & GESTION DES UTILISATEURS
// -------------------------------------------------------------

export async function setItemApprovalStatus(
  type: 'document' | 'folder',
  id: string,
  status: 'approved' | 'rejected',
  reason?: string,
  reviewerId?: string
): Promise<void> {
  if (!isSupabaseConfigured()) {
    if (type === 'document') {
      const docs = getLocalDocs();
      const idx = docs.findIndex((d) => d.id === id);
      if (idx !== -1) {
        docs[idx].status = status;
        docs[idx].rejection_reason = status === 'rejected' ? (reason || 'Non conforme') : null;
        docs[idx].reviewed_at = new Date().toISOString();
        setLocalDocs(docs);
      }
    } else {
      const folders = getLocalFolders();
      const idx = folders.findIndex((f) => f.id === id);
      if (idx !== -1) {
        folders[idx].status = status;
        folders[idx].rejection_reason = status === 'rejected' ? (reason || 'Non conforme') : null;
        setLocalFolders(folders);
      }
    }
    return;
  }

  const table = type === 'document' ? 'documents' : 'folders';
  // V4 calcule reviewer/date côté PostgreSQL ; le navigateur n'écrit que
  // les champs de modération autorisés, jamais l'identité de la personne reviewer.
  const updateData = {
    status,
    rejection_reason: status === 'rejected' ? (reason || null) : null,
  };

  const { data, error } = await supabase
    .from(table)
    .update(updateData)
    .eq('id', id)
    .select('id');

  if (error) throw new Error(`La modération a échoué : ${error.message}`);
  if (!data || data.length !== 1 || data[0].id !== id) {
    throw new Error('La modération n’a affecté aucun élément confirmé. Actualisez la liste et vérifiez vos droits.');
  }
}

export interface PendingApprovalTargets {
  documentIds: string[];
  folderIds: string[];
}

export async function approveAllPendingItems(
  targets: PendingApprovalTargets,
  reviewerId?: string
): Promise<void> {
  const documentIds = [...new Set(targets.documentIds)];
  const folderIds = [...new Set(targets.folderIds)];
  const total = documentIds.length + folderIds.length;
  if (total === 0) return;

  if (!isSupabaseConfigured()) {
    const docs = getLocalDocs();
    const folders = getLocalFolders();
    if (documentIds.some((id) => !docs.some((doc) => doc.id === id && doc.status === 'pending'))
      || folderIds.some((id) => !folders.some((folder) => folder.id === id && folder.status === 'pending'))) {
      throw new Error('Certains éléments ne sont plus en attente. Actualisez la liste avant de réessayer.');
    }
    const reviewedAt = new Date().toISOString();
    setLocalDocs(docs.map((doc) => documentIds.includes(doc.id)
      ? { ...doc, status: 'approved', rejection_reason: null, reviewed_by: reviewerId ?? null, reviewed_at: reviewedAt }
      : doc));
    setLocalFolders(folders.map((folder) => folderIds.includes(folder.id)
      ? { ...folder, status: 'approved', rejection_reason: null }
      : folder));
    return;
  }

  const operations = [
    { table: 'documents', label: 'Fichiers', ids: documentIds },
    { table: 'folders', label: 'Dossiers', ids: folderIds },
  ].filter(({ ids }) => ids.length > 0);
  // Les deux tables ne partagent pas une transaction côté navigateur.
  // Attendre tous les résultats permet de signaler fidèlement un échec partiel.
  const results = await Promise.allSettled(operations.map(({ table, ids }) =>
    supabase.from(table)
      .update({ status: 'approved', rejection_reason: null })
      .in('id', ids)
      .eq('status', 'pending')
      .select('id')
  ));

  let confirmedCount = 0;
  const failures: string[] = [];
  results.forEach((result, index) => {
    const operation = operations[index];
    if (result.status === 'rejected') {
      failures.push(`${operation.label} : réponse indisponible, résultat à vérifier.`);
      return;
    }
    const { data, error } = result.value;
    if (error) {
      failures.push(`${operation.label} : ${error.message}`);
      return;
    }
    const returnedIds = new Set<string>((data ?? []).map((row: { id: string }) => row.id));
    const confirmed = operation.ids.filter((id) => returnedIds.has(id)).length;
    confirmedCount += confirmed;
    if (confirmed !== operation.ids.length || returnedIds.size !== operation.ids.length) {
      failures.push(`${operation.label} : ${confirmed} sur ${operation.ids.length} cible(s) confirmée(s).`);
    }
  });
  if (failures.length > 0) {
    throw new Error(`Approbation incomplète : ${confirmedCount} sur ${total} élément(s) confirmé(s). ${failures.join(' ')} Actualisez la liste avant de réessayer.`);
  }
}

export async function fetchUsersList(): Promise<UserProfile[]> {
  if (!isSupabaseConfigured()) {
    const users = getLocalUsers();
    const docs = getLocalDocs();
    return users.map((u) => ({
      ...u,
      document_count: docs.filter((d) => d.user_id === u.id).length,
    }));
  }

  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !profiles) {
      return getLocalUsers();
    }

    const { data: docs } = await supabase.from('documents').select('user_id');
    const docCounts: Record<string, number> = {};
    (docs || []).forEach((d) => {
      docCounts[d.user_id] = (docCounts[d.user_id] || 0) + 1;
    });

    return profiles.map((p: any) => ({
      id: p.id,
      email: p.email || 'Sans email',
      full_name: p.full_name || 'Utilisateur',
      avatar_url: p.avatar_url || '',
      role: (p.role as UserRole) || 'user',
      created_at: p.created_at,
      last_sign_in_at: p.last_sign_in_at || p.created_at,
      document_count: docCounts[p.id] || 0,
    }));
  } catch {
    return getLocalUsers();
  }
}

export async function updateUserRole(userId: string, newRole: UserRole): Promise<void> {
  if (!isSupabaseConfigured()) {
    const users = getLocalUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx !== -1) {
      users[idx].role = newRole;
      setLocalUsers(users);
    }
    return;
  }

  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId);

  if (error) throw new Error(error.message);
}
