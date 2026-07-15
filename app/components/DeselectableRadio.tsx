'use client';

import type { ComponentProps } from 'react';

// Native radio groups can't be unselected once something is picked. This one can: clicking
// the already-checked option clears it, so a /resolve row can go back to "no choice" (the
// form simply submits nothing for that row, which the action treats as skip). Tracks
// was-checked state via a data attribute because by the time click fires, the browser has
// already set checked=true — the pre-click state is what decides toggle-off.
export default function DeselectableRadio(props: ComponentProps<'input'>) {
  return (
    <input
      type="radio"
      {...props}
      onClick={(e) => {
        const el = e.currentTarget;
        if (el.dataset.wasChecked === 'true') {
          el.checked = false;
          el.dataset.wasChecked = 'false';
        } else {
          document
            .querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(el.name ?? '')}"]`)
            .forEach((s) => {
              s.dataset.wasChecked = 'false';
            });
          el.dataset.wasChecked = 'true';
        }
      }}
    />
  );
}
