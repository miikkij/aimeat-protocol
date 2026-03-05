/**
 * aimeat-canvas — A full-featured drawing canvas for the AIMEAT Cortex extension system.
 *
 * Provides DrawingCanvas: a complete drawing tool with pen, line, rect, circle,
 * eraser, and text tools. Supports undo/redo, auto-save to AIMEAT storage,
 * PNG/SVG export, touch/mouse input, and responsive layout.
 *
 * Zero external dependencies — pure Canvas API.
 *
 * Usage:
 *   <script src="/v1/cortex/aimeat-canvas/libs/aimeat-canvas.js"></script>
 *   <script>
 *     var dc = AIMEAT.canvas.DrawingCanvas({
 *       elementId: 'my-canvas',
 *       storageKey: 'drawing:my-sketch',
 *       nodeUrl: 'http://localhost:40050'
 *     });
 *   </script>
 */
(function (AIMEAT) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  /** All supported drawing tools. */
  var TOOLS = ['pen', 'line', 'rect', 'circle', 'eraser', 'text'];

  /** AIMEAT brand colour palette for the toolbar swatches. */
  var PALETTE = [
    '#000000', '#ffffff', '#6366f1', '#8b5cf6',
    '#ef4444', '#f59e0b', '#10b981', '#3b82f6',
    '#ec4899', '#64748b'
  ];

  /** Human-readable labels for toolbar tool buttons. */
  var TOOL_LABELS = {
    pen: 'Pen',
    line: 'Line',
    rect: 'Rect',
    circle: 'Circle',
    eraser: 'Eraser',
    text: 'Text'
  };

  /** SVG icons for toolbar tool buttons (16x16 viewBox). */
  var TOOL_ICONS = {
    pen: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M12.1 1.3l2.6 2.6-9.7 9.7L2 15l1.4-3L13 2.3z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    line: '<svg viewBox="0 0 16 16" width="16" height="16"><line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    rect: '<svg viewBox="0 0 16 16" width="16" height="16"><rect x="2" y="3" width="12" height="10" fill="none" stroke="currentColor" stroke-width="1.2" rx="1"/></svg>',
    circle: '<svg viewBox="0 0 16 16" width="16" height="16"><ellipse cx="8" cy="8" rx="6" ry="5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    eraser: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M5 14h8M3.5 10.5l3-3 5 5-3 3-5-5z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6.5 7.5l5-5 2 2-5 5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    text: '<svg viewBox="0 0 16 16" width="16" height="16"><text x="3" y="13" font-size="13" font-family="serif" fill="currentColor">T</text></svg>'
  };

  // ---------------------------------------------------------------------------
  // CSS injection (once)
  // ---------------------------------------------------------------------------

  var stylesInjected = false;

  /**
   * Inject all CSS rules needed for the canvas UI.
   * Called lazily on first DrawingCanvas invocation.
   */
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var css =
      /* Container */
      '.aimeat-canvas-wrap {' +
      '  font-family: system-ui, -apple-system, sans-serif;' +
      '  font-size: 13px;' +
      '  line-height: 1.4;' +
      '  color: #e2e8f0;' +
      '  background: #1e1e2e;' +
      '  border: 1px solid rgba(255,255,255,0.08);' +
      '  border-radius: 10px;' +
      '  overflow: hidden;' +
      '  display: flex;' +
      '  flex-direction: column;' +
      '  max-width: 100%;' +
      '}' +

      /* Toolbar (top) */
      '.aimeat-canvas-toolbar {' +
      '  display: flex;' +
      '  flex-wrap: wrap;' +
      '  align-items: center;' +
      '  gap: 6px;' +
      '  padding: 8px 10px;' +
      '  background: rgba(255,255,255,0.04);' +
      '  border-bottom: 1px solid rgba(255,255,255,0.06);' +
      '}' +

      /* Toolbar section divider */
      '.aimeat-canvas-toolbar-sep {' +
      '  width: 1px;' +
      '  height: 24px;' +
      '  background: rgba(255,255,255,0.1);' +
      '  margin: 0 2px;' +
      '}' +

      /* Tool buttons */
      '.aimeat-canvas-toolbar button {' +
      '  display: inline-flex;' +
      '  align-items: center;' +
      '  justify-content: center;' +
      '  gap: 4px;' +
      '  padding: 5px 10px;' +
      '  border: 1px solid rgba(255,255,255,0.1);' +
      '  border-radius: 6px;' +
      '  background: rgba(255,255,255,0.05);' +
      '  color: #cbd5e1;' +
      '  cursor: pointer;' +
      '  font-size: 12px;' +
      '  font-family: inherit;' +
      '  transition: background 0.15s, border-color 0.15s, color 0.15s;' +
      '  white-space: nowrap;' +
      '}' +
      '.aimeat-canvas-toolbar button:hover {' +
      '  background: rgba(255,255,255,0.1);' +
      '  color: #f1f5f9;' +
      '}' +
      '.aimeat-canvas-toolbar button.active {' +
      '  background: #6366f1;' +
      '  border-color: #818cf8;' +
      '  color: #fff;' +
      '}' +

      /* Color swatches */
      '.aimeat-canvas-colors {' +
      '  display: flex;' +
      '  flex-wrap: wrap;' +
      '  gap: 3px;' +
      '  align-items: center;' +
      '}' +
      '.aimeat-canvas-swatch {' +
      '  width: 20px;' +
      '  height: 20px;' +
      '  border-radius: 4px;' +
      '  border: 2px solid transparent;' +
      '  cursor: pointer;' +
      '  padding: 0;' +
      '  transition: border-color 0.15s, transform 0.1s;' +
      '}' +
      '.aimeat-canvas-swatch:hover {' +
      '  transform: scale(1.15);' +
      '}' +
      '.aimeat-canvas-swatch.active {' +
      '  border-color: #6366f1;' +
      '  box-shadow: 0 0 0 1px rgba(99,102,241,0.4);' +
      '}' +
      '.aimeat-canvas-color-input {' +
      '  width: 26px;' +
      '  height: 22px;' +
      '  border: 1px solid rgba(255,255,255,0.15);' +
      '  border-radius: 4px;' +
      '  cursor: pointer;' +
      '  padding: 0;' +
      '  background: none;' +
      '}' +

      /* Sliders */
      '.aimeat-canvas-slider-group {' +
      '  display: flex;' +
      '  align-items: center;' +
      '  gap: 4px;' +
      '}' +
      '.aimeat-canvas-slider-group label {' +
      '  font-size: 11px;' +
      '  color: #94a3b8;' +
      '  min-width: 30px;' +
      '}' +
      '.aimeat-canvas-slider-group input[type="range"] {' +
      '  width: 70px;' +
      '  accent-color: #6366f1;' +
      '}' +
      '.aimeat-canvas-slider-group .aimeat-canvas-slider-val {' +
      '  font-size: 11px;' +
      '  color: #94a3b8;' +
      '  min-width: 24px;' +
      '  text-align: right;' +
      '}' +

      /* Canvas area */
      '.aimeat-canvas-area {' +
      '  position: relative;' +
      '  overflow: auto;' +
      '  display: flex;' +
      '  justify-content: center;' +
      '  background: #0f0f1a;' +
      '}' +
      '.aimeat-canvas-area canvas {' +
      '  display: block;' +
      '  cursor: crosshair;' +
      '}' +

      /* Bottom bar */
      '.aimeat-canvas-bottombar {' +
      '  display: flex;' +
      '  flex-wrap: wrap;' +
      '  align-items: center;' +
      '  gap: 6px;' +
      '  padding: 8px 10px;' +
      '  background: rgba(255,255,255,0.04);' +
      '  border-top: 1px solid rgba(255,255,255,0.06);' +
      '}' +
      '.aimeat-canvas-bottombar button {' +
      '  display: inline-flex;' +
      '  align-items: center;' +
      '  gap: 4px;' +
      '  padding: 5px 10px;' +
      '  border: 1px solid rgba(255,255,255,0.1);' +
      '  border-radius: 6px;' +
      '  background: rgba(255,255,255,0.05);' +
      '  color: #cbd5e1;' +
      '  cursor: pointer;' +
      '  font-size: 12px;' +
      '  font-family: inherit;' +
      '  transition: background 0.15s, color 0.15s;' +
      '  white-space: nowrap;' +
      '}' +
      '.aimeat-canvas-bottombar button:hover {' +
      '  background: rgba(255,255,255,0.1);' +
      '  color: #f1f5f9;' +
      '}' +
      '.aimeat-canvas-bottombar button:disabled {' +
      '  opacity: 0.35;' +
      '  cursor: default;' +
      '}' +
      '.aimeat-canvas-bottombar .aimeat-canvas-spacer {' +
      '  flex: 1;' +
      '}' +
      '.aimeat-canvas-status {' +
      '  font-size: 11px;' +
      '  color: #64748b;' +
      '  margin-left: auto;' +
      '}' +

      /* Error display */
      '.aimeat-canvas-error {' +
      '  padding: 20px;' +
      '  color: #ef4444;' +
      '  text-align: center;' +
      '  font-family: system-ui, -apple-system, sans-serif;' +
      '  font-size: 14px;' +
      '  border: 1px dashed #ef4444;' +
      '  border-radius: 8px;' +
      '  background: rgba(239, 68, 68, 0.05);' +
      '}';

    var style = document.createElement('style');
    style.setAttribute('data-aimeat', 'canvas');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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
   * Render an error message inside the target element.
   * @param {HTMLElement} el  Target container.
   * @param {string}      msg Human-readable error text.
   */
  function showError(el, msg) {
    el.innerHTML = '<div class="aimeat-canvas-error">' + escapeHtml(msg) + '</div>';
  }

  /**
   * Get mouse/touch coordinates relative to the canvas element.
   * Handles both MouseEvent and TouchEvent.
   * @param {HTMLCanvasElement} canvas  The canvas element.
   * @param {Event}             e       Mouse or touch event.
   * @returns {{x: number, y: number}} Coordinates relative to canvas.
   */
  function getCanvasPoint(canvas, e) {
    var rect = canvas.getBoundingClientRect();
    var clientX, clientY;

    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: Math.round(clientX - rect.left),
      y: Math.round(clientY - rect.top)
    };
  }

  /**
   * Simple debounce utility.
   * @param {Function} fn    Function to debounce.
   * @param {number}   delay Delay in milliseconds.
   * @returns {Function} Debounced function.
   */
  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var ctx = this;
      var args = arguments;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fn.apply(ctx, args);
      }, delay);
    };
  }

  /**
   * Trigger a file download in the browser.
   * @param {string} dataUrl  Data URL or blob URL.
   * @param {string} filename Suggested filename.
   */
  function triggerDownload(dataUrl, filename) {
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ---------------------------------------------------------------------------
  // Stroke rendering
  // ---------------------------------------------------------------------------

  /**
   * Render a single stroke onto a 2D canvas context.
   * @param {CanvasRenderingContext2D} ctx    Canvas context.
   * @param {object}                   stroke Stroke data object.
   * @param {string}                   bgColor Background colour (for eraser).
   */
  function renderStroke(ctx, stroke, bgColor) {
    var points = stroke.points || [];
    if (points.length === 0) return;

    ctx.save();
    ctx.globalAlpha = stroke.opacity != null ? stroke.opacity : 1;
    ctx.lineWidth = stroke.lineWidth || 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (stroke.tool) {
      case 'pen':
        ctx.strokeStyle = stroke.color || '#000000';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (var i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.stroke();
        break;

      case 'eraser':
        // Eraser draws with the background colour.
        ctx.strokeStyle = bgColor || '#ffffff';
        ctx.globalAlpha = 1; // Eraser is always fully opaque.
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (var j = 1; j < points.length; j++) {
          ctx.lineTo(points[j].x, points[j].y);
        }
        ctx.stroke();
        break;

      case 'line':
        ctx.strokeStyle = stroke.color || '#000000';
        if (points.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
          ctx.stroke();
        }
        break;

      case 'rect':
        ctx.strokeStyle = stroke.color || '#000000';
        if (points.length >= 2) {
          var rx = Math.min(points[0].x, points[1].x);
          var ry = Math.min(points[0].y, points[1].y);
          var rw = Math.abs(points[1].x - points[0].x);
          var rh = Math.abs(points[1].y - points[0].y);
          ctx.strokeRect(rx, ry, rw, rh);
        }
        break;

      case 'circle':
        ctx.strokeStyle = stroke.color || '#000000';
        if (points.length >= 2) {
          var cx = points[0].x;
          var cy = points[0].y;
          var radiusX = Math.abs(points[1].x - cx);
          var radiusY = Math.abs(points[1].y - cy);
          ctx.beginPath();
          ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;

      case 'text':
        ctx.fillStyle = stroke.color || '#000000';
        var fontSize = stroke.fontSize || 16;
        ctx.font = fontSize + 'px system-ui, -apple-system, sans-serif';
        ctx.textBaseline = 'top';
        if (stroke.text) {
          ctx.fillText(stroke.text, points[0].x, points[0].y);
        }
        break;

      default:
        break;
    }

    ctx.restore();
  }

  /**
   * Redraw the entire canvas from scratch: fill background, then render
   * every stroke in order.
   * @param {CanvasRenderingContext2D} ctx     Canvas context.
   * @param {number}                   width   Canvas width.
   * @param {number}                   height  Canvas height.
   * @param {string}                   bgColor Background colour.
   * @param {object[]}                 strokes Array of stroke objects.
   */
  function redrawCanvas(ctx, width, height, bgColor, strokes) {
    ctx.clearRect(0, 0, width, height);

    // Fill background.
    ctx.fillStyle = bgColor || '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Render each stroke.
    for (var i = 0; i < strokes.length; i++) {
      renderStroke(ctx, strokes[i], bgColor);
    }
  }

  // ---------------------------------------------------------------------------
  // SVG export
  // ---------------------------------------------------------------------------

  /**
   * Reconstruct the drawing as an SVG string from the stroke data.
   * @param {number}   width   Canvas width.
   * @param {number}   height  Canvas height.
   * @param {string}   bgColor Background colour.
   * @param {object[]} strokes Array of stroke objects.
   * @returns {string} SVG markup.
   */
  function buildSvg(width, height, bgColor, strokes) {
    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">');
    parts.push('<rect width="' + width + '" height="' + height + '" fill="' + escapeHtml(bgColor || '#ffffff') + '"/>');

    for (var i = 0; i < strokes.length; i++) {
      var s = strokes[i];
      var pts = s.points || [];
      if (pts.length === 0) continue;

      var opacity = s.opacity != null ? s.opacity : 1;
      var lw = s.lineWidth || 2;
      var color = escapeHtml(s.color || '#000000');

      switch (s.tool) {
        case 'pen':
          if (pts.length === 1) {
            parts.push('<circle cx="' + pts[0].x + '" cy="' + pts[0].y + '" r="' + (lw / 2) + '" fill="' + color + '" opacity="' + opacity + '"/>');
          } else {
            var d = 'M' + pts[0].x + ' ' + pts[0].y;
            for (var j = 1; j < pts.length; j++) {
              d += ' L' + pts[j].x + ' ' + pts[j].y;
            }
            parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + lw + '" stroke-linecap="round" stroke-linejoin="round" opacity="' + opacity + '"/>');
          }
          break;

        case 'eraser':
          // In SVG, represent eraser as strokes in the background colour.
          var eraserColor = escapeHtml(bgColor || '#ffffff');
          if (pts.length === 1) {
            parts.push('<circle cx="' + pts[0].x + '" cy="' + pts[0].y + '" r="' + (lw / 2) + '" fill="' + eraserColor + '"/>');
          } else {
            var ed = 'M' + pts[0].x + ' ' + pts[0].y;
            for (var k = 1; k < pts.length; k++) {
              ed += ' L' + pts[k].x + ' ' + pts[k].y;
            }
            parts.push('<path d="' + ed + '" fill="none" stroke="' + eraserColor + '" stroke-width="' + lw + '" stroke-linecap="round" stroke-linejoin="round"/>');
          }
          break;

        case 'line':
          if (pts.length >= 2) {
            var last = pts[pts.length - 1];
            parts.push('<line x1="' + pts[0].x + '" y1="' + pts[0].y + '" x2="' + last.x + '" y2="' + last.y + '" stroke="' + color + '" stroke-width="' + lw + '" stroke-linecap="round" opacity="' + opacity + '"/>');
          }
          break;

        case 'rect':
          if (pts.length >= 2) {
            var rx = Math.min(pts[0].x, pts[1].x);
            var ry = Math.min(pts[0].y, pts[1].y);
            var rw = Math.abs(pts[1].x - pts[0].x);
            var rh = Math.abs(pts[1].y - pts[0].y);
            parts.push('<rect x="' + rx + '" y="' + ry + '" width="' + rw + '" height="' + rh + '" fill="none" stroke="' + color + '" stroke-width="' + lw + '" opacity="' + opacity + '"/>');
          }
          break;

        case 'circle':
          if (pts.length >= 2) {
            var ecx = pts[0].x;
            var ecy = pts[0].y;
            var erx = Math.abs(pts[1].x - ecx);
            var ery = Math.abs(pts[1].y - ecy);
            parts.push('<ellipse cx="' + ecx + '" cy="' + ecy + '" rx="' + erx + '" ry="' + ery + '" fill="none" stroke="' + color + '" stroke-width="' + lw + '" opacity="' + opacity + '"/>');
          }
          break;

        case 'text':
          if (s.text) {
            var fs = s.fontSize || 16;
            parts.push('<text x="' + pts[0].x + '" y="' + (pts[0].y + fs) + '" font-size="' + fs + '" font-family="system-ui, -apple-system, sans-serif" fill="' + color + '" opacity="' + opacity + '">' + escapeHtml(s.text) + '</text>');
          }
          break;

        default:
          break;
      }
    }

    parts.push('</svg>');
    return parts.join('\n');
  }

  // ---------------------------------------------------------------------------
  // UI builder helpers
  // ---------------------------------------------------------------------------

  /**
   * Create a toolbar button element.
   * @param {string}   label   Button text label.
   * @param {string=}  icon    Optional SVG icon HTML.
   * @param {string=}  title   Tooltip text.
   * @returns {HTMLButtonElement}
   */
  function createButton(label, icon, title) {
    var btn = document.createElement('button');
    btn.type = 'button';
    if (title) btn.title = title;
    if (icon) {
      btn.innerHTML = icon + ' <span>' + escapeHtml(label) + '</span>';
    } else {
      btn.textContent = label;
    }
    return btn;
  }

  /**
   * Create a colour swatch button.
   * @param {string} color Hex colour string.
   * @returns {HTMLButtonElement}
   */
  function createSwatch(color) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'aimeat-canvas-swatch';
    btn.style.background = color;
    btn.title = color;
    // Add a subtle inner shadow on white so it's visible on dark bg.
    if (color.toLowerCase() === '#ffffff' || color.toLowerCase() === '#fff') {
      btn.style.boxShadow = 'inset 0 0 0 1px rgba(0,0,0,0.15)';
    }
    return btn;
  }

  /**
   * Create a slider group (label + range input + value display).
   * @param {string} labelText Label.
   * @param {number} min       Min value.
   * @param {number} max       Max value.
   * @param {number} value     Initial value.
   * @param {number} step      Step increment.
   * @param {Function} onChange Callback(newValue: number).
   * @returns {HTMLElement} Container div.
   */
  function createSlider(labelText, min, max, value, step, onChange) {
    var group = document.createElement('div');
    group.className = 'aimeat-canvas-slider-group';

    var lbl = document.createElement('label');
    lbl.textContent = labelText;
    group.appendChild(lbl);

    var input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    group.appendChild(input);

    var valSpan = document.createElement('span');
    valSpan.className = 'aimeat-canvas-slider-val';
    valSpan.textContent = step < 1 ? value.toFixed(1) : String(value);
    group.appendChild(valSpan);

    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      valSpan.textContent = step < 1 ? v.toFixed(1) : String(Math.round(v));
      if (typeof onChange === 'function') onChange(v);
    });

    // Expose a way to update the display from outside.
    group._setVal = function (v) {
      input.value = String(v);
      valSpan.textContent = step < 1 ? v.toFixed(1) : String(Math.round(v));
    };

    return group;
  }

  /**
   * Create a vertical separator for the toolbar.
   * @returns {HTMLElement}
   */
  function createSep() {
    var sep = document.createElement('div');
    sep.className = 'aimeat-canvas-toolbar-sep';
    return sep;
  }

  // ---------------------------------------------------------------------------
  // DrawingCanvas — main entry point
  // ---------------------------------------------------------------------------

  /**
   * Create a full-featured drawing canvas with toolbar, tools, undo/redo,
   * auto-save, and export capabilities.
   *
   * @param {object}  opts
   * @param {string}  opts.elementId   DOM id of the target container element.
   * @param {string}  opts.storageKey  AIMEAT memory key for auto-save (e.g. 'drawing:my-sketch').
   * @param {string}  opts.nodeUrl     AIMEAT node base URL (no trailing slash).
   * @param {string=} opts.token       Optional bearer token for authenticated requests.
   * @param {object=} opts.options     Optional configuration overrides.
   * @returns {object|null} Controller object, or null on error.
   */
  function DrawingCanvas(opts) {
    injectStyles();

    // -----------------------------------------------------------------------
    // Validate inputs
    // -----------------------------------------------------------------------

    if (!opts || !opts.elementId) {
      console.error('[aimeat-canvas] DrawingCanvas: elementId is required.');
      return null;
    }

    var el = document.getElementById(opts.elementId);
    if (!el) {
      console.error('[aimeat-canvas] DrawingCanvas: element not found: #' + opts.elementId);
      return null;
    }

    // -----------------------------------------------------------------------
    // Merge options with defaults
    // -----------------------------------------------------------------------

    var o = opts.options || {};
    var canvasWidth = o.width || 800;
    var canvasHeight = o.height || 600;
    var enabledTools = o.tools || TOOLS.slice();
    var bgColor = o.backgroundColor || '#ffffff';
    var autoSave = o.autoSave !== false;
    var autoSaveDelay = o.autoSaveDelay || 2000;
    var storageKey = opts.storageKey || '';
    var nodeUrl = (opts.nodeUrl || '').replace(/\/+$/, '');
    var token = opts.token || '';

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    var strokes = [];       // Array of completed stroke objects.
    var redoStack = [];     // Strokes that were undone (for redo).
    var currentStroke = null; // Stroke being drawn right now.
    var isDrawing = false;
    var createdAt = '';     // Timestamp of first save (preserved across undo/clear).

    var activeTool = enabledTools[0] || 'pen';
    var activeColor = '#000000';
    var activeLineWidth = 2;
    var activeOpacity = 1.0;

    // -----------------------------------------------------------------------
    // Build the DOM structure
    // -----------------------------------------------------------------------

    el.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'aimeat-canvas-wrap';

    // -- Top toolbar --------------------------------------------------------
    var toolbar = document.createElement('div');
    toolbar.className = 'aimeat-canvas-toolbar';

    // Tool buttons.
    var toolButtons = {};
    for (var t = 0; t < enabledTools.length; t++) {
      var toolName = enabledTools[t];
      var btn = createButton(
        TOOL_LABELS[toolName] || toolName,
        TOOL_ICONS[toolName] || '',
        TOOL_LABELS[toolName] || toolName
      );
      btn.setAttribute('data-tool', toolName);
      if (toolName === activeTool) btn.classList.add('active');
      toolbar.appendChild(btn);
      toolButtons[toolName] = btn;
    }

    toolbar.appendChild(createSep());

    // Colour swatches.
    var colorsDiv = document.createElement('div');
    colorsDiv.className = 'aimeat-canvas-colors';

    var swatchButtons = [];
    for (var c = 0; c < PALETTE.length; c++) {
      var swatch = createSwatch(PALETTE[c]);
      swatch.setAttribute('data-color', PALETTE[c]);
      if (PALETTE[c] === activeColor) swatch.classList.add('active');
      colorsDiv.appendChild(swatch);
      swatchButtons.push(swatch);
    }

    // Custom colour picker.
    var colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'aimeat-canvas-color-input';
    colorInput.value = activeColor;
    colorInput.title = 'Custom colour';
    colorsDiv.appendChild(colorInput);

    toolbar.appendChild(colorsDiv);

    toolbar.appendChild(createSep());

    // Line width slider.
    var lineWidthSlider = createSlider('Width', 1, 20, activeLineWidth, 1, function (v) {
      activeLineWidth = v;
    });
    toolbar.appendChild(lineWidthSlider);

    // Opacity slider.
    var opacitySlider = createSlider('Opacity', 0.1, 1.0, activeOpacity, 0.1, function (v) {
      activeOpacity = Math.round(v * 10) / 10;
    });
    toolbar.appendChild(opacitySlider);

    wrap.appendChild(toolbar);

    // -- Canvas area --------------------------------------------------------
    var canvasArea = document.createElement('div');
    canvasArea.className = 'aimeat-canvas-area';

    var canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvasArea.appendChild(canvas);

    wrap.appendChild(canvasArea);

    var ctx = canvas.getContext('2d');

    // -- Bottom bar ---------------------------------------------------------
    var bottombar = document.createElement('div');
    bottombar.className = 'aimeat-canvas-bottombar';

    var undoBtn = createButton('Undo', null, 'Undo (Ctrl+Z)');
    var redoBtn = createButton('Redo', null, 'Redo (Ctrl+Y)');
    var clearBtn = createButton('Clear', null, 'Clear canvas');
    var exportPngBtn = createButton('PNG', null, 'Export as PNG');
    var exportSvgBtn = createButton('SVG', null, 'Export as SVG');

    var spacer = document.createElement('div');
    spacer.className = 'aimeat-canvas-spacer';

    var statusSpan = document.createElement('span');
    statusSpan.className = 'aimeat-canvas-status';
    statusSpan.textContent = '';

    bottombar.appendChild(undoBtn);
    bottombar.appendChild(redoBtn);
    bottombar.appendChild(clearBtn);
    bottombar.appendChild(spacer);
    bottombar.appendChild(exportPngBtn);
    bottombar.appendChild(exportSvgBtn);
    bottombar.appendChild(statusSpan);

    wrap.appendChild(bottombar);

    el.appendChild(wrap);

    // Initial draw.
    redrawCanvas(ctx, canvasWidth, canvasHeight, bgColor, strokes);
    updateButtonStates();

    // -----------------------------------------------------------------------
    // Toolbar event handlers
    // -----------------------------------------------------------------------

    // Tool selection.
    toolbar.addEventListener('click', function (e) {
      var target = e.target.closest('button[data-tool]');
      if (!target) return;
      var tool = target.getAttribute('data-tool');
      if (tool) setTool(tool);
    });

    // Colour swatch selection.
    colorsDiv.addEventListener('click', function (e) {
      var target = e.target.closest('.aimeat-canvas-swatch');
      if (!target) return;
      var color = target.getAttribute('data-color');
      if (color) setColor(color);
    });

    // Custom colour input.
    colorInput.addEventListener('input', function () {
      setColor(colorInput.value);
    });

    // -----------------------------------------------------------------------
    // Bottom bar event handlers
    // -----------------------------------------------------------------------

    undoBtn.addEventListener('click', function () { undo(); });
    redoBtn.addEventListener('click', function () { redo(); });
    clearBtn.addEventListener('click', function () { clear(); });
    exportPngBtn.addEventListener('click', function () { exportDrawing('png'); });
    exportSvgBtn.addEventListener('click', function () { exportDrawing('svg'); });

    // -----------------------------------------------------------------------
    // Keyboard shortcuts
    // -----------------------------------------------------------------------

    function handleKeyDown(e) {
      // Only respond when our canvas is within the active focus area.
      if (!el.contains(document.activeElement) && document.activeElement !== document.body) return;

      var isCtrl = e.ctrlKey || e.metaKey;

      if (isCtrl && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if (isCtrl && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    // -----------------------------------------------------------------------
    // Drawing — mouse events
    // -----------------------------------------------------------------------

    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return; // Left button only.
      startDraw(getCanvasPoint(canvas, e));
    });

    canvas.addEventListener('mousemove', function (e) {
      if (!isDrawing) return;
      continueDraw(getCanvasPoint(canvas, e));
    });

    canvas.addEventListener('mouseup', function (e) {
      if (!isDrawing) return;
      endDraw(getCanvasPoint(canvas, e));
    });

    canvas.addEventListener('mouseleave', function (e) {
      if (!isDrawing) return;
      endDraw(getCanvasPoint(canvas, e));
    });

    // -----------------------------------------------------------------------
    // Drawing — touch events
    // -----------------------------------------------------------------------

    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault(); // Prevent scrolling while drawing.
      if (e.touches.length !== 1) return; // Single touch only.
      startDraw(getCanvasPoint(canvas, e));
    }, { passive: false });

    canvas.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (!isDrawing) return;
      continueDraw(getCanvasPoint(canvas, e));
    }, { passive: false });

    canvas.addEventListener('touchend', function (e) {
      e.preventDefault();
      if (!isDrawing) return;
      endDraw(getCanvasPoint(canvas, e));
    }, { passive: false });

    canvas.addEventListener('touchcancel', function (e) {
      e.preventDefault();
      if (!isDrawing) return;
      endDraw(getCanvasPoint(canvas, e));
    }, { passive: false });

    // -----------------------------------------------------------------------
    // Drawing logic
    // -----------------------------------------------------------------------

    /**
     * Begin a new stroke at the given point.
     * @param {{x: number, y: number}} pt Start point.
     */
    function startDraw(pt) {
      // Text tool has special handling — prompt for text on click.
      if (activeTool === 'text') {
        handleTextTool(pt);
        return;
      }

      isDrawing = true;
      currentStroke = {
        tool: activeTool,
        color: activeTool === 'eraser' ? bgColor : activeColor,
        lineWidth: activeLineWidth,
        opacity: activeTool === 'eraser' ? 1 : activeOpacity,
        points: [pt]
      };
    }

    /**
     * Continue the current stroke to the given point.
     * @param {{x: number, y: number}} pt Current point.
     */
    function continueDraw(pt) {
      if (!currentStroke) return;

      if (activeTool === 'pen' || activeTool === 'eraser') {
        // Freehand: accumulate points.
        currentStroke.points.push(pt);
        // Incremental draw for performance: just draw the last segment.
        ctx.save();
        ctx.globalAlpha = currentStroke.opacity;
        ctx.strokeStyle = currentStroke.color;
        ctx.lineWidth = currentStroke.lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        var pts = currentStroke.points;
        ctx.beginPath();
        ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
        ctx.restore();
      } else {
        // Shape tools (line, rect, circle): preview by redrawing.
        currentStroke.points = [currentStroke.points[0], pt];
        redrawCanvas(ctx, canvasWidth, canvasHeight, bgColor, strokes);
        // Draw the in-progress shape as a preview.
        renderStroke(ctx, currentStroke, bgColor);
      }
    }

    /**
     * Finish the current stroke at the given point.
     * @param {{x: number, y: number}} pt End point.
     */
    function endDraw(pt) {
      if (!currentStroke) {
        isDrawing = false;
        return;
      }

      isDrawing = false;

      // For shape tools, set the final end point.
      if (activeTool === 'line' || activeTool === 'rect' || activeTool === 'circle') {
        currentStroke.points = [currentStroke.points[0], pt];
      } else if (activeTool === 'pen' || activeTool === 'eraser') {
        currentStroke.points.push(pt);
      }

      // Commit the stroke.
      strokes.push(currentStroke);
      redoStack.length = 0; // Clear redo on new stroke.
      currentStroke = null;

      // Full redraw to ensure clean state.
      redrawCanvas(ctx, canvasWidth, canvasHeight, bgColor, strokes);
      updateButtonStates();

      // Auto-save.
      if (autoSave && storageKey && nodeUrl) {
        debouncedSave();
      }
    }

    /**
     * Handle the text tool: prompt user for text, then place it.
     * @param {{x: number, y: number}} pt Placement point.
     */
    function handleTextTool(pt) {
      var text = prompt('Enter text:');
      if (!text) return;

      var textStroke = {
        tool: 'text',
        color: activeColor,
        lineWidth: activeLineWidth,
        opacity: activeOpacity,
        points: [pt],
        text: text,
        fontSize: Math.max(activeLineWidth * 8, 12) // Scale font size from line width.
      };

      strokes.push(textStroke);
      redoStack.length = 0;
      redrawCanvas(ctx, canvasWidth, canvasHeight, bgColor, strokes);
      updateButtonStates();

      if (autoSave && storageKey && nodeUrl) {
        debouncedSave();
      }
    }

    // -----------------------------------------------------------------------
    // Undo / redo
    // -----------------------------------------------------------------------

    function undo() {
      if (strokes.length === 0) return;
      var last = strokes.pop();
      redoStack.push(last);
      redrawCanvas(ctx, canvasWidth, canvasHeight, bgColor, strokes);
      updateButtonStates();

      if (autoSave && storageKey && nodeUrl) {
        debouncedSave();
      }
    }

    function redo() {
      if (redoStack.length === 0) return;
      var item = redoStack.pop();
      // Handle composite clear snapshots — restore all strokes at once.
      if (item && item._clearSnapshot) {
        for (var i = 0; i < item._clearSnapshot.length; i++) {
          strokes.push(item._clearSnapshot[i]);
        }
      } else {
        strokes.push(item);
      }
      redrawCanvas(ctx, canvasWidth, canvasHeight, bgColor, strokes);
      updateButtonStates();

      if (autoSave && storageKey && nodeUrl) {
        debouncedSave();
      }
    }

    // -----------------------------------------------------------------------
    // Clear
    // -----------------------------------------------------------------------

    function clear() {
      if (strokes.length === 0) return;
      // Treat clear as a single composite undo operation — push snapshot.
      redoStack.push({ _clearSnapshot: strokes.slice() });
      strokes.length = 0;
      redrawCanvas(ctx, canvasWidth, canvasHeight, bgColor, strokes);
      updateButtonStates();

      if (autoSave && storageKey && nodeUrl) {
        debouncedSave();
      }
    }

    // -----------------------------------------------------------------------
    // Tool / colour / width setters
    // -----------------------------------------------------------------------

    function setTool(name) {
      if (enabledTools.indexOf(name) === -1) return;
      activeTool = name;

      // Update toolbar button active states.
      var keys = Object.keys(toolButtons);
      for (var i = 0; i < keys.length; i++) {
        toolButtons[keys[i]].classList.toggle('active', keys[i] === name);
      }
    }

    function setColor(hex) {
      activeColor = hex;
      colorInput.value = hex;

      // Update swatch active states.
      for (var i = 0; i < swatchButtons.length; i++) {
        swatchButtons[i].classList.toggle(
          'active',
          swatchButtons[i].getAttribute('data-color') === hex
        );
      }
    }

    function setLineWidth(px) {
      var val = Math.max(1, Math.min(20, Math.round(px)));
      activeLineWidth = val;
      lineWidthSlider._setVal(val);
    }

    // -----------------------------------------------------------------------
    // Button state management
    // -----------------------------------------------------------------------

    function updateButtonStates() {
      undoBtn.disabled = strokes.length === 0;
      redoBtn.disabled = redoStack.length === 0;
      clearBtn.disabled = strokes.length === 0;
    }

    // -----------------------------------------------------------------------
    // Status display
    // -----------------------------------------------------------------------

    function setStatus(msg) {
      statusSpan.textContent = msg;
    }

    // -----------------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------------

    function exportDrawing(format) {
      var keyPart = storageKey ? storageKey.replace(/[^a-zA-Z0-9-_]/g, '-') : 'canvas';

      if (format === 'svg') {
        var svgStr = buildSvg(canvasWidth, canvasHeight, bgColor, strokes);
        var blob = new Blob([svgStr], { type: 'image/svg+xml' });
        var url = URL.createObjectURL(blob);
        triggerDownload(url, keyPart + '.svg');
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        setStatus('Exported SVG');
      } else {
        // PNG export via canvas toDataURL.
        var dataUrl = canvas.toDataURL('image/png');
        triggerDownload(dataUrl, keyPart + '.png');
        setStatus('Exported PNG');
      }
    }

    // -----------------------------------------------------------------------
    // Storage — save
    // -----------------------------------------------------------------------

    function saveToStorage() {
      if (!storageKey || !nodeUrl) {
        return Promise.reject(new Error('storageKey and nodeUrl are required for storage operations.'));
      }

      var drawingData = {
        strokes: strokes,
        canvasSize: { width: canvasWidth, height: canvasHeight },
        backgroundColor: bgColor,
        metadata: {
          createdAt: createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };

      // Remember createdAt for subsequent saves.
      if (!createdAt) {
        createdAt = drawingData.metadata.createdAt;
      }

      var url = nodeUrl + '/v1/memory/' + encodeURIComponent(storageKey);
      var headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };
      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
      }

      setStatus('Saving...');

      return fetch(url, {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify({ value: drawingData })
      })
        .then(function (res) {
          if (!res.ok) {
            throw new Error('HTTP ' + res.status + ' saving drawing');
          }
          setStatus('Saved');
          return res.json();
        })
        .catch(function (err) {
          setStatus('Save failed');
          console.error('[aimeat-canvas] Save error:', err);
          throw err;
        });
    }

    var debouncedSave = debounce(function () {
      saveToStorage().catch(function () {
        // Error already logged in saveToStorage.
      });
    }, autoSaveDelay);

    // -----------------------------------------------------------------------
    // Storage — load
    // -----------------------------------------------------------------------

    function loadFromStorage() {
      if (!storageKey || !nodeUrl) {
        return Promise.reject(new Error('storageKey and nodeUrl are required for storage operations.'));
      }

      var url = nodeUrl + '/v1/memory/' + encodeURIComponent(storageKey);
      var headers = { 'Accept': 'application/json' };
      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
      }

      setStatus('Loading...');

      return fetch(url, { headers: headers })
        .then(function (res) {
          if (res.status === 404) {
            // No saved drawing — start fresh.
            setStatus('New drawing');
            return null;
          }
          if (!res.ok) {
            throw new Error('HTTP ' + res.status + ' loading drawing');
          }
          return res.json();
        })
        .then(function (response) {
          if (!response) return;

          // Extract from AIMEAT response envelope.
          var data = response && response.data && response.data.value;
          if (!data) {
            setStatus('New drawing');
            return;
          }

          // Restore strokes.
          if (Array.isArray(data.strokes)) {
            strokes.length = 0;
            for (var i = 0; i < data.strokes.length; i++) {
              strokes.push(data.strokes[i]);
            }
          }

          // Restore createdAt for future saves.
          if (data.metadata && data.metadata.createdAt) {
            createdAt = data.metadata.createdAt;
          }

          redoStack.length = 0;
          redrawCanvas(ctx, canvasWidth, canvasHeight, bgColor, strokes);
          updateButtonStates();
          setStatus('Loaded (' + strokes.length + ' strokes)');
        })
        .catch(function (err) {
          setStatus('Load failed');
          console.error('[aimeat-canvas] Load error:', err);
          throw err;
        });
    }

    // -----------------------------------------------------------------------
    // Auto-load on init
    // -----------------------------------------------------------------------

    if (storageKey && nodeUrl) {
      loadFromStorage().catch(function () {
        // Error already logged in loadFromStorage.
      });
    }

    // -----------------------------------------------------------------------
    // Make the canvas focusable for keyboard events
    // -----------------------------------------------------------------------

    wrap.setAttribute('tabindex', '0');
    wrap.style.outline = 'none';

    // -----------------------------------------------------------------------
    // Return the controller object
    // -----------------------------------------------------------------------

    return {
      /** The underlying HTMLCanvasElement. */
      canvas: canvas,

      /**
       * Export the drawing as PNG or SVG, triggering a file download.
       * @param {string} format 'png' or 'svg'.
       */
      export: function (format) {
        exportDrawing(format || 'png');
      },

      /** Clear all strokes (undoable — strokes go to redo stack). */
      clear: clear,

      /** Undo the last stroke. */
      undo: undo,

      /** Redo the last undone stroke. */
      redo: redo,

      /**
       * Switch the active drawing tool.
       * @param {string} name Tool name: 'pen','line','rect','circle','eraser','text'.
       */
      setTool: setTool,

      /**
       * Set the active drawing colour.
       * @param {string} hex Hex colour string (e.g. '#6366f1').
       */
      setColor: setColor,

      /**
       * Set the active line width.
       * @param {number} px Line width in pixels (1-20).
       */
      setLineWidth: setLineWidth,

      /**
       * Load the drawing from AIMEAT storage.
       * @returns {Promise}
       */
      loadFromStorage: loadFromStorage,

      /**
       * Save the drawing to AIMEAT storage.
       * @returns {Promise}
       */
      saveToStorage: saveToStorage
    };
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
    DrawingCanvas: DrawingCanvas
  };

  AIMEAT.register('aimeat-canvas', exports);

  // Also expose under the short alias "canvas" for convenience:
  // AIMEAT.canvas.DrawingCanvas(...)
  if (!AIMEAT.canvas) {
    AIMEAT.canvas = exports;
  }

})(window.AIMEAT || (window.AIMEAT = {}));
