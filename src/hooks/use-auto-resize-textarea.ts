import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

export interface UseAutoResizeTextareaProps {
  minHeight: number;
  maxHeight?: number;
}

export function useAutoResizeTextarea({ minHeight, maxHeight }: UseAutoResizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const minimum = Number.isFinite(minHeight) && minHeight > 0 ? minHeight : 56;
  const maximum = typeof maxHeight === 'number' && Number.isFinite(maxHeight)
    ? Math.max(minimum, maxHeight)
    : Number.POSITIVE_INFINITY;

  const adjustHeight = useCallback((reset = false) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const previousScroll = textarea.scrollTop;
    textarea.style.minHeight = `${minimum}px`;
    textarea.style.maxHeight = Number.isFinite(maximum) ? `${maximum}px` : 'none';
    textarea.style.height = `${minimum}px`;
    textarea.style.overflowY = 'hidden';

    const borders = textarea.offsetHeight - textarea.clientHeight;
    const contentHeight = textarea.scrollHeight + borders;
    const height = reset ? minimum : Math.max(minimum, Math.min(contentHeight, maximum));
    textarea.style.height = `${height}px`;
    textarea.style.overflowY = contentHeight > height ? 'auto' : 'hidden';
    textarea.scrollTop = reset ? 0 : previousScroll;
  }, [minimum, maximum]);

  useLayoutEffect(() => {
    adjustHeight();
  }, [adjustHeight]);

  useEffect(() => {
    const onResize = () => adjustHeight();
    window.addEventListener('resize', onResize);

    // Un panneau peut changer de largeur sans redimensionner la fenêtre.
    let previousWidth: number | undefined;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined || width === previousWidth) return;
      previousWidth = width;
      adjustHeight();
    });
    if (textareaRef.current) observer?.observe(textareaRef.current);

    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, [adjustHeight]);

  return { textareaRef, adjustHeight };
}
