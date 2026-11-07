import React from 'react';
import { Navigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { FileText, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    user, loading, sessionError, roleError, isConfigured,
    retrySession, refreshUserRole, setIsConfigModalOpen,
  } = useAuth();
  const reducedMotion = useReducedMotion();

  if (!isConfigured || sessionError || roleError) {
    const message = !isConfigured ? 'Le service est momentanément indisponible. Réessayez plus tard.' : 'Votre connexion n’a pas pu être vérifiée. Réessayez.';
    return (
      <main className="min-h-dvh bg-[#f1ece4] flex flex-col items-center justify-center p-6 text-center gap-4">
        <AlertCircle className="w-8 h-8 text-[#ff6a2b]" aria-hidden="true" />
        <h1 className="font-extrabold text-xl text-[#141414]">Votre espace n’a pas pu être vérifié</h1>
        <p role="alert" className="text-sm text-[#141414]/80 max-w-lg break-words">{message}</p>
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
        <motion.div
          animate={reducedMotion ? { y: 0, rotate: 0, scale: 1 } : { y: [-8, 8, -8], rotate: [-3, 3, -3], scale: [0.98, 1.02, 0.98] }}
          transition={reducedMotion ? { duration: 0 } : { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden="true"
          className="w-20 h-24 bg-white rounded-2xl shadow-xl border-2 border-[#141414] flex flex-col items-center justify-center relative p-3">
          <div className="w-10 h-2 bg-[#ff6a2b] rounded-full mb-3" />
          <FileText className="w-8 h-8 text-[#4a6cf0]" />
          <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-[#ffd23f] border-2 border-[#141414] flex items-center justify-center shadow-sm">
            <span className="text-xs font-black">✦</span>
          </div>
        </motion.div>
        <p className="mt-6 font-bold text-[#141414] text-lg tracking-tight">Vérification de votre connexion…</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
};
