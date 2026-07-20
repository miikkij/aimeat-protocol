/**
 * @file editor/index.js
 * @description The aimeat-editor library (SDK-libs migration Phase 1). Mounts a CodeMirror 6 markdown
 *   editor (dynamic esm.sh import, pinned codemirror@6.0.2) with markdown highlighting + a one-dark
 *   theme in dark mode, falling back to a plain auto-growing <textarea> when the CDN import fails or
 *   times out — so the editor always works. Exposes a uniform adapter (getValue/setValue/wrap/
 *   prefixLine/focus) a toolbar + save flows target regardless of engine; split() adds a live preview
 *   pane through AIMEAT.md.renderRich. Componentized ESM source esbuild bundles to the IIFE served,
 *   unchanged, at /v1/libs/aimeat-editor.js. Ported verbatim from lib-editor.ts; the CDN import
 *   specifiers are held in variables so tsc/esbuild leave them as runtime dynamic imports.
 * @structure imports attach (namespace); injectCss/loadCM; mount()/toolbar()/split(); attach('editor', …).
 * @usage <script src="/v1/libs/aimeat-markdown.js"></script><script src="/v1/libs/aimeat-editor.js"></script>
 *   const { adapter } = AIMEAT.editor.split(host, { value: md, onChange: t => dirty = true });
 * @version-history
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-editor.ts (SDK-libs migration Phase 1).
 */
import { attach } from '../_core/namespace.js';

var BT = String.fromCharCode(96); // backtick
var FENCE = BT + BT + BT;

// CDN import specifiers held in variables so tsc can't resolve them (Promise<any>) and esbuild
// leaves them as runtime dynamic imports (not bundled) — the browser imports them at mount time.
var CM_URL = 'https://esm.sh/codemirror@6.0.2'; // exact pin — the "@6" range resolves to a CM5 build on esm.sh
var CM_MD_URL = 'https://esm.sh/@codemirror/lang-markdown@6';
var CM_DARK_URL = 'https://esm.sh/@codemirror/theme-one-dark@6';

var CSS = '.aimeat-ed-host .cm-editor{border:1px solid var(--color-base-300,#3a3a3a);border-radius:8px;font-size:.95rem;background:transparent;}' +
  '.aimeat-ed-host .cm-editor.cm-focused{outline:none;border-color:var(--color-primary,#4f9eff);}' +
  '.aimeat-ed-host .cm-scroller{min-height:280px;max-height:70vh;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.6;}' +
  '.aimeat-ed-host textarea.aimeat-ed-ta{width:100%;border:1px solid var(--color-base-300,#3a3a3a);border-radius:8px;background:transparent;' +
  'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92rem;line-height:1.6;color:inherit;min-height:280px;padding:.7rem;outline:none;resize:vertical;}' +
  '.aimeat-ed-loading{color:var(--color-base-content,#888);opacity:.7;font-size:.85rem;padding:.8rem;border:1px dashed var(--color-base-300,#3a3a3a);border-radius:8px;}' +
  '.aimeat-ed-toolbar{display:flex;gap:.15rem;flex-wrap:wrap;align-items:center;padding:.35rem .4rem;margin:0 0 .8rem;' +
  'border:1px solid var(--color-base-300,#3a3a3a);border-radius:8px;}' +
  '.aimeat-ed-tb{border:none;background:transparent;border-radius:5px;cursor:pointer;padding:.25rem .5rem;font-size:.82rem;color:inherit;min-height:28px;}' +
  '.aimeat-ed-tb:hover{background:var(--color-base-200,rgba(128,128,128,.15));}' +
  '.aimeat-ed-sep{width:1px;align-self:stretch;background:var(--color-base-300,#3a3a3a);margin:.15rem .25rem;}' +
  '.aimeat-ed-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1.2rem;align-items:start;}' +
  '.aimeat-ed-preview{border-left:1px solid var(--color-base-300,#3a3a3a);padding-left:1.2rem;min-height:280px;max-height:70vh;overflow-y:auto;}' +
  '@media (max-width:1099px){.aimeat-ed-split{grid-template-columns:1fr;}' +
  '.aimeat-ed-preview{border-left:none;border-top:1px solid var(--color-base-300,#3a3a3a);padding:1rem 0 0;max-height:none;}}';
function injectCss() {
  if (document.getElementById('aimeat-editor-styles')) return;
  var s = document.createElement('style');
  s.id = 'aimeat-editor-styles';
  s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
}

var _cmModsP = null;
function loadCM() {
  if (_cmModsP) return _cmModsP;
  _cmModsP = Promise.race([
    Promise.all([
      import(CM_URL),
      import(CM_MD_URL).catch(function () { return null; }),
      import(CM_DARK_URL).catch(function () { return null; }),
    ]),
    new Promise(function (_, rej) { setTimeout(function () { rej(new Error('editor cdn timeout')); }, 10000); }),
  ]).catch(function (e) { _cmModsP = null; throw e; });
  return _cmModsP;
}

function wrapSelTa(ta, before, after, placeholder) {
  var s = ta.selectionStart, e = ta.selectionEnd, val = ta.value;
  var sel = val.slice(s, e) || placeholder || '';
  ta.value = val.slice(0, s) + before + sel + (after || '') + val.slice(e);
  ta.focus(); ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length;
  ta.dispatchEvent(new Event('input'));
}
function linePrefixTa(ta, prefix) {
  var s = ta.selectionStart, val = ta.value;
  var ls = val.lastIndexOf('\n', s - 1) + 1;
  ta.value = val.slice(0, ls) + prefix + val.slice(ls);
  ta.focus(); ta.selectionStart = ta.selectionEnd = s + prefix.length;
  ta.dispatchEvent(new Event('input'));
}

// Mount an editor into host. Returns an adapter usable before the async CM mount resolves
// (getValue falls back to the initial text until an engine is live).
function mount(host, opts) {
  opts = opts || {};
  injectCss();
  host.classList.add('aimeat-ed-host');
  var A = {
    host: host,
    cm: /** @type {any} */ (null),
    ta: /** @type {any} */ (null),
    _initial: opts.value || '',
    getValue: function () {
      if (this.cm) return this.cm.state.doc.toString();
      if (this.ta) return this.ta.value;
      return this._initial;
    },
    setValue: function (text) {
      text = text == null ? '' : String(text);
      if (this.cm) this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: text } });
      else if (this.ta) { this.ta.value = text; this.ta.dispatchEvent(new Event('input')); }
      else this._initial = text;
    },
    focus: function () { if (this.cm) this.cm.focus(); else if (this.ta) this.ta.focus(); },
    wrap: function (before, after, ph) {
      if (this.cm) {
        var st = this.cm.state, sel = st.selection.main;
        var chosen = st.sliceDoc(sel.from, sel.to) || ph || '';
        this.cm.dispatch({
          changes: { from: sel.from, to: sel.to, insert: before + chosen + (after || '') },
          selection: { anchor: sel.from + before.length, head: sel.from + before.length + chosen.length },
        });
        this.cm.focus();
      } else if (this.ta) wrapSelTa(this.ta, before, after, ph);
    },
    prefixLine: function (prefix) {
      if (this.cm) {
        var st = this.cm.state, line = st.doc.lineAt(st.selection.main.head);
        this.cm.dispatch({ changes: { from: line.from, insert: prefix } });
        this.cm.focus();
      } else if (this.ta) linePrefixTa(this.ta, prefix);
    },
    destroy: function () {
      if (this.cm) { this.cm.destroy(); this.cm = null; }
      this.ta = null;
      host.innerHTML = '';
    },
  };
  host.innerHTML = '';
  var loading = document.createElement('div');
  loading.className = 'aimeat-ed-loading';
  loading.textContent = 'Loading editor…';
  host.appendChild(loading);
  function emit() { if (opts.onChange) opts.onChange(A.getValue()); }
  function mountTa() {
    if (A.cm || A.ta || !host.isConnected) return;
    var ta = document.createElement('textarea');
    ta.className = 'aimeat-ed-ta';
    ta.placeholder = opts.placeholder || 'Write in markdown…';
    ta.value = A._initial;
    ta.addEventListener('input', emit);
    host.innerHTML = ''; host.appendChild(ta); A.ta = ta;
  }
  loadCM().then(function (mods) {
    if (A.ta || A.cm || !host.isConnected) return;
    var cmr = mods[0], mdm = mods[1], darkm = mods[2];
    var base = [cmr.basicSetup, cmr.EditorView.lineWrapping,
      cmr.EditorView.updateListener.of(function (u) { if (u.docChanged) emit(); })];
    var exts = base.slice();
    try { if (mdm && mdm.markdown) exts.push(mdm.markdown()); } catch { /* markdown ext optional */ }
    if (darkm && darkm.oneDark && document.documentElement.getAttribute('data-theme') === 'dark') exts.push(darkm.oneDark);
    var view;
    try { view = new cmr.EditorView({ doc: A._initial, extensions: exts }); }
    catch { view = new cmr.EditorView({ doc: A._initial, extensions: base }); } // dual-instance ext mismatch → plain setup
    host.innerHTML = ''; host.appendChild(view.dom); A.cm = view;
  }).catch(function () { mountTa(); });
  return A;
}

function toolbar(A) {
  injectCss();
  function b(label, title, fn) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'aimeat-ed-tb'; btn.textContent = label; btn.title = title;
    btn.addEventListener('click', function (ev) { ev.preventDefault(); fn(); });
    return btn;
  }
  function sep() { var s = document.createElement('span'); s.className = 'aimeat-ed-sep'; return s; }
  var bar = document.createElement('div');
  bar.className = 'aimeat-ed-toolbar';
  [
    b('B', 'Bold', function () { A.wrap('**', '**', 'bold'); }),
    b('I', 'Italic', function () { A.wrap('*', '*', 'italic'); }),
    b('S̶', 'Strikethrough', function () { A.wrap('~~', '~~', 'text'); }),
    sep(),
    b('H1', 'Heading 1', function () { A.prefixLine('# '); }),
    b('H2', 'Heading 2', function () { A.prefixLine('## '); }),
    b('H3', 'Heading 3', function () { A.prefixLine('### '); }),
    sep(),
    b('•', 'Bullet list', function () { A.prefixLine('- '); }),
    b('1.', 'Numbered list', function () { A.prefixLine('1. '); }),
    b('☐', 'Todo', function () { A.prefixLine('- [ ] '); }),
    b('❝', 'Quote', function () { A.prefixLine('> '); }),
    sep(),
    b('</>', 'Code block', function () { A.wrap('\n' + FENCE + '\n', '\n' + FENCE + '\n', 'code'); }),
    b('🧜', 'Mermaid diagram', function () { A.wrap('\n' + FENCE + 'mermaid\n', '\n' + FENCE + '\n', 'graph TD\n  A[Start] --> B[End]'); }),
    b('🧩', 'Live data (aimeat-memory block)', function () { A.wrap('\n' + FENCE + 'aimeat-memory\nkey: ', '\n' + FENCE + '\n', 'livedata.my-table'); }),
    b('🔗', 'Link', function () { A.wrap('[', '](https://)', 'link text'); }),
    b('―', 'Divider', function () { A.prefixLine('\n---\n'); }),
  ].forEach(function (n) { bar.appendChild(n); });
  return bar;
}

// Editor + live preview side by side (stacked below 1100px). The preview renders through
// AIMEAT.md.renderRich when aimeat-markdown.js is loaded, else AIMEAT.md.render, else plain text.
function renderPreview(target, text) {
  var md = window.AIMEAT && window.AIMEAT.md;
  if (md && typeof md.renderRich === 'function') { md.renderRich(text, target); return; }
  if (md && typeof md.render === 'function') { md.render(text, target); return; }
  target.innerHTML = '';
  var pre = document.createElement('pre');
  pre.style.whiteSpace = 'pre-wrap';
  pre.textContent = text;
  target.appendChild(pre);
}
function split(host, opts) {
  opts = opts || {};
  injectCss();
  host.innerHTML = '';
  var wrap = document.createElement('div');
  wrap.className = 'aimeat-ed-split';
  var edPane = document.createElement('div');
  var pvPane = document.createElement('div');
  pvPane.className = 'aimeat-ed-preview';
  wrap.appendChild(edPane); wrap.appendChild(pvPane);
  host.appendChild(wrap);
  var timer = null;
  var debounce = opts.previewDebounceMs || 350;
  var A = mount(edPane, {
    value: opts.value, placeholder: opts.placeholder,
    onChange: function (t) {
      if (opts.onChange) opts.onChange(t);
      clearTimeout(timer);
      timer = setTimeout(function () { if (pvPane.isConnected) renderPreview(pvPane, t); }, debounce);
    },
  });
  renderPreview(pvPane, opts.value || '');
  return { adapter: A, editorEl: edPane, previewEl: pvPane };
}

attach('editor', { mount: mount, toolbar: toolbar, split: split });
