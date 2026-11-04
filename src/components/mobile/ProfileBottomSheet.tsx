import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomSheet } from './BottomSheet';
import { useAuth } from '../../context/AuthContext';
import { Shield, LogOut, FileText, CheckCircle2 } from 'lucide-react';

interface ProfileBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileBottomSheet: React.FC<ProfileBottomSheetProps> = ({
  isOpen,
  onClose,
}) => {
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  const handleAdminClick = () => {
    onClose();
    navigate('/admin');
  };

  const handleSignOut = async () => {
    onClose();
    await signOut();
    navigate('/');
  };

  const userEmail = user?.email || 'utilisateur@amphix.site';
  const userName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    userEmail.split('@')[0] ||
    'Membre AmphixDocs';
  const userAvatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Mon Profil">
      <div className="flex flex-col gap-5 pt-2 pb-6">
        {/* Identité utilisateur */}
        <div className="flex items-center gap-4 bg-white/70 p-4 rounded-2xl border border-[#141414]/10 shadow-xs">
          {userAvatar ? (
            <img
              src={userAvatar}
              alt={userName}
              className="w-14 h-14 rounded-full object-cover border-2 border-[#ff6a2b] shadow-xs"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-[#ff6a2b] text-white flex items-center justify-center text-xl font-extrabold shadow-xs">
              {userName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h4 className="text-base font-extrabold text-[#141414] truncate">{userName}</h4>
            <p className="text-xs text-[#141414]/65 truncate font-mono">{userEmail}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                isAdmin
                  ? 'bg-[#ffd23f] text-[#141414]'
                  : 'bg-emerald-100 text-emerald-800'
              }`}>
                {isAdmin ? <Shield className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                {isAdmin ? 'Administrateur' : 'Membre vérifié'}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2.5">
          {isAdmin && (
            <button
              type="button"
              onClick={handleAdminClick}
              className="w-full flex items-center justify-between p-4 rounded-2xl bg-[#ffd23f]/25 hover:bg-[#ffd23f]/40 border-2 border-[#ffd23f] text-[#141414] font-bold text-sm transition-all active:scale-98 cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#ffd23f] flex items-center justify-center text-[#141414] shadow-xs">
                  <Shield className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <p className="font-extrabold">Console Admin</p>
                  <p className="text-xs text-[#141414]/70">Modérer les documents & utilisateurs</p>
                </div>
              </div>
              <span className="text-xs font-black uppercase tracking-wider text-[#ff6a2b]">Accéder →</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onClose();
              navigate('/dashboard');
            }}
            className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-white hover:bg-neutral-50 border border-[#141414]/10 text-[#141414] font-bold text-sm transition-all active:scale-98 cursor-pointer"
          >
            <div className="w-9 h-9 rounded-xl bg-[#4a6cf0]/15 text-[#4a6cf0] flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
            <span>Tous mes documents</span>
          </button>

          <button
            type="button"
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 font-bold text-sm transition-all active:scale-98 cursor-pointer"
          >
            <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
              <LogOut className="w-5 h-5" />
            </div>
            <span>Se déconnecter</span>
          </button>
        </div>
      </div>
    </BottomSheet>
  );
};
