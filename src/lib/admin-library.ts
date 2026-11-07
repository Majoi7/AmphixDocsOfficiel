import type { DocumentItem, UserProfile } from './supabase';
import { userError as errorMessage } from './errors';

export interface AdminLibraryData {
  documents: DocumentItem[];
  users: UserProfile[];
}
export interface AdminLibrarySnapshot extends AdminLibraryData {
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  hasLoaded: boolean;
  error: string | null;
}

// Documents et profils appartiennent à une même lecture et à un même compte/projet.
// Une erreur conserve le dernier instantané. Une réponse obsolète n'est ni publiée
// ni renvoyée comme preuve de modération ou de changement de rôle.
export function createAdminLibraryController(dependencies: {
  isCurrent: () => boolean;
  read: (offset: number) => Promise<AdminLibraryData>;
}) {
  const listeners = new Set<() => void>();
  let snapshot: AdminLibrarySnapshot = { documents: [], users: [], loading: true, loadingMore: false, hasMore: false, hasLoaded: false, error: null };
  let revision = 0;
  let nextOffset = 0;
  const publish = (next: AdminLibrarySnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const check = (request: number) => {
    if (!dependencies.isCurrent()) throw new Error('Le compte ou le projet a changé. Rouvrez la console avec la session actuelle.');
    if (request !== revision) throw new Error('Cette relecture a été remplacée par une autre. Attendez sa fin puis actualisez si nécessaire.');
  };
  const readPage = async (append: boolean): Promise<AdminLibraryData> => {
    const request = ++revision;
    check(request);
    const offset = append ? nextOffset : 0;
    publish({ ...snapshot, loading: !append, loadingMore: append, error: null });
    try {
      const data = await dependencies.read(offset);
      check(request);
      if (data.documents.length > 20) throw new Error('La liste est indisponible. Réessayez.');
      const seen = new Set(snapshot.documents.map((document) => document.id));
      const result = append
        ? { ...data, documents: [...snapshot.documents, ...data.documents.filter((document) => !seen.has(document.id))] }
        : data;
      nextOffset = offset + data.documents.length;
      publish({ ...result, loading: false, loadingMore: false, hasMore: data.documents.length === 20, hasLoaded: true, error: null });
      return result;
    } catch (cause) {
      if (request === revision && dependencies.isCurrent()) {
        publish({ ...snapshot, loading: false, loadingMore: false, error: errorMessage(cause, 'Impossible de charger la console. Réessayez.') });
      }
      throw cause;
    }
  };
  return {
    isCurrent: dependencies.isCurrent,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh: () => readPage(false),
    async loadMore(): Promise<void> {
      if (snapshot.loading || snapshot.loadingMore || !snapshot.hasMore || !dependencies.isCurrent()) return;
      await readPage(true);
    },
    cancelPending() { revision++; },
  };
}
