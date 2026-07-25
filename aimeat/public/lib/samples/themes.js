/**
 * @file themes.js
 * @description Behaviour for the theme showroom (themes.html): mounts the real login pill (whose
 *   cluster carries the language/mode/palette controls), renders the every-palette-both-modes
 *   strip from AIMEAT.auth.getPalettes() (so it can never drift from the shipped registry), and
 *   exposes window.THEME_CHECK.read() for automated audits. External file because /lib/ pages run
 *   under a `script-src 'self'` CSP.
 * @usage <script src="/lib/samples/themes.js"></script> after /v1/libs/aimeat-auth.js.
 * @version-history
 *   v1.0.0 — 2026-07-25 — Born with the theme showroom.
 */
/* global AIMEAT */
(function () {
  AIMEAT.auth.mountLoginButton('#login', {});

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // The palette strip: one row per palette, its light + dark swatches, click-to-apply.
  function renderStrip() {
    var cur = AIMEAT.auth.getPalette();
    var rows = AIMEAT.auth.getPalettes().map(function (p) {
      var chips = ['light', 'dark'].map(function (m) {
        var s = p.swatch[m];
        return '<span class="sr-chip" title="' + esc(p.label + ' — ' + m) + '" style="background:' + esc(s.bg) + '">'
          + '<i style="background:' + esc(s.card) + '"></i><b style="background:' + esc(s.accent) + '"></b></span>';
      }).join('');
      return '<button type="button" data-pal="' + esc(p.id) + '" class="btn btn-ghost btn-sm justify-start gap-3 w-full'
        + (p.id === cur ? ' btn-active' : '') + '">' + chips
        + '<span class="font-semibold">' + esc(p.label) + '</span>'
        + (p.id === cur ? '<span class="badge badge-soft badge-primary badge-sm ml-auto">in use</span>' : '')
        + '</button>';
    }).join('');
    document.getElementById('pal-strip').innerHTML = rows;
    document.querySelectorAll('#pal-strip [data-pal]').forEach(function (b) {
      b.addEventListener('click', function () { AIMEAT.auth.setPalette(b.getAttribute('data-pal')); });
    });
  }

  function renderWhich() {
    document.getElementById('which-pal').textContent = AIMEAT.auth.getPalette();
    document.getElementById('which-mode').textContent =
      document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  renderStrip(); renderWhich();
  window.addEventListener('aimeat-palette-change', function () { renderStrip(); renderWhich(); });
  window.addEventListener('aimeat-theme-change', renderWhich);

  // For automated audits (Playwright / the build-app audit snippet).
  window.THEME_CHECK = {
    read: function () {
      var cs = getComputedStyle(document.documentElement);
      var out = { theme: document.documentElement.getAttribute('data-theme'), palette: AIMEAT.auth.getPalette() };
      ['--color-base-100', '--color-base-200', '--color-base-300', '--color-base-content',
        '--color-primary', '--color-primary-content', '--font-display', '--font-body']
        .forEach(function (t) { out[t] = cs.getPropertyValue(t).trim(); });
      return out;
    },
  };
})();
