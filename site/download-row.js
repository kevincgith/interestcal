// Downloads on every tab: choose a format (a segmented control: Word | PDF | Excel), then press Download. The format is
// remembered in this browser, per tab. The page's own per-format buttons stay as hidden targets (their handlers build
// the files): Download presses the chosen one and copies its state (off while inputs are out of date, busy while a
// file is built).
const NAMES = { docx: 'Word', pdf: 'PDF', xlsx: 'Excel' };

function setupDownloadRow(row) {
  const seg = row.querySelector('.seg');
  const btn = row.querySelector('.download');
  const targets = row.querySelector('.download-targets');
  const chosen = () => seg.querySelector('input:checked');
  const target = () => document.getElementById(chosen().value);
  const key = `downloadFormat:${row.dataset.tab}`;
  try {
    const saved = localStorage.getItem(key);
    const input = saved && seg.querySelector(`input[value="${saved}"]`);
    if (input) input.checked = true;
  } catch {}
  const sync = () => {
    const t = target();
    btn.disabled = t.disabled;
    btn.title = t.title;
    btn.setAttribute('aria-label', `Download ${NAMES[chosen().dataset.format]}`);
  };
  seg.addEventListener('change', () => {
    try {
      localStorage.setItem(key, chosen().value);
    } catch {}
    sync();
  });
  btn.addEventListener('click', () => target().click());
  // The targets are turned off and on by each tab (stale results, a file being built): follow them
  new MutationObserver(sync).observe(targets, { subtree: true, attributes: true, attributeFilter: ['disabled', 'title'] });
  sync();
}

export const setupDownloadRows = () => document.querySelectorAll('.download-row').forEach(setupDownloadRow);
