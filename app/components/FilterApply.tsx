'use client';
import { useEffect, useRef, useState } from 'react';
import { CHIP_NEUTRAL } from './chip.ts';

// Filtersidebar's Apply button, with a dirty check: disabled until something in the form
// (radios + the text input named `search.name`) differs from the current URL. Lives as the
// sticky <form> footer so a server component can render the rest of the sidebar.

export default function FilterApply({
  formId,
  applyLabel = 'Apply',
  clearHref,
}: {
  formId: string;
  applyLabel?: string;
  clearHref?: string;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    formRef.current = document.getElementById(formId) as HTMLFormElement | null;
    const compute = () => {
      const form = formRef.current;
      if (!form) return false;
      const url = new URLSearchParams(window.location.search);
      const elems = form.querySelectorAll<HTMLInputElement>('input[name]');
      for (const el of elems) {
        if (el.type === 'hidden') continue;
        // radio/checkbox: any input whose value/status differs from URL
        const urlVal = url.getAll(el.name);
        if (el.type === 'checkbox') {
          const isOn = (urlVal ?? []).includes(el.value);
          if (isOn !== el.checked) return true;
        } else if (el.type === 'radio') {
          if (el.checked) {
            if (!urlVal.includes(el.value)) return true;
          } else {
            if (urlVal.includes(el.value)) return true;
          }
        } else {
          // text/number: value differs
          if (el.value !== (url.get(el.name) ?? '')) return true;
        }
      }
      return false;
    };
    setDirty(compute());
    const handler = () => setDirty(compute());
    formRef.current?.addEventListener('change', handler);
    formRef.current?.addEventListener('input', handler);
    return () => {
      formRef.current?.removeEventListener('change', handler);
      formRef.current?.removeEventListener('input', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  return (
    <>
      <button
        type="submit"
        disabled={!dirty}
        className={`flex-1 ${CHIP_NEUTRAL}`}
      >
        {applyLabel}
      </button>
      {clearHref && (
        <a href={clearHref} className={CHIP_NEUTRAL}>
          Clear
        </a>
      )}
    </>
  );
}
