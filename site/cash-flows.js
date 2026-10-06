// Cash flows on the Interest tab: rows of date + amount for payments received, and date + amount + description for
// principal added later. The rows live in the collapsible "Cash flows" pane.
import { $, money, parseNumber } from './shared.js?v=__BUILD__';

const hooks = { onChange: () => {}, currency: () => 'HK$' };

/**
 * @param {{ onChange: () => void, currency: () => string }} opts  onChange: a row was added or removed; currency: the
 *   symbol for the amount boxes' placeholder
 */
export function setupCashFlows(opts) {
  Object.assign(hooks, opts);
  $('addPayment').addEventListener('click', () => {
    addEventRow('payment').querySelector('.pay-date').focus();
    hooks.onChange();
  });
  $('addSum').addEventListener('click', () => {
    addEventRow('addition').querySelector('.pay-date').focus();
    hooks.onChange();
  });
}

const EVENT_ROWS = {
  payment: { container: 'paymentRows', noun: 'Payment', aria: 'Payment', withLabel: false },
  addition: { container: 'additionRows', noun: 'Added principal', aria: 'Added principal', withLabel: true },
};

function input(type, cls, aria, value = '') {
  const el = document.createElement('input');
  el.type = type;
  el.className = cls;
  el.value = value;
  el.setAttribute('aria-label', aria);
  return el;
}

export function addEventRow(kind, date = '', amount = '', label = '') {
  const cfg = EVENT_ROWS[kind];
  const row = document.createElement('div');
  row.className = cfg.withLabel ? 'payment-row with-label' : 'payment-row';
  const d = input('date', 'pay-date', `${cfg.aria} date`, date);
  const a = input('text', 'pay-amount', `${cfg.aria} amount`, amount === '' ? '' : money.format(amount));
  a.inputMode = 'decimal';
  a.autocomplete = 'off';
  a.placeholder = hooks.currency() ? `Amount (${hooks.currency()})` : 'Amount';
  a.addEventListener('blur', () => {
    const n = parseNumber(a.value);
    if (a.value.trim() && Number.isFinite(n)) a.value = money.format(n);
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary remove';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Remove ${cfg.noun.toLowerCase()}`);
  remove.addEventListener('click', () => {
    row.remove();
    updatePaymentFields();
    hooks.onChange();
  });
  row.append(d, a);
  if (cfg.withLabel) {
    const l = input('text', 'pay-label', `${cfg.aria} description`, label);
    l.placeholder = 'Description, e.g. Costs (optional)';
    row.append(l);
  }
  row.append(remove);
  $(cfg.container).append(row);
  updatePaymentFields();
  return row;
}

export function updatePaymentFields() {
  const payments = $('paymentRows').children.length;
  const added = $('additionRows').children.length;
  $('allocationField').hidden = !payments;
  // Cash flows heading: what's inside while it's collapsed, e.g. "(1 principal added, 2 payments)"
  const parts = [
    added && `${added} principal added`,
    payments && `${payments} ${payments === 1 ? 'payment' : 'payments'}`,
  ].filter(Boolean);
  $('cashFlowsSummary').textContent = `(${parts.length ? parts.join(', ') : 'principal added later, payments received'})`;
}

/** Reads payment or added-sum rows. Throws a user-facing message for half-filled rows; empty rows are ignored. */
export function readEventRows(kind) {
  const cfg = EVENT_ROWS[kind];
  const out = [];
  [...$(cfg.container).children].forEach((row, i) => {
    const date = row.querySelector('.pay-date').value;
    const raw = row.querySelector('.pay-amount').value.trim();
    const label = row.querySelector('.pay-label')?.value.trim() ?? '';
    if (!date && !raw) return;
    const amount = parseNumber(raw);
    if (!date || !raw || !Number.isFinite(amount) || amount <= 0) {
      throw new Error(`${cfg.noun} ${i + 1}: enter a date and an amount above 0.`);
    }
    out.push(cfg.withLabel ? { date, amount, label } : { date, amount });
  });
  return out;
}
