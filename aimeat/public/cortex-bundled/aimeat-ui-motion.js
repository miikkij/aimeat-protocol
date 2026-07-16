/**
 * aimeat-ui-motion — UX polish primitives for AIMEAT apps.
 *
 * The motion language every dashboard app re-implements, packaged once: animated count-up
 * numbers, KPI stat-tile rows with sparklines, skeleton shimmer loaders, staggered list
 * entrances, view transitions, and tasteful micro-bling (pulse / glow / confetti tick /
 * row highlight). Every animation is transform/opacity only (compositor-friendly, 60fps),
 * theme-aware via the app's CSS variables, and honors prefers-reduced-motion globally
 * (final states render instantly, no motion).
 *
 * Usage:
 *   <script src="/v1/cortex/aimeat-ui-motion/libs/aimeat-ui-motion.js"></script>
 *   <script>
 *     var M = AIMEAT.ui.motion;
 *     M.statTiles('#tiles', [{ label: 'Active missions', value: 18, spark: [3,5,4,8,9] }]);
 *     M.skeleton('#table', { lines: 5 });                 // while loading…
 *     M.unskeleton('#table', renderedHtml); M.staggerIn('#table');
 *     await M.viewTransition('#view', function () { renderNextView(); });
 *   </script>
 */
(function (global) {
  'use strict';

  var AIMEAT = global.AIMEAT = global.AIMEAT || {};
  AIMEAT.ui = AIMEAT.ui || {};

  function reduced() {
    try { return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  var CSS = [
    // skeleton shimmer
    '.aum-skeleton { display: flex; flex-direction: column; gap: 10px; padding: 4px 0; }',
    '.aum-skel-row { display: flex; gap: 10px; align-items: center; }',
    '.aum-skel-bar, .aum-skel-avatar { background: var(--bg-dim, rgba(127,127,127,.14)); border-radius: 8px; position: relative; overflow: hidden; }',
    '.aum-skel-avatar { width: 36px; height: 36px; border-radius: 50%; flex: 0 0 auto; }',
    '.aum-skel-bar { height: 14px; flex: 1; }',
    '.aum-skel-bar::after, .aum-skel-avatar::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgba(255,255,255,.28), transparent); animation: aum-shimmer 1.4s infinite; }',
    '@keyframes aum-shimmer { to { transform: translateX(100%); } }',
    // stagger entrance
    '.aum-stagger-item { opacity: 0; transform: translateY(8px); animation: aum-enter 380ms cubic-bezier(.22,1,.36,1) forwards; }',
    '@keyframes aum-enter { to { opacity: 1; transform: none; } }',
    // view transition fallback
    '.aum-view-leave { animation: aum-leave 140ms ease forwards; }',
    '.aum-view-enter { animation: aum-enter-view 220ms cubic-bezier(.22,1,.36,1); }',
    '@keyframes aum-leave { to { opacity: 0; transform: translateY(-6px); } }',
    '@keyframes aum-enter-view { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }',
    // stat tiles
    '.aum-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }',
    '.aum-tile { background: var(--card, #fff); border: 1px solid var(--border, #e5e7eb); border-radius: 14px; padding: 14px 16px; min-width: 0; }',
    '.aum-tile-top { display: flex; align-items: center; gap: 8px; }',
    '.aum-tile-icon { font-size: 18px; line-height: 1; }',
    '.aum-tile-label { font: 500 11px/1.3 system-ui, sans-serif; opacity: .65; text-transform: uppercase; letter-spacing: .04em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.aum-tile-value { font: 700 26px/1.2 system-ui, sans-serif; font-variant-numeric: tabular-nums; margin-top: 4px; color: var(--text, inherit); }',
    '.aum-tile-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; min-height: 22px; }',
    '.aum-trend { font: 600 11px/1 system-ui, sans-serif; padding: 3px 8px; border-radius: 999px; }',
    '.aum-trend-up { background: rgba(34,197,94,.15); color: #16a34a; }',
    '.aum-trend-down { background: rgba(239,68,68,.15); color: #dc2626; }',
    '.aum-trend-flat { background: var(--bg-dim, rgba(127,127,127,.12)); opacity: .8; }',
    '.aum-spark { flex: 1; max-width: 90px; height: 22px; }',
    '.aum-spark path { fill: none; stroke: var(--accent, #e8564a); stroke-width: 1.6; }',
    '.aum-spark .aum-spark-fill { fill: var(--accent, #e8564a); opacity: .12; stroke: none; }',
    // micro-bling
    '.aum-pulse { animation: aum-pulse 1.4s ease-in-out infinite; }',
    '@keyframes aum-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.045); } }',
    '.aum-highlight { animation: aum-highlight 900ms ease; }',
    '@keyframes aum-highlight { 0% { background-color: color-mix(in srgb, var(--accent, #e8564a) 20%, transparent); } 100% { background-color: transparent; } }',
    '.aum-confetti-bit { position: absolute; width: 6px; height: 6px; border-radius: 2px; pointer-events: none; animation: aum-confetti 700ms cubic-bezier(.22,1,.36,1) forwards; }',
    '@keyframes aum-confetti { to { transform: translate(var(--aum-dx), var(--aum-dy)) rotate(var(--aum-rot)); opacity: 0; } }',
    '@media (prefers-reduced-motion: reduce) {',
    '  .aum-skel-bar::after, .aum-skel-avatar::after { animation: none; }',
    '  .aum-stagger-item { animation: none; opacity: 1; transform: none; }',
    '  .aum-view-leave, .aum-view-enter { animation: none; }',
    '  .aum-pulse, .aum-highlight { animation: none; }',
    '}',
  ].join('\n');

  var injected = false;
  function injectCss() {
    if (injected) return;
    var s = document.createElement('style');
    s.setAttribute('data-aimeat-ui-motion', '1');
    s.textContent = CSS;
    document.head.appendChild(s);
    injected = true;
  }

  function resolveEl(x) { return typeof x === 'string' ? document.querySelector(x) : x; }

  function esc(text) {
    var d = document.createElement('div');
    d.textContent = String(text == null ? '' : text);
    return d.innerHTML;
  }

  var defaultFormat = function (v, decimals) {
    try { return Number(v).toLocaleString(undefined, { maximumFractionDigits: decimals != null ? decimals : (Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0) }); }
    catch (e) { return String(v); }
  };

  /**
   * Animate a number rolling up (or down) to `value` inside el.
   * opts: { duration=800, format?(v)→string, decimals?, from? }
   */
  function countUp(el, value, opts) {
    el = resolveEl(el);
    if (!el) return;
    opts = opts || {};
    var fmt = opts.format || function (v) { return defaultFormat(v, opts.decimals); };
    var target = Number(value) || 0;
    if (reduced()) { el.textContent = fmt(target); return; }
    var from = opts.from != null ? Number(opts.from) : (parseFloat(String(el.textContent).replace(/[^\d.-]/g, '')) || 0);
    var dur = opts.duration != null ? opts.duration : 800;
    var t0 = null;
    function frame(t) {
      if (t0 == null) t0 = t;
      var p = Math.min(1, (t - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      el.textContent = fmt(from + (target - from) * eased);
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = fmt(target);
    }
    requestAnimationFrame(frame);
  }

  function sparkSvg(values) {
    if (!values || values.length < 2) return '';
    var w = 90; var h = 22; var pad = 2;
    var min = Math.min.apply(null, values); var max = Math.max.apply(null, values);
    var span = max - min || 1;
    var pts = values.map(function (v, i) {
      return [pad + (w - pad * 2) * (i / (values.length - 1)), h - pad - (h - pad * 2) * ((v - min) / span)];
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    var fill = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + (h - pad) + ' L' + pts[0][0].toFixed(1) + ',' + (h - pad) + ' Z';
    return '<svg class="aum-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">'
      + '<path class="aum-spark-fill" d="' + fill + '"></path><path d="' + line + '"></path></svg>';
  }

  /**
   * Render a responsive KPI stat-tile row. Values count up on mount and on update.
   * tiles: [{ label, value, icon?, trend?: {value, dir:'up'|'down'|'flat'}, spark?: number[],
   *           format?(v)→string, decimals? }]
   * Returns { update(tiles), destroy() }.
   */
  function statTiles(el, tiles) {
    el = resolveEl(el);
    if (!el) throw new Error('aimeat-ui-motion: statTiles host not found');
    injectCss();
    el.classList.add('aum-tiles');

    function render(list) {
      el.innerHTML = list.map(function (t, i) {
        var trend = t.trend
          ? '<span class="aum-trend aum-trend-' + esc(t.trend.dir || 'flat') + '">'
            + (t.trend.dir === 'up' ? '▲ ' : t.trend.dir === 'down' ? '▼ ' : '') + esc(t.trend.value) + '</span>'
          : '';
        return '<div class="aum-tile">'
          + '<div class="aum-tile-top">' + (t.icon ? '<span class="aum-tile-icon">' + esc(t.icon) + '</span>' : '')
          + '<span class="aum-tile-label">' + esc(t.label) + '</span></div>'
          + '<div class="aum-tile-value" data-aum-tile="' + i + '">0</div>'
          + '<div class="aum-tile-foot">' + trend + (t.spark ? sparkSvg(t.spark) : '') + '</div>'
          + '</div>';
      }).join('');
      list.forEach(function (t, i) {
        var v = el.querySelector('[data-aum-tile="' + i + '"]');
        if (v) countUp(v, t.value, { format: t.format, decimals: t.decimals });
      });
    }

    render(tiles || []);
    return {
      update: render,
      destroy: function () { el.innerHTML = ''; el.classList.remove('aum-tiles'); },
    };
  }

  /**
   * Replace el's content with a shimmer skeleton while data loads.
   * opts: { lines=3, avatar=false, height? } — height sets a fixed skeleton-bar height in px.
   */
  function skeleton(el, opts) {
    el = resolveEl(el);
    if (!el) return;
    injectCss();
    opts = opts || {};
    var lines = opts.lines != null ? opts.lines : 3;
    var rows = [];
    for (var i = 0; i < lines; i++) {
      var widths = [96, 78, 88, 64, 92];
      var bar = '<div class="aum-skel-bar" style="width:' + widths[i % widths.length] + '%'
        + (opts.height ? ';height:' + opts.height + 'px' : '') + '"></div>';
      rows.push('<div class="aum-skel-row">' + (opts.avatar ? '<div class="aum-skel-avatar"></div>' : '') + bar + '</div>');
    }
    el.setAttribute('data-aum-skeleton', '1');
    el.innerHTML = '<div class="aum-skeleton" aria-hidden="true">' + rows.join('') + '</div>';
  }

  /** Swap a skeleton for real content (html string optional — pass nothing if you render after). */
  function unskeleton(el, html) {
    el = resolveEl(el);
    if (!el) return;
    el.removeAttribute('data-aum-skeleton');
    if (html != null) el.innerHTML = html;
    else if (el.querySelector('.aum-skeleton')) el.innerHTML = '';
  }

  /**
   * Staggered entrance for a list's children after render.
   * opts: { selector? (default: direct children), delay=35 (ms between items), max=14 }
   */
  function staggerIn(listEl, opts) {
    listEl = resolveEl(listEl);
    if (!listEl || reduced()) return;
    injectCss();
    opts = opts || {};
    var items = opts.selector ? listEl.querySelectorAll(opts.selector) : listEl.children;
    var delay = opts.delay != null ? opts.delay : 35;
    var max = opts.max != null ? opts.max : 14;
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      el.classList.remove('aum-stagger-item');
      if (i < max) {
        el.style.animationDelay = (i * delay) + 'ms';
        el.classList.add('aum-stagger-item');
      }
    }
  }

  /**
   * Animate a view swap: leave-fade the container, run renderFn (may be async), enter-slide the
   * new content. Uses the native View Transitions API when available; CSS fallback otherwise.
   * Returns a promise resolving when the new view is in.
   */
  function viewTransition(container, renderFn) {
    container = resolveEl(container);
    injectCss();
    if (!container) return Promise.resolve(renderFn());
    if (reduced()) return Promise.resolve(renderFn());
    if (document.startViewTransition) {
      return document.startViewTransition(function () { return renderFn(); }).finished.catch(function () { /* interrupted is fine */ });
    }
    return new Promise(function (res) {
      container.classList.add('aum-view-leave');
      setTimeout(function () {
        container.classList.remove('aum-view-leave');
        Promise.resolve(renderFn()).then(function () {
          container.classList.add('aum-view-enter');
          setTimeout(function () { container.classList.remove('aum-view-enter'); res(); }, 240);
        });
      }, 130);
    });
  }

  /** Gentle looping attention pulse (returns stop()). Use for "needs you" affordances. */
  function pulse(el) {
    el = resolveEl(el);
    if (!el) return function () {};
    injectCss();
    el.classList.add('aum-pulse');
    return function () { el.classList.remove('aum-pulse'); };
  }

  /** One-off glow ring around an element (box-shadow fade; returns nothing). */
  function glow(el, color) {
    el = resolveEl(el);
    if (!el || reduced()) return;
    var c = color || 'var(--accent, #e8564a)';
    var prev = el.style.boxShadow;
    el.style.transition = 'box-shadow 700ms ease';
    el.style.boxShadow = '0 0 0 4px color-mix(in srgb, ' + c + ' 40%, transparent)';
    setTimeout(function () { el.style.boxShadow = prev || ''; }, 720);
  }

  /** Brief background flash on an SSE-updated row — beats a full-table repaint. */
  function highlightRow(el) {
    el = resolveEl(el);
    if (!el) return;
    injectCss();
    el.classList.remove('aum-highlight');
    void el.offsetWidth;
    el.classList.add('aum-highlight');
  }

  /** Small, tasteful success confetti burst anchored to an element. One per user action. */
  function confettiTick(el) {
    el = resolveEl(el);
    if (!el || reduced()) return;
    injectCss();
    var r = el.getBoundingClientRect();
    var colors = ['#22c55e', '#f59e0b', '#3b82f6', '#ec4899', '#a78bfa'];
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:' + (r.left + r.width / 2) + 'px;top:' + (r.top + r.height / 2) + 'px;width:0;height:0;z-index:99999;pointer-events:none';
    for (var i = 0; i < 12; i++) {
      var bit = document.createElement('div');
      bit.className = 'aum-confetti-bit';
      var ang = (Math.PI * 2 * i) / 12 + (i % 3) * 0.2;
      var d = 26 + (i % 4) * 9;
      bit.style.background = colors[i % colors.length];
      bit.style.setProperty('--aum-dx', (Math.cos(ang) * d).toFixed(0) + 'px');
      bit.style.setProperty('--aum-dy', (Math.sin(ang) * d - 8).toFixed(0) + 'px');
      bit.style.setProperty('--aum-rot', ((i % 2 ? 1 : -1) * (90 + i * 20)) + 'deg');
      host.appendChild(bit);
    }
    document.body.appendChild(host);
    setTimeout(function () { host.remove(); }, 750);
  }

  AIMEAT.ui.motion = {
    countUp: countUp,
    statTiles: statTiles,
    skeleton: skeleton,
    unskeleton: unskeleton,
    staggerIn: staggerIn,
    viewTransition: viewTransition,
    pulse: pulse,
    glow: glow,
    highlightRow: highlightRow,
    confettiTick: confettiTick,
  };

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
