/**
 * @file src/services/design-book/measure.ts
 * @description Browser geometry checks for the Design Book. Scrollable containers may reveal
 *   their contents; clipped containers cannot. Kept self-contained for in-page evaluation.
 * @usage DESIGN_BOOK_GEOMETRY_JS is evaluated inside the rendered page.
 * @version-history
 *   v1.0.0 — 2026-09-08 — Atelier phone targets, clipped content and small visible text.
 */
export const DESIGN_BOOK_GEOMETRY_JS = `(() => {
  const phone = innerWidth <= 760;
  let smallControls = 0;
  let clippedContent = 0;
  let smallText = 0;
  const controls = 'button, [role="button"], a[href], input, select, textarea, summary';
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || style.visibility === 'hidden' || style.display === 'none'
      || style.opacity === '0' || el.closest('[aria-hidden="true"], .ak-sr-only')) continue;
    // Decorative canvases and intentionally oversized backgrounds are not content boxes.
    const hasText = [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
    const control = el.matches(controls);
    if (!control && !hasText) continue;
    if (control && (r.width < (phone ? 40 : 24) || r.height < (phone ? 40 : 24))) smallControls++;
    if (hasText && parseFloat(style.fontSize) < 11) smallText++;
    let clipped = false;
    let checkX = true;
    let checkY = true;
    for (let parent = el.parentElement; parent && (checkX || checkY); parent = parent.parentElement) {
      const ps = getComputedStyle(parent);
      const pr = parent.getBoundingClientRect();
      if (checkX && /^(hidden|clip)$/.test(ps.overflowX) && (r.left < pr.left - 1 || r.right > pr.right + 1)) clipped = true;
      if (checkY && /^(hidden|clip)$/.test(ps.overflowY) && (r.top < pr.top - 1 || r.bottom > pr.bottom + 1)) clipped = true;
      if (/^(auto|scroll)$/.test(ps.overflowX)) checkX = false;
      if (/^(auto|scroll)$/.test(ps.overflowY)) checkY = false;
    }
    if (checkX && (r.left < -1 || r.right > innerWidth + 1)) clipped = true;
    if (clipped) clippedContent++;
  }
  return { smallControls, clippedContent, smallText };
})()`;
