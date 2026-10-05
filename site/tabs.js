// Interest / Mortgage / PV / Inflation tabs. Each tab keeps its own shareable link (?...); the other tabs' links
// carry tab=mortgage, tab=pv and tab=inflation.

const TABS = ['interest', 'mortgage', 'pv', 'inflation'];
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
