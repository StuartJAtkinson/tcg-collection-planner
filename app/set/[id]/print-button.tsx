'use client';

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print rounded border border-current px-3 py-1 text-sm opacity-70 hover:opacity-100"
    >
      Print
    </button>
  );
}
