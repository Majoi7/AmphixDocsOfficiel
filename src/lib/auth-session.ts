import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { Database, UserRole } from './database.types';
import { errorMessage, userError } from './errors';

export interface AuthSnapshot {
  generation: number;
  user: User | null;
  userRole: UserRole | null;
  sessionStatus: 'unconfigured' | 'loading' | 'ready' | 'error';
  roleStatus: 'idle' | 'loading' | 'ready' | 'error';
  sessionError: string | null;
  roleError: string | null;
}

export type SignOutResult =
  | { status: 'confirmed'; isCurrent: () => boolean }
  | { status: 'failed'; message: string; isCurrent: () => boolean }
  | { status: 'superseded' };

export function emptyAuthSnapshot(generation: number, configured: boolean): AuthSnapshot {
  return {
    generation, user: null, userRole: null,
    sessionStatus: configured ? 'loading' : 'unconfigured', roleStatus: 'idle',
    sessionError: null, roleError: null,
  };
}

// Contrôleur indépendant de React pour tester les courses session/profil.
// Aucun appel au SDK depuis le callback onAuthStateChange : son travail
// asynchrone est différé hors du verrou interne de Supabase Auth.
export function createAuthSessionController({ client, generation, loadRole, publish, isCurrent = () => true }: {
  client: SupabaseClient<Database>;
  generation: number;
  loadRole: (userId: string) => Promise<UserRole>;
  publish: (snapshot: AuthSnapshot) => void;
  isCurrent?: () => boolean;
}) {
  let disposed = false;
  let sessionRevision = 0;
  let roleRevision = 0;
  // L’identité annoncée par Auth reste connue pendant getUser/loadRole,
  // même lorsque le snapshot masque encore l’utilisateur non vérifié.
  let sessionAccountId: string | null = null;
  let accountRevision = 0;
  let signOutTask: { revision: number; result: Promise<SignOutResult> } | null = null;
  let snapshot = emptyAuthSnapshot(generation, true);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const active = () => !disposed && isCurrent();
  const update = (next: AuthSnapshot) => {
    if (!active()) return;
    snapshot = next;
    publish(next);
  };
  const schedule = (work: () => void) => {
    const timer = setTimeout(() => { timers.delete(timer); if (active()) work(); }, 0);
    timers.add(timer);
  };

  async function resolveRole(userId: string, sessionVersion: number): Promise<void> {
    const roleVersion = ++roleRevision;
    update({ ...snapshot, userRole: null, roleStatus: 'loading', roleError: null });
    const current = () => active() && sessionRevision === sessionVersion
      && roleRevision === roleVersion && snapshot.user?.id === userId;
    try {
      const role = await loadRole(userId);
      if (!current()) return;
      if (role !== 'admin' && role !== 'user') throw new Error('Le rôle reçu est invalide. Faites vérifier votre profil.');
      update({ ...snapshot, userRole: role, roleStatus: 'ready', roleError: null });
    } catch (error) {
      if (!current()) return;
      const message = userError(error, 'Votre accès n’a pas pu être vérifié. Réessayez.');
      update({ ...snapshot, userRole: null, roleStatus: 'error', roleError: message });
      throw new Error(message);
    }
  }

  async function verifySession(session: Session, version: number): Promise<void> {
    const current = () => active() && sessionRevision === version;
    try {
      // getSession seul lit le stockage. getUser(token) vérifie le compte
      // auprès d'Auth avec le jeton de CETTE session, pas d'un compte ultérieur.
      const { data, error } = await client.auth.getUser(session.access_token);
      if (!current()) return;
      if (error) throw new Error(`La session n’a pas pu être vérifiée : ${errorMessage(error)}`);
      if (!data.user || data.user.id !== session.user.id) throw new Error('Le compte vérifié ne correspond pas à la session. Reconnectez-vous.');
      update({ ...snapshot, user: data.user, sessionStatus: 'ready', sessionError: null, roleStatus: 'loading' });
      await resolveRole(data.user.id, version).catch(() => undefined);
    } catch (error) {
      if (!current()) return;
      update({ ...emptyAuthSnapshot(generation, true), sessionStatus: 'error', sessionError: userError(error, 'Votre connexion n’a pas pu être vérifiée. Réessayez.') });
    }
  }

  function acceptSession(session: Session | null) {
    if (!active()) return;
    const accountId = session?.user.id ?? null;
    if (accountId !== sessionAccountId) {
      sessionAccountId = accountId;
      ++accountRevision;
    }
    const version = ++sessionRevision;
    ++roleRevision;
    update({ ...emptyAuthSnapshot(generation, true), sessionStatus: session ? 'loading' : 'ready' });
    if (session) schedule(() => { void verifySession(session, version); });
  }

  async function restoreSession(reset: boolean): Promise<void> {
    const version = reset ? ++sessionRevision : sessionRevision;
    if (reset) {
      ++roleRevision;
      update(emptyAuthSnapshot(generation, true));
    }
    try {
      const { data, error } = await client.auth.getSession();
      if (!active() || version !== sessionRevision) return;
      if (error) throw new Error(`Impossible de restaurer la session : ${errorMessage(error)}`);
      acceptSession(data.session);
    } catch (error) {
      if (!active() || version !== sessionRevision) return;
      update({ ...emptyAuthSnapshot(generation, true), sessionStatus: 'error', sessionError: userError(error, 'Votre connexion n’a pas pu être rétablie. Réessayez.') });
    }
  }

  const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => acceptSession(session));
  // Une notification reçue après le départ de cette lecture invalide sa réponse.
  void restoreSession(false);

  return {
    getSnapshot: () => snapshot,
    retrySession: () => restoreSession(true),
    refreshUserRole: async () => {
      if (!active() || !snapshot.user || snapshot.sessionStatus !== 'ready') return;
      await resolveRole(snapshot.user.id, sessionRevision);
    },
    clear: () => acceptSession(null),
    dispose: () => {
      disposed = true;
      ++sessionRevision;
      ++roleRevision;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      subscription.unsubscribe();
    },
  };
}
