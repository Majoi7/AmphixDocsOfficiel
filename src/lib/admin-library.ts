import type { DocumentItem, UserProfile } from './supabase';
import { errorMessage } from './errors';

export interface AdminLibraryData {
  documents: DocumentItem[];
  users: UserProfile[];
}
export interface AdminLibrarySnapshot extends AdminLibraryData {
  loading: boolean;
  hasLoaded: boolean;
  error: string | null;
}

// Documents et profils appartiennent à une même lecture et à un même compte/projet.
// Une erreur conserve le dernier instantané. Une réponse obsolète n'est ni publiée
// ni renvoyée comme preuve de modération ou de changement de rôle.
export function createAdminLibraryController(dependencies: {
  isCurrent: () => boolean;
  read: () => Promise<AdminLibraryData>;
}) {
  const listeners = new Set<() => void>();
  let snapshot: AdminLibrarySnapshot = { documents: [], users: [], loading: true, hasLoaded: false, error: null };
  let revision = 0;
  const publish = (next: AdminLibrarySnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const check = (request: number) => {
    if (!dependencies.isCurrent()) throw new Error('Le compte ou le projet a changé. Rouvrez la console avec la session actuelle.');
    if (request !== revision) throw new Error('Cette relecture a été remplacée par une autre. Attendez sa fin puis actualisez si nécessaire.');
  };
  return {
    isCurrent: dependencies.isCurrent,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async refresh(): Promise<AdminLibraryData> {
      const request = ++revision;
      check(request);
      publish({ ...snapshot, loading: true, error: null });
      try {
        const data = await dependencies.read();
        check(request);
        publish({ ...data, loading: false, hasLoaded: true, error: null });
        return data;
      } catch (cause) {
        if (request === revision && dependencies.isCurrent()) {
          publish({ ...snapshot, loading: false, error: errorMessage(cause, 'Impossible de charger la console. Réessayez.') });
        }
        throw cause;
      }
    },
    cancelPending() { revision++; },
  };
}
