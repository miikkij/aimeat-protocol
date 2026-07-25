/**
 * @file themes-boot.js
 * @description Head-of-page restore for the theme showroom: applies the stored light/dark MODE and
 *   PALETTE before first paint. External file (not inline) because /lib/ pages are served under a
 *   `script-src 'self'` CSP with no inline allowance.
 * @usage <script src="/lib/samples/themes-boot.js"></script> in the <head> of themes.html.
 * @version-history
 *   v1.0.0 — 2026-07-25 — Born with the theme showroom.
 */
(function () {
  function mode(t) { document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light'); }
  function pal(p) {
    if (p && p !== 'aimeat') document.documentElement.setAttribute('data-palette', p);
    else document.documentElement.removeAttribute('data-palette');
  }
  try {
    mode(localStorage.getItem('aimeat-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    pal(localStorage.getItem('aimeat-palette'));
  } catch (e) { /* storage blocked — defaults stand */ }
})();
