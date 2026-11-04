import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Home, Search, Plus, Folder, User as UserIcon } from 'lucide-react';
import { NavItem } from './NavItem';
import { ProfileBottomSheet } from './ProfileBottomSheet';
import { useAuth } from '../../context/AuthContext';
import { useScrollDirection } from '../../hooks/useScrollDirection';

interface MobileNavProps {
  onOpenUpload: () => void;
  onFocusSearch?: () => void;
  onSelectFoldersTab?: () => void;
  isModalOpen?: boolean;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  onOpenUpload,
  onFocusSearch,
  onSelectFoldersTab,
  isModalOpen = false,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isScrollingDown, isKeyboardOpen } = useScrollDirection();
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);

  // Uniquement visible sur /dashboard et /admin
  const isEligibleRoute = location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/admin');
  if (!isEligibleRoute) {
    return null;
  }

  // Déterminer l'onglet actif
  let activeTab = 'home';
  if (location.pathname === '/dashboard') {
    if (location.hash === '#search') activeTab = 'search';
    else if (location.hash === '#folders') activeTab = 'folders';
    else activeTab = 'home';
  } else if (location.pathname.startsWith('/admin')) {
    activeTab = 'admin';
  }

  // Cacher la barre si le clavier est actif, si un modal est ouvert, ou lors d'un défilement vers le bas
  const shouldHide = isScrollingDown || isKeyboardOpen || isModalOpen;

  const handleHomeClick = () => {
    if (location.pathname !== '/dashboard') {
      navigate('/dashboard');
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSearchClick = () => {
    if (location.pathname !== '/dashboard') {
      navigate('/dashboard#search');
    }
    onFocusSearch?.();
  };

  const handleFoldersClick = () => {
    if (location.pathname !== '/dashboard') {
      navigate('/dashboard#folders');
    }
    onSelectFoldersTab?.();
  };

  const userAvatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;

  return (
    <>
      <AnimatePresence>
        {!shouldHide && (
          <motion.nav
            initial={{ y: '140%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '140%', opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            aria-label="Navigation principale mobile"
            className="md:hidden fixed z-40 left-4 right-4 mx-auto max-w-[420px] bottom-[max(16px,env(safe-area-inset-bottom,16px))] bg-[#141414]/95 text-[#f1ece4] rounded-full shadow-2xl backdrop-blur-md border border-white/10 px-2 py-1.5 flex items-center justify-around"
          >
            {/* 1. Accueil */}
            <NavItem
              id="home"
              label="Accueil"
              icon={<Home className="w-5 h-5" />}
              isActive={activeTab === 'home'}
              onClick={handleHomeClick}
            />

            {/* 2. Recherche */}
            <NavItem
              id="search"
              label="Chercher"
              icon={<Search className="w-5 h-5" />}
              isActive={activeTab === 'search'}
              onClick={handleSearchClick}
            />

            {/* 3. Déposer (Bouton central "+") */}
            <NavItem
              id="upload"
              label="Déposer un document"
              icon={<Plus className="w-7 h-7 stroke-[2.8]" />}
              isActive={false}
              onClick={onOpenUpload}
              isCenterPlus={true}
            />

            {/* 4. Dossiers */}
            <NavItem
              id="folders"
              label="Dossiers"
              icon={<Folder className="w-5 h-5" />}
              isActive={activeTab === 'folders'}
              onClick={handleFoldersClick}
            />

            {/* 5. Profil (Avatar ou Icône) */}
            <NavItem
              id="profile"
              label="Profil"
              icon={
                userAvatar ? (
                  <img
                    src={userAvatar}
                    alt="Mon profil"
                    className="w-6 h-6 rounded-full object-cover border border-white/40"
                  />
                ) : (
                  <UserIcon className="w-5 h-5" />
                )
              }
              isActive={isProfileOpen || activeTab === 'admin'}
              onClick={() => setIsProfileOpen(true)}
            />
          </motion.nav>
        )}
      </AnimatePresence>

      {/* Feuille de profil mobile */}
      <ProfileBottomSheet
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
      />
    </>
  );
};
