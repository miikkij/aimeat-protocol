/**
 * aimeat-flow — configuration-first flow / mindmap / process editor for AIMEAT apps.
 *
 * The app talks ONLY to AIMEAT.flow — the rendering engine underneath (currently the
 * vendored Drawflow, /lib/drawflow@0.min.js) is an internal detail and may be swapped
 * without breaking apps. Presets give a working editor from one call; graphs save/load
 * as flow:* memory records via AIMEAT.data.
 *
 * Usage:
 *   <link rel="stylesheet" href="/lib/drawflow@0.min.css">
 *   <script src="/lib/drawflow@0.min.js"></script>
 *   <script src="/v1/cortex/aimeat-flow/libs/aimeat-flow.js"></script>
 *   <script>
 *     var flow = AIMEAT.flow.create('#editor', { preset: 'process' });
 *     flow.addNode({ label: 'Order received', x: 80, y: 120 });
 *     await flow.save('flow:orders');       // -> AIMEAT.data (visibility private by default)
 *     await flow.load('flow:orders');
 *   </script>
 */
(function (global) {
  'use strict';

  var AIMEAT = global.AIMEAT = global.AIMEAT || {};

  /** Theme CSS — engine-agnostic class names (af-*) + Drawflow overrides, follows the
   *  AIMEAT light/dark CSS variables an app defines (--card/--text/--border/--accent). */
  var THEME_CSS = [
    '.aimeat-flow-host { position: relative; width: 100%; height: 100%; min-height: 320px; border: 1px solid var(--border, #e5e7eb); border-radius: 12px; overflow: hidden; background: var(--bg, #fafaf8); }',
    // The engine mount must fill the host — without an explicit size the container is
    // 0-high and pointer events never reach the nodes (found in browser verification).
    '.aimeat-flow-host > .parent-drawflow { width: 100%; height: 100%; min-height: inherit; }',
    '.aimeat-flow-host .drawflow { width: 100%; height: 100%; }',
    '.aimeat-flow-host .drawflow .drawflow-node { background: var(--card, #fff); color: var(--text, #1a1a2e); border: 1.5px solid var(--border, #e5e7eb); border-radius: 10px; padding: 10px 14px; min-width: 120px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); }',
    '.aimeat-flow-host .drawflow .drawflow-node.selected { border-color: var(--accent, #e8564a); }',
    '.aimeat-flow-host .drawflow .connection .main-path { stroke: var(--accent, #e8564a); stroke-width: 2.5px; }',
    '.aimeat-flow-host .drawflow .drawflow-node .input, .aimeat-flow-host .drawflow .drawflow-node .output { background: var(--card, #fff); border: 2px solid var(--accent, #e8564a); height: 12px; width: 12px; }',
    '.aimeat-flow-host .af-label { font: 600 14px/1.3 system-ui, sans-serif; text-align: center; pointer-events: none; }',
    '.aimeat-flow-host.af-mindmap .drawflow .drawflow-node { border-radius: 999px; padding: 8px 18px; }',
    '.aimeat-flow-toolbar { position: absolute; top: 8px; right: 8px; z-index: 5; display: flex; gap: 4px; }',
    '.aimeat-flow-toolbar button { border: 1px solid var(--border, #e5e7eb); background: var(--card, #fff); color: var(--text, #1a1a2e); border-radius: 8px; width: 30px; height: 30px; cursor: pointer; font-size: 15px; line-height: 1; }',
    '.aimeat-flow-toolbar button:hover { border-color: var(--accent, #e8564a); }',
  ].join('\n');

  var themeInjected = false;
  function injectTheme() {
    if (themeInjected) return;
    var style = document.createElement('style');
    style.setAttribute('data-aimeat-flow', '1');
    style.textContent = THEME_CSS;
    document.head.appendChild(style);
    themeInjected = true;
  }

  /** Preset defaults: how many connection points a new node gets, host styling class. */
  var PRESETS = {
    process: { inputs: 1, outputs: 1, hostClass: '' },
    mindmap: { inputs: 1, outputs: 0, hostClass: 'af-mindmap' },
    orgchart: { inputs: 1, outputs: 0, hostClass: '' },
  };

  function resolveEl(elOrSelector) {
    if (typeof elOrSelector === 'string') return document.querySelector(elOrSelector);
    return elOrSelector;
  }

  function esc(text) {
    var d = document.createElement('div');
    d.textContent = String(text == null ? '' : text);
    return d.innerHTML;
  }

  /**
   * Create a flow editor.
   * @param {Element|string} elOrSelector host element (or selector). Sized by the app.
   * @param {Object} [opts]
   * @param {string} [opts.preset='process'] 'process' | 'mindmap' | 'orgchart'
   * @param {Object} [opts.data] a previously exported graph to load
   * @param {Function} [opts.onChange] called (debounced) after any node/connection change
   * @param {boolean} [opts.toolbar=true] show the zoom/fit mini toolbar
   */
  function create(elOrSelector, opts) {
    if (typeof global.Drawflow !== 'function') {
      throw new Error('aimeat-flow: the engine is not loaded — include /lib/drawflow@0.min.js (and its CSS) BEFORE this lib.');
    }
    opts = opts || {};
    var host = resolveEl(elOrSelector);
    if (!host) throw new Error('aimeat-flow: host element not found');
    injectTheme();

    var preset = PRESETS[opts.preset || 'process'] || PRESETS.process;
    host.classList.add('aimeat-flow-host');
    if (preset.hostClass) host.classList.add(preset.hostClass);

    var mount = document.createElement('div');
    host.appendChild(mount);
    var editor = new global.Drawflow(mount);
    editor.reroute = true;
    editor.start();

    // Change notification — one debounced callback for every mutating engine event.
    var changeCb = opts.onChange || null;
    var changeTimer = null;
    function emitChange() {
      if (!changeCb) return;
      clearTimeout(changeTimer);
      changeTimer = setTimeout(function () { changeCb(api.export()); }, 150);
    }
    ['nodeCreated', 'nodeRemoved', 'nodeMoved', 'connectionCreated', 'connectionRemoved', 'nodeDataChanged']
      .forEach(function (ev) { editor.on(ev, emitChange); });

    // Double-click renames a node (label lives in node data + the .af-label div).
    mount.addEventListener('dblclick', function (e) {
      var nodeEl = e.target.closest('.drawflow-node');
      if (!nodeEl) return;
      var id = nodeEl.id.replace('node-', '');
      var node = editor.getNodeFromId(id);
      var next = global.prompt('Label:', (node.data && node.data.label) || '');
      if (next == null) return;
      editor.updateNodeDataFromId(id, Object.assign({}, node.data, { label: next }));
      var labelEl = nodeEl.querySelector('.af-label');
      if (labelEl) labelEl.textContent = next;
      emitChange();
    });

    // Mini toolbar: zoom in / out / reset.
    if (opts.toolbar !== false) {
      var bar = document.createElement('div');
      bar.className = 'aimeat-flow-toolbar';
      [['+', function () { editor.zoom_in(); }], ['−', function () { editor.zoom_out(); }], ['⤢', function () { editor.zoom_reset(); }]]
        .forEach(function (b) {
          var btn = document.createElement('button');
          btn.type = 'button'; btn.textContent = b[0]; btn.onclick = b[1];
          bar.appendChild(btn);
        });
      host.appendChild(bar);
    }

    var api = {
      /** The raw engine instance — INTERNAL; do not build app features on it. */
      engine: editor,

      /** Add a node. Returns the node id. */
      addNode: function (node) {
        node = node || {};
        var label = node.label || 'Node';
        var inputs = node.inputs != null ? node.inputs : preset.inputs;
        var outputs = node.outputs != null ? node.outputs : preset.outputs;
        var html = '<div class="af-label">' + esc(label) + '</div>';
        return editor.addNode(
          node.type || 'af-node', inputs, outputs,
          node.x != null ? node.x : 60, node.y != null ? node.y : 60,
          'af-node', Object.assign({ label: label }, node.data || {}), html, false
        );
      },

      /** Connect two nodes (first output → first input by default). */
      connect: function (fromId, toId, output, input) {
        editor.addConnection(fromId, toId, output || 'output_1', input || 'input_1');
      },

      /** Mindmap helper: add a child bubble near its parent and connect them. */
      addChild: function (parentId, label) {
        var parent = editor.getNodeFromId(parentId);
        var count = Object.keys(editor.drawflow.drawflow.Home.data).length;
        var id = api.addNode({
          label: label, inputs: 1, outputs: 1,
          x: (parent.pos_x || 60) + 220,
          y: (parent.pos_y || 60) + ((count % 5) - 2) * 90,
        });
        // Parents need an output to connect from; preset mindmap roots are created with outputs
        // via addNode({outputs:1}) — the connect below no-ops harmlessly if the port is missing.
        try { api.connect(parentId, id); } catch (_e) { /* parent without output port */ }
        return id;
      },

      /** Export the graph (engine-agnostic envelope: { format, graph }). */
      export: function () {
        return { format: 'drawflow@0', graph: editor.export() };
      },

      /** Import a graph previously produced by export() (raw engine exports also accepted). */
      import: function (data) {
        if (!data) return;
        var graph = data.graph || data;
        editor.import(graph);
        emitChange();
      },

      /** Remove every node/connection. */
      clear: function () { editor.clearModuleSelected(); emitChange(); },

      /** Save to AIMEAT memory (flow:* keys; requires aimeat-auth + aimeat-data + login). */
      save: function (key, saveOpts) {
        if (!AIMEAT.data || !AIMEAT.data.set) return Promise.reject(new Error('aimeat-flow: load aimeat-data.js (and sign in) to save flows'));
        return AIMEAT.data.set(key, api.export(), Object.assign({ visibility: 'private', tags: ['flow'] }, saveOpts || {}));
      },

      /** Load from AIMEAT memory and render. Resolves the loaded envelope (or null). */
      load: function (key) {
        if (!AIMEAT.data || !AIMEAT.data.get) return Promise.reject(new Error('aimeat-flow: load aimeat-data.js (and sign in) to load flows'));
        return AIMEAT.data.get(key).then(function (value) {
          if (value) api.import(value);
          return value || null;
        });
      },

      /** Destroy the editor and detach from the host. */
      destroy: function () {
        clearTimeout(changeTimer);
        try { editor.clear(); } catch (_e) { /* already gone */ }
        host.innerHTML = '';
        host.classList.remove('aimeat-flow-host', 'af-mindmap');
      },
    };

    if (opts.data) api.import(opts.data);
    return api;
  }

  AIMEAT.flow = {
    create: create,
    PRESETS: Object.keys(PRESETS),
  };

})(typeof window !== 'undefined' ? window : this);
