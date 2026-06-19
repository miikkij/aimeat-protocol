/*
 * @file style-testbed.js
 * @description Interactivity for the dev style-decision testbed
 *   (style-testbed.html). Injects a per-clone decision <select> into each
 *   variant, wires the light/dark theme toggle, and serializes every choice +
 *   family note live into the copyable output box. Uses addEventListener only
 *   (no inline handlers) to satisfy the static-asset CSP (script-src 'self').
 * @version-history
 *   v1.0.0 — 2026-06-02 — Initial testbed behavior
 *   v1.0.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 */
(function () {
  'use strict';

  // Decision option sets keyed by variant kind.
  const OPTIONS = {
    standard: [
      ['', '— decide —'],
      ['canonical', 'Use canonical as-is (delete clone; variants already exist)'],
      ['promote', 'Add / merge into canonical (make this look shared)'],
      ['separate', 'Leave separate (no change)'],
      ['delete', 'Delete (unused)'],
    ],
    admin: [
      ['', '— decide —'],
      ['consolidate', 'Consolidate into the ONE admin design'],
      ['promote', 'Promote this variant to admin-shared'],
      ['keep', 'Keep as-is'],
      ['separate', 'Leave separate'],
    ],
    dead: [
      ['delete', 'Delete (confirmed dead)'],
      ['promote', 'Actually keep → add to canonical'],
      ['keep', 'Keep as-is'],
      ['', '— decide —'],
    ],
  };

  // Human-readable labels for the output summary.
  const LABEL = {
    canonical: 'USE CANONICAL',
    promote: 'ADD TO CANONICAL',
    keep: 'KEEP AS-IS',
    separate: 'LEAVE SEPARATE',
    delete: 'DELETE',
    consolidate: 'CONSOLIDATE (admin)',
    '': 'undecided',
  };

  function kindOf(variant) {
    if (variant.hasAttribute('data-dead')) return 'dead';
    if (variant.hasAttribute('data-admin')) return 'admin';
    return 'standard';
  }

  // ── Inject decision selects ──
  function buildSelects() {
    document.querySelectorAll('.stb-variant').forEach((variant) => {
      const wrap = variant.querySelector('.stb-decide-wrap');
      if (!wrap || wrap.querySelector('select')) return;
      const kind = kindOf(variant);
      const sel = document.createElement('select');
      sel.className = 'stb-decide';
      OPTIONS[kind].forEach(([val, text]) => {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = text;
        sel.appendChild(o);
      });
      // Dead variants default to "delete" (first option already 'delete').
      if (kind === 'dead') sel.value = 'delete';
      wrap.appendChild(sel);
    });
  }

  // ── Build the output summary ──
  function pad(s, n) {
    s = String(s);
    return s.length >= n ? s : s + ' '.repeat(n - s.length);
  }

  function rebuild() {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const lines = [];
    lines.push('=== AIMEAT Style Decisions ===');
    lines.push('(reviewed in ' + theme.toUpperCase() + ' theme · ' + new Date().toLocaleString() + ')');
    lines.push('');

    let decided = 0;
    let total = 0;

    document.querySelectorAll('.stb-family').forEach((fam) => {
      const famName = fam.getAttribute('data-family') || '';
      const rows = [];
      fam.querySelectorAll('.stb-variant').forEach((variant) => {
        const sel = variant.querySelector('.stb-decide');
        if (!sel) return; // canonical reference — no decision
        total += 1;
        const val = /** @type {HTMLInputElement} */ (sel).value;
        if (val !== '') decided += 1;
        sel.classList.toggle('stb-chosen', val !== '');
        const clone = variant.getAttribute('data-clone') || '';
        const sites = variant.getAttribute('data-sites');
        const sitesStr = sites ? '(' + sites + ' sites)' : '';
        rows.push('  [' + pad(LABEL[val] || val, 18) + '] ' + pad(clone, 46) + ' ' + sitesStr);
      });
      const note = fam.querySelector('.stb-note');
      const noteVal = note && /** @type {HTMLInputElement} */ (note).value.trim();

      lines.push('## ' + famName);
      rows.forEach((r) => lines.push(r));
      if (noteVal) lines.push('  note: ' + noteVal);
      lines.push('');
    });

    const out = document.getElementById('stb-output');
    if (out) /** @type {HTMLInputElement} */ (out).value = lines.join('\n');
    const count = document.getElementById('stb-count');
    if (count) count.textContent = '(' + decided + '/' + total + ' clones decided)';
  }

  // ── Theme toggle ──
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('.stb-theme-btn').forEach((b) => {
      b.classList.toggle('stb-active', b.getAttribute('data-theme-set') === theme);
    });
    rebuild();
  }

  // ── Copy ──
  function copyOut() {
    const out = document.getElementById('stb-output');
    const btn = document.getElementById('stb-copy');
    if (!out) return;
    const done = () => {
      if (!btn) return;
      btn.classList.add('stb-copied');
      const prev = btn.textContent;
      btn.textContent = '✓ Copied';
      setTimeout(() => { btn.classList.remove('stb-copied'); btn.textContent = prev; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(/** @type {HTMLInputElement} */ (out).value).then(done, () => { /** @type {HTMLInputElement} */ (out).select(); document.execCommand('copy'); done(); });
    } else {
      /** @type {HTMLInputElement} */ (out).select();
      document.execCommand('copy');
      done();
    }
  }

  // ── Wire up ──
  function init() {
    buildSelects();
    document.getElementById('stb-main').addEventListener('change', rebuild);
    document.getElementById('stb-main').addEventListener('input', rebuild);
    document.querySelectorAll('.stb-theme-btn').forEach((b) => {
      b.addEventListener('click', () => setTheme(b.getAttribute('data-theme-set')));
    });
    const copy = document.getElementById('stb-copy');
    if (copy) copy.addEventListener('click', copyOut);
    // Reflect the initial data-theme on the toggle buttons.
    setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
