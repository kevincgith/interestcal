// Saved and recent calculations: each is a calculation's shareable link plus a name, kept in this browser's
// localStorage only (never uploaded). "Saved calculations" are the ones the user chose to keep (rename, open, delete);
// "Recent calculations" are the last 5 the user ran with Calculate, kept automatically (open, or save to keep).
// Storage can be unavailable (private windows, blocked site data): saving then says so and nothing breaks.

const KEY = 'interestcal.saved';
const MAX = 50;
const RECENT_KEY = 'interestcal.recent';
const RECENT_MAX = 5;
const TAB_NAMES = { interest: 'Interest', mortgage: 'Mortgage', pv: 'Present value', inflation: 'Inflation' };
const tabName = (tab) => TAB_NAMES[tab] ?? 'Interest';

function load(key = KEY) {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(list) ? list.filter((x) => x && typeof x.query === 'string') : [];
  } catch {
    return [];
  }
}

function store(list, key = KEY, max = MAX) {
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(0, max)));
    return true;
  } catch {
    return false;
  }
}

/** Remember a calculation the user just ran (the last 5, newest first; running the same one again moves it up) */
export function recordRecent({ tab, query, title }) {
  const list = load(RECENT_KEY).filter((x) => x.query !== query);
  store([{ tab, query, name: title, savedAt: new Date().toISOString() }, ...list], RECENT_KEY, RECENT_MAX);
  renderRecent();
}

/**
 * Save a calculation. The same link saved again moves to the top and keeps its name.
 * @param {{ tab: 'interest' | 'mortgage' | 'pv' | 'inflation', query: string, title: string }} item  query is the link's "?..." part
 * @returns {boolean} false when the browser won't store it
 */
export function saveCalculation({ tab, query, title }) {
  const list = load();
  const existing = list.find((x) => x.query === query);
  const item = { id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, tab, query,
    name: existing?.name ?? title, savedAt: new Date().toISOString() };
  const ok = store([item, ...list.filter((x) => x.query !== query)]);
  renderSaved();
  return ok;
}

const fmtWhen = (iso) => {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
  return `${date} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

export function renderSaved() {
  const card = document.getElementById('savedCard');
  const ul = document.getElementById('savedList');
  if (!card || !ul) return;
  const list = load();
  card.hidden = !list.length;
  document.getElementById('savedCount').textContent = list.length ? `(${list.length})` : '';
  ul.replaceChildren(
    ...list.map((x) => {
      const li = document.createElement('li');
      const name = Object.assign(document.createElement('input'), {
        type: 'text', value: x.name, className: 'saved-name', autocomplete: 'off',
      });
      name.setAttribute('aria-label', 'Name of this saved calculation');
      name.addEventListener('change', () => {
        const all = load();
        const it = all.find((y) => y.id === x.id);
        if (it) {
          it.name = name.value.trim() || it.name;
          store(all);
        }
      });
      const meta = Object.assign(document.createElement('span'), {
        className: 'muted saved-meta',
        textContent: `${tabName(x.tab)} · saved ${fmtWhen(x.savedAt)}`,
      });
      const open = Object.assign(document.createElement('a'), { href: `./${x.query}`, textContent: 'Open', className: 'saved-open' });
      const del = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary remove', textContent: '×' });
      del.setAttribute('aria-label', `Delete ${x.name}`);
      del.addEventListener('click', () => {
        store(load().filter((y) => y.id !== x.id));
        renderSaved();
      });
      li.append(name, meta, open, del);
      return li;
    }),
  );
}

export function renderRecent() {
  const card = document.getElementById('recentCard');
  const ul = document.getElementById('recentList');
  if (!card || !ul) return;
  const list = load(RECENT_KEY);
  card.hidden = !list.length;
  ul.replaceChildren(
    ...list.map((x) => {
      const li = document.createElement('li');
      const name = Object.assign(document.createElement('span'), { className: 'recent-name', textContent: x.name });
      const meta = Object.assign(document.createElement('span'), {
        className: 'muted saved-meta',
        textContent: `${tabName(x.tab)} · ${fmtWhen(x.savedAt)}`,
      });
      const open = Object.assign(document.createElement('a'), { href: `./${x.query}`, textContent: 'Open', className: 'saved-open' });
      const keep = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary', textContent: 'Save' });
      keep.setAttribute('aria-label', `Save ${x.name}`);
      keep.addEventListener('click', () => {
        saveCalculation({ tab: x.tab, query: x.query, title: x.name });
        keep.textContent = 'Saved';
        keep.disabled = true;
      });
      li.append(name, meta, open, keep);
      return li;
    }),
  );
}

// Another browser tab saved, deleted or ran something
window.addEventListener('storage', (e) => {
  if (e.key === KEY) renderSaved();
  if (e.key === RECENT_KEY) renderRecent();
});
