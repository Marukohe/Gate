import { useRef, useCallback } from 'react';

interface SwipeHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
}

const MIN_DISTANCE = 80; // px — minimum horizontal distance to count as a swipe
const MAX_RATIO = 0.6;   // max |deltaY/deltaX| — keep swipe mostly horizontal

/** Walk up from target to find a horizontally scrollable ancestor. */
function hasScrollableAncestor(el: HTMLElement | null): boolean {
  while (el) {
    if (el.scrollWidth > el.clientWidth) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Detects horizontal swipe gestures on a touch-enabled element.
 * Returns touch handlers to spread onto the target element.
 * Ignores swipes that start inside a horizontally scrollable container (e.g. code blocks).
 */
export function useSwipe(
  onSwipeLeft: () => void,
  onSwipeRight: () => void,
): SwipeHandlers {
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // Don't capture swipe if touch started inside a scrollable element (code blocks, tables)
    if (hasScrollableAncestor(e.target as HTMLElement)) {
      startRef.current = null;
      return;
    }
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY };
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!startRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - startRef.current.x;
    const dy = t.clientY - startRef.current.y;
    startRef.current = null;

    if (Math.abs(dx) < MIN_DISTANCE) return;
    if (Math.abs(dy) / Math.abs(dx) > MAX_RATIO) return; // too vertical

    if (dx < 0) onSwipeLeft();
    else onSwipeRight();
  }, [onSwipeLeft, onSwipeRight]);

  return { onTouchStart, onTouchEnd };
}
