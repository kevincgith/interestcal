// Helpers shared by the Interest and Mortgage tabs.

export const $ = (id) => document.getElementById(id);
export const money = new Intl.NumberFormat('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-04-01" -> "01-Apr-2026", matching the workbook's dd-mmm-yyyy format
export const fmtDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
};
// At least 3 decimals like the published tables, more only if needed (e.g. 7.0625%). r is a fraction (0.08 = 8%).
export const fmtRate = (r) =>
  `${Number((r * 100).toFixed(6)).toLocaleString('en', { minimumFractionDigits: 3, maximumFractionDigits: 6 })}%`;
export const parseNumber = (s) => Number(String(s).replace(/[,\s$%]/g, '').replace(/^HK/i, ''));
export const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');
export const todayIso = () => new Date().toLocaleDateString('en-CA'); // local date, YYYY-MM-DD

export function link(url, text = url) {
  const a = document.createElement('a');
  a.href = url;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

export function row(cells, classes = []) {
  const tr = document.createElement('tr');
  cells.forEach((text, i) => {
    const td = document.createElement('td');
    td.textContent = text;
    if (classes[i]) td.className = classes[i];
    tr.append(td);
  });
  return tr;
}

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

// The export libraries are only loaded on first use, so the page itself stays light.
const scripts = {};
function loadScript(src) {
  scripts[src] ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `vendor/${src}?v=__BUILD__`;
    script.onload = resolve;
    script.onerror = () => {
      delete scripts[src];
      reject(new Error('Could not load the export library. Please try again.'));
    };
    document.head.append(script);
  });
  return scripts[src];
}
export const loadXlsx = () => loadScript('xlsx.mini.min.js').then(() => window.XLSX);
// AutoTable must load after jsPDF; in the browser it exposes window.autoTable(doc, options)
export const loadPdf = () =>
  loadScript('jspdf.umd.min.js')
    .then(() => loadScript('jspdf.plugin.autotable.min.js'))
    .then(() => ({ jsPDF: window.jspdf.jsPDF, autoTable: window.autoTable }));

// Busy state for export buttons while a library loads; errors go to onError
export async function busy(btn, fn, onError) {
  btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    onError(err.message);
  } finally {
    btn.disabled = false;
  }
}

/** Short-lived status text, e.g. "Link copied" */
export function flash(el, msg) {
  el.textContent = msg;
  clearTimeout(el._flashTimer);
  el._flashTimer = setTimeout(() => (el.textContent = ''), 2500);
}

/** Copy a link, falling back to a prompt where the clipboard is unavailable */
export async function copyLink(url, statusEl) {
  try {
    await navigator.clipboard.writeText(url);
    flash(statusEl, 'Link copied');
  } catch {
    window.prompt('Copy this link:', url);
  }
}

/** +/- buttons in a .stepper change the input by data-step, never below the input's data-min */
export function wireSteppers(root, onChange) {
  root.querySelectorAll('.stepper .step').forEach((btn) =>
    btn.addEventListener('click', () => {
      const input = btn.closest('.stepper').querySelector('input');
      const current = parseNumber(input.value || '0');
      let next = (Number.isFinite(current) ? current : 0) + Number(btn.dataset.step);
      if (input.dataset.min !== undefined) next = Math.max(Number(input.dataset.min), next);
      if (input.dataset.max !== undefined) next = Math.min(Number(input.dataset.max), next);
      input.value = String(Number(next.toFixed(6)));
      onChange();
    }),
  );
}

/**
 * Keep each figure inside its summary box: when an unbreakable one is too wide (e.g. 3,207,776,571.88), shrink
 * its font a pixel at a time until it fits; text with spaces just wraps. Normal figures keep the full size. Refits when
 * the figures change or the boxes resize (including a hidden tab being shown).
 */
export function autoFitText(container, selector = 'dd', minPx = 13) {
  const fit = () => {
    for (const el of container.querySelectorAll(selector)) {
      el.style.fontSize = '';
      if (!el.clientWidth) continue; // hidden: fitted once it's shown
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > el.clientWidth && size > minPx) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
    }
  };
  new ResizeObserver(fit).observe(container);
  new MutationObserver(fit).observe(container, { childList: true, characterData: true, subtree: true });
  fit();
}

/**
 * Segmented controls (radio buttons in a .seg) read and set like a <select>: .value is the checked option's value.
 * Setting a value that isn't an option leaves the choice as it was.
 */
export function segValue(...ids) {
  for (const id of ids) {
    const group = $(id);
    Object.defineProperty(group, 'value', {
      get: () => group.querySelector('input:checked')?.value ?? '',
      set: (v) => {
        const input = [...group.querySelectorAll('input[type="radio"]')].find((i) => i.value === String(v));
        if (input) input.checked = true;
      },
    });
  }
}
