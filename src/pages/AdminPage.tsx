import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import {
  DocumentItem,
  FolderItem,
  UserProfile,
  fetchDashboardData,
  fetchUsersList,
} from '../lib/supabase';
import { PendingList } from '../components/PendingList';
import { UsersTable } from '../components/UsersTable';
import { LogOut, ArrowLeft, LayoutDashboard } from 'lucide-react';
import { MobileNav } from '../components/mobile/MobileNav';

type AdminTab = 'pending' | 'users';

export const AdminPage: React.FC = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<AdminTab>('pending');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);

  const avatarMenuRef = useRef<HTMLDivElement>(null);

  const loadData = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const [dash, usersList] = await Promise.all([
        fetchDashboardData(user.id, true),
        fetchUsersList(),
      ]);
      setDocuments(dash.documents);
      setFolders(dash.folders);
      setUsers(usersList);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  // Fermer le menu avatar au clic à l'extérieur
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(e.target as Node)) {
        setIsAvatarMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const pendingCount =
    documents.filter((d) => d.status === 'pending').length +
    folders.filter((f) => f.status === 'pending').length;

  const avatarUrl =
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture ||
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80';
  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    'Administrateur';
  const userEmail = user?.email || 'admin@amphix.site';

  const tabs: { id: AdminTab; label: string; count: number }[] = [
    { id: 'pending', label: 'À approuver', count: pendingCount },
    { id: 'users', label: 'Inscriptions', count: users.length },
  ];

  return (
    <div
      style={{
        fontFamily:
          "'DM Sans', 'Manrope', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
      className="min-h-screen bg-[#f1ece4] text-[#141414] flex flex-col selection:bg-[#ff6a2b] selection:text-[#141414]"
    >
      {/* Header */}
      <header className="w-full bg-[#f1ece4]/90 backdrop-blur sticky top-0 z-40 border-b border-[#141414]/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/dashboard"
              className="text-xl font-extrabold tracking-[-0.02em] select-none shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ff6a2b]"
            >
              <span className="text-[#141414]">Amphix</span>
              <span className="text-[#ff6a2b]">Docs</span>
            </Link>

            <span className="px-2.5 py-0.5 rounded-full bg-[#ff6a2b] text-[#141414] text-xs font-semibold">
              Admin
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/dashboard"
              className="hidden sm:inline-flex items-center gap-2 h-10 px-4 rounded-full bg-white text-sm font-semibold hover:-rotate-2 active:scale-95 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b]"
            >
              <LayoutDashboard className="w-4 h-4 text-[#141414]/55" />
              <span>Voir le dashboard</span>
            </Link>

            {/* Avatar et menu */}
            <div className="relative shrink-0" ref={avatarMenuRef}>
              <button
                type="button"
                onClick={() => setIsAvatarMenuOpen((prev) => !prev)}
                aria-label="Menu du profil"
                aria-expanded={isAvatarMenuOpen}
                className="w-9 h-9 rounded-full overflow-hidden ring-1 ring-[#141414]/15 hover:ring-[#141414]/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b] cursor-pointer"
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
                      <p className="text-sm font-semibold truncate">{displayName}</p>
                      <p className="text-xs text-[#141414]/55 truncate">{userEmail}</p>
                    </div>

                    <div className="h-px bg-[#141414]/10 my-1" />

                    <Link
                      to="/dashboard"
                      onClick={() => setIsAvatarMenuOpen(false)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#141414]/80 rounded-xl hover:bg-[#141414]/5 transition-colors"
                    >
                      <LayoutDashboard className="w-4 h-4 text-[#141414]/55" />
                      <span>Retour au dashboard</span>
                    </Link>

                    <button
                      type="button"
                      onClick={async () => {
                        setIsAvatarMenuOpen(false);
                        await signOut();
                        navigate('/');
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 rounded-xl hover:bg-red-50 transition-colors text-left cursor-pointer"
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
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-10 pb-32 sm:pb-10">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-[#141414]/55 hover:text-[#141414] transition-colors mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Dashboard</span>
        </Link>

        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-[-0.03em] mb-6">
          Console d'administration
        </h1>

        {/* Onglets */}
        <div
          role="tablist"
          aria-label="Sections de la console"
          className="inline-flex items-center gap-1 p-1 rounded-full bg-[#141414]/5 mb-8"
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={`relative h-9 px-4 rounded-full text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b] ${
                  active ? 'text-[#141414]' : 'text-[#141414]/55 hover:text-[#141414]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="admin-active-tab"
                    className="absolute inset-0 rounded-full bg-white shadow-sm"
                    transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  />
                )}
                <span className="relative">{tab.label}</span>
                <span
                  className={`relative px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums ${
                    tab.id === 'pending' && tab.count > 0
                      ? 'bg-[#ff6a2b] text-[#141414]'
                      : 'bg-[#141414]/8 text-[#141414]/65'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Contenu des onglets */}
        {loading ? (
          <div className="py-24 flex flex-col items-center" role="status">
            <div className="w-8 h-8 border-[3px] border-[#4a6cf0] border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-[#141414]/60">Chargement des données…</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {activeTab === 'pending' ? (
              <motion.div
                key="pending-tab"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <PendingList
                  documents={documents}
                  folders={folders}
                  onRefresh={loadData}
                  currentUserId={user?.id || ''}
                />
              </motion.div>
            ) : (
              <motion.div
                key="users-tab"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <UsersTable
                  users={users}
                  onRefresh={loadData}
                  currentUserId={user?.id || ''}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>

      {/* Barre de navigation mobile flottante */}
      <MobileNav
        onOpenUpload={() => navigate('/dashboard', { state: { openUpload: true } })}
        onFocusSearch={() => navigate('/dashboard#search')}
        onSelectFoldersTab={() => navigate('/dashboard#folders')}
      />
    </div>
  );
};
