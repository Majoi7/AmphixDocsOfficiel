import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { Database, UserRole } from './database.types';
import { errorMessage, userError } from './errors';
import { logUploadDiagnostic } from './upload-diagnostics';

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
  let restorationRevision = 0;
  let roleRevision = 0;
  // L’identité de la session SDK reste connue pendant le chargement initial du rôle.
  let sessionAccountId: string | null = null;
  let accountRevision = 0;
  let signOutTask: { revision: number; result: Promise<SignOutResult> } | null = null;
  // Ref par valeur : connue aussi pendant la première vérification du compte.
  const currentUserIdRef: { current: string | null } = { current: null };
  let snapshot = emptyAuthSnapshot(generation, true);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const active = () => !disposed && isCurrent();
  const update = (next: AuthSnapshot) => {
    if (!active() || (Object.keys(next) as (keyof AuthSnapshot)[])
      .every((key) => snapshot[key] === next[key])) return;
    snapshot = next;
    publish(next);
  };
  const schedule = (work: () => void) => {
    const timer = setTimeout(() => { timers.delete(timer); if (active()) work(); }, 0);
    timers.add(timer);
  };

  async function resolveRole(userId: string, sessionVersion: number): Promise<void> {
    const roleVersion = ++roleRevision;
    // Une revalidation explicite garde le dernier rôle résolu. Les événements
    // Auth du même compte ne passent jamais par ce chargement.
    const revalidating = snapshot.roleStatus === 'ready' && snapshot.userRole !== null;
    if (!revalidating) update({ ...snapshot, userRole: null, roleStatus: 'loading', roleError: null });
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
      // Une erreur temporaire de profil n'efface pas le rôle déjà chargé et
      // ne démonte pas la page. Une réponse réelle de révocation reste appliquée.
      update(revalidating ? { ...snapshot, roleError: message }
        : { ...snapshot, userRole: null, roleStatus: 'error', roleError: message });
      throw new Error(message);
    }
  }

  function openSession(session: Session, version: number): void {
    if (!active() || sessionRevision !== version) return;
    // La session est déjà gérée par Supabase Auth. Pas d'aller-retour getUser
    // pour afficher la page : les API et leurs RLS vérifient le JWT côté serveur.
    update({ ...snapshot, user: session.user, sessionStatus: 'ready', sessionError: null, roleStatus: 'loading' });
    void resolveRole(session.user.id, version).catch(() => undefined);
  }

  function acceptSession(session: Session | null) {
    if (!active()) return;
    const accountId = session?.user.id ?? null;
    if (accountId === currentUserIdRef.current && (session || snapshot.sessionStatus === 'ready')) {
      // SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED et INITIAL_SESSION peuvent
      // réémettre le même compte au retour du sélecteur. Aucun setState, aucun
      // getUser/loadRole ni remplacement de l'objet user pour cette notification.
      return;
    }
    currentUserIdRef.current = accountId;
    if (accountId !== sessionAccountId) {
      sessionAccountId = accountId;
      ++accountRevision;
    }
    const version = ++sessionRevision;
    ++restorationRevision;
    ++roleRevision;
    update({ ...emptyAuthSnapshot(generation, true), sessionStatus: session ? 'loading' : 'ready' });
    if (session) schedule(() => openSession(session, version));
  }

  async function restoreSession(reset: boolean): Promise<void> {
    // Une notification du même compte ne modifie ni l'utilisateur ni le rôle ;
    // elle rend seulement une ancienne lecture getSession obsolète.
    const readVersion = ++restorationRevision;
    const revalidating = reset && snapshot.sessionStatus === 'ready' && snapshot.user !== null;
    const version = reset && !revalidating ? ++sessionRevision : sessionRevision;
    if (reset && !revalidating) {
      ++roleRevision;
      currentUserIdRef.current = null;
      update(emptyAuthSnapshot(generation, true));
    }
    try {
      const { data, error } = await client.auth.getSession();
      if (!active() || version !== sessionRevision || readVersion !== restorationRevision) return;
      if (error) throw new Error(`Impossible de restaurer la session : ${errorMessage(error)}`);
      if (revalidating && data.session?.user.id === currentUserIdRef.current) {
        update({ ...snapshot, sessionError: null });
        return;
      }
      acceptSession(data.session);
    } catch (error) {
      if (!active() || version !== sessionRevision || readVersion !== restorationRevision) return;
      const message = userError(error, 'Votre session est indisponible. Réessayez.');
      update(revalidating ? { ...snapshot, sessionError: message }
        : { ...emptyAuthSnapshot(generation, true), sessionStatus: 'error', sessionError: message });
    }
  }

  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    logUploadDiagnostic('auth-event', { authEvent: event });
    // Une notification sans session autre que SIGNED_OUT n'est pas la preuve
    // d'une déconnexion. SIGNED_OUT et un vrai changement de compte invalidant
    // la session gardent, eux, leur comportement de sécurité.
    if (currentUserIdRef.current && !session && event !== 'SIGNED_OUT') return;
    ++restorationRevision;
    acceptSession(event === 'SIGNED_OUT' ? null : session);
  });
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
      ++restorationRevision;
      ++roleRevision;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      subscription.unsubscribe();
    },
  };
}
