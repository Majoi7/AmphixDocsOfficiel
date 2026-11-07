import React from 'react';
import { Navigate } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    user, isAdmin, loading, sessionError, roleError, isConfigured,
    retrySession, refreshUserRole, setIsConfigModalOpen,
  } = useAuth();
  const reducedMotion = useReducedMotion();

  if (!isConfigured || sessionError || roleError) {
    return (
      <main className="min-h-dvh bg-[#f1ece4] flex flex-col items-center justify-center p-6 gap-4 text-center">
        <AlertCircle className="w-8 h-8 text-[#ff6a2b]" aria-hidden="true" />
        <h1 className="font-extrabold text-xl text-[#141414]">Autorisations non vérifiées</h1>
        <p role="alert" className="text-sm text-[#141414]/80 max-w-lg break-words">
          {!isConfigured ? 'Le service est momentanément indisponible. Réessayez plus tard.' : 'L’accès à l’administration n’a pas pu être vérifié. Réessayez.'}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {isConfigured && (
            <button type="button" onClick={() => { void (sessionError ? retrySession() : refreshUserRole()).catch(() => undefined); }}
              className="px-5 py-3 rounded-full bg-[#ff6a2b] text-white text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b]">
              Réessayer la vérification
            </button>
          )}
          <button type="button" onClick={() => setIsConfigModalOpen(true)}
            className="px-5 py-3 rounded-full border-2 border-[#141414]/30 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b]">
            Aide à la connexion
          </button>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <div role="status" className="min-h-dvh bg-[#f1ece4] flex flex-col items-center justify-center p-6">
        <Loader2 className={`w-8 h-8 text-[#ff6a2b] mb-3 ${reducedMotion ? '' : 'animate-spin'}`} aria-hidden="true" />
        <p className="font-bold text-[#141414] text-sm">Vérification des autorisations administratrices…</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/" replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};
