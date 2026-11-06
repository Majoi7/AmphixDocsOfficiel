import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Compass, LogOut, Plus, Search, Shield, Trash2, UserRound, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchDashboardData, setDocumentTrash, updateDocumentMetadata } from '../lib/supabase';
import { createDashboardLibraryController } from '../lib/dashboard-library';
import { getSupabaseClientState, subscribeSupabaseClient } from '../lib/supabase-config';
import type { UploadBatchReport } from '../lib/upload-batch';
import { errorMessage } from '../lib/errors';
import { FileCard } from '../components/FileCard';
import { SearchHero } from '../components/SearchHero';
import { UploadModal } from '../components/UploadModal';
import { MobileNav, type DashboardView } from '../components/mobile/MobileNav';
import { MobileDashboardHero } from '../components/mobile/MobileDashboardHero';

type LibraryController = ReturnType<typeof createDashboardLibraryController>;
const buttonClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:cursor-not-allowed disabled:opacity-50';

export function DashboardPage() {
  const { user, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const reducedMotion = useReducedMotion();
  const { client, generation, config: { url: projectUrl } } = useSyncExternalStore(subscribeSupabaseClient, getSupabaseClientState, getSupabaseClientState);
  const userId = user?.id || '';
  const libraryRef = useRef<LibraryController | null>(null);
  const library = useMemo(() => {
    const controller = createDashboardLibraryController({
      scope: { userId, projectUrl, generation },
      isCurrent: () => libraryRef.current === controller && !!userId && !!client
        && getSupabaseClientState().generation === generation && getSupabaseClientState().client === client,
      read: async () => {
        if (!client) throw new Error('Rétablissez la configuration du projet avant de réessayer.');
        const checkAccount = async () => {
          const { data, error } = await client.auth.getSession();
          if (error || data.session?.user.id !== userId) throw new Error('La session a changé. Rechargez la bibliothèque avec le compte actuel.');
        };
        await checkAccount();
        const data = await fetchDashboardData(userId, undefined, client);
        await checkAccount();
        return data;
      },
    });
    return controller;
  }, [userId, projectUrl, generation, client, isAdmin]);
  // Invalidation dès le rendu, avant le nettoyage des effets de l'ancien compte.
  libraryRef.current = library;
  const { documents, loading, error: libraryError } = useSyncExternalStore(library.subscribe, library.getSnapshot, library.getSnapshot);
  const [view, setView] = useState<DashboardView>('home');
  const [showTrash, setShowTrash] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [newlyAddedDocId, setNewlyAddedDocId] = useState<string | null>(null);
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const logoutRef = useRef(false);
  const avatarMenuRef = useRef<HTMLDivElement>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const state: unknown = location.state;
    if (typeof state !== 'object' || state === null) return;
    if ('dashboardView' in state && (state.dashboardView === 'home' || state.dashboardView === 'search' || state.dashboardView === 'explore')) {
      setView(state.dashboardView);
      setShowTrash('showTrash' in state && state.showTrash === true);
      setSearchQuery('');
      setDebouncedQuery('');
    }
    if ('openUpload' in state && state.openUpload === true) setIsUploadOpen(true);
  }, [location.state]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  useEffect(() => {
    if (view !== 'search' || isUploadOpen) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [view, isUploadOpen]);
  useEffect(() => {
    libraryRef.current = library;
    setNewlyAddedDocId(null);
    setActionNotice(null);
    setSignOutError(null);
    setSearchQuery('');
    setDebouncedQuery('');
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    void library.refresh();
    return () => {
      library.cancelPending();
      if (libraryRef.current === library) libraryRef.current = null;
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
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

  const selectView = (next: DashboardView) => {
    setIsAvatarMenuOpen(false);
    setShowTrash(false);
    setView(next);
    if (next !== 'search') { setSearchQuery(''); setDebouncedQuery(''); }
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'instant' : 'smooth' });
    if (next === 'search') requestAnimationFrame(() => searchInputRef.current?.focus());
  };
  const openUpload = () => { setIsAvatarMenuOpen(false); setIsUploadOpen(true); };
  const handleSignOut = async () => {
    if (logoutRef.current || !library.isCurrent()) return;
    logoutRef.current = true;
    setIsAvatarMenuOpen(false);
    setSignOutError(null);
    setIsLoggingOut(true);
    try { await signOut(); navigate('/'); }
    catch (error) { if (library.isCurrent()) setSignOutError(errorMessage(error, 'La déconnexion a échoué. Réessayez.')); }
    finally { logoutRef.current = false; if (library.isCurrent()) setIsLoggingOut(false); }
  };
  const checkLibraryScope = () => {
    if (!library.isCurrent()) throw new Error('Le compte ou le projet a changé. Rechargez la bibliothèque avant de réessayer cette action.');
  };
  const handleUpdateDocument = async (id: string, title: string, description: string) => {
    checkLibraryScope();
    await updateDocumentMetadata(id, title, description, userId);
    if (!library.updateDocumentMetadata(id, title, description)) checkLibraryScope();
  };
  const handleTrashDocument = async (id: string, deleted: boolean) => {
    checkLibraryScope();
    const state = await setDocumentTrash(id, deleted, userId);
    if (!library.setDocumentTrash(state)) checkLibraryScope();
    setActionNotice(deleted ? 'Fichier placé dans la corbeille. Vous pouvez le restaurer depuis Explorer → Corbeille.' : 'Fichier restauré. Son statut d’approbation est conservé.');
    resultsHeadingRef.current?.focus();
  };
  const handleDocumentUploaded = (report: UploadBatchReport) => {
    const previousIds = new Set(library.getSnapshot().documents.map((document) => document.id));
    if (!library.applyUploadReport(report)) {
      if (library.isCurrent()) throw new Error('Ce bilan ne correspond pas au compte ou au projet affiché. Actualisez pour vérifier les fichiers confirmés.');
      return;
    }
    const added = library.getSnapshot().documents.find((document) => !previousIds.has(document.id) && document.deleted_at === null);
    if (!added) return;
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setNewlyAddedDocId(added.id);
    highlightTimerRef.current = setTimeout(() => {
      if (library.isCurrent()) setNewlyAddedDocId(null);
      highlightTimerRef.current = null;
    }, 1500);
  };

  const activeDocuments = documents.filter((document) => document.deleted_at === null);
  const trashedDocuments = documents.filter((document) => document.deleted_at !== null);
  const query = debouncedQuery.toLocaleLowerCase('fr');
  // Recherche locale existante, sans prétendre au moteur PostgreSQL du LOT 4.
  const filteredDocuments = (showTrash ? trashedDocuments : activeDocuments).filter((document) => !query
    || [document.title, document.description, document.file_name, document.school_name, document.subject_name]
      .some((value) => value?.toLocaleLowerCase('fr').includes(query)));
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Utilisateur';
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
  const hasResultsView = view === 'explore' || (view === 'search' && !!query);

  return (
    <motion.div animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : 0.2 }}
      className="flex min-h-dvh min-w-0 flex-col bg-[#f1ece4] text-[#141414] selection:bg-[#ff6a2b] selection:text-[#141414]">
      <header className="safe-top sticky top-0 z-40 border-b border-[#141414]/10 bg-[#f1ece4]/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:px-8">
          <Link to="/dashboard" onClick={() => selectView('home')} className="inline-flex min-h-11 shrink-0 items-center rounded-lg text-xl font-extrabold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0]">
            Amphix<span className="text-[#ff6a2b]">Docs</span>
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={() => selectView('explore')} className={`${buttonClass} hidden bg-white md:inline-flex`}><Compass aria-hidden="true" size={18} />Explorer</button>
            <button type="button" onClick={openUpload} className={`${buttonClass} hidden bg-[#ff6a2b] sm:inline-flex`}><Plus aria-hidden="true" size={18} />Déposer</button>
            <div ref={avatarMenuRef} className="relative shrink-0">
              <button ref={avatarButtonRef} type="button" aria-label="Ouvrir le profil" aria-expanded={isAvatarMenuOpen} aria-controls="dashboard-profile-actions"
                onClick={() => setIsAvatarMenuOpen((current) => !current)} className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-[#141414]/20 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0]">
                {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : <UserRound aria-hidden="true" size={22} />}
              </button>
              <AnimatePresence>
                {isAvatarMenuOpen && <motion.div id="dashboard-profile-actions" role="group" aria-label="Actions du profil"
                  initial={reducedMotion ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.12 }}
                  className="absolute right-0 top-13 z-50 w-64 max-w-[calc(100vw-32px)] rounded-2xl border border-[#141414]/15 bg-[#f1ece4] p-2 shadow-xl">
                  <div className="min-w-0 px-3 py-2"><p className="truncate text-sm font-bold">{displayName}</p>{user?.email && <p className="truncate text-xs text-[#141414]/65">{user.email}</p>}</div>
                  <button type="button" onClick={() => selectView('explore')} className={`${buttonClass} w-full justify-start hover:bg-white`}><Compass aria-hidden="true" size={18} />Explorer les fichiers</button>
                  {isAdmin && <Link to="/admin" className={`${buttonClass} w-full justify-start hover:bg-white`}><Shield aria-hidden="true" size={18} />Console admin</Link>}
                  <button type="button" onClick={() => void handleSignOut()} disabled={isLoggingOut} className={`${buttonClass} w-full justify-start text-red-700 hover:bg-red-50`}><LogOut aria-hidden="true" size={18} />Se déconnecter</button>
                </motion.div>}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>
      <main className="pb-nav mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col px-4 pt-6 md:px-8 md:pb-10">
        {isLoggingOut && <p role="status" className="mb-4 text-sm">Déconnexion en cours…</p>}
        {signOutError && <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4"><p role="alert" className="break-words text-sm text-red-800">{signOutError}</p><button type="button" disabled={isLoggingOut} onClick={() => void handleSignOut()} className={`${buttonClass} mt-2 bg-white`}>Réessayer la déconnexion</button></div>}
        {libraryError && <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4">
          <p role="alert" className="break-words text-sm text-red-800">{libraryError}</p><p className="mt-1 text-xs text-red-800">Les fichiers déjà confirmés restent affichés ; la liste peut être incomplète.</p>
          <button type="button" onClick={() => void library.refresh()} disabled={loading} className={`${buttonClass} mt-2 bg-white`}>Réessayer le chargement</button>
        </div>}
        {actionNotice && <p role="status" className="mb-4 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800">{actionNotice}</p>}
        {view === 'home' ? <>
          <MobileDashboardHero userFirstName={displayName.split(' ')[0]} searchQuery={searchQuery} onSearchChange={setSearchQuery} onFocusSearch={() => selectView('search')} onOpenUpload={openUpload} />
          <div className="hidden flex-1 flex-col md:flex"><SearchHero value={searchQuery} onChange={setSearchQuery} onFocusSearch={() => selectView('search')} onOpenUpload={openUpload} /></div>
        </> : <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 ref={resultsHeadingRef} tabIndex={-1} className="min-w-0 rounded-lg text-2xl font-extrabold tracking-tight focus-visible:outline-2 focus-visible:outline-[#4a6cf0]">{view === 'search' ? 'Recherche' : showTrash ? 'Corbeille' : 'Explorer les fichiers'}</h1>
            <button type="button" onClick={() => void library.refresh()} disabled={loading} className={`${buttonClass} bg-white`}>Actualiser</button>
          </div>
          <div className="relative min-w-0">
            <label htmlFor="library-search" className="sr-only">Rechercher par titre, école, matière ou nom de fichier</label>
            <Search aria-hidden="true" size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/50" />
            <input ref={searchInputRef} id="library-search" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Titre, école, matière…"
              className="min-h-14 w-full min-w-0 rounded-2xl border-2 border-[#141414] bg-white py-3 pr-14 pl-12 text-base outline-none focus:border-[#4a6cf0] focus:ring-4 focus:ring-[#4a6cf0]/15" />
            {searchQuery && <button type="button" aria-label="Effacer la recherche" onClick={() => setSearchQuery('')} className="absolute top-1/2 right-1 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full hover:bg-[#f1ece4] focus-visible:outline-2 focus-visible:outline-[#4a6cf0]"><X aria-hidden="true" size={20} /></button>}
          </div>
          {view === 'explore' && <div role="group" aria-label="Afficher les fichiers actifs ou la corbeille" className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!showTrash} onClick={() => setShowTrash(false)} className={`${buttonClass} ${!showTrash ? 'bg-[#141414] text-white' : 'bg-white'}`}>Fichiers ({activeDocuments.length})</button>
            <button type="button" aria-pressed={showTrash} onClick={() => setShowTrash(true)} className={`${buttonClass} ${showTrash ? 'bg-[#141414] text-white' : 'bg-white'}`}><Trash2 aria-hidden="true" size={16} />Corbeille ({trashedDocuments.length})</button>
          </div>}
          {showTrash && <p className="text-sm text-[#141414]/70">Les fichiers restent conservés. Leur restauration conserve leur statut d’approbation. Aucune suppression définitive n’est proposée.</p>}
          {loading && <p role="status" className="text-sm text-[#141414]/70">Chargement de la bibliothèque…</p>}
          {searchQuery.trim() !== debouncedQuery && <p role="status" className="text-sm text-[#141414]/70">Mise à jour de la recherche…</p>}
          {!hasResultsView ? <p className="rounded-3xl bg-white/60 p-5 text-sm text-[#141414]/70">Saisissez votre recherche, ou choisissez Explorer pour voir les fichiers accessibles.</p> : <>
            <p role="status" className="text-sm text-[#141414]/70">{filteredDocuments.length} fichier(s) {showTrash ? 'dans la corbeille' : 'accessible(s)'}{libraryError ? ' dans la liste disponible' : ''}.</p>
            {!filteredDocuments.length && !loading && !libraryError ? <div className="rounded-3xl border border-[#141414]/15 bg-white p-5">
              <h2 className="text-lg font-bold">{showTrash ? 'La corbeille est vide' : query ? 'Aucun fichier trouvé' : 'Aucun fichier pour le moment'}</h2>
              <p className="mt-2 text-sm text-[#141414]/70">{query ? 'Essayez un autre titre, une école ou une matière.' : showTrash ? 'Les fichiers retirés apparaîtront ici.' : 'Déposez votre premier fichier pour le partager après validation.'}</p>
              {!showTrash && <button type="button" onClick={openUpload} className={`${buttonClass} mt-4 bg-[#ff6a2b]`}><Plus aria-hidden="true" size={18} />Déposer</button>}
            </div> : <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"><AnimatePresence mode="popLayout">
              {filteredDocuments.map((document) => <FileCard key={document.id} doc={document} isNew={document.id === newlyAddedDocId} onUpdate={handleUpdateDocument} onTrash={handleTrashDocument} canManage={isAdmin || document.user_id === userId} />)}
            </AnimatePresence></div>}
          </>}
        </div>}
      </main>
      <UploadModal isOpen={isUploadOpen} onClose={() => setIsUploadOpen(false)} documents={documents} onSuccess={handleDocumentUploaded} />
      <MobileNav activeView={view} onHome={() => selectView('home')} onFocusSearch={() => selectView('search')} onSelectExplorer={() => selectView('explore')} onOpenUpload={openUpload} isModalOpen={isUploadOpen} />
    </motion.div>
  );
}
