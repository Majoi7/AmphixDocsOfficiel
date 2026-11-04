import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, fetchUserRole, UserRole } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  userRole: UserRole;
  isAdmin: boolean;
  loading: boolean;
  isConfigured: boolean;
  signInWithGoogle: () => Promise<void>;
  signInDemoUser: () => void;
  signOut: () => Promise<void>;
  isPageTransitioning: boolean;
  startPageTransition: (callback?: () => void) => void;
  isConfigModalOpen: boolean;
  setIsConfigModalOpen: (open: boolean) => void;
  lastAuthError: string | null;
  setLastAuthError: (err: string | null) => void;
  refreshUserRole: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEMO_USER_STORAGE_KEY = 'amphixdocs_demo_session';

const MOCK_GOOGLE_USER: unknown = {
  id: 'demo-user-12345',
  email: 'marie.curie@amphix.site',
  user_metadata: {
    full_name: 'Marie Curie',
    name: 'Marie Curie',
    avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    picture: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  },
  app_metadata: {},
  aud: 'authenticated',
  created_at: new Date().toISOString(),
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('user');
  const [loading, setLoading] = useState<boolean>(true);
  const [isPageTransitioning, setIsPageTransitioning] = useState<boolean>(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);
  const [lastAuthError, setLastAuthError] = useState<string | null>(null);
  const configured = isSupabaseConfigured();

  const loadRole = async (usrId: string) => {
    try {
      const r = await fetchUserRole(usrId);
      setUserRole(r);
    } catch {
      setUserRole('user');
    }
  };

  const refreshUserRole = async () => {
    if (user) {
      await loadRole(user.id);
    }
  };

  useEffect(() => {
    let mounted = true;

    // Vérifier les erreurs de redirection OAuth dans l'URL (ex: signup_disabled)
    const checkUrlForErrors = () => {
      try {
        const searchParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));

        const error = searchParams.get('error') || hashParams.get('error');
        const errorCode = searchParams.get('error_code') || hashParams.get('error_code');
        const errorDesc = searchParams.get('error_description') || hashParams.get('error_description');

        if (error || errorCode || errorDesc) {
          let message = errorDesc ? decodeURIComponent(errorDesc.replace(/\+/g, ' ')) : 'Accès refusé.';

          if (errorCode === 'signup_disabled' || (errorDesc && errorDesc.toLowerCase().includes('signup'))) {
            message = "signup_disabled: Inscriptions non autorisées sur ce projet Supabase. Vous devez activer l'option 'Allow new users to sign up' dans le dashboard Supabase.";
          }

          setLastAuthError(message);
          setIsConfigModalOpen(true);

          // Nettoyer l'URL pour une navigation propre
          const cleanUrl = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, cleanUrl);
        }
      } catch (e) {
        console.warn('Erreur vérification URL:', e);
      }
    };

    checkUrlForErrors();

    if (!configured) {
      // Vérifier si un utilisateur démo était déjà connecté
      const saved = localStorage.getItem(DEMO_USER_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as User;
          setUser(parsed);
          loadRole(parsed.id);
        } catch {
          setUser(null);
        }
      }
      setLoading(false);
      return;
    }

    // Récupérer la session Supabase actuelle
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (mounted) {
        if (error) {
          console.warn('Session Supabase initiale:', error.message);
        }
        setUser(session?.user ?? null);
        if (session?.user) {
          loadRole(session.user.id);
        }
        setLoading(false);
      }
    });

    // Écouter les changements de session en temps réel
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setUser(session?.user ?? null);
        if (session?.user) {
          loadRole(session.user.id);
        } else {
          setUserRole('user');
        }
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [configured]);

  const startPageTransition = (callback?: () => void) => {
    setIsPageTransitioning(true);
    setTimeout(() => {
      if (callback) callback();
      setTimeout(() => {
        setIsPageTransitioning(false);
      }, 700);
    }, 600);
  };

  const signInWithGoogle = async () => {
    setLastAuthError(null);

    if (!configured) {
      // Si Supabase n'est pas encore configuré, ouvrir le modal de configuration
      setIsConfigModalOpen(true);
      return;
    }

    const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
        skipBrowserRedirect: isInIframe,
      },
    });

    if (error) {
      console.error('Erreur de connexion OAuth Google:', error);
      setLastAuthError(error.message);
      setIsConfigModalOpen(true);
      throw error;
    }

    if (isInIframe && data?.url) {
      // Ouvrir la mire Google dans un onglet séparé pour contourner l'interdiction X-Frame-Options
      window.open(data.url, '_blank');
    }
  };

  const signInDemoUser = () => {
    const demoUser = MOCK_GOOGLE_USER as User;
    localStorage.setItem(DEMO_USER_STORAGE_KEY, JSON.stringify(demoUser));
    startPageTransition(() => {
      setUser(demoUser);
    });
  };

  const signOut = async () => {
    if (!configured) {
      localStorage.removeItem(DEMO_USER_STORAGE_KEY);
      setUser(null);
      return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Erreur lors de la déconnexion:', error);
      throw error;
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        userRole,
        isAdmin: userRole === 'admin',
        loading,
        isConfigured: configured,
        signInWithGoogle,
        signInDemoUser,
        signOut,
        isPageTransitioning,
        startPageTransition,
        isConfigModalOpen,
        setIsConfigModalOpen,
        lastAuthError,
        setLastAuthError,
        refreshUserRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth doit être utilisé à l\'intérieur d\'un AuthProvider');
  }
  return context;
};
