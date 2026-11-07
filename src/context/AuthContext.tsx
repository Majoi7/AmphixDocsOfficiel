import React, {
  createContext, useContext, useEffect, useRef, useState, useSyncExternalStore,
} from 'react';
import { useReducedMotion } from 'motion/react';
import {
  fetchUserRole, getSupabaseClientState, subscribeSupabaseClient,
} from '../lib/supabase';
import { createAuthSessionController, emptyAuthSnapshot, type AuthSnapshot } from '../lib/auth-session';
import { errorMessage, logDevelopmentError, userError } from '../lib/errors';

interface AuthContextType extends AuthSnapshot {
  isAdmin: boolean;
  loading: boolean;
  sessionLoading: boolean;
  roleLoading: boolean;
  isConfigured: boolean;
  configError: string | null;
  storageWarning: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  retrySession: () => Promise<void>;
  refreshUserRole: () => Promise<void>;
  isPageTransitioning: boolean;
  startPageTransition: (callback?: () => void) => void;
  isConfigModalOpen: boolean;
  setIsConfigModalOpen: (open: boolean) => void;
  lastAuthError: string | null;
  setLastAuthError: (err: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
type SessionController = ReturnType<typeof createAuthSessionController>;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const clientState = useSyncExternalStore(subscribeSupabaseClient, getSupabaseClientState, getSupabaseClientState);
  const { client, generation, config } = clientState;
  const [auth, setAuth] = useState<AuthSnapshot>(() => emptyAuthSnapshot(generation, !!client));
  const controllerRef = useRef<SessionController | null>(null);
  const [isPageTransitioning, setIsPageTransitioning] = useState(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [lastAuthError, setLastAuthError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const transitionTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const transitionCallback = useRef<(() => void) | undefined>(undefined);

  // Ne jamais exposer le compte ou le rôle du projet précédent, même pendant
  // le rendu qui précède le nettoyage de son contrôleur.
  const currentAuth = auth.generation === generation ? auth : emptyAuthSnapshot(generation, !!client);

  useEffect(() => {
    setAuth(emptyAuthSnapshot(generation, !!client));
    if (!client) return;
    const controller = createAuthSessionController({
      client,
      generation,
      loadRole: (userId) => fetchUserRole(userId, client),
      publish: setAuth,
      isCurrent: () => getSupabaseClientState().generation === generation,
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [client, generation]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const code = search.get('error_code') || hash.get('error_code');
    const description = search.get('error_description') || hash.get('error_description');
    const error = search.get('error') || hash.get('error');
    if (!code && !description && !error) return;

    logDevelopmentError(new Error(description || code || error || 'Retour de connexion invalide'), 'Connexion Google');
    const message = code === 'signup_disabled'
      ? 'Les inscriptions sont momentanément fermées. Contactez une personne administratrice.'
      : 'La connexion a été refusée. Réessayez.';
    setLastAuthError(message);
    setIsConfigModalOpen(true);
    for (const name of ['error', 'error_code', 'error_description']) search.delete(name);
    const query = search.toString();
    const oauthErrorHash = hash.has('error') || hash.has('error_code') || hash.has('error_description');
    window.history.replaceState(window.history.state, document.title,
      `${window.location.pathname}${query ? `?${query}` : ''}${oauthErrorHash ? '' : window.location.hash}`);
  }, []);

  const cancelTransitionTimers = () => {
    for (const timer of transitionTimers.current) clearTimeout(timer);
    transitionTimers.current = [];
  };

  useEffect(() => () => {
    cancelTransitionTimers();
    transitionCallback.current = undefined;
  }, []);

  useEffect(() => {
    if (!reducedMotion) return;
    cancelTransitionTimers();
    const callback = transitionCallback.current;
    transitionCallback.current = undefined;
    setIsPageTransitioning(false);
    callback?.();
  }, [reducedMotion]);

  const startPageTransition = (callback?: () => void) => {
    cancelTransitionTimers();
    transitionCallback.current = callback;
    if (reducedMotion) {
      transitionCallback.current = undefined;
      setIsPageTransitioning(false);
      callback?.();
      return;
    }
    setIsPageTransitioning(true);
    transitionTimers.current.push(setTimeout(() => {
      const pending = transitionCallback.current;
      transitionCallback.current = undefined;
      try {
        pending?.();
      } finally {
        transitionTimers.current.push(setTimeout(() => setIsPageTransitioning(false), 700));
      }
    }, 600));
  };

  const signInWithGoogle = async () => {
    setLastAuthError(null);
    const originState = getSupabaseClientState();
    try {
      if (!originState.client) throw new Error(originState.config.error || 'Enregistrez une configuration Supabase publique valide avant de vous connecter.');
      // Le stockage PKCE d'un iframe peut être partitionné : démarrer puis
      // terminer OAuth dans le même onglet de premier niveau, sans popup tardive.
      if (window.self !== window.top) throw new Error('Ouvrez l’application dans un onglet dédié, puis relancez la connexion Google depuis cet onglet.');
      const { data, error } = await originState.client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/dashboard`, skipBrowserRedirect: true },
      });
      if (getSupabaseClientState().generation !== originState.generation) throw new Error('La configuration a changé. Relancez la connexion pour le projet actuel.');
      if (error) throw new Error(`Impossible de démarrer la connexion Google : ${errorMessage(error)}`);
      if (!data.url) throw new Error('Le service n’a pas retourné de lien de connexion. Réessayez.');
      window.location.assign(data.url);
    } catch (error) {
      const message = userError(error, 'La connexion Google n’a pas pu être démarrée. Réessayez.');
      if (getSupabaseClientState().generation === originState.generation) {
        setLastAuthError(message);
        setIsConfigModalOpen(true);
      }
      throw new Error(message);
    }
  };

  const signOut = async () => {
    const originState = getSupabaseClientState();
    const controller = controllerRef.current;
    const accountId = controller?.getSnapshot().user?.id;
    try {
      if (!originState.client) throw new Error('Aucune session réelle n’est disponible pour cette configuration.');
      const { error } = await originState.client.auth.signOut();
      if (error) throw new Error(`La déconnexion n’a pas été confirmée : ${errorMessage(error)}`);
      if (getSupabaseClientState().generation !== originState.generation) return;
      // Une réponse de déconnexion ancienne ne doit pas effacer un autre compte.
      if (controllerRef.current === controller && (!controller?.getSnapshot().user || controller.getSnapshot().user?.id === accountId)) {
        controller?.clear();
      }
      setLastAuthError(null);
    } catch (error) {
      const message = userError(error, 'La déconnexion a échoué. Réessayez.');
      if (getSupabaseClientState().generation === originState.generation) setLastAuthError(message);
      throw new Error(message);
    }
  };

  return (
    <AuthContext.Provider value={{
      ...currentAuth,
      isAdmin: currentAuth.roleStatus === 'ready' && currentAuth.userRole === 'admin',
      loading: currentAuth.sessionStatus === 'loading' || currentAuth.roleStatus === 'loading',
      sessionLoading: currentAuth.sessionStatus === 'loading',
      roleLoading: currentAuth.roleStatus === 'loading',
      isConfigured: config.isConfigured,
      configError: config.error,
      storageWarning: config.storageWarning,
      signInWithGoogle,
      signOut,
      retrySession: async () => { await controllerRef.current?.retrySession(); },
      refreshUserRole: async () => { await controllerRef.current?.refreshUserRole(); },
      isPageTransitioning,
      startPageTransition,
      isConfigModalOpen,
      setIsConfigModalOpen,
      lastAuthError,
      setLastAuthError,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé à l’intérieur d’un AuthProvider');
  return context;
};
