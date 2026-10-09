import { useEffect, useRef } from 'react';

export function isOutsideSurface(event, surface) {
  if (!surface) return false;
  if (surface.tagName === 'DIALOG') {
    if (!surface.open) return false;
    // Native dialog backdrops target the dialog itself, including its padding.
    if (event.target === surface) {
      const bounds = surface.getBoundingClientRect();
      return event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom;
    }
  }
  return !(event.composedPath?.().includes(surface) || surface.contains(event.target));
}

export function useOutsideDismiss(surfaceRef, onDismiss, enabled = true) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    if (!enabled) return;
    const ownerDocument = surfaceRef.current?.ownerDocument ?? document;
    const outside = event => {
      if (event.button === 0 && isOutsideSurface(event, surfaceRef.current)) dismissRef.current();
    };
    // Capture catches outside clicks even when map controls stop propagation.
    // Starting inside never dismisses a panel while selecting text or dragging.
    ownerDocument.addEventListener('pointerdown', outside, true);
    return () => ownerDocument.removeEventListener('pointerdown', outside, true);
  }, [surfaceRef, enabled]);
}
