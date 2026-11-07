import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertCircle, ExternalLink, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { userError } from '../lib/errors';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';
import { useDialogViewport } from '../hooks/useDialogViewport';

interface SupabaseConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Le nom est conservé pour compatibilité avec les appels existants. La
// configuration se fait hors interface, dans l’environnement de déploiement.
export function SupabaseConfigModal({ isOpen, onClose }: SupabaseConfigModalProps) {
  const { user, isConfigured, signInWithGoogle, lastAuthError, setLastAuthError } = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const reducedMotion = useReducedMotion();
  const embedded = typeof window !== 'undefined' && window.self !== window.top;
  useDialogAccessibility(dialogRef, isOpen, onClose, !busy);
  useDialogViewport(viewportRef, isOpen);
  useEffect(() => { if (isOpen) setActionError(null); }, [isOpen]);

  const connect = async () => {
    setBusy(true);
    setActionError(null);
    setLastAuthError(null);
    try { await signInWithGoogle(); }
    catch (cause) { setActionError(userError(cause, 'La connexion n’a pas pu démarrer. Réessayez.')); }
    finally { setBusy(false); }
  };
  const buttonClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b] disabled:opacity-50';

  return <AnimatePresence>{isOpen && <div ref={viewportRef}
    className="fixed inset-x-0 z-50 flex min-w-0 items-center justify-center p-4"
    style={{ top: 'var(--dialog-viewport-top, 0px)', height: 'var(--dialog-viewport-height, 100dvh)' }}>
    <motion.div aria-hidden="true" onClick={() => { if (!busy) onClose(); }}
      initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.15 }}
      className="absolute inset-0 bg-[#141414]/55 backdrop-blur-xs" />
    <motion.div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
      initial={reducedMotion ? false : { scale: 0.96, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ opacity: reducedMotion ? 1 : 0 }}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 350, damping: 26 }}
      className="relative z-10 w-full min-w-0 max-w-md overflow-y-auto overscroll-contain rounded-[28px] bg-[#f1ece4] p-5 text-[#141414] shadow-xl"
      style={{ maxHeight: 'calc(var(--dialog-viewport-height, 100dvh) - 32px)' }}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-xl font-extrabold">Votre connexion</h2>
        <button type="button" data-autofocus disabled={busy} onClick={onClose}
          aria-label="Fermer l’aide de connexion" className={`${buttonClass} shrink-0 bg-white/60 px-2`}><X size={20} aria-hidden="true" /></button>
      </header>
      <p className="text-sm">{user ? 'Vous êtes connecté·e. Vous pouvez revenir à vos fichiers.' : 'Connectez-vous avec Google pour retrouver et partager vos fichiers.'}</p>
      {!isConfigured && <p role="alert" className="mt-4 text-sm text-[#b0245e]">Le service est momentanément indisponible. Réessayez plus tard.</p>}
      {(actionError || lastAuthError) && <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-[#b0245e]"><AlertCircle size={18} aria-hidden="true" className="shrink-0" />{actionError || 'La connexion a échoué. Réessayez.'}</p>}
      {embedded && <a href={`${window.location.origin}${window.location.pathname}`} target="_blank" rel="noopener noreferrer"
        className={`${buttonClass} mt-4 bg-white`}>Ouvrir dans un onglet<ExternalLink size={16} aria-hidden="true" /></a>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" disabled={busy} onClick={onClose} className={`${buttonClass} bg-white/60`}>Fermer</button>
        {!user && <button type="button" disabled={busy || !isConfigured || embedded} onClick={() => { void connect(); }}
          className={`${buttonClass} bg-[#ff6a2b]`}>{busy ? 'Connexion en cours…' : 'Se connecter avec Google'}</button>}
      </div>
    </motion.div>
  </div>}</AnimatePresence>;
}
