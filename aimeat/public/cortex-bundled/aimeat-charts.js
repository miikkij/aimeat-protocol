/**
 * aimeat-charts — Chart.js wrapper for the AIMEAT Cortex extension system.
 *
 * Provides ChartPanel (fetch-from-storage) and ChartBuilder (inline data)
 * components that render responsive, themed Chart.js charts.
 *
 * Requires Chart.js to be loaded first:
 *   <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
 *   <script src="/v1/cortex/aimeat-charts/libs/aimeat-charts.js"></script>
 *
 * Usage:
 *   AIMEAT.charts.ChartBuilder({ elementId: 'my-chart', type: 'bar', data: {...} })
 *   AIMEAT.charts.ChartPanel({ elementId: 'my-chart', chartKey: 'chart:sales-2024', nodeUrl: '...' })
 */
(function (AIMEAT) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  /** Supported Chart.js chart types. */
  var TYPES = ['bar', 'line', 'pie', 'doughnut', 'radar', 'scatter', 'bubble'];

  /** AIMEAT brand palette — used as default colours when datasets omit backgroundColor. */
  var PALETTE = [
    '#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd',
    '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
    '#ec4899', '#14b8a6'
  ];

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
      '.aimeat-chart-container canvas {' +
      '  display: block;' +
      '  width: 100% !important;' +
      '  height: auto !important;' +
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
   * @returns {object} Cloned data with palette applied.
   */
  function applyPalette(data, type) {
    var d = JSON.parse(JSON.stringify(data));
    var isSlice = SLICE_TYPES.indexOf(type) !== -1;

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
   * Attach a ResizeObserver to the chart's parent so Chart.js can re-draw when
   * the container size changes (e.g. responsive layout, collapsible panels).
   *
   * @param {object}      chart Chart.js instance.
   * @param {HTMLElement}  el    The outer container element.
   */
  function observeResize(chart, el) {
    if (typeof ResizeObserver === 'undefined') return;

    var observer = new ResizeObserver(function () {
      try {
        chart.resize();
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
        '<script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>'
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
      var chartData = applyPalette(opts.data, opts.type);
      var chartOptions = buildOptions(opts.title, opts.options);

      var chart = new window.Chart(canvas, {
        type: opts.type,
        data: chartData,
        options: chartOptions
      });

      observeResize(chart, el);
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
        '<script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>'
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
    TYPES: TYPES
  };

  AIMEAT.register('aimeat-charts', exports);

  // Also expose under the short alias "charts" for convenience:
  // AIMEAT.charts.ChartBuilder(...)
  if (!AIMEAT.charts) {
    AIMEAT.charts = exports;
  }

})(window.AIMEAT || (window.AIMEAT = {}));
