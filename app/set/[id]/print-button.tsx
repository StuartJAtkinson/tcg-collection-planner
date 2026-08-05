'use client';
import { BTN_SECONDARY } from '../../components/chip.ts';

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className={BTN_SECONDARY}
    >
      Print
    </button>
  );
}
