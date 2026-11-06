import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { Compass, Home, Plus, Search, UserRound } from 'lucide-react';
import { NavItem } from './NavItem';
import { ProfileBottomSheet } from './ProfileBottomSheet';
import { useAuth } from '../../context/AuthContext';
import { useScrollDirection } from '../../hooks/useScrollDirection';

export type DashboardView = 'home' | 'search' | 'explore';
interface MobileNavProps {
  onOpenUpload: () => void;
  activeView?: DashboardView;
  onHome?: () => void;
  onFocusSearch?: () => void;
  onSelectExplorer?: () => void;
  isModalOpen?: boolean;
}

export function MobileNav({ onOpenUpload, activeView, onHome, onFocusSearch, onSelectExplorer, isModalOpen = false }: MobileNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const reducedMotion = useReducedMotion();
  const { isScrollingDown, isKeyboardOpen } = useScrollDirection();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const eligible = location.pathname === '/dashboard' || location.pathname === '/admin';
  if (!eligible) return null;

  const select = (view: DashboardView) => {
    const callback = view === 'home' ? onHome : view === 'search' ? onFocusSearch : onSelectExplorer;
    if (callback) callback();
    else navigate('/dashboard', { state: { dashboardView: view } });
  };
  const shouldHide = isScrollingDown || isKeyboardOpen || isModalOpen || isProfileOpen;
  const selected = location.pathname === '/dashboard' ? activeView ?? 'home' : undefined;
  const avatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;

  return <>
    {/* Garder les déclencheurs montés permet de restaurer le focus après une feuille. */}
    <motion.nav aria-label="Navigation principale mobile" aria-hidden={shouldHide} inert={shouldHide}
      initial={false} animate={{ y: shouldHide ? '140%' : 0, opacity: shouldHide ? 0 : 1 }}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', damping: 26, stiffness: 320 }}
      className={`fixed right-4 bottom-[max(16px,env(safe-area-inset-bottom,16px))] left-4 z-40 mx-auto grid max-w-[420px] grid-cols-5 items-center rounded-full border border-white/10 bg-[#141414]/95 px-1.5 py-1.5 text-[#f1ece4] shadow-2xl backdrop-blur-md md:hidden ${shouldHide ? 'pointer-events-none' : ''}`}>
      <NavItem id="home" label="Accueil" icon={<Home aria-hidden="true" size={20} />} isActive={selected === 'home'} onClick={() => select('home')} />
      <NavItem id="search" label="Recherche" icon={<Search aria-hidden="true" size={20} />} isActive={selected === 'search'} onClick={() => select('search')} />
      <NavItem id="upload" label="Déposer" icon={<Plus aria-hidden="true" size={26} strokeWidth={3} />} isActive={false} onClick={onOpenUpload} isCenterPlus />
      <NavItem id="explore" label="Explorer" icon={<Compass aria-hidden="true" size={20} />} isActive={selected === 'explore'} onClick={() => select('explore')} />
      <NavItem id="profile" label="Profil" icon={avatar ? <img src={avatar} alt="" className="h-5 w-5 rounded-full border border-white/40 object-cover" /> : <UserRound aria-hidden="true" size={20} />} isActive={isProfileOpen} onClick={() => setIsProfileOpen(true)} />
    </motion.nav>
    <ProfileBottomSheet isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} onExplore={() => select('explore')} />
  </>;
}
