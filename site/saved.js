// Saved and recent calculations: each is a calculation's shareable link plus a name, kept in this browser's
// localStorage only (never uploaded). "Saved calculations" are the ones the user chose to keep (rename, open, delete
// with undo, sort, and export to a file / import from one, to back them up or move them to another device);
// "Recent calculations" are the last 5 the user ran with Calculate, kept automatically (open, save to keep, or clear
// them all).
// Storage can be unavailable (private windows, blocked site data): saving then says so and nothing breaks.

import { download, todayIso } from './shared.js?v=__BUILD__';

const KEY = 'interestcal.saved';
const MAX = 50;
const RECENT_KEY = 'interestcal.recent';
const RECENT_MAX = 5;
const TAB_NAMES = { interest: 'Interest', mortgage: 'Mortgage', pv: 'Present value', inflation: 'Inflation' };
const tabName = (tab) => TAB_NAMES[tab] ?? 'Interest';
const SORT_KEY = 'interestcal.savedSort';
const byName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

// Saved calculations sort newest first (as stored) or by name; the choice is remembered in this browser
function sortChoice() {
  try {
    return localStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'time';
  } catch {
    return 'time';
  }
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
  const item = { id: existing?.id ?? newId(), tab, query,
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
  document.getElementById('savedEmpty').hidden = list.length > 0;
  document.getElementById('savedExport').disabled = !list.length;
  document.getElementById('savedCount').textContent = list.length ? `(${list.length})` : '';
  const sort = sortChoice();
  const seg = document.getElementById('savedSort');
  if (seg) {
    seg.hidden = list.length < 2;
    seg.querySelector(`input[value="${sort}"]`).checked = true;
  }
  if (sort === 'name') list.sort((a, b) => byName.compare(a.name, b.name));
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
        name.value = it?.name ?? name.value;
        if (sortChoice() === 'name') renderSaved(); // the renamed one moves to its place
      });
      const meta = Object.assign(document.createElement('span'), {
        className: 'muted saved-meta',
        textContent: `${tabName(x.tab)} · saved ${fmtWhen(x.savedAt)}`,
      });
      const open = Object.assign(document.createElement('a'), { href: `./${x.query}`, textContent: 'Open', className: 'saved-open' });
      const del = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary remove', textContent: '×' });
      del.setAttribute('aria-label', `Delete ${x.name}`);
      del.addEventListener('click', () => {
        const all = load();
        const at = all.findIndex((y) => y.id === x.id);
        if (at < 0) return renderSaved();
        const [gone] = all.splice(at, 1);
        store(all);
        renderSaved();
        offerUndo(gone, at);
      });
      li.append(name, meta, open, del);
      return li;
    }),
  );
}

// After a delete: "Deleted “name”. Undo" for a few seconds; Undo puts it back where it was. Only the latest delete
// can be undone.
const UNDO_MS = 8000;
function offerUndo(item, at) {
  const status = document.getElementById('savedStatus');
  const undo = Object.assign(document.createElement('button'), { type: 'button', className: 'link-button', textContent: 'Undo' });
  undo.addEventListener('click', () => {
    const all = load().filter((y) => y.query !== item.query);
    all.splice(Math.min(at, all.length), 0, item);
    store(all);
    clearTimeout(status._undoTimer);
    status.replaceChildren(`Restored “${item.name}”.`);
    status._undoTimer = setTimeout(() => status.replaceChildren(), 2500);
    renderSaved();
  });
  status.replaceChildren(`Deleted “${item.name}”. `, undo);
  clearTimeout(status._undoTimer);
  status._undoTimer = setTimeout(() => status.replaceChildren(), UNDO_MS);
}

function sayStatus(msg) {
  const status = document.getElementById('savedStatus');
  clearTimeout(status._undoTimer);
  status.replaceChildren(msg);
  status._undoTimer = setTimeout(() => status.replaceChildren(), 6000);
}

// Export: the saved calculations as a JSON file. Import: add the ones from such a file that aren't saved here yet
// (matched by link; a calculation already saved keeps its name here), newest first, up to the usual 50.
const FILE_KIND = 'interestcal.saved';

function exportSaved() {
  const saved = load().map(({ tab, query, name, savedAt }) => ({ tab, query, name, savedAt }));
  const body = JSON.stringify({ kind: FILE_KIND, version: 1, exportedAt: new Date().toISOString(), saved }, null, 2);
  download(new Blob([body], { type: 'application/json' }), `hk-interest-calc-saved-${todayIso()}.json`);
  sayStatus(`Exported ${saved.length} calculation${saved.length === 1 ? '' : 's'}.`);
}

/** The valid calculations in an exported file's text; throws if it isn't one */
export function parseExport(text) {
  const data = JSON.parse(text);
  if (data?.kind !== FILE_KIND || !Array.isArray(data.saved)) throw new Error('not an export');
  return data.saved
    .filter((x) => x && typeof x.query === 'string' && /^\?[^\s]{1,4000}$/.test(x.query) && typeof x.name === 'string' && x.name.trim())
    .map((x) => ({
      tab: Object.hasOwn(TAB_NAMES, x.tab) ? x.tab : 'interest',
      query: x.query,
      name: x.name.trim().slice(0, 300),
      savedAt: Number.isNaN(Date.parse(x.savedAt)) ? new Date().toISOString() : new Date(x.savedAt).toISOString(),
    }));
}

async function importSaved(file) {
  let items;
  try {
    items = parseExport(await file.text());
  } catch {
    sayStatus('That file isn’t a saved-calculations export.');
    return;
  }
  const list = load();
  const have = new Set(list.map((x) => x.query));
  const fresh = items.filter((x) => !have.has(x.query) && have.add(x.query));
  const merged = [...list, ...fresh.map((x) => ({ id: newId(), ...x }))]
    .sort((a, b) => (b.savedAt > a.savedAt ? 1 : b.savedAt < a.savedAt ? -1 : 0));
  if (fresh.length && !store(merged)) {
    sayStatus('This browser won’t save data here.');
    return;
  }
  renderSaved();
  const dropped = Math.max(0, merged.length - MAX);
  const skipped = items.length - fresh.length;
  sayStatus([
    `Imported ${fresh.length} calculation${fresh.length === 1 ? '' : 's'}.`,
    skipped ? `${skipped} already saved.` : '',
    dropped ? `Only the newest ${MAX} are kept; ${dropped} older ones were left out.` : '',
  ].filter(Boolean).join(' '));
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

/** Forget the recent calculations (saved ones stay) */
export function clearRecent() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {}
  renderRecent();
}
document.getElementById('clearRecent')?.addEventListener('click', clearRecent);
document.getElementById('savedExport')?.addEventListener('click', exportSaved);
document.getElementById('savedImport')?.addEventListener('click', () => document.getElementById('savedImportFile').click());
document.getElementById('savedImportFile')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = ''; // the same file can be chosen again
  if (file) await importSaved(file);
});
document.getElementById('savedSort')?.addEventListener('change', (e) => {
  try {
    localStorage.setItem(SORT_KEY, e.target.value);
  } catch {}
  renderSaved();
});

// Another browser tab saved, deleted or ran something
window.addEventListener('storage', (e) => {
  if (e.key === KEY) renderSaved();
  if (e.key === RECENT_KEY) renderRecent();
});
