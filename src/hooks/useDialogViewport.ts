import { useEffect, type RefObject } from 'react';

// Le viewport visuel rétrécit avec le clavier sur mobile, contrairement au
// viewport de mise en page de certains navigateurs. Le scroll reste interne.
export function useDialogViewport(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    const container = ref.current;
    if (!open || !container) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      container.style.setProperty('--dialog-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      container.style.setProperty('--dialog-viewport-top', `${viewport?.offsetTop ?? 0}px`);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && container.contains(active)) {
          active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        }
      });
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      container.style.removeProperty('--dialog-viewport-height');
      container.style.removeProperty('--dialog-viewport-top');
    };
  }, [open, ref]);
}
