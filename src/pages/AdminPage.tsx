import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, LayoutDashboard, Loader2, LogOut, RefreshCw, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchDashboardData, fetchUsersList } from '../lib/supabase';
import { createAdminLibraryController } from '../lib/admin-library';
import { getSupabaseClientState, subscribeSupabaseClient } from '../lib/supabase-config';
import { errorMessage } from '../lib/errors';
import { PendingList } from '../components/PendingList';
import { UsersTable } from '../components/UsersTable';
import { MobileNav } from '../components/mobile/MobileNav';

type AdminTab = 'pending' | 'users';
type LibraryController = ReturnType<typeof createAdminLibraryController>;
const buttonClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:cursor-not-allowed disabled:opacity-50';

export function AdminPage() {
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const { client, generation, config: { url: projectUrl } } = useSyncExternalStore(subscribeSupabaseClient, getSupabaseClientState, getSupabaseClientState);
  const userId = user?.id || '';
  const libraryRef = useRef<LibraryController | null>(null);
  const library = useMemo(() => {
    const controller = createAdminLibraryController({
      isCurrent: () => libraryRef.current === controller && !!userId && !!client && isAdmin
        && getSupabaseClientState().generation === generation && getSupabaseClientState().client === client,
      read: async () => {
        if (!client) throw new Error('Aucun projet connecté. Rétablissez la configuration avant de réessayer.');
        const checkAccount = async () => {
          const { data, error } = await client.auth.getSession();
          if (error || data.session?.user.id !== userId) throw new Error('La session a changé. Rouvrez la console avec le compte actuel.');
        };
        await checkAccount();
        const [dashboard, users] = await Promise.all([
          fetchDashboardData(userId, true, client),
          fetchUsersList(client),
        ]);
        await checkAccount();
        if (!users.some((profile) => profile.id === userId && profile.role === 'admin')) {
          throw new Error('Vos droits administrateurs ne sont plus confirmés. Reconnectez-vous avant une nouvelle action.');
        }
        return { documents: dashboard.documents, users };
      },
    });
    return controller;
  }, [userId, projectUrl, generation, client, isAdmin]);
  // Invalider l'ancien compte dès le rendu, sans attendre le nettoyage des effets.
  libraryRef.current = library;
  const { documents, users, loading, hasLoaded, error } = useSyncExternalStore(library.subscribe, library.getSnapshot, library.getSnapshot);
  const [activeTab, setActiveTab] = useState<AdminTab>('pending');
  const [pendingInteraction, setPendingInteraction] = useState(false);
  const [usersInteraction, setUsersInteraction] = useState(false);
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const logoutRef = useRef(false);
  const mountedRef = useRef(false);
  const avatarMenuRef = useRef<HTMLDivElement>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const sectionsId = useId();
  const interaction = pendingInteraction || usersInteraction;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    libraryRef.current = library;
    setPendingInteraction(false);
    setUsersInteraction(false);
    setSignOutError(null);
    setIsAvatarMenuOpen(false);
    // Le contrôleur expose l'erreur. Les actions reçoivent, elles, la promesse rejetée.
    void library.refresh().catch(() => undefined);
    return () => {
      library.cancelPending();
      if (libraryRef.current === library) libraryRef.current = null;
    };
  }, [library]);
  useEffect(() => {
    if (!isAvatarMenuOpen) return;
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !avatarMenuRef.current?.contains(event.target)) setIsAvatarMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsAvatarMenuOpen(false);
      avatarButtonRef.current?.focus();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [isAvatarMenuOpen]);

  const handleSignOut = async () => {
    if (logoutRef.current || interaction || !library.isCurrent() || !client) return;
    logoutRef.current = true;
    setIsAvatarMenuOpen(false);
    setSignOutError(null);
    setIsLoggingOut(true);
    const sameProject = () => getSupabaseClientState().generation === generation && getSupabaseClientState().client === client;
    try {
      await signOut();
      if (!mountedRef.current || !sameProject()) return;
      const session = await client.auth.getSession();
      if (!mountedRef.current || !sameProject() || session.data.session) return;
      if (session.error) throw new Error('La déconnexion est confirmée, mais la session ne peut pas être relue. Actualisez la page.');
      navigate('/');
    } catch (cause) {
      if (mountedRef.current && library.isCurrent()) setSignOutError(errorMessage(cause, 'La déconnexion a échoué. Réessayez.'));
    } finally {
      logoutRef.current = false;
      if (mountedRef.current && sameProject()) setIsLoggingOut(false);
    }
  };
  const refresh = () => { void library.refresh().catch(() => undefined); };
  const pendingCount = documents.filter((document) => document.status === 'pending' && document.deleted_at === null).length;
  const ownProfile = users.find((profile) => profile.id === userId);
  const metadataName = user?.user_metadata?.full_name || user?.user_metadata?.name;
  const displayName = ownProfile?.full_name || (typeof metadataName === 'string' && metadataName.trim() ? metadataName : 'Votre compte');
  const metadataAvatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
  const avatarUrl = ownProfile?.avatar_url || (typeof metadataAvatar === 'string' ? metadataAvatar : undefined);
  const tabs: { id: AdminTab; label: string; count: number }[] = [
    { id: 'pending', label: 'À approuver', count: pendingCount },
    { id: 'users', label: 'Inscriptions', count: users.length },
  ];
  const actionsDisabled = loading || !!error || !hasLoaded || isLoggingOut;

  return (
    <div className="flex min-h-dvh min-w-0 flex-col bg-[#f1ece4] text-[#141414] selection:bg-[#ff6a2b] selection:text-[#141414]">
      <header className="sticky top-0 z-40 border-b border-[#141414]/10 bg-[#f1ece4]/90 pt-safe-top backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <Link to="/dashboard" className={`${buttonClass} px-0 text-xl font-extrabold tracking-tight`} aria-label="AmphixDocs, retour à l’accueil">
              <span>Amphix<span className="text-[#ff6a2b]">Docs</span></span>
            </Link>
            <span className="rounded-full bg-[#ff6a2b] px-2 py-1 text-xs font-bold">Admin</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/dashboard" className={`${buttonClass} hidden bg-white sm:inline-flex`}>
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> Bibliothèque
            </Link>
            <div className="relative shrink-0" ref={avatarMenuRef}>
              <button ref={avatarButtonRef} type="button" onClick={() => setIsAvatarMenuOpen((open) => !open)} disabled={interaction || isLoggingOut}
                aria-label="Afficher les actions du profil" aria-expanded={isAvatarMenuOpen}
                className={`${buttonClass} h-11 w-11 overflow-hidden border border-[#141414]/15 bg-white p-0`}>
                {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : <UserRound className="h-5 w-5" aria-hidden="true" />}
              </button>
              {isAvatarMenuOpen && (
                <motion.div initial={reducedMotion ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.12 }}
                  className="absolute right-0 top-13 z-50 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-[#141414]/15 bg-white p-2 shadow-xl">
                  <div className="min-w-0 p-3">
                    <p className="truncate text-sm font-bold">{displayName}</p>
                    <p className="break-all text-xs text-[#141414]/60">{user?.email || 'Adresse e-mail non renseignée'}</p>
                  </div>
                  <Link to="/dashboard" onClick={() => setIsAvatarMenuOpen(false)} className={`${buttonClass} w-full justify-start hover:bg-[#f1ece4]`}>
                    <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> Retour à la bibliothèque
                  </Link>
                  <button type="button" onClick={() => void handleSignOut()} className={`${buttonClass} w-full justify-start text-red-700 hover:bg-red-50`}>
                    <LogOut className="h-4 w-4" aria-hidden="true" /> Se déconnecter
                  </button>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6 pb-nav sm:px-8 sm:py-10">
        <Link to="/dashboard" className={`${buttonClass} mb-2 justify-start px-0 text-[#141414]/70`}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Bibliothèque
        </Link>
        <h1 className="mb-5 text-2xl font-extrabold tracking-tight sm:text-4xl">Console d’administration</h1>
        {signOutError && <p role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{signOutError}</p>}
        {isLoggingOut && <p role="status" className="mb-4 text-sm">Déconnexion en cours…</p>}
        <div role="group" aria-label="Sections de la console" className="mb-5 grid grid-cols-2 gap-1 rounded-3xl bg-[#141414]/5 p-1 sm:inline-flex">
          {tabs.map((tab) => (
            <button key={tab.id} id={`${sectionsId}-${tab.id}`} type="button" aria-pressed={activeTab === tab.id}
              aria-controls={`${sectionsId}-panel-${tab.id}`} disabled={interaction || isLoggingOut} onClick={() => setActiveTab(tab.id)}
              className={`${buttonClass} relative min-w-0 px-3 ${activeTab === tab.id ? 'bg-white shadow-sm' : 'text-[#141414]/65'}`}>
              <span>{tab.label}</span><span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${tab.id === 'pending' && tab.count ? 'bg-[#ff6a2b]' : 'bg-[#141414]/10'}`}>{tab.count}</span>
            </button>
          ))}
        </div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[#141414]/65">{hasLoaded ? 'Fichiers et profils accessibles à votre compte.' : 'Lecture de la console.'}</p>
          <button type="button" disabled={loading || interaction || isLoggingOut} onClick={refresh} className={`${buttonClass} border border-[#141414]/15 bg-white`}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {loading ? 'Actualisation…' : 'Actualiser'}
          </button>
        </div>
        {error && (
          <div role="alert" className="mb-5 rounded-2xl border-2 border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p>{error}</p>
            <p className="mt-2">{hasLoaded ? 'Le dernier état affiché est conservé. Actualisez avant une nouvelle modification.' : 'Aucun résultat ne peut encore être présenté. Réessayez la lecture.'}</p>
          </div>
        )}
        {!hasLoaded && loading && <p role="status" className="py-12 text-center text-sm">Chargement des fichiers et des inscriptions…</p>}
        {hasLoaded && (
          <section id={`${sectionsId}-panel-${activeTab}`} aria-labelledby={`${sectionsId}-${activeTab}`} aria-busy={loading} className="min-w-0">
            {activeTab === 'pending' ? (
              <PendingList key={`${generation}:${userId}:pending`} documents={documents} currentUserId={userId} onRefresh={library.refresh}
                isCurrent={library.isCurrent} disabled={actionsDisabled} onInteractionChange={setPendingInteraction} />
            ) : (
              <UsersTable key={`${generation}:${userId}:users`} users={users} currentUserId={userId} onRefresh={library.refresh}
                isCurrent={library.isCurrent} disabled={actionsDisabled} onInteractionChange={setUsersInteraction} />
            )}
          </section>
        )}
      </main>
      <MobileNav onOpenUpload={() => navigate('/dashboard', { state: { openUpload: true } })}
        onFocusSearch={() => navigate('/dashboard', { state: { dashboardView: 'search' } })}
        onSelectExplorer={() => navigate('/dashboard', { state: { dashboardView: 'explore' } })}
        isModalOpen={interaction || isLoggingOut} />
    </div>
  );
}
