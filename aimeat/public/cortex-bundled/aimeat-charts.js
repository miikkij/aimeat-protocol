/**
 * aimeat-charts — Chart.js wrapper for the AIMEAT Cortex extension system.
 *
 * Provides ChartPanel (fetch-from-storage) and ChartBuilder (inline data)
 * components that render responsive, themed Chart.js charts.
 *
 * Requires Chart.js to be loaded first:
 *   <script src="/lib/chartjs@4.js"></script>   (self-hosted; vendored in public/lib/)
 *   <script src="/v1/cortex/aimeat-charts/libs/aimeat-charts.js"></script>
 *
 * Usage:
 *   AIMEAT.charts.ChartBuilder({ elementId: 'my-chart', type: 'bar', data: {...} })
 *   AIMEAT.charts.ChartPanel({ elementId: 'my-chart', chartKey: 'chart:sales-2024', nodeUrl: '...' })
 *
 * @version-history
 *   v1.1.2 — 2026-07-25 — One observer, not two. This lib attached its own ResizeObserver that
 *     called `chart.resize()` with no arguments; Chart.js already watches the same container and
 *     already resizes from the observer entry's contentRect. The two disagree wherever an
 *     ancestor carries `transform: scale(k)` — the no-argument call measures with
 *     getBoundingClientRect(), which is k times the layout size. Measured while dragging a frame
 *     on a zoomable board: 30 canvas style writes for 15 pointer moves, alternating between the
 *     right height and exactly k x it (k = 0.31, 0.99, 1.87 all reproduce); a chart left holding
 *     the scaled answer stayed at 31% of its box for good. Now the observer exists only for
 *     non-responsive charts, and it passes layout pixels instead of re-measuring.
 *   v1.1.1 — 2026-07-25 — Give the canvas size back to Chart.js. The injected
 *     `.aimeat-chart-container canvas { width:100%!important; height:auto!important }` overrode the
 *     inline height Chart.js writes and then watches, so in any height-constrained container the
 *     two fought: measured 14 distinct canvas sizes in 3 seconds, visible as a fast flicker between
 *     two renderings. Only display:block and max-width remain.
 *   v1.1.0 — 2026-07-25 — Charts follow the theme. The palette is resolved from the theme tokens
 *     when a chart is drawn, and every chart this lib owns is repainted when the palette or the
 *     light/dark mode changes. The old list called itself "the AIMEAT brand palette" and was
 *     Tailwind's indigo/violet default: it was neither the house coral nor aware of the five
 *     palettes the theme system ships, so every chart in every app was off-brand and stayed that
 *     way when the reader switched look. A canvas cannot inherit a CSS variable the way a div can,
 *     which is why this needs resolving at draw time plus a repaint, not a stylesheet rule.
 *     Datasets that carry their own colours are still left alone.
 */
(function (AIMEAT) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  /** Supported Chart.js chart types. */
  var TYPES = ['bar', 'line', 'pie', 'doughnut', 'radar', 'scatter', 'bubble'];

  /**
   * Used when the page has no AIMEAT theme loaded, so a bare Chart.js page still gets a chart
   * with distinguishable series rather than ten black bars.
   */
  var FALLBACK_PALETTE = [
    '#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd',
    '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
    '#ec4899', '#14b8a6'
  ];

  /** The theme tokens a chart draws from, in the order a reader should see them. */
  var PALETTE_TOKENS = [
    '--color-primary', '--color-secondary', '--color-accent', '--color-info',
    '--color-success', '--color-warning', '--color-error'
  ];

  /**
   * The palette in effect right now, read from the theme.
   *
   * Resolved per draw rather than once at load: the theme has two axes (light/dark and five
   * palettes) and both can change while the page is open.
   *
   * @param {Element=} host element to resolve against — the tokens live on :root, but resolving
   *   against the chart's own container lets a scoped override win.
   * @returns {string[]} colours, or FALLBACK_PALETTE when no theme is present.
   */
  function themePalette(host) {
    try {
      var cs = window.getComputedStyle(host || document.documentElement);
      var out = [];
      PALETTE_TOKENS.forEach(function (name) {
        var v = String(cs.getPropertyValue(name) || '').trim();
        if (v && out.indexOf(v) === -1) out.push(v);
      });
      /* Two colours cannot carry a multi-series chart, so a half-defined theme falls back whole
         rather than mixing house colours with Tailwind defaults. */
      return out.length >= 3 ? out : FALLBACK_PALETTE;
    } catch (_e) {
      return FALLBACK_PALETTE;
    }
  }

  /** Chart types where each data-point gets its own colour slice. */
  var SLICE_TYPES = ['pie', 'doughnut'];

  // ---------------------------------------------------------------------------
  // CSS injection (once)
  // ---------------------------------------------------------------------------

  var stylesInjected = false;

  /**
   * Inject the baseline CSS rules needed for chart containers.
   * Called lazily on first ChartPanel / ChartBuilder invocation.
   */
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var css =
      '.aimeat-chart-container {' +
      '  position: relative;' +
      '  width: 100%;' +
      '  max-width: 100%;' +
      '  box-sizing: border-box;' +
      '}' +
      /* Chart.js owns the canvas size in responsive mode: it writes style.width/height inline
         and watches the result. These two !important rules overrode that inline height, so the
         canvas rendered at the backing store's own ratio instead, Chart.js's ResizeObserver saw a
         different size and wrote the height again — a two-state oscillation, several times a
         second, whenever the container height was constrained. Two authorities for one value.
         display:block stays (it removes the inline-element baseline gap); the sizing is Chart.js's. */
      '.aimeat-chart-container canvas {' +
      '  display: block;' +
      '  max-width: 100%;' +
      '}' +
      '.aimeat-chart-error {' +
      '  padding: 20px;' +
      '  color: #ef4444;' +
      '  text-align: center;' +
      '  font-family: system-ui, -apple-system, sans-serif;' +
      '  font-size: 14px;' +
      '  border: 1px dashed #ef4444;' +
      '  border-radius: 8px;' +
      '  background: rgba(239, 68, 68, 0.05);' +
      '}' +
      '.aimeat-chart-loading {' +
      '  padding: 20px;' +
      '  color: #6366f1;' +
      '  text-align: center;' +
      '  font-family: system-ui, -apple-system, sans-serif;' +
      '  font-size: 14px;' +
      '}';

    var style = document.createElement('style');
    style.setAttribute('data-aimeat', 'charts');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Render an error message inside the target element.
   * @param {HTMLElement} el  Target container.
   * @param {string}      msg Human-readable error text.
   */
  function showError(el, msg) {
    el.innerHTML = '<div class="aimeat-chart-error">' + escapeHtml(msg) + '</div>';
  }

  /**
   * Render a loading indicator inside the target element.
   * @param {HTMLElement} el Target container.
   */
  function showLoading(el) {
    el.innerHTML = '<div class="aimeat-chart-loading">Loading chart&hellip;</div>';
  }

  /**
   * Minimal HTML-entity escaping for safe text insertion.
   * @param {string} str Raw string.
   * @returns {string} Escaped string safe for innerHTML.
   */
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /**
   * Validate that Chart.js is available on the page.
   * @returns {boolean} true if window.Chart exists.
   */
  function hasChartJs() {
    return typeof window.Chart === 'function' || typeof window.Chart === 'object';
  }

  /**
   * Deep-clone chart data and apply the AIMEAT palette to any dataset that is
   * missing an explicit backgroundColor.
   *
   * For "slice" chart types (pie, doughnut, polarArea) each data-point receives
   * its own colour from the palette.  For all other types each dataset receives
   * a single colour.
   *
   * @param {object} data  Chart.js data object ({ labels, datasets }).
   * @param {string} type  Chart type string (e.g. 'bar', 'pie').
   * @param {Element=} host container to resolve the theme against.
   * @returns {object} Cloned data with palette applied.
   */
  function applyPalette(data, type, host) {
    var d = JSON.parse(JSON.stringify(data));
    var isSlice = SLICE_TYPES.indexOf(type) !== -1;
    var PALETTE = themePalette(host);

    d.datasets.forEach(function (ds, i) {
      if (!ds.backgroundColor) {
        if (isSlice) {
          // One colour per data-point, cycling through the palette.
          ds.backgroundColor = ds.data.map(function (_val, j) {
            return PALETTE[j % PALETTE.length];
          });
        } else {
          // Single colour per dataset.
          ds.backgroundColor = PALETTE[i % PALETTE.length];
        }
      }

      // Default borderColor to match backgroundColor when not explicitly set.
      if (!ds.borderColor && ds.backgroundColor) {
        ds.borderColor = ds.backgroundColor;
      }
    });

    return d;
  }

  // ---------------------------------------------------------------------------
  // Following the theme
  // ---------------------------------------------------------------------------

  /**
   * Every chart this lib currently owns, with the data the CALLER passed.
   *
   * The caller's data is what gets kept, not the drawn data: applyPalette fills in a colour where
   * one was missing, so re-applying it to already-drawn data would find every dataset "already
   * coloured" and change nothing. Recolouring has to start from the original each time, which
   * also keeps the promise that a dataset with its own colour is never overridden.
   */
  var live = [];
  var watching = false;

  /** Drop charts whose canvas has left the document, so a long-lived page does not accumulate. */
  function pruneLive() {
    live = live.filter(function (rec) {
      var c = rec.chart;
      return c && c.canvas && c.canvas.isConnected;
    });
  }

  /** Repaint every live chart against the theme as it is now. */
  function repaintAll() {
    pruneLive();
    live.forEach(function (rec) {
      try {
        var next = applyPalette(rec.data, rec.type, rec.el);
        rec.chart.data.datasets.forEach(function (ds, i) {
          var src = next.datasets[i];
          if (!src) return;
          ds.backgroundColor = src.backgroundColor;
          ds.borderColor = src.borderColor;
        });
        /* A plain update(), not update('none'): the 'none' mode skips the element style cache
           as well as the animation, so a bar chart kept its old fill while its own legend showed
           the new one. Measured on canvas pixels, not inferred. The colour transition it animates
           instead is the right feel for a palette change. */
        rec.chart.update();
      } catch (_e) { /* one bad chart must not stop the rest */ }
    });
  }

  /**
   * Watch the theme. A MutationObserver on the two attributes rather than the
   * 'aimeat-palette-change' event, because light/dark has no event of its own and an app is free
   * to set either attribute directly — the attribute is the thing that is actually true.
   */
  function watchTheme() {
    if (watching || typeof MutationObserver === 'undefined') return;
    watching = true;
    try {
      new MutationObserver(repaintAll).observe(document.documentElement, {
        attributes: true, attributeFilter: ['data-theme', 'data-palette']
      });
    } catch (_e) { watching = false; }
  }

  /**
   * Create a <canvas> inside the given container, wrapped in the standard
   * .aimeat-chart-container div.
   *
   * @param {HTMLElement} el Parent element (its contents will be replaced).
   * @returns {HTMLCanvasElement} The newly created canvas.
   */
  function createCanvas(el) {
    el.innerHTML = '';
    var wrapper = document.createElement('div');
    wrapper.className = 'aimeat-chart-container';
    var canvas = document.createElement('canvas');
    wrapper.appendChild(canvas);
    el.appendChild(wrapper);
    return canvas;
  }

  /**
   * Keep a chart sized to its container.
   *
   * A responsive chart is already watched by Chart.js itself, and Chart.js measures the right
   * thing: its own ResizeObserver hands `resize()` the entry's contentRect, which is layout
   * pixels. `chart.resize()` with no arguments measures the container with
   * getBoundingClientRect() instead — and inside an ancestor carrying `transform: scale(k)`, as
   * every zoomable board has, that rect is k times the layout size. Two observers, two answers,
   * one canvas: measured on ORIGAMI while dragging a frame's resize grip, the canvas got two
   * style writes per pointer move, one correct and one exactly k x correct — 30 writes for 15
   * moves at k=0.31, k=0.99 and k=1.87 alike. Without this second observer: 15 writes, one size.
   * A chart left holding the scaled answer stayed at 31% of its box and never recovered.
   *
   * So the observer is only for the non-responsive case, where Chart.js watches nothing — and
   * even there it passes layout pixels explicitly rather than asking for a fresh measurement.
   *
   * @param {object}      chart Chart.js instance.
   * @param {HTMLElement}  el    The outer container element.
   */
  function observeResize(chart, el) {
    if (typeof ResizeObserver === 'undefined') return;
    if (!chart.options || chart.options.responsive !== false) return;

    var observer = new ResizeObserver(function () {
      try {
        /* clientWidth/clientHeight, never the no-argument resize(): these are layout pixels and
           stay true inside a scaled ancestor. The box is the canvas's own parent, which is what
           Chart.js measures. */
        var box = chart.canvas && chart.canvas.parentElement;
        if (box) chart.resize(box.clientWidth, box.clientHeight);
      } catch (_e) {
        // Chart may have been destroyed — silently ignore.
      }
    });

    observer.observe(el);

    // Store the observer reference so callers could disconnect later if needed.
    chart._aimeatResizeObserver = observer;
  }

  /**
   * Build default Chart.js options, merged with any caller-supplied overrides.
   *
   * @param {string}  title   Optional chart title string.
   * @param {object=} extras  Caller-supplied Chart.js options to merge in.
   * @returns {object} Merged options object.
   */
  function buildOptions(title, extras) {
    var base = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: { enabled: true }
      }
    };

    // Add title plugin when a title string is provided.
    if (title) {
      base.plugins.title = {
        display: true,
        text: title,
        font: { size: 16, weight: 'bold' },
        padding: { bottom: 12 }
      };
    }

    // Merge caller overrides (shallow one-level merge for plugins).
    if (extras) {
      var merged = Object.assign({}, base, extras);
      if (extras.plugins) {
        merged.plugins = Object.assign({}, base.plugins, extras.plugins);
      }
      return merged;
    }

    return base;
  }

  // ---------------------------------------------------------------------------
  // ChartBuilder — render a chart from inline data
  // ---------------------------------------------------------------------------

  /**
   * Render a Chart.js chart from inline data.
   *
   * @param {object}  opts
   * @param {string}  opts.elementId  DOM id of the target container element.
   * @param {object}  opts.data       Chart.js data ({ labels, datasets }).
   * @param {string}  opts.type       Chart type (bar, line, pie, ...).
   * @param {string=} opts.title      Optional chart title.
   * @param {object=} opts.options    Optional Chart.js options overrides.
   * @returns {Chart|null} The Chart.js instance, or null on error.
   */
  function ChartBuilder(opts) {
    injectStyles();

    // --- Validate inputs ---------------------------------------------------

    if (!opts || !opts.elementId) {
      console.error('[aimeat-charts] ChartBuilder: elementId is required.');
      return null;
    }

    var el = document.getElementById(opts.elementId);
    if (!el) {
      console.error('[aimeat-charts] ChartBuilder: element not found: #' + opts.elementId);
      return null;
    }

    if (!hasChartJs()) {
      showError(el,
        'Chart.js is not loaded. Add this before aimeat-charts.js:\n' +
        '<script src="/lib/chartjs@4.js"><\/script>'
      );
      return null;
    }

    if (!opts.type || TYPES.indexOf(opts.type) === -1) {
      showError(el, 'Invalid chart type: "' + (opts.type || '') + '". Supported: ' + TYPES.join(', '));
      return null;
    }

    if (!opts.data || !opts.data.datasets || !opts.data.datasets.length) {
      showError(el, 'Chart data with at least one dataset is required.');
      return null;
    }

    // --- Build chart -------------------------------------------------------

    try {
      var canvas = createCanvas(el);
      var chartData = applyPalette(opts.data, opts.type, el);
      var chartOptions = buildOptions(opts.title, opts.options);

      var chart = new window.Chart(canvas, {
        type: opts.type,
        data: chartData,
        options: chartOptions
      });

      observeResize(chart, el);
      pruneLive();
      live.push({ chart: chart, el: el, data: opts.data, type: opts.type });
      watchTheme();
      return chart;
    } catch (err) {
      showError(el, 'Failed to render chart: ' + (err.message || String(err)));
      console.error('[aimeat-charts] ChartBuilder error:', err);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // ChartPanel — fetch chart data from AIMEAT storage, then render
  // ---------------------------------------------------------------------------

  /**
   * Fetch a chart definition from AIMEAT memory and render it.
   *
   * The memory value is expected to follow the chart-data schema defined in the
   * aimeat-charts extension manifest:
   *   { type, title?, data: { labels, datasets }, options? }
   *
   * @param {object}  opts
   * @param {string}  opts.elementId  DOM id of the target container element.
   * @param {string}  opts.chartKey   AIMEAT memory key (e.g. "chart:sales-2024").
   * @param {string}  opts.nodeUrl    AIMEAT node base URL (no trailing slash).
   * @param {string=} opts.token      Optional bearer token for authenticated requests.
   * @returns {Promise<Chart|null>} Resolves to the Chart.js instance or null.
   */
  function ChartPanel(opts) {
    injectStyles();

    // --- Validate inputs ---------------------------------------------------

    if (!opts || !opts.elementId) {
      console.error('[aimeat-charts] ChartPanel: elementId is required.');
      return Promise.resolve(null);
    }

    var el = document.getElementById(opts.elementId);
    if (!el) {
      console.error('[aimeat-charts] ChartPanel: element not found: #' + opts.elementId);
      return Promise.resolve(null);
    }

    if (!hasChartJs()) {
      showError(el,
        'Chart.js is not loaded. Add this before aimeat-charts.js:\n' +
        '<script src="/lib/chartjs@4.js"><\/script>'
      );
      return Promise.resolve(null);
    }

    if (!opts.chartKey) {
      showError(el, 'chartKey is required (e.g. "chart:sales-2024").');
      return Promise.resolve(null);
    }

    if (!opts.nodeUrl) {
      showError(el, 'nodeUrl is required (e.g. "http://localhost:40050").');
      return Promise.resolve(null);
    }

    // --- Fetch and render --------------------------------------------------

    showLoading(el);

    var url = opts.nodeUrl.replace(/\/+$/, '') +
              '/v1/memory/' +
              encodeURIComponent(opts.chartKey);

    var headers = { 'Accept': 'application/json' };
    if (opts.token) {
      headers['Authorization'] = 'Bearer ' + opts.token;
    }

    return fetch(url, { headers: headers })
      .then(function (res) {
        if (!res.ok) {
          throw new Error('HTTP ' + res.status + ' — could not load chart key "' + opts.chartKey + '"');
        }
        return res.json();
      })
      .then(function (response) {
        // The AIMEAT response envelope: { status, node_id, data: { key, value, ... }, hints }
        var chartDef = response && response.data && response.data.value;

        if (!chartDef) {
          throw new Error('No chart data found at key "' + opts.chartKey + '"');
        }

        if (!chartDef.type || TYPES.indexOf(chartDef.type) === -1) {
          throw new Error(
            'Invalid chart type "' + (chartDef.type || '') +
            '" in stored data. Supported: ' + TYPES.join(', ')
          );
        }

        if (!chartDef.data || !chartDef.data.datasets || !chartDef.data.datasets.length) {
          throw new Error('Stored chart data is missing datasets.');
        }

        // Render using ChartBuilder logic (inline).
        var canvas = createCanvas(el);
        var chartData = applyPalette(chartDef.data, chartDef.type);
        var chartOptions = buildOptions(
          chartDef.title,
          chartDef.options || opts.options
        );

        var chart = new window.Chart(canvas, {
          type: chartDef.type,
          data: chartData,
          options: chartOptions
        });

        observeResize(chart, el);
        return chart;
      })
      .catch(function (err) {
        showError(el, 'Chart load failed: ' + (err.message || String(err)));
        console.error('[aimeat-charts] ChartPanel error:', err);
        return null;
      });
  }

  // ---------------------------------------------------------------------------
  // Register with the AIMEAT extension system
  // ---------------------------------------------------------------------------

  // Ensure the global register helper exists (defensive — the Cortex loader
  // normally provides it, but extensions should be loadable standalone too).
  if (typeof AIMEAT.register !== 'function') {
    AIMEAT.register = function (name, exports) {
      AIMEAT[name] = exports;
    };
  }

  var exports = {
    ChartPanel: ChartPanel,
    ChartBuilder: ChartBuilder,
    TYPES: TYPES,
    VERSION: '1.1.2',
    /** The palette a chart would draw with right now, for legends and non-canvas visuals. */
    palette: themePalette
  };

  AIMEAT.register('aimeat-charts', exports);

  // Also expose under the short alias "charts" for convenience:
  // AIMEAT.charts.ChartBuilder(...)
  if (!AIMEAT.charts) {
    AIMEAT.charts = exports;
  }

})(window.AIMEAT || (window.AIMEAT = {}));
