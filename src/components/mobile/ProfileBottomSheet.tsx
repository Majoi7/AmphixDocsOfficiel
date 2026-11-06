import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, LogOut, Shield, UserRound } from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../lib/errors';

interface ProfileBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onExplore: () => void;
}

export function ProfileBottomSheet({ isOpen, onClose, onExplore }: ProfileBottomSheetProps) {
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const handleSignOut = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsSigningOut(true);
    setError(null);
    try { await signOut(); navigate('/', { replace: true }); }
    catch (cause) { if (mountedRef.current) setError(errorMessage(cause, 'La déconnexion a échoué. Réessayez.')); }
    finally { busyRef.current = false; if (mountedRef.current) setIsSigningOut(false); }
  };
  const name = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Membre AmphixDocs';
  const avatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
  const buttonClass = 'flex min-h-12 w-full min-w-0 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:cursor-not-allowed disabled:opacity-50';

  return <BottomSheet isOpen={isOpen} onClose={onClose} title="Mon profil" canClose={!isSigningOut}>
    <div className="flex min-w-0 flex-col gap-4 pb-4">
      <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-[#141414]/10 bg-white/70 p-4">
        {avatar ? <img src={avatar} alt="" className="h-12 w-12 shrink-0 rounded-full border-2 border-[#ff6a2b] object-cover" /> : <UserRound aria-hidden="true" size={32} className="shrink-0 text-[#ff6a2b]" />}
        <div className="min-w-0 flex-1"><p className="truncate font-extrabold">{name}</p>{user?.email && <p className="truncate text-xs text-[#141414]/70">{user.email}</p>}<span className="mt-2 inline-flex rounded-full bg-[#ffd23f]/50 px-2 py-1 text-xs font-bold">{isAdmin ? 'Administrateur' : 'Membre'}</span></div>
      </div>
      {isAdmin && <button type="button" disabled={isSigningOut} onClick={() => navigate('/admin', { replace: true })} className={`${buttonClass} border-[#ffd23f] bg-[#ffd23f]/25 hover:bg-[#ffd23f]/40`}><Shield aria-hidden="true" size={22} className="shrink-0" />Console admin</button>}
      <button type="button" disabled={isSigningOut} onClick={onExplore} className={`${buttonClass} border-[#141414]/10 bg-white hover:bg-neutral-50`}><Compass aria-hidden="true" size={22} className="shrink-0" />Explorer les fichiers</button>
      <button type="button" disabled={isSigningOut} onClick={() => void handleSignOut()} className={`${buttonClass} border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100`}><LogOut aria-hidden="true" size={22} className="shrink-0" />{isSigningOut ? 'Déconnexion en cours…' : 'Se déconnecter'}</button>
      {isSigningOut && <p role="status" className="text-sm">La feuille se fermera après confirmation de la déconnexion.</p>}
      {error && <p role="alert" className="break-words text-sm text-red-800">{error}</p>}
    </div>
  </BottomSheet>;
}
