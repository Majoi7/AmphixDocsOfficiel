import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  getSupabaseClientState, subscribeSupabaseClient, reinitializeSupabase, resetSupabaseConfig,
} from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { useAuth } from '../context/AuthContext';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';
import { X, Key, ExternalLink, Check, AlertTriangle, Copy } from 'lucide-react';

interface SupabaseConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SupabaseConfigModal: React.FC<SupabaseConfigModalProps> = ({ isOpen, onClose }) => {
  const { user, sessionStatus, roleError, signInWithGoogle, lastAuthError, setLastAuthError } = useAuth();
  const { config } = useSyncExternalStore(subscribeSupabaseClient, getSupabaseClientState, getSupabaseClientState);
  const [url, setUrl] = useState(config.url);
  const [key, setKey] = useState(config.key);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const urlId = useId();
  const keyId = useId();
  const reducedMotion = useReducedMotion();
  useDialogAccessibility(dialogRef, isOpen, onClose, !isTesting);

  useEffect(() => {
    if (!isOpen) return;
    const saved = getSupabaseClientState().config;
    setUrl(saved.url);
    setKey(saved.key);
    setNotice(null);
    setActionError(null);
    setCopiedField(null);
  }, [isOpen]);

  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const callbackUrl = config.isConfigured ? `${config.url}/auth/v1/callback` : null;
  const projectRef = config.isConfigured
    ? new URL(config.url).hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i)?.[1]
    : null;
  const dashboardUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/auth/providers`
    : 'https://supabase.com/dashboard';
  const activeError = actionError || lastAuthError || config.error;
  const signupDisabled = lastAuthError?.includes('signup_disabled');
  const sourceLabel = config.source === 'local' ? 'paire enregistrée dans ce navigateur'
    : config.source === 'environment' ? 'variables publiques de l’environnement' : 'aucune configuration';

  const copyToClipboard = async (text: string, name: string) => {
    setActionError(null);
    try {
      if (!navigator.clipboard) throw new Error('Le presse-papiers n’est pas disponible. Sélectionnez et copiez le texte manuellement.');
      await navigator.clipboard.writeText(text);
      setCopiedField(name);
    } catch (error) {
      setActionError(errorMessage(error, 'La copie a échoué. Copiez le texte manuellement.'));
    }
  };

  const handleSaveConfig = (event: React.FormEvent) => {
    event.preventDefault();
    setActionError(null);
    setNotice(null);
    try {
      const result = reinitializeSupabase(url, key);
      setUrl(result.config.url);
      setKey(result.config.key);
      setLastAuthError(null);
      setNotice('Configuration enregistrée. Son format est valide ; cela ne vérifie ni le projet distant, ni Google, ni une session. Le compte et le rôle sont rechargés pour ce projet.');
    } catch (error) {
      setActionError(errorMessage(error, 'La configuration n’a pas été enregistrée. Vérifiez les champs puis réessayez.'));
    }
  };

  const handleReset = () => {
    setActionError(null);
    setNotice(null);
    try {
      const result = resetSupabaseConfig();
      setUrl(result.config.url);
      setKey(result.config.key);
      setLastAuthError(null);
      setNotice('La paire locale a été retirée. Les variables publiques de l’environnement sont de nouveau utilisées, si elles sont valides.');
    } catch (error) {
      setActionError(errorMessage(error, 'La configuration locale n’a pas pu être réinitialisée. Réessayez.'));
    }
  };

  const handleGoogle = async () => {
    setIsTesting(true);
    setActionError(null);
    try {
      await signInWithGoogle();
    } catch (error) {
      setActionError(errorMessage(error, 'La connexion n’a pas pu démarrer. Réessayez.'));
    } finally {
      setIsTesting(false);
    }
  };

  const buttonClass = 'px-4 py-2.5 rounded-full text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:opacity-50';

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <motion.div
            aria-hidden="true"
            initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }}
            exit={{ opacity: reducedMotion ? 1 : 0 }} transition={{ duration: reducedMotion ? 0 : 0.2 }}
            onClick={() => { if (!isTesting) onClose(); }}
            className="fixed inset-0 bg-[#141414]/60 backdrop-blur-xs"
          />
          <motion.div
            ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
            initial={reducedMotion ? false : { scale: 0.95, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ opacity: reducedMotion ? 1 : 0 }}
            transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 350, damping: 24 }}
            className="relative w-full min-w-0 max-w-2xl bg-white rounded-[28px] border-3 border-[#141414] shadow-[6px_8px_0px_#141414] p-5 sm:p-8 z-10 max-h-[90dvh] overflow-y-auto overscroll-contain"
          >
            <div className="flex items-start justify-between gap-3 pb-4 border-b-2 border-[#f1ece4] mb-5">
              <div className="flex items-center gap-2.5 min-w-0">
                <Key className="w-6 h-6 text-[#ff6a2b] shrink-0" aria-hidden="true" />
                <div>
                  <h2 id={titleId} className="font-extrabold text-xl text-[#141414]">Connexion et configuration</h2>
                  <p className="text-xs text-[#141414]/70 mt-1">Supabase et connexion Google réelle</p>
                </div>
              </div>
              <button type="button" data-autofocus onClick={onClose} disabled={isTesting}
                className={`${buttonClass} p-2! bg-[#f1ece4] shrink-0`} aria-label="Fermer la configuration">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-2xl bg-[#f1ece4]/60 p-3 text-xs space-y-1 mb-4">
              <p><strong>Configuration :</strong> {config.isConfigured ? 'format valide, disponibilité non vérifiée' : config.status === 'invalid' ? 'invalide' : 'absente'}.</p>
              <p><strong>Source :</strong> {sourceLabel}.</p>
              <p><strong>Session :</strong> {sessionStatus === 'loading' ? 'vérification en cours…' : sessionStatus === 'error' ? 'vérification en erreur' : user ? 'compte vérifié auprès de Supabase Auth' : 'aucun compte connecté'}.</p>
              {roleError && <p>Le rôle du profil n’a pas pu être vérifié. Réessayez depuis votre espace.</p>}
            </div>
            {config.storageWarning && <p role="status" className="mb-4 text-xs text-[#141414] bg-[#ffd23f]/20 p-3 rounded-xl">{config.storageWarning}</p>}
            {activeError && (
              <div role="alert" className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs break-words">
                <p className="font-bold flex gap-2 items-start"><AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />{activeError}</p>
                {signupDisabled && <p className="mt-2">Vérifiez la politique d’inscription dans Supabase. Ne l’assouplissez que si cela correspond au produit et que vous avez l’autorisation adaptée.</p>}
              </div>
            )}
            {notice && <p role="status" className="mb-4 text-xs bg-green-50 text-green-900 border border-green-200 rounded-xl p-3">{notice}</p>}

            {isInIframe && (
              <div className="mb-5 p-3 rounded-xl bg-[#ff6a2b]/10 text-xs space-y-2">
                <p>Google et le stockage de session peuvent bloquer la connexion dans un cadre intégré. Démarrez et terminez OAuth dans le même onglet dédié.</p>
                <a href={`${currentOrigin}${window.location.pathname}`} target="_blank" rel="noopener noreferrer"
                  className={`${buttonClass} inline-flex items-center gap-2 bg-[#ff6a2b] text-white`}>
                  Ouvrir l’application dans un onglet <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              </div>
            )}

            <form onSubmit={handleSaveConfig} className="p-4 rounded-2xl bg-[#ffd23f]/10 border-2 border-[#ffd23f] space-y-3">
              <h3 className="text-sm font-extrabold">Paire Supabase publique</h3>
              <p className="text-xs text-[#141414]/75">La paire locale remplace entièrement celle de l’environnement. Elle n’est jamais complétée avec une clé d’une autre source.</p>
              <div>
                <label htmlFor={urlId} className="block text-xs font-bold mb-1">URL du projet</label>
                <input id={urlId} type="url" value={url} required disabled={isTesting} spellCheck={false} autoComplete="off"
                  placeholder="https://votre-projet.supabase.co" onChange={(event) => { setUrl(event.target.value); setNotice(null); }}
                  className="w-full min-w-0 text-xs font-mono px-3 py-2 rounded-xl bg-white border border-[#141414]/30 focus-visible:outline-2 focus-visible:outline-[#4a6cf0]" />
              </div>
              <div>
                <label htmlFor={keyId} className="block text-xs font-bold mb-1">Clé publique publishable ou anon</label>
                <input id={keyId} type="password" value={key} required disabled={isTesting} spellCheck={false} autoComplete="off"
                  placeholder="Clé publique du projet" onChange={(event) => { setKey(event.target.value); setNotice(null); }}
                  className="w-full min-w-0 text-xs font-mono px-3 py-2 rounded-xl bg-white border border-[#141414]/30 focus-visible:outline-2 focus-visible:outline-[#4a6cf0]" />
              </div>
              <p className="text-xs text-[#141414]/75">Jamais de clé service_role, secret Supabase, clé privée Google ou Gemini ici. Les variables VITE_* sont publiques dans le navigateur.</p>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={isTesting} className={`${buttonClass} bg-[#141414] text-white`}>Enregistrer la paire</button>
                <button type="button" disabled={isTesting} onClick={handleReset} className={`${buttonClass} bg-white border border-[#141414]/25`}>Rétablir l’environnement</button>
              </div>
              <p className="text-xs text-[#141414]/70">Un changement de projet recharge la session et le rôle. Aucun rechargement de page ou compte de démonstration n’est nécessaire.</p>
            </form>

            <section className="mt-5 text-xs space-y-3">
              <h3 className="text-sm font-extrabold">Vérifications manuelles Google / Supabase</h3>
              <p>Dans Google Cloud, l’ID client OAuth doit être de type Web. L’URI de redirection est celle du projet enregistré ci-dessus :</p>
              {callbackUrl ? (
                <div className="flex items-start gap-2 p-3 bg-[#f1ece4]/60 rounded-xl">
                  <code className="break-all min-w-0 flex-1">{callbackUrl}</code>
                  <button type="button" disabled={isTesting} onClick={() => { void copyToClipboard(callbackUrl, 'callback'); }}
                    aria-label="Copier l’URI de redirection Google" className={`${buttonClass} p-1! shrink-0`}>
                    {copiedField === 'callback' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              ) : <p>Enregistrez une paire valide avant de calculer l’URI de redirection. Aucune référence de projet par défaut n’est utilisée.</p>}
              <p>Dans Supabase, vérifiez le provider Google et ses identifiants privés <strong>uniquement côté Supabase</strong>, puis les URL autorisées. Ajoutez cette redirection applicative :</p>
              <div className="flex items-start gap-2 p-3 bg-[#f1ece4]/60 rounded-xl">
                <code className="break-all min-w-0 flex-1">{currentOrigin}/dashboard</code>
                <button type="button" disabled={isTesting} onClick={() => { void copyToClipboard(`${currentOrigin}/dashboard`, 'redirect'); }}
                  aria-label="Copier l’URL de retour vers le dashboard" className={`${buttonClass} p-1! shrink-0`}>
                  {copiedField === 'redirect' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p aria-live="polite">{copiedField ? 'URL copiée dans le presse-papiers.' : 'Ces indications ne constituent pas une validation OAuth ou RLS du projet distant.'}</p>
              <a href={dashboardUrl} target="_blank" rel="noopener noreferrer" className="inline-flex gap-1.5 items-center font-bold text-[#4a6cf0] underline focus-visible:outline-2">
                Ouvrir le dashboard Supabase <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            </section>
            <div className="mt-5 pt-4 border-t-2 border-[#f1ece4] flex justify-end">
              <button type="button" onClick={() => { void handleGoogle(); }} disabled={isTesting || !config.isConfigured || isInIframe}
                className={`${buttonClass} bg-[#ff6a2b] text-white`}>
                {isTesting ? 'Démarrage de la connexion…' : 'Se connecter avec Google'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
