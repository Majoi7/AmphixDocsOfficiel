import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { Compass, Plus, Search, Trash2, UserRound, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchDashboardData, setDocumentTrash, updateDocumentMetadata } from '../lib/supabase';
import { createDashboardLibraryController } from '../lib/dashboard-library';
import { getSupabaseClientState, subscribeSupabaseClient } from '../lib/supabase-config';
import type { UploadBatchReport } from '../lib/upload-batch';
import { DocumentGrid } from '../components/DocumentGrid';
import { DocumentDetails } from '../components/DocumentDetails';
import { LoadMoreDocuments } from '../components/LoadMoreDocuments';
import { SearchHero } from '../components/SearchHero';
import { UploadModal } from '../components/UploadModal';
import { MobileNav } from '../components/mobile/MobileNav';
import { useLibraryNavigation } from '../hooks/useLibraryNavigation';
import { useDocumentThumbnails } from '../hooks/useDocumentThumbnails';
import type { DashboardView } from '../lib/library-navigation';
import { MobileDashboardHero } from '../components/mobile/MobileDashboardHero';

type LibraryController = ReturnType<typeof createDashboardLibraryController>;
const buttonClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:cursor-not-allowed disabled:opacity-50';

export function DashboardPage() {
  const { user } = useAuth();
  const navigation = useLibraryNavigation();
  const { view, query: searchQuery, showTrash, setQuery: setSearchQuery, setShowTrash } = navigation;
  const isUploadOpen = navigation.panel === 'upload';
  const reducedMotion = useReducedMotion();
  const { client, generation, config: { url: projectUrl } } = useSyncExternalStore(subscribeSupabaseClient, getSupabaseClientState, getSupabaseClientState);
  const userId = user?.id || '';
  const [debouncedQuery, setDebouncedQuery] = useState(() => searchQuery.trim());
  const query = view === 'home' ? '' : debouncedQuery;
  const libraryRef = useRef<LibraryController | null>(null);
  const library = useMemo(() => {
    const controller = createDashboardLibraryController({
      scope: { userId, projectUrl, generation },
      isCurrent: () => libraryRef.current === controller && !!userId && !!client
        && getSupabaseClientState().generation === generation && getSupabaseClientState().client === client,
      matches: (document) => (document.deleted_at !== null) === showTrash
        && (!query || [document.title, document.description, document.file_name, document.school_name, document.subject_name]
          .some((value) => value?.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')))),
      read: async (offset) => {
        if (!client) throw new Error('Service momentanément indisponible. Réessayez.');
        const checkAccount = async () => {
          const { data, error } = await client.auth.getSession();
          if (error || data.session?.user.id !== userId) throw new Error('Reconnectez-vous pour actualiser les fichiers.');
        };
        await checkAccount();
        const data = await fetchDashboardData(userId, undefined, client, { query, trash: showTrash, offset });
        await checkAccount();
        return data;
      },
    });
    return controller;
  }, [userId, projectUrl, generation, client, query, showTrash]);
  // Invalidation dès le rendu, avant le nettoyage des effets de l'ancien compte.
  libraryRef.current = library;
  const { documents, loading, loadingMore, hasMore, error: libraryError } = useSyncExternalStore(library.subscribe, library.getSnapshot, library.getSnapshot);
  const previews = useDocumentThumbnails(documents);
  const [newlyAddedDocId, setNewlyAddedDocId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastViewRef = useRef<string | null>(null);
  const previousDocumentRef = useRef(navigation.documentId);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  useEffect(() => {
    if (navigation.panel || navigation.documentId) return;
    const viewKey = `${view}:${showTrash}`;
    if (lastViewRef.current === viewKey) return;
    const frame = requestAnimationFrame(() => {
      lastViewRef.current = viewKey;
      if (view === 'search') searchInputRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [view, showTrash, navigation.panel, navigation.documentId]);
  useEffect(() => {
    const wasOpen = previousDocumentRef.current;
    previousDocumentRef.current = navigation.documentId;
    if (!wasOpen || navigation.documentId) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body) resultsHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation.documentId]);
  useEffect(() => {
    libraryRef.current = library;
    setNewlyAddedDocId(null);
    setActionNotice(null);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    void library.refresh();
    return () => {
      library.cancelPending();
      if (libraryRef.current === library) libraryRef.current = null;
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, [library]);

  const selectView = (next: DashboardView) => navigation.selectView(next);
  const openUpload = () => navigation.openPanel('upload');
  const checkLibraryScope = () => {
    if (!library.isCurrent()) throw new Error('Votre session a changé. Actualisez avant de réessayer.');
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
    setActionNotice(deleted ? 'Fichier placé dans la corbeille. Retrouvez-le dans Explorer → Corbeille.' : 'Fichier restauré. Son statut d’approbation est conservé.');
  };
  const handleDocumentUploaded = (report: UploadBatchReport) => {
    const previousIds = new Set(library.getSnapshot().documents.map((document) => document.id));
    if (!library.applyUploadReport(report)) {
      if (library.isCurrent()) throw new Error('Votre session a changé. Actualisez pour vérifier vos fichiers.');
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

  const metadataName = user?.user_metadata?.full_name || user?.user_metadata?.name;
  const displayName = typeof metadataName === 'string' ? metadataName : 'Utilisateur';
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
  const hasResultsView = view !== 'search' || !!query;
  const selectedDocument = documents.find((item) => item.id === navigation.documentId);
  const overlayOpen = !!(navigation.panel || navigation.documentId);

  return (
    <motion.div animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : 0.2 }}
      className="flex min-h-dvh min-w-0 flex-col bg-[#f1ece4] text-[#141414] selection:bg-[#ff6a2b] selection:text-[#141414]">
      <header className="safe-top sticky top-0 z-40 border-b border-[#141414]/10 bg-[#f1ece4]/95 backdrop-blur">
        <div className="mx-auto flex min-h-13 md:min-h-16 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:px-8">
          <Link to="/dashboard" className="inline-flex min-h-11 shrink-0 items-center rounded-lg text-xl font-extrabold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0]">
            Amphix<span className="text-[#ff6a2b]">Docs</span>
          </Link>
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <button type="button" onClick={() => selectView('explore')} className={`${buttonClass} bg-white`}><Compass aria-hidden="true" size={18} />Explorer</button>
            <button type="button" onClick={openUpload} className={`${buttonClass} bg-[#ff6a2b]`}><Plus aria-hidden="true" size={18} />Déposer</button>
            <button type="button" aria-label="Ouvrir le profil" aria-haspopup="dialog" aria-expanded={navigation.panel === 'profile'}
              onClick={() => navigation.openPanel('profile')} className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#141414]/20 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0]">
              {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : <UserRound aria-hidden="true" size={22} />}
            </button>
          </div>
        </div>
      </header>
      <main className="pb-nav mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col px-4 pt-6 md:px-8 md:pb-10">
        {libraryError && <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4">
          <p role="alert" className="break-words text-sm text-red-800">{libraryError}</p><p className="mt-1 text-xs text-red-800">Les fichiers déjà chargés restent affichés ; la liste peut être incomplète.</p>
          <button type="button" onClick={() => void library.refresh()} disabled={loading || overlayOpen} className={`${buttonClass} mt-2 bg-white`}>Réessayer le chargement</button>
        </div>}
        {actionNotice && <p role="status" className="mb-4 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800">{actionNotice}</p>}
        {view === 'home' ? <>
          <MobileDashboardHero userFirstName={displayName.split(' ')[0]} searchQuery={searchQuery} onSearchChange={setSearchQuery} onFocusSearch={() => selectView('search')} onOpenUpload={openUpload} />
          <div className="hidden flex-col md:flex"><SearchHero value={searchQuery} onChange={setSearchQuery} onFocusSearch={() => selectView('search')} onOpenUpload={openUpload} /></div>
        </> : <div className="mb-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 ref={resultsHeadingRef} tabIndex={-1} className="min-w-0 rounded-lg text-2xl font-extrabold tracking-tight focus-visible:outline-2 focus-visible:outline-[#4a6cf0]">{view === 'search' ? 'Recherche' : showTrash ? 'Corbeille' : 'Explorer les fichiers'}</h1>
            <button type="button" onClick={() => void library.refresh()} disabled={loading || overlayOpen} className={`${buttonClass} bg-white`}>Actualiser</button>
          </div>
          <div className="relative min-w-0">
            <label htmlFor="library-search" className="sr-only">Rechercher par titre, école, matière ou nom de fichier</label>
            <Search aria-hidden="true" size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/50" />
            <input ref={searchInputRef} id="library-search" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Titre, école, matière…"
              className="min-h-14 w-full min-w-0 rounded-2xl border-2 border-[#141414] bg-white py-3 pr-14 pl-12 text-base outline-none focus:border-[#4a6cf0] focus:ring-4 focus:ring-[#4a6cf0]/15" />
            {searchQuery && <button type="button" aria-label="Effacer la recherche" onClick={() => setSearchQuery('')} className="absolute top-1/2 right-1 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full hover:bg-[#f1ece4] focus-visible:outline-2 focus-visible:outline-[#4a6cf0]"><X aria-hidden="true" size={20} /></button>}
          </div>
          {view === 'explore' && <div role="group" aria-label="Afficher les fichiers actifs ou la corbeille" className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!showTrash} onClick={() => setShowTrash(false)} className={`${buttonClass} ${!showTrash ? 'bg-[#141414] text-white' : 'bg-white'}`}>Fichiers</button>
            <button type="button" aria-pressed={showTrash} onClick={() => setShowTrash(true)} className={`${buttonClass} ${showTrash ? 'bg-[#141414] text-white' : 'bg-white'}`}><Trash2 aria-hidden="true" size={16} />Corbeille</button>
          </div>}
          {showTrash && <p className="text-sm text-[#141414]/70">Les fichiers restent conservés. Leur restauration conserve leur statut d’approbation.</p>}
          {searchQuery.trim() !== debouncedQuery && <p role="status" className="text-sm text-[#141414]/70">Mise à jour de la recherche…</p>}
        </div>}
        {hasResultsView ? <section className="min-w-0 space-y-4" aria-label={view === 'home' ? 'Fichiers récents' : 'Résultats'}>
          {view === 'home' && <h2 ref={resultsHeadingRef} tabIndex={-1} className="rounded-lg text-xl font-extrabold focus-visible:outline-2 focus-visible:outline-[#4a6cf0]">Ajouts récents</h2>}
          <p role="status" className="text-sm text-[#141414]/65">{loading ? 'Chargement des fichiers…' : `${documents.length} fichier(s) chargé(s)${hasMore ? ' · la liste continue' : ''}.`}</p>
          {previews.error && <div className="rounded-2xl bg-white/60 p-3 text-sm"><p role="status">{previews.error}</p><button type="button" onClick={previews.retry} className={`${buttonClass} mt-2 bg-white`}>Recharger les aperçus</button></div>}
          {!documents.length && !loading && !libraryError ? <div className="rounded-3xl border border-[#141414]/15 bg-white p-5">
            <h3 className="text-lg font-bold">{showTrash ? 'La corbeille est vide' : query ? 'Aucun fichier trouvé' : 'Aucun fichier pour le moment'}</h3>
            <p className="mt-2 text-sm text-[#141414]/70">{query ? 'Essayez un autre titre, une école ou une matière.' : showTrash ? 'Les fichiers retirés apparaîtront ici.' : 'Déposez votre premier fichier pour le partager après validation.'}</p>
            {!showTrash && <button type="button" onClick={openUpload} className={`${buttonClass} mt-4 bg-[#ff6a2b]`}><Plus aria-hidden="true" size={18} />Déposer</button>}
          </div> : <DocumentGrid documents={documents} urls={previews.urls} loading={loading} loadingPreviews={previews.loading}
            highlightedId={newlyAddedDocId} onOpen={(document) => navigation.openDocument(document.id)} />}
          <LoadMoreDocuments hasMore={hasMore} loading={loadingMore} disabled={loading || overlayOpen} error={!!libraryError} onLoad={library.loadMore} />
        </section> : <p className="rounded-3xl bg-white/60 p-5 text-sm text-[#141414]/70">Saisissez votre recherche, ou choisissez Explorer pour voir les fichiers accessibles.</p>}
      </main>
      <UploadModal isOpen={isUploadOpen} onClose={navigation.closePanel} documents={documents} onSuccess={handleDocumentUploaded} />
      {navigation.documentId && <DocumentDetails documentId={navigation.documentId}
        thumbnailUrl={selectedDocument?.thumbnail_path ? previews.urls[selectedDocument.thumbnail_path] : undefined}
        onClose={navigation.closeDocument} onUpdate={handleUpdateDocument} onTrash={handleTrashDocument} />}
      <MobileNav isModalOpen={overlayOpen} />
    </motion.div>
  );
}
