'use client';

import { useRef, type ReactNode } from 'react';

// Wraps card art in the .foil holographic layer and feeds pointer position to the CSS
// specular highlight via --mx/--my. When `foil` is false it renders a plain container, so the
// effect is entirely opt-in per card (only cards owned in a foil finish light up).
export default function FoilCard({ foil, className, children }: { foil: boolean; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  if (!foil) return <div className={className}>{children}</div>;
  return (
    <div
      ref={ref}
      className={`foil ${className ?? ''}`}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
        el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
      }}
    >
      {children}
    </div>
  );
}
