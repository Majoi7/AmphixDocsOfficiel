import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { getStoredSupabaseConfig, reinitializeSupabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  X,
  Key,
  ExternalLink,
  Check,
  AlertTriangle,
  Sparkles,
  HelpCircle,
  Copy,
  ShieldCheck,
  Globe,
} from 'lucide-react';

interface SupabaseConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectRealGoogle?: () => void;
}

export const SupabaseConfigModal: React.FC<SupabaseConfigModalProps> = ({
  isOpen,
  onClose,
  onConnectRealGoogle,
}) => {
  const { isConfigured, signInDemoUser, signInWithGoogle, lastAuthError, setLastAuthError } = useAuth();
  const currentConfig = getStoredSupabaseConfig();

  const [url, setUrl] = useState(currentConfig.url || '');
  const [key, setKey] = useState(currentConfig.key || '');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Synchroniser avec l'erreur passée par l'AuthContext
  const activeError = authError || lastAuthError;
  const isSignupDisabled = activeError && activeError.toLowerCase().includes('signup');

  // Détection si l'application est exécutée dans un iframe
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const projectRef = url.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/i)?.[1] || 'rxekjxttxbhylzjepibc';
  const callbackUrl = `https://${projectRef}.supabase.co/auth/v1/callback`;
  const supabaseDashboardAuthUrl = `https://supabase.com/dashboard/project/${projectRef}/auth/users`;

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !key.trim()) return;
    reinitializeSupabase(url.trim(), key.trim());
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      window.location.reload();
    }, 1200);
  };

  const handleTestGoogle = async () => {
    try {
      setIsTesting(true);
      setAuthError(null);
      setLastAuthError(null);
      await signInWithGoogle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Échec de la connexion OAuth Google';
      setAuthError(msg);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          {/* Overlay sombre */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#141414]/60 backdrop-blur-xs cursor-pointer"
          />

          {/* Fenêtre modale */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 350, damping: 24 }}
            className="relative w-full max-w-2xl bg-white rounded-[28px] border-3 border-[#141414] shadow-[12px_18px_0px_#141414] p-6 sm:p-8 z-10 max-h-[90vh] overflow-y-auto"
          >
            {/* En-tête */}
            <div className="flex items-center justify-between pb-4 border-b-2 border-[#f1ece4] mb-6">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-[#ff6a2b]/15 flex items-center justify-center text-[#ff6a2b]">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-[800] text-xl sm:text-2xl text-[#141414] tracking-tight">
                    Activer la connexion Google
                  </h3>
                  <p className="text-xs text-[#141414]/60 font-medium">
                    Guide complet de dépannage et configuration Supabase
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#141414]/60 hover:text-[#141414] hover:bg-[#f1ece4] transition-colors"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Alerte si dans un iframe (problème n°1 pour Google OAuth) */}
            {isInIframe && (
              <div className="mb-6 p-4 rounded-2xl bg-[#ff6a2b]/10 border-2 border-[#ff6a2b] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-[#ff6a2b] shrink-0 mt-0.5" />
                  <div className="text-xs text-[#141414]">
                    <span className="font-extrabold block text-sm text-[#ff6a2b] mb-0.5">
                      Contrainte de sécurité Google (iFrame)
                    </span>
                    Google interdit expressément l'affichage de sa mire de connexion dans les cadres intégrés (iframes). Pour vous connecter avec Google, ouvrez l'application dans un **onglet dédié**.
                  </div>
                </div>
                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#ff6a2b] text-white text-xs font-extrabold shadow-sm hover:bg-[#ff8a4c] transition-colors"
                >
                  <span>Ouvrir en plein écran</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}

            {/* Alerte spécifique si signup_disabled */}
            {isSignupDisabled ? (
              <div className="mb-6 p-4 rounded-2xl bg-[#ff6a2b]/15 border-2 border-[#ff6a2b] flex flex-col gap-2.5 text-xs">
                <div className="flex items-center gap-2 text-sm font-extrabold text-[#141414]">
                  <AlertTriangle className="w-5 h-5 text-[#ff6a2b] shrink-0" />
                  <span>Action requise dans Supabase : Autoriser les inscriptions</span>
                </div>
                <p className="text-[#141414]/85 leading-relaxed">
                  Votre projet Supabase bloque actuellement les nouveaux comptes (erreur <code>signup_disabled</code>). C'est normal sur un nouveau projet.
                </p>
                <div className="p-3 bg-white rounded-xl border border-[#ff6a2b]/30 space-y-1.5 font-medium">
                  <p className="font-bold text-[#141414]">Comment l'activer en 30 secondes :</p>
                  <p>1. Allez dans votre dashboard Supabase : <strong>Authentication &gt; Sign In / Up</strong> (ou <strong>Configuration &gt; General</strong>).</p>
                  <p>2. Cochez / activez l'interrupteur : <strong>« Allow new users to sign up »</strong> (Autoriser les nouvelles inscriptions).</p>
                  <p>3. Cliquez sur <strong>Save</strong> en bas de la page.</p>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <a
                    href={supabaseDashboardAuthUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#ff6a2b] text-white font-extrabold text-xs shadow-xs hover:bg-[#ff8a4c] transition-colors"
                  >
                    <span>Ouvrir les paramètres Authentication Supabase</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null);
                      setLastAuthError(null);
                    }}
                    className="text-[11px] font-bold text-[#141414]/60 hover:text-[#141414]"
                  >
                    Fermer cette alerte
                  </button>
                </div>
              </div>
            ) : activeError ? (
              <div className="mb-6 p-3.5 rounded-xl bg-[#e11d48]/10 border border-[#e11d48]/30 flex items-start gap-2 text-xs font-bold text-[#e11d48]">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-black">Erreur d'authentification Supabase :</p>
                  <p className="font-mono text-[11px] mt-0.5">{activeError}</p>
                </div>
              </div>
            ) : null}

            {/* Étapes détaillées */}
            <div className="space-y-6">
              {/* Étape 1 : Google Cloud Console */}
              <div className="p-4 rounded-2xl bg-[#f1ece4]/50 border border-[#141414]/15">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-full bg-[#4a6cf0] text-white font-extrabold text-xs flex items-center justify-center">
                    1
                  </span>
                  <h4 className="font-extrabold text-sm text-[#141414]">
                    Google Cloud Console : ID client OAuth Web
                  </h4>
                </div>
                <p className="text-xs text-[#141414]/70 mb-3 leading-relaxed">
                  Dans votre console Google Cloud (<em>Identifiants &gt; Créer un ID client OAuth &gt; Application Web</em>), ajoutez cette URI exacte dans <strong>« URI de redirection autorisés »</strong> :
                </p>
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white border border-[#141414]/20 font-mono text-xs">
                  <span className="truncate text-[#4a6cf0] font-semibold">{callbackUrl}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(callbackUrl, 'callback')}
                    className="p-1.5 rounded-lg hover:bg-[#f1ece4] text-[#141414]/70 shrink-0"
                    title="Copier"
                  >
                    {copiedField === 'callback' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Étape 2 : Supabase Provider & URL */}
              <div className="p-4 rounded-2xl bg-[#f1ece4]/50 border border-[#141414]/15">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-full bg-[#4a6cf0] text-white font-extrabold text-xs flex items-center justify-center">
                    2
                  </span>
                  <h4 className="font-extrabold text-sm text-[#141414]">
                    Dashboard Supabase : Activer Google & URLs
                  </h4>
                </div>
                <ul className="text-xs text-[#141414]/70 space-y-2 mb-3">
                  <li>
                    • Allez dans <strong>Authentication &gt; Providers &gt; Google</strong> : activez le bouton et collez votre <em>Client ID</em> et <em>Client Secret</em> Google.
                  </li>
                  <li>
                    • Allez dans <strong>Authentication &gt; URL Configuration</strong> : ajoutez dans <em>Redirect URLs</em> :
                  </li>
                </ul>
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white border border-[#141414]/20 font-mono text-xs">
                  <span className="truncate text-[#141414] font-semibold">{currentOrigin}/dashboard</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(`${currentOrigin}/dashboard`, 'redirect')}
                    className="p-1.5 rounded-lg hover:bg-[#f1ece4] text-[#141414]/70 shrink-0"
                    title="Copier"
                  >
                    {copiedField === 'redirect' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Étape 3 : Renseigner les clés Supabase */}
              <div className="p-4 rounded-2xl bg-[#ffd23f]/15 border-2 border-[#ffd23f]">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[#141414] text-white font-extrabold text-xs flex items-center justify-center">
                      3
                    </span>
                    <h4 className="font-extrabold text-sm text-[#141414]">
                      Renseigner vos identifiants Supabase
                    </h4>
                  </div>
                  {isConfigured && (
                    <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-[10px] font-bold flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> Connecté
                    </span>
                  )}
                </div>

                <form onSubmit={handleSaveConfig} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-bold text-[#141414] mb-1">
                      Project URL (ex : https://xyzcompany.supabase.co)
                    </label>
                    <input
                      type="url"
                      placeholder="https://votre-projet.supabase.co"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 rounded-xl bg-white border border-[#141414]/20 focus:border-[#ff6a2b] focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#141414] mb-1">
                      Anon Public Key (clé API publique anon)
                    </label>
                    <input
                      type="password"
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 rounded-xl bg-white border border-[#141414]/20 focus:border-[#ff6a2b] focus:outline-hidden"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-[11px] text-[#141414]/60">
                      Enregistré localement dans votre navigateur
                    </span>
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-full bg-[#141414] text-white font-bold text-xs hover:bg-[#333] transition-colors flex items-center gap-1.5"
                    >
                      {savedSuccess ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-green-400" />
                          <span>Sauvegardé !</span>
                        </>
                      ) : (
                        <span>Enregistrer les clés</span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Actions rapides en bas */}
            <div className="mt-8 pt-4 border-t-2 border-[#f1ece4] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  signInDemoUser();
                }}
                className="px-4 py-2.5 rounded-full bg-[#f1ece4] text-[#141414] font-bold text-xs hover:bg-[#e7e1d7] transition-colors flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#ff6a2b]" />
                <span>Tester tout de suite en Mode Découverte</span>
              </button>

              <button
                type="button"
                onClick={handleTestGoogle}
                disabled={isTesting}
                className="px-6 py-2.5 rounded-full bg-[#ff6a2b] text-white font-extrabold text-xs hover:bg-[#ff8a4c] transition-colors flex items-center justify-center gap-1.5 shadow-md disabled:opacity-60"
              >
                {isTesting ? 'Ouverture…' : 'Tester la connexion Google'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
