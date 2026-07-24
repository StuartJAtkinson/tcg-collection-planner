'use client';
import { useEffect, useRef, useState } from 'react';

// Standardized chip-row filter for surfaces that don't use the full FilterSidebar (the master
// Sets page, advisor's Collection Aim, /binders and /search's game tabs). Each chip is a
// styled label wrapping an sr-only checkbox/radio, and the FORM submits a single hidden input
// per field carrying the joined/delimited value of the current selection. Apply is disabled
// while the form's values match the current URL, so picking or unchecking a chip flips it
// back to enabled. Plain GET <form> — no client router calls, the browser navigates on submit.
//
// Ponytail: the URL convention here is that multi-select fields are comma-separated in a
// single param (e.g. ?kind=A,B,C or ?kind=none for empty). That means plain checkboxes that
// each submit their own param value don't match — the page side reads ONE value per field.
// So we keep the live state in client JS, write the joined value into a single hidden input
// on every change, and let the form submit that single string. No new state library, no global
// store; one useState per multi field.

type Opt = { value: string; label: string; n?: number };
type Field = {
  name: string;
  kind: 'radio' | 'multi';
  options: Opt[];
  // Single-select radios use this to render `checked` server-side. Multi-select fields use
  // initialValue[]. Either way it's read-only on the server; runtime state lives in `sel`.
  defaultValue?: string | string[];
  // Multi-select: sentinel value for "nothing checked" so the server can distinguish "user
  // toggled all off" from "user never visited this field". Defaults to 'none' if absent.
  uncheckedValue?: string;
  // Multi-select: separator for joining values; defaults to ','.
  joiner?: string;
};

// Convert a multi-select state into the single string posted in the hidden field.
const joinMulti = (vals: Set<string>, joiner: string, sentinel: string) =>
  vals.size === 0 ? sentinel : [...vals].sort().join(joiner);

// Convert the page-supplied defaultValue into the runtime Set used by client state.
const initSet = (v: Field['defaultValue']): Set<string> =>
  new Set(Array.isArray(v) ? v : v ? [v] : []);

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
  // Foreign-to-the-form hidden params (e.g. `game` from /search). NEVER use a key that
  // matches `fields[].name` — collision with the per-field hidden below would cause the form
  // to post duplicate params and the page would never appear to change.
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
  const [sel, setSel] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, initSet(f.defaultValue)])),
  );
  const [dirty, setDirty] = useState(false);

  // Compute whether the form's current values differ from the URL. Reading fresh from window
  // each computation instead of capturing at mount — Back/Forward navigation can change the
  // URL without the component re-mounting.
  const computeDirty = () => {
    const form = formRef.current;
    if (!form) return false;
    const url = new URLSearchParams(window.location.search);
    for (const f of fields) {
      const inputs = form.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(f.name)}"]`);
      if (f.kind === 'radio') {
        const checked = [...inputs].find((i) => i.checked);
        const v = checked?.value ?? '';
        const want = url.get(f.name) ?? '';
        if (v !== want) return true;
      } else {
        // Multi: the actual posted value is the hidden `sel[name]` (joined string OR sentinel).
        const want = url.get(f.name) ?? '';
        const got = joinMulti(sel[f.name] ?? new Set(), f.joiner ?? ',', f.uncheckedValue ?? 'none');
        if (got !== want) return true;
      }
    }
    return false;
  };

  useEffect(() => {
    setDirty(computeDirty());
    // Also re-check after a browser navigation settles (Back button etc.)
    const onPop = () => setDirty(computeDirty());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const toggleMulti = (name: string, value: string) =>
    setSel((prev) => {
      const next = new Set(prev[name]);
      next.has(value) ? next.delete(value) : next.add(value);
      return { ...prev, [name]: next };
    });

  const setRadio = (name: string, value: string) =>
    setSel((prev) => ({ ...prev, [name]: new Set([value]) }));

  return (
    <form ref={formRef} method="get" action={action} id={rowId} className={className}>
      {hidden && Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {fields.map((f) => {
        const cur = sel[f.name] ?? new Set();
        if (f.kind === 'radio') {
          // Radio state: a single hidden mirrors the checked option's value. Default empty
          // value means "field has no current choice", which the page can map to a default.
          const v = [...cur][0] ?? '';
          return (
            <fieldset key={f.name} className="contents">
              <legend className="sr-only">{f.name}</legend>
              {/* Hidden carries the URL-friendly single string the page expects. */}
              <input type="hidden" name={f.name} value={v} />
              {f.options.map((o) => {
                const on = cur.has(o.value);
                return (
                  <label
                    key={o.value || '(none)'}
                    className={`cursor-pointer ${optionClass} ${on ? activeClass : inactiveClass}`}
                  >
                    <input
                      type="radio"
                      name={`_${f.name}_ui`} // separate namespace so the hidden is THE submitter
                      value={o.value}
                      checked={on}
                      onChange={() => setRadio(f.name, o.value)}
                      className="sr-only"
                    />
                    {o.label}
                    {o.n != null && o.n ? <span className="text-neutral-500"> {o.n}</span> : null}
                  </label>
                );
              })}
            </fieldset>
          );
        }
        // Multi: a single hidden carries the joined string OR the sentinel; each chip just
        // toggles the Set in client state. No duplicate-name submissions on the form.
        const joiner = f.joiner ?? ',';
        const sentinel = f.uncheckedValue ?? 'none';
        return (
          <fieldset key={f.name} className="contents">
            <legend className="sr-only">{f.name}</legend>
            <input type="hidden" name={f.name} value={joinMulti(cur, joiner, sentinel)} />
            {f.options.map((o) => {
              const on = cur.has(o.value);
              return (
                <label
                  key={o.value || '(none)'}
                  className={`cursor-pointer ${optionClass} ${on ? activeClass : inactiveClass}`}
                  onClick={(e) => {
                    // Toggle state on chip click so the hidden updates without waiting for the
                    // input's change handler — and so a click on the label text still works.
                    e.preventDefault();
                    toggleMulti(f.name, o.value);
                  }}
                >
                  <input
                    type="checkbox"
                    name={`_${f.name}_ui`}
                    value={o.value}
                    checked={on}
                    onChange={() => toggleMulti(f.name, o.value)}
                    className="sr-only"
                  />
                  {o.label}
                  {o.n != null && o.n ? <span className="text-neutral-500"> {o.n}</span> : null}
                </label>
              );
            })}
          </fieldset>
        );
      })}
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
