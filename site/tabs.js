// Interest / Mortgage / PV / Inflation tabs. Each tab keeps its own shareable link (?...); the other tabs' links
// carry tab=mortgage, tab=pv and tab=inflation.

const TABS = ['interest', 'mortgage', 'pv', 'inflation'];
const $rates = document.getElementById('headerRates');
const queries = {};
const asked = new URLSearchParams(location.search).get('tab');
let current = TABS.includes(asked) ? asked : 'interest';

export const activeTab = () => current;

/** A tab reports its current link (e.g. "?src=prime&p=..."), used when switching back to it */
export function registerQuery(name, fn) {
  queries[name] = fn;
}

function show(name) {
  current = name;
  $rates.dataset.tab = name; // the header shows only the rates this tab uses (style.css)
  for (const t of TABS) {
    const selected = t === name;
    document.getElementById(`tab-${t}`).setAttribute('aria-selected', String(selected));
    document.getElementById(`tab-${t}`).tabIndex = selected ? 0 : -1;
    document.getElementById(`panel-${t}`).hidden = !selected;
  }
}

function select(name) {
  show(name);
  const q = queries[name]?.() || (name === 'interest' ? '' : `?tab=${name}`);
  history.replaceState(null, '', `${location.pathname}${q}`);
}

for (const t of TABS) {
  const btn = document.getElementById(`tab-${t}`);
  btn.addEventListener('click', () => select(t));
  // Arrow keys move between tabs (standard tab keyboard behaviour)
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = TABS[(TABS.indexOf(t) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    select(next);
    document.getElementById(`tab-${next}`).focus();
  });
}
show(current);

// The header's rates differ by tab (3 lines on Interest, none on PV...), so the area keeps the height of the
// tallest tab's rates at the current width: switching tabs never moves the tabs. Measured on an invisible copy
// set to each tab in turn, again whenever the rates load or change and when the width changes.
// Several changes at once (e.g. all the rates arriving) are measured once, straight after them and before the next
// paint (a microtask, not requestAnimationFrame, which stops while the page isn't visible).
let pending = false;
function steadyHeader() {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    const copy = $rates.cloneNode(true);
    copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    copy.removeAttribute('id');
    Object.assign(copy.style, { position: 'absolute', visibility: 'hidden', left: '0', top: '0', width: `${$rates.clientWidth}px`, minHeight: '0' });
    copy.setAttribute('aria-hidden', 'true');
    $rates.parentElement.append(copy);
    const tallest = Math.max(...TABS.map((t) => {
      copy.dataset.tab = t;
      return copy.getBoundingClientRect().height; // fractional: whole pixels would still leave a 1px jump
    }));
    copy.remove();
    $rates.style.minHeight = `${tallest}px`;
  });
}
new MutationObserver(steadyHeader).observe($rates, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
new ResizeObserver(steadyHeader).observe($rates.parentElement);
steadyHeader();
