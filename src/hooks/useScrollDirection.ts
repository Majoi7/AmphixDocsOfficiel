import { useState, useEffect, useRef } from 'react';

/**
 * Hook pour détecter la direction du défilement et l'état d'ouverture du clavier virtuel mobile.
 */
export function useScrollDirection(threshold: number = 10) {
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down'>('up');
  const [isKeyboardOpen, setIsKeyboardOpen] = useState<boolean>(false);
  const lastScrollY = useRef<number>(0);
  const ticking = useRef<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateScrollDirection = () => {
      const scrollY = window.scrollY;

      // Si on est tout en haut de page, toujours afficher la barre
      if (scrollY < 20) {
        setScrollDirection('up');
        lastScrollY.current = scrollY > 0 ? scrollY : 0;
        ticking.current = false;
        return;
      }

      const diff = scrollY - lastScrollY.current;

      if (Math.abs(diff) >= threshold) {
        setScrollDirection(diff > 0 ? 'down' : 'up');
        lastScrollY.current = scrollY;
      }

      ticking.current = false;
    };

    const onScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(updateScrollDirection);
        ticking.current = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });

    // Détection du clavier virtuel mobile via Visual Viewport API
    const handleViewportResize = () => {
      if (window.visualViewport) {
        // Si la hauteur de la vue visuelle est nettement inférieure à la hauteur de la fenêtre, le clavier est ouvert
        const isKeyboard = window.visualViewport.height < window.innerHeight * 0.75;
        setIsKeyboardOpen(isKeyboard);
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportResize);
      window.visualViewport.addEventListener('scroll', handleViewportResize);
    }

    return () => {
      window.removeEventListener('scroll', onScroll);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportResize);
        window.visualViewport.removeEventListener('scroll', handleViewportResize);
      }
    };
  }, [threshold]);

  return {
    scrollDirection,
    isScrollingDown: scrollDirection === 'down',
    isKeyboardOpen,
  };
}
