import { useCallback, useEffect, useRef, useState } from 'react';

export function SidebarResizeHandle({ side, width, min, max, defaultWidth, onChange, onCommit }: {
  side: 'sessions' | 'files'; width: number; min: number; max: number; defaultWidth: number;
  onChange: (width: number) => void; onCommit: () => void;
}) {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const direction = side === 'sessions' ? 1 : -1;
  const clamp = (value: number) => Math.max(min, Math.min(max, Math.round(value)));
  const finish = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    onCommit();
  }, [onCommit]);
  useEffect(() => {
    window.addEventListener('blur', finish);
    return () => window.removeEventListener('blur', finish);
  }, [finish]);
  useEffect(() => () => { if (drag.current) onCommit(); }, [onCommit]);
  return <div role="separator" tabIndex={0} aria-label={`Resize ${side} sidebar`} aria-orientation="vertical"
    aria-controls={side === 'sessions' ? 'session-sidebar' : 'session-files'}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} aria-valuetext={`${width} pixels`}
    title="Drag to resize · Double-click to reset" className="sidebar-resize-handle" data-dragging={dragging}
    onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, x: event.clientX, width };
      setDragging(true);
    }}
    onPointerMove={(event) => {
      if (drag.current?.pointerId === event.pointerId) {
        onChange(clamp(drag.current.width + direction * (event.clientX - drag.current.x)));
      }
    }}
    onPointerUp={(event) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      finish();
      event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={() => { onChange(clamp(defaultWidth)); onCommit(); }}
    onKeyDown={(event) => {
      const delta = event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0;
      if (!delta && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      onChange(event.key === 'Home' ? min : event.key === 'End' ? max : clamp(width + direction * delta));
      onCommit();
    }} />;
}
