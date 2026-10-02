// HIBOR history chart: 1-month and 3-month fixings as two lines on one % axis, with a crosshair tooltip.
import { fmtDate } from './shared.js?v=__BUILD__';

export const HIBOR_RANGES = { '1y': 1, '5y': 5, '10y': 10, all: Infinity };

const ns = 'http://www.w3.org/2000/svg';
const el = (tag, attrs) => {
  const n = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const dayMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
// A round step (1, 2 or 5 x 10^n) at least as big as v
const niceStep = (v) => {
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= v);
};

/**
 * @param box element to draw into
 * @param series [{ name, color, rates }] with rates newest first ({ effective, rate } in % p.a.), as in hibor.json
 * @param range a key of HIBOR_RANGES
 */
export function renderHiborChart(box, series, range = '10y') {
  const latest = series[0].rates[0].effective;
  const years = HIBOR_RANGES[range];
  const from = Number.isFinite(years) ? `${+latest.slice(0, 4) - years}${latest.slice(4)}` : '0000';
  // Oldest first, within the range
  const lines = series.map((s) => ({ ...s, pts: s.rates.filter((r) => r.effective >= from).reverse() }));
  const base = lines[0].pts;
  const byDate = lines.map((l) => new Map(l.pts.map((p) => [p.effective, p.rate])));

  // Drawn at the box's real width so text stays 11px on phones (a scaled-down viewBox would shrink it)
  const W = Math.round(Math.max(300, box.clientWidth || 720));
  const H = W < 500 ? 220 : 260;
  const pad = { l: 44, r: 64, t: 10, b: 28 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const t0 = dayMs(base[0].effective);
  const t1 = dayMs(base.at(-1).effective);
  const x = (iso) => pad.l + ((dayMs(iso) - t0) / Math.max(1, t1 - t0)) * plotW;
  const maxV = Math.max(...lines.flatMap((l) => l.pts.map((p) => p.rate)), 0.1);
  const step = niceStep(maxV / 5);
  const top = Math.ceil(maxV / step) * step;
  const y = (v) => pad.t + plotH - (v / top) * plotH;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
  // Recessive grid and % labels
  for (let v = 0; v <= top + 1e-9; v += step) {
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), stroke: 'var(--grid)', 'stroke-width': 1 }));
    const t = el('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' });
    t.textContent = `${Number(v.toFixed(2))}%`;
    svg.append(t);
  }
  // Year labels: at most about 8
  const y0 = +base[0].effective.slice(0, 4);
  const y1 = +base.at(-1).effective.slice(0, 4);
  const maxLabels = Math.max(3, Math.floor(plotW / 70));
  const yStep = [1, 2, 5, 10].find((s) => (y1 - y0) / s <= maxLabels) ?? 10;
  for (let yr = Math.ceil((y0 + 1) / yStep) * yStep; yr <= y1; yr += yStep) {
    const iso = `${yr}-01-01`;
    if (iso < base[0].effective) continue;
    svg.append(el('line', { x1: x(iso), x2: x(iso), y1: pad.t + plotH, y2: pad.t + plotH + 4, stroke: 'var(--grid)' }));
    const t = el('text', { x: x(iso), y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' });
    t.textContent = String(yr);
    svg.append(t);
  }
  // 2px lines
  for (const l of lines) {
    const d = l.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.effective).toFixed(1)},${y(p.rate).toFixed(1)}`).join('');
    svg.append(el('path', { d, fill: 'none', stroke: l.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  }
  // Direct labels at the line ends, nudged apart so they never overlap
  const ends = lines.map((l) => ({ l, v: l.pts.at(-1).rate, ly: y(l.pts.at(-1).rate) })).sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < ends.length; i++) ends[i].ly = Math.max(ends[i].ly, ends[i - 1].ly + 14);
  for (const e of ends) {
    const t = el('text', { x: W - pad.r + 8, y: e.ly + 4, 'font-size': 11, fill: 'var(--muted)' });
    t.textContent = `${e.l.short} ${e.v.toFixed(2)}%`;
    svg.append(t);
  }

  // Crosshair + tooltip
  const cross = el('line', { y1: pad.t, y2: pad.t + plotH, stroke: 'var(--muted)', 'stroke-width': 1, visibility: 'hidden' });
  const dots = lines.map((l) =>
    el('circle', { r: 4, fill: l.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }),
  );
  const hit = el('rect', { x: pad.l, y: pad.t, width: plotW, height: plotH, fill: 'transparent' });
  svg.append(cross, ...dots, hit);
  const tip = Object.assign(document.createElement('div'), { className: 'tip', hidden: true });

  const show = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    const t = t0 + ((px - pad.l) / plotW) * (t1 - t0);
    // Nearest fixing (binary search on the oldest-first dates)
    let lo = 0;
    let hi = base.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (dayMs(base[mid].effective) < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && t - dayMs(base[lo - 1].effective) < dayMs(base[lo].effective) - t) lo--;
    const date = base[lo].effective;
    const cx = x(date);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    tip.replaceChildren(Object.assign(document.createElement('strong'), { textContent: fmtDate(date) }));
    lines.forEach((l, i) => {
      const v = byDate[i].get(date);
      dots[i].setAttribute('visibility', v == null ? 'hidden' : 'visible');
      if (v != null) {
        dots[i].setAttribute('cx', cx);
        dots[i].setAttribute('cy', y(v));
      }
      const rowEl = document.createElement('div');
      rowEl.append(Object.assign(document.createElement('i'), { style: `background:${l.color}` }),
        `${l.name} ${v == null ? '–' : `${v.toFixed(3)}%`}`);
      tip.append(rowEl);
    });
    tip.hidden = false;
    const boxRect = box.getBoundingClientRect();
    const left = rect.left - boxRect.left + (cx / W) * rect.width;
    tip.style.left = `${Math.min(Math.max(0, left + 12), boxRect.width - 170)}px`;
    tip.style.top = '32px';
  };
  const hide = () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
  };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);

  const legend = document.createElement('div');
  legend.className = 'legend';
  for (const l of lines) {
    const item = document.createElement('span');
    item.append(Object.assign(document.createElement('i'), { style: `background:${l.color}` }), l.name);
    legend.append(item);
  }
  box.setAttribute(
    'aria-label',
    `HIBOR fixings from ${fmtDate(base[0].effective)} to ${fmtDate(latest)}; latest ${lines
      .map((l) => `${l.name} ${l.pts.at(-1).rate.toFixed(3)}%`)
      .join(', ')}`,
  );
  box.replaceChildren(legend, svg, tip);
}
