import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import {
  DocumentItem,
  FolderItem,
  CategoryItem,
  fetchDashboardData,
  updateDocumentMetadata,
  deleteDocumentItem,
  deleteFolderItem,
} from '../lib/supabase';
import { SearchHero } from '../components/SearchHero';
import { CategoryChips } from '../components/CategoryChips';
import { FolderCard } from '../components/FolderCard';
import { FileCard } from '../components/FileCard';
import { FolderView } from '../components/FolderView';
import { UploadModal } from '../components/UploadModal';
import { EmptyState } from '../components/EmptyState';
import { MobileNav } from '../components/mobile/MobileNav';
import { MobileDashboardHero } from '../components/mobile/MobileDashboardHero';
import { Search, Plus, LogOut, Shield, X } from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const { user, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loadingDocs, setLoadingDocs] = useState<boolean>(true);

  // Recherche & filtres
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // Dossier ouvert
  const [openedFolderId, setOpenedFolderId] = useState<string | null>(null);

  // Upload
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState<string | null>(null);
  const [newlyAddedDocId, setNewlyAddedDocId] = useState<string | null>(null);

  // Menu avatar
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState<boolean>(false);
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  const avatarMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if ((location.state as any)?.openUpload) {
      setIsUploadOpen(true);
    }
  }, [location.state]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 250);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const loadData = async () => {
    if (!user) return;
    try {
      setLoadingDocs(true);
      const data = await fetchDashboardData(user.id, isAdmin);
      setDocuments(data.documents);
      setFolders(data.folders);
      setCategories(data.categories);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user, isAdmin]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(e.target as Node)) {
        setIsAvatarMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    setIsAvatarMenuOpen(false);
    setIsLoggingOut(true);
    setTimeout(async () => {
      await signOut();
      navigate('/');
    }, 450);
  };

  const handleDocumentUploaded = (newDoc: DocumentItem, newFolder?: FolderItem) => {
    setNewlyAddedDocId(newDoc.id);
    if (newFolder) {
      setFolders((prev) => [newFolder, ...prev]);
    }
    setDocuments((prev) => [newDoc, ...prev]);
    setTimeout(() => {
      setNewlyAddedDocId(null);
    }, 1500);
  };

  const handleUpdateDocument = async (id: string, title: string, description: string) => {
    if (!user) return;
    await updateDocumentMetadata(id, title, description, user.id);
    setDocuments((prev) =>
      prev.map((d) => (d.id === id ? { ...d, title, description: description || null } : d))
    );
  };

  const handleDeleteDocument = async (id: string, filePath: string) => {
    if (!user) return;
    await deleteDocumentItem(id, filePath, user.id);
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  };

  const handleDeleteFolder = async (id: string) => {
    await deleteFolderItem(id);
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setDocuments((prev) => prev.filter((d) => d.folder_id !== id));
    if (openedFolderId === id) setOpenedFolderId(null);
  };

  // Filtrage
  const isSearching = Boolean(debouncedQuery.length > 0 || selectedCategoryId !== null);
  const normalizedQuery = debouncedQuery.toLowerCase();

  const filteredFolders = folders.filter((folder) => {
    if (selectedCategoryId && folder.category_id !== selectedCategoryId) return false;
    if (!normalizedQuery) return true;
    return folder.name.toLowerCase().includes(normalizedQuery);
  });

  const filteredDocuments = documents.filter((doc) => {
    if (selectedCategoryId && doc.category_id !== selectedCategoryId) return false;
    if (!normalizedQuery) return true;
    return (
      doc.title.toLowerCase().includes(normalizedQuery) ||
      (doc.description && doc.description.toLowerCase().includes(normalizedQuery)) ||
      doc.file_name.toLowerCase().includes(normalizedQuery)
    );
  });

  const rootDocuments = filteredDocuments.filter((d) => !d.folder_id);

  const categoryCounts: Record<string, number> = {};
  categories.forEach((cat) => {
    const docsCount = documents.filter((d) => d.category_id === cat.id).length;
    const foldersCount = folders.filter((f) => f.category_id === cat.id).length;
    categoryCounts[cat.id] = docsCount + foldersCount;
  });

  const totalItemCount = documents.length + folders.length;
  const openedFolder = folders.find((f) => f.id === openedFolderId);

  const avatarUrl =
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture ||
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80';
  const displayName =
    user?.user_metadata?.full_name || user?.user_metadata?.name || 'Utilisateur';
  const userEmail = user?.email || 'utilisateur@amphix.site';

  const openUpload = (folderId: string | null) => {
    setUploadTargetFolderId(folderId);
    setIsUploadOpen(true);
  };

  return (
    <motion.div
      animate={{ opacity: isLoggingOut ? 0 : 1 }}
      transition={{ duration: 0.3 }}
      style={{ fontFamily: "'DM Sans', 'Manrope', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}
      className="min-h-screen flex flex-col bg-[#f1ece4] text-[#141414] selection:bg-[#ff6a2b] selection:text-[#f1ece4]"
    >
      {/* Header */}
      <header className="w-full sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-[#141414]/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Link
            to="/dashboard"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategoryId(null);
              setOpenedFolderId(null);
            }}
            className="shrink-0 text-xl font-extrabold tracking-[-0.02em] select-none rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ff6a2b]"
          >
            <span className="text-[#141414]">Amphix</span>
            <span className="text-[#ff6a2b]">Docs</span>
          </Link>

          {isSearching && (
            <motion.div
              layoutId="search-bar-container"
              className="flex-1 max-w-xl relative"
            >
              <Search className="w-4 h-4 text-[#141414]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher un document, un dossier…"
                className="w-full h-10 pl-9 pr-9 rounded-full bg-white border border-transparent text-sm text-[#141414] placeholder:text-[#141414]/40 hover:border-[#141414]/20 focus:bg-white focus:border-[#4a6cf0] focus:ring-4 focus:ring-[#4a6cf0]/15 focus:outline-hidden transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-[#141414]/55 hover:bg-[#141414]/10 flex items-center justify-center cursor-pointer"
                  aria-label="Effacer la recherche"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </motion.div>
          )}

          <div className="flex items-center gap-3">
            {isSearching && (
              <button
                type="button"
                onClick={() => openUpload(openedFolderId)}
                className="hidden sm:inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-[#4a6cf0] text-[#f1ece4] text-sm font-medium hover:bg-[#3d5ed8] active:bg-[#3552c0] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b]"
              >
                <Plus className="w-4 h-4" />
                <span>Déposer</span>
              </button>
            )}

            {/* Menu profil */}
            <div className="relative shrink-0" ref={avatarMenuRef}>
              <button
                type="button"
                onClick={() => setIsAvatarMenuOpen((prev) => !prev)}
                className="w-9 h-9 rounded-full overflow-hidden ring-1 ring-[#141414]/15 hover:ring-[#141414]/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b] cursor-pointer"
                aria-label="Menu du profil"
                aria-expanded={isAvatarMenuOpen}
              >
                <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
              </button>

              <AnimatePresence>
                {isAvatarMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-11 z-50 w-64 bg-[#f1ece4] rounded-2xl shadow-[0_0_0_4px_#fff,0_18px_40px_rgba(10,16,60,0.35)] p-1.5"
                  >
                    <div className="px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-[#141414] truncate">
                          {displayName}
                        </p>
                        {isAdmin && (
                          <span className="px-1.5 py-0.5 rounded bg-[#ff6a2b] text-[#141414] text-[11px] font-medium">
                            Admin
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#141414]/55 truncate">{userEmail}</p>
                    </div>

                    <div className="h-px bg-[#141414]/5 my-1" />

                    {isAdmin && (
                      <Link
                        to="/admin"
                        onClick={() => setIsAvatarMenuOpen(false)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#141414]/80 rounded-lg hover:bg-[#141414]/5 transition-colors"
                      >
                        <Shield className="w-4 h-4 text-[#141414]/55" />
                        <span>Console admin</span>
                      </Link>
                    )}

                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 rounded-lg hover:bg-red-50 transition-colors text-left cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Se déconnecter</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

      {/* Contenu */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-10 flex flex-col pb-32 sm:pb-10">
        {/* Accueil */}
        {!isSearching && !openedFolderId && (
          <>
            <MobileDashboardHero
              userFirstName={(displayName || 'Ami').split(' ')[0]}
              searchQuery={searchQuery}
              onSearchChange={(val) => setSearchQuery(val)}
              onOpenUpload={() => openUpload(null)}
              categories={categories}
              selectedCategoryId={selectedCategoryId}
              onSelectCategory={setSelectedCategoryId}
              recentDocuments={documents}
              recentFolders={folders}
              onOpenFolder={(id) => setOpenedFolderId(id)}
            />

            <div className="hidden md:flex flex-1 flex-col">
              <SearchHero
                value={searchQuery}
                onChange={(val) => setSearchQuery(val)}
                onOpenUpload={() => openUpload(null)}
              />
            </div>
          </>
        )}

        {/* Dossier ouvert */}
        {openedFolder && (
          <FolderView
            folder={openedFolder}
            documents={documents}
            onBack={() => setOpenedFolderId(null)}
            onOpenUpload={(fId) => openUpload(fId)}
            onUpdateDocument={handleUpdateDocument}
            onDeleteDocument={handleDeleteDocument}
            currentUserId={user?.id || ''}
            isAdmin={isAdmin}
          />
        )}

        {/* Résultats */}
        {isSearching && !openedFolderId && (
          <div className="space-y-8">
            <CategoryChips
              categories={categories}
              selectedCategoryId={selectedCategoryId}
              onSelectCategory={setSelectedCategoryId}
              counts={categoryCounts}
              totalCount={totalItemCount}
            />

            {filteredFolders.length === 0 && rootDocuments.length === 0 ? (
              <EmptyState isSearching={true} onOpenUpload={() => openUpload(null)} />
            ) : (
              <div className="space-y-10">
                {filteredFolders.length > 0 && (
                  <section aria-labelledby="folders-title">
                    <div className="flex items-center gap-2.5 mb-4">
                      <h2
                        id="folders-title"
                        className="inline-block px-3 py-1 rounded-full bg-[#4a6cf0] text-[#f1ece4] text-sm font-semibold"
                      >
                        Dossiers
                      </h2>
                      <span className="text-sm text-[#141414]/55 tabular-nums">
                        {filteredFolders.length}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                      <AnimatePresence mode="popLayout">
                        {filteredFolders.map((folder) => (
                          <FolderCard
                            key={folder.id}
                            folder={folder}
                            onClick={() => setOpenedFolderId(folder.id)}
                            onDelete={handleDeleteFolder}
                            canDelete={isAdmin || folder.user_id === user?.id}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  </section>
                )}

                {rootDocuments.length > 0 && (
                  <section aria-labelledby="files-title">
                    <div className="flex items-center gap-2.5 mb-4">
                      <h2
                        id="files-title"
                        className="inline-block px-3 py-1 rounded-full bg-[#4a6cf0] text-[#f1ece4] text-sm font-semibold"
                      >
                        Fichiers
                      </h2>
                      <span className="text-sm text-[#141414]/55 tabular-nums">
                        {rootDocuments.length}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                      <AnimatePresence mode="popLayout">
                        {rootDocuments.map((doc) => (
                          <FileCard
                            key={doc.id}
                            doc={doc}
                            isNew={doc.id === newlyAddedDocId}
                            onUpdate={handleUpdateDocument}
                            onDelete={handleDeleteDocument}
                            canManage={isAdmin || doc.user_id === user?.id}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        categories={categories}
        folders={folders}
        initialFolderId={uploadTargetFolderId}
        onSuccess={handleDocumentUploaded}
      />

      <MobileNav
        onOpenUpload={() => openUpload(openedFolderId)}
        onFocusSearch={() => {
          if (!isSearching) setSearchQuery(' ');
          setTimeout(() => searchInputRef.current?.focus(), 150);
        }}
        onSelectFoldersTab={() => {
          if (!isSearching) setSearchQuery(' ');
        }}
        isModalOpen={isUploadOpen}
      />
    </motion.div>
  );
};
