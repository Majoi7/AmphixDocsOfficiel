export interface ImageTransform { scale: number; x: number; y: number }
export interface ImagePoint { x: number; y: number }
export const INITIAL_IMAGE_TRANSFORM: ImageTransform = { scale: 1, x: 0, y: 0 };

export function boundImageTransform(value: ImageTransform, width: number, height: number): ImageTransform {
  const scale = Math.min(4, Math.max(1, Number.isFinite(value.scale) ? value.scale : 1));
  const bound = (offset: number, size: number) => {
    const maximum = Math.max(0, size * (scale - 1) / 2);
    return Math.min(maximum, Math.max(-maximum, Number.isFinite(offset) ? offset : 0));
  };
  return { scale, x: bound(value.x, width), y: bound(value.y, height) };
}

// L’ancre sous les doigts reste fixe pendant le pincement ; le centre peut aussi
// se déplacer. Coordonnées relatives au centre de la surface de lecture.
export function pinchImage(start: ImageTransform, anchor: ImagePoint, center: ImagePoint, factor: number, width: number, height: number): ImageTransform {
  const scale = Math.min(4, Math.max(1, start.scale * factor));
  const ratio = scale / start.scale;
  return boundImageTransform({ scale, x: center.x - (anchor.x - start.x) * ratio, y: center.y - (anchor.y - start.y) * ratio }, width, height);
}
