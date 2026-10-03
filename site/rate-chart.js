// Rate history chart: 1-month and 3-month HIBOR fixings and the HSBC prime rate as lines on one % axis, each with an
// optional spread (e.g. H + 1.3%, P - 1.75%), with a range picker and a crosshair tooltip.
import { fmtDate } from './shared.js?v=__BUILD__';

export const RATE_RANGES = { '1y': 1, '5y': 5, '10y': 10, all: Infinity };

const ns = 'http://www.w3.org/2000/svg';
const el = (tag, attrs) => {
  const n = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const dayMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
// A round step (1, 2 or 5 x 10^n) at least as big as v
const niceStep = (v) => {
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= v);
};
const fmtSpread = (s) => (s ? ` ${s > 0 ? '+' : '−'} ${Math.abs(s).toFixed(2)}%` : '');
const shortSpread = (s) => (s ? `${s > 0 ? '+' : '−'}${Number(Math.abs(s).toFixed(2))}` : '');

/** Rate in effect on a date from a change list (newest first); undefined before the first change */
const stepValueAt = (rates, iso) => rates.find((r) => r.effective <= iso)?.rate;

/**
 * @param box element to draw into
 * @param series [{ name, short, color, rates, spread, step?, end?, width? }]: rates newest first ({ effective, rate, note? }
 *   in % p.a.; a note says where the rate came from, shown in the tooltip).
 *   Daily fixings are drawn point to point; a step series (rate changes, e.g. prime) holds each rate until the next
 *   change, up to `end`.
 * @param opts { range } for a preset (a key of RATE_RANGES, ending at the latest data), or { from, to } (ISO dates;
 *   either can be left out to run from the earliest or to the latest data)
 * @returns {{ from: string, to: string } | null} the dates drawn
 */
export function renderRateChart(box, series, { range, from: fromOpt, to: toOpt } = { range: '10y' }) {
  const message = (text) => {
    box.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: text }));
    return null;
  };
  if (!series.length) return message('Pick a rate to show.');
  const lastDate = (s) => (s.step ? s.end : s.rates[0].effective);
  const dataEnd = series.map(lastDate).sort().at(-1);
  const dataStart = series.map((s) => s.rates.at(-1).effective).sort()[0];
  const latest = toOpt && toOpt < dataEnd ? toOpt : dataEnd;
  const years = RATE_RANGES[range];
  const from = range
    ? (Number.isFinite(years) ? `${+latest.slice(0, 4) - years}${latest.slice(4)}` : dataStart)
    : fromOpt && fromOpt > dataStart ? fromOpt : dataStart;
  if (from >= latest) return message('Pick a start date before the end date.');

  // Oldest-first points within the range, with the spread added
  const lines = series
    .map((s) => {
      let pts;
      if (s.step) {
        const startRate = stepValueAt(s.rates, from);
        pts = s.rates.filter((r) => r.effective > from && r.effective <= latest).reverse();
        if (startRate !== undefined) pts.unshift({ effective: from, rate: startRate });
        if (pts.length) pts.push({ effective: latest, rate: pts.at(-1).rate });
      } else {
        pts = s.rates.filter((r) => r.effective >= from && r.effective <= latest).reverse();
      }
      pts = pts.map((p) => ({ effective: p.effective, base: p.rate, rate: p.rate + s.spread, note: p.note }));
      return { ...s, pts, byDate: new Map(pts.map((p) => [p.effective, p])) };
    })
    .filter((l) => l.pts.length);
  if (!lines.length) return message('No rates in this date range.');
  const daily = lines.find((l) => !l.step); // hovering snaps to its fixing dates

  const W = Math.round(Math.max(300, box.clientWidth || 720)); // real width, so text stays 11px on phones
  const H = W < 500 ? 220 : 260;
  const labelOf = (l) => `${l.short}${shortSpread(l.spread)} ${l.pts.at(-1).rate.toFixed(2)}%`;
  const pad = { l: 44, r: 16 + Math.max(...lines.map((l) => labelOf(l).length)) * 6.2, t: 10, b: 28 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const t0 = dayMs(lines.map((l) => l.pts[0].effective).sort()[0]);
  const t1 = dayMs(latest);
  const x = (iso) => pad.l + ((dayMs(iso) - t0) / Math.max(1, t1 - t0)) * plotW;
  const values = lines.flatMap((l) => l.pts.map((p) => p.rate));
  const maxV = Math.max(...values, 0.1);
  const minV = Math.min(...values, 0);
  const step = niceStep((maxV - minV) / 5);
  const top = Math.ceil(maxV / step) * step;
  const bottom = Math.floor(minV / step) * step;
  const y = (v) => pad.t + plotH - ((v - bottom) / (top - bottom)) * plotH;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
  // Recessive grid and % labels
  for (let v = bottom; v <= top + 1e-9; v += step) {
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), stroke: 'var(--grid)', 'stroke-width': 1 }));
    const t = el('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' });
    t.textContent = `${Number(v.toFixed(2))}%`;
    svg.append(t);
  }
  // Year labels: about one per 70px
  const y0 = +isoOf(t0).slice(0, 4);
  const y1 = +latest.slice(0, 4);
  const maxLabels = Math.max(3, Math.floor(plotW / 70));
  const yStep = [1, 2, 5, 10, 20].find((s) => (y1 - y0) / s <= maxLabels) ?? 20;
  for (let yr = Math.ceil((y0 + 1) / yStep) * yStep; yr <= y1; yr += yStep) {
    const iso = `${yr}-01-01`;
    svg.append(el('line', { x1: x(iso), x2: x(iso), y1: pad.t + plotH, y2: pad.t + plotH + 4, stroke: 'var(--grid)' }));
    const t = el('text', { x: x(iso), y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' });
    t.textContent = String(yr);
    svg.append(t);
  }
  // 2px lines; a step series moves across, then up or down, at each change
  for (const l of lines) {
    const d = l.pts
      .map((p, i) => {
        const px = x(p.effective).toFixed(1);
        const py = y(p.rate).toFixed(1);
        return i === 0 ? `M${px},${py}` : l.step ? `H${px}V${py}` : `L${px},${py}`;
      })
      .join('');
    svg.append(el('path', { d, fill: 'none', stroke: l.color, 'stroke-width': l.width ?? 2, 'stroke-linejoin': 'round' }));
  }
  // Direct labels at the line ends, nudged apart so they never overlap
  const ends = lines.map((l) => ({ l, ly: y(l.pts.at(-1).rate) })).sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < ends.length; i++) ends[i].ly = Math.max(ends[i].ly, ends[i - 1].ly + 14);
  for (const e of ends) {
    const t = el('text', { x: W - pad.r + 8, y: e.ly + 4, 'font-size': 11, fill: 'var(--muted)' });
    t.textContent = labelOf(e.l);
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
    const t = Math.min(t1, Math.max(t0, t0 + ((px - pad.l) / plotW) * (t1 - t0)));
    let date = isoOf(Math.round(t / 864e5) * 864e5);
    if (daily) {
      // Nearest fixing (binary search on the oldest-first dates)
      const pts = daily.pts;
      let lo = 0;
      let hi = pts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (dayMs(pts[mid].effective) < t) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0 && t - dayMs(pts[lo - 1].effective) < dayMs(pts[lo].effective) - t) lo--;
      date = pts[lo].effective;
    }
    const cx = x(date);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    tip.replaceChildren(Object.assign(document.createElement('strong'), { textContent: fmtDate(date) }));
    lines.forEach((l, i) => {
      let p = l.byDate.get(date);
      if (l.step) {
        const base = stepValueAt(l.rates, date);
        p = base === undefined ? undefined : { base, rate: base + l.spread };
      }
      dots[i].setAttribute('visibility', p ? 'visible' : 'hidden');
      if (p) {
        dots[i].setAttribute('cx', cx);
        dots[i].setAttribute('cy', y(p.rate));
      }
      const value = !p
        ? '–'
        : p.note
          ? `${p.rate.toFixed(3)}% (${p.note})`
          : l.spread
          ? `${p.rate.toFixed(3)}% (${p.base.toFixed(3)}%${fmtSpread(l.spread)})`
          : `${p.rate.toFixed(3)}%`;
      const rowEl = document.createElement('div');
      rowEl.append(Object.assign(document.createElement('i'), { style: `background:${l.color}` }), `${l.name}: ${value}`);
      tip.append(rowEl);
    });
    tip.hidden = false;
    const boxRect = box.getBoundingClientRect();
    const left = rect.left - boxRect.left + (cx / W) * rect.width;
    const tipW = tip.offsetWidth || 200;
    // Right of the crosshair, or left of it when there's no room
    tip.style.left = `${left + 12 + tipW <= boxRect.width ? left + 12 : Math.max(0, left - 12 - tipW)}px`;
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
    item.append(Object.assign(document.createElement('i'), { style: `background:${l.color}` }), `${l.name}${fmtSpread(l.spread)}`);
    legend.append(item);
  }
  box.setAttribute(
    'aria-label',
    `Rates from ${fmtDate(isoOf(t0))} to ${fmtDate(latest)}; latest ${lines
      .map((l) => `${l.name}${fmtSpread(l.spread)} ${l.pts.at(-1).rate.toFixed(3)}%`)
      .join(', ')}`,
  );
  box.replaceChildren(legend, svg, tip);
  return { from, to: latest };
}
