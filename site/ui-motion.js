// Small UI animations, off when the system asks for reduced motion:
// - segmented controls: the chosen option's highlight (the "thumb") slides to the new option
// - collapsible sections (<details>): open and close with a smooth height change
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- Segmented controls ----

// Put the thumb under the checked option. A control inside a closed section or a hidden field has no size yet: its
// ResizeObserver places the thumb when it appears. The first placement doesn't animate.
function placeThumb(seg) {
  const thumb = seg.querySelector(':scope > .seg-thumb');
  const label = seg.querySelector('input:checked')?.closest('label');
  if (!thumb || !label || !seg.offsetWidth) return;
  const span = label.querySelector('span');
  const box = span.getBoundingClientRect();
  const outer = seg.getBoundingClientRect();
  thumb.style.width = `${box.width}px`;
  thumb.style.height = `${box.height}px`;
  thumb.style.transform = `translate(${box.left - outer.left - seg.clientLeft}px, ${box.top - outer.top - seg.clientTop}px)`;
  if (!seg.classList.contains('has-thumb')) {
    seg.classList.add('has-thumb');
    requestAnimationFrame(() => requestAnimationFrame(() => seg.classList.add('thumb-ready'))); // animate from now on
  }
}

export function setupSegments(root = document) {
  const segs = [...root.querySelectorAll('.seg')];
  const observer = new ResizeObserver((entries) => entries.forEach((e) => placeThumb(e.target)));
  for (const seg of segs) {
    const thumb = document.createElement('span');
    thumb.className = 'seg-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    seg.prepend(thumb);
    observer.observe(seg);
  }
  // A choice can also change from code (a link, Reset, the currency following the rate): re-place every thumb after
  // anything that might change one
  let queued = false;
  const placeAll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      segs.forEach(placeThumb);
    });
  };
  for (const type of ['change', 'click', 'reset', 'input']) document.addEventListener(type, placeAll, true);
  placeAll();
}

// ---- Collapsible sections ----

const DURATION = 220;
const EASING = 'cubic-bezier(.2, .7, .3, 1)';

function animateHeight(details, from, to, done) {
  details.style.overflow = 'hidden';
  const anim = details.animate({ height: [`${from}px`, `${to}px`] }, { duration: DURATION, easing: EASING });
  details._anim = anim;
  const finish = () => {
    if (details._anim !== anim) return; // superseded by a newer click
    details._anim = null;
    details.style.overflow = '';
    done?.();
  };
  anim.onfinish = finish;
  anim.oncancel = () => { if (details._anim === anim) details._anim = null; };
}

export function setupDetails(root = document) {
  for (const details of root.querySelectorAll('details')) {
    const summary = details.querySelector(':scope > summary');
    if (!summary) continue;
    summary.addEventListener('click', (e) => {
      if (reduced() || e.defaultPrevented) return;
      e.preventDefault();
      const from = details.offsetHeight;
      details._anim?.cancel();
      if (details.open && !details._closing) {
        // Closing: measure the closed height, keep it open while the height shrinks, then close
        details.open = false;
        const to = details.offsetHeight;
        details.open = true;
        details._closing = true;
        animateHeight(details, from, to, () => {
          details._closing = false;
          details.open = false;
        });
      } else {
        // Opening (or reopening while it was still closing)
        details._closing = false;
        details.open = true;
        const to = details.offsetHeight;
        animateHeight(details, from, to);
      }
    });
  }
}
