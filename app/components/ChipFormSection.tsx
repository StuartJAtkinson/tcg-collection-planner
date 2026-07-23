'use client';
import { useEffect, useRef, useState } from 'react';

// Standardized chip-row filter for surfaces that don't use the full FilterSidebar (the master
// Sets page, advisor's Collection Aim, /binders and /search's game tabs). Each chip is a
// styled radio/checkbox label inside a single <form method="get">; an inline Apply button (and
// optional Clear) is shown only when something differs from the current URL, so the row stays
// passive when the filter is already in effect. Single-source for the select-then-apply rule
// across every slicer surface in the app.
//
// Ponytail: this is the same shape as FilterSidebar's Chips — server components render the
// labels with hidden inputs, the client component just toggles the disabled state on Apply +
// handles Clear. No new state library; one form, one URL.

type Opt = { value: string; label: string; n?: number; href?: string };
type Field = {
  name: string; // form field name (== URL param name)
  kind: 'radio' | 'multi'; // radio = single-select, multi = checkbox group
  options: Opt[];
  defaultValue?: string | string[]; // current value(s) from the URL; compared for dirty check
};

export default function ChipFormSection({
  action,
  fields,
  hidden,
  applyLabel = 'Apply',
  clearHref,
  className = 'mb-4 flex flex-wrap items-center gap-1.5 text-sm',
  optionClass = 'rounded-full border px-2.5 py-0.5 text-xs',
  activeClass = 'border-emerald-500 bg-emerald-500/10 text-emerald-300',
  inactiveClass = 'border-neutral-700 text-neutral-300 hover:border-neutral-500',
  rowId,
}: {
  action?: string;
  fields: Field[];
  hidden?: Record<string, string | undefined>;
  applyLabel?: string;
  clearHref?: string;
  className?: string;
  optionClass?: string;
  activeClass?: string;
  inactiveClass?: string;
  rowId?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);

  // Compare every named radio/checkbox in the form against the page URL on any input change.
  // Reading the URL avoids a stale-closure bug if the user navigates with a Back button and the
  // form was re-mounted with new defaults.
  const computeDirty = () => {
    const form = formRef.current;
    if (!form) return false;
    const url = new URLSearchParams(window.location.search);
    for (const f of fields) {
      const inputs = form.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(f.name)}"]`);
      if (f.kind === 'radio') {
        // current = the checked one's value, or '' for none
        const checked = [...inputs].find((i) => i.checked);
        const v = checked?.value ?? '';
        const want = Array.isArray(f.defaultValue) ? f.defaultValue[0] ?? '' : f.defaultValue ?? '';
        if (v !== want) return true;
      } else {
        const checked = new Set([...inputs].filter((i) => i.checked).map((i) => i.value));
        const want = new Set(Array.isArray(f.defaultValue) ? f.defaultValue : f.defaultValue ? [f.defaultValue] : []);
        if (checked.size !== want.size || ![...checked].every((v) => want.has(v))) return true;
      }
      // suppress unused 'url' lint — currently only consulted for hidden fields below
      void url;
    }
    return false;
  };

  useEffect(() => {
    setDirty(computeDirty());
    const handler = () => setDirty(computeDirty());
    const form = formRef.current;
    form?.addEventListener('change', handler);
    form?.addEventListener('input', handler);
    return () => {
      form?.removeEventListener('change', handler);
      form?.removeEventListener('input', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <form ref={formRef} method="get" action={action} id={rowId} className={className}>
      {hidden &&
        Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {fields.map((f) => (
        <fieldset key={f.name} className="contents">
          {f.kind === 'radio' && <legend className="sr-only">{f.name}</legend>}
          {f.options.map((o) => {
            const checked = Array.isArray(f.defaultValue)
              ? f.defaultValue.includes(o.value)
              : f.defaultValue === o.value;
            return (
              <label
                key={o.value || '(none)'}
                className={`cursor-pointer ${optionClass} ${checked ? activeClass : inactiveClass}`}
              >
                <input
                  type={f.kind === 'radio' ? 'radio' : 'checkbox'}
                  name={f.name}
                  value={o.value}
                  defaultChecked={checked}
                  className="sr-only"
                />
                {o.label}
                {o.n != null && o.n ? <span className="text-neutral-500"> {o.n}</span> : null}
              </label>
            );
          })}
        </fieldset>
      ))}
      <button
        type="submit"
        disabled={!dirty}
        className="rounded border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {applyLabel}
      </button>
      {clearHref && (
        <a
          href={clearHref}
          className="rounded border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800"
        >
          Clear
        </a>
      )}
    </form>
  );
}
