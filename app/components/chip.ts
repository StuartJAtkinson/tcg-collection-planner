// The one canonical pill — every chip, button, tab, action, anything-shaped-like-a-pill on every
// page references one of these six constants. Never concatenate utility classes onto them at the
// call site. If a real new variant is needed, add it here.
export const CHIP_NEUTRAL = 'flex items-center justify-between gap-1 cursor-pointer whitespace-nowrap rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:border-neutral-500';
export const CHIP_PLUS    = 'flex items-center justify-between gap-1 cursor-pointer whitespace-nowrap rounded-full border border-emerald-500 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300';
export const CHIP_MINUS   = 'flex items-center justify-between gap-1 cursor-pointer whitespace-nowrap rounded-full border border-rose-500 bg-rose-500/10 px-3 py-1 text-xs text-rose-300';
export const BTN_PRIMARY   = 'cursor-pointer rounded-full border border-emerald-600 bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500';
export const BTN_SECONDARY = 'cursor-pointer rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:border-neutral-500';
export const BTN_DANGER    = 'cursor-pointer rounded-full border border-red-900/60 bg-red-900/60 px-3 py-1 text-xs text-red-200 hover:border-red-700 hover:bg-red-800/70';
