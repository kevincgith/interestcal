// Currency as on the Interest tab: HK$ / US$ / Others, where Others opens a box for any symbol or code. Used by the
// PV tab's cash flows and calculator. The control's .value is 'HKD', 'USD' or what was typed under Others; a code from
// an older link (GBP, EUR...) opens as Others with its symbol filled in.
import { $ } from './shared.js?v=__BUILD__';
import { CURRENCIES } from './interest-text.js?v=__BUILD__';

/**
 * @param {string} id     the .seg with radios HKD / USD / other
 * @param {string} boxId  the Others text box (inside the same .seg-stack)
 * @param {() => void} onChange  the symbol changed
 * @returns {{ symbol: () => string }}  the symbol to show: HK$, US$ or what was typed ('' when nothing yet)
 */
export function currencyControl(id, boxId, onChange = () => {}) {
  const seg = $(id);
  const box = $(boxId);
  const checked = () => seg.querySelector('input:checked').value;
  const show = () => {
    box.hidden = checked() !== 'other';
  };
  Object.defineProperty(seg, 'value', {
    get: () => (checked() === 'other' ? box.value.trim() : checked()),
    set: (v) => {
      const direct = seg.querySelector(`input[value="${v}"]`);
      if (direct && v !== 'other') direct.checked = true;
      else {
        seg.querySelector('input[value="other"]').checked = true;
        box.value = CURRENCIES[v] ?? v;
      }
      show();
    },
  });
  seg.addEventListener('change', (e) => {
    if (e.target === box) return; // typing is handled on input
    show();
    if (checked() === 'other') box.focus(); // type a symbol right away
    onChange();
  });
  box.addEventListener('input', onChange);
  seg.closest('form')?.addEventListener('reset', () => setTimeout(() => { show(); onChange(); }));
  show();
  return { symbol: () => CURRENCIES[seg.value] ?? seg.value };
}
