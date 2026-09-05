/**
 * @file test/unit/phaser-stub-dom.mjs
 * @description The browser around the fake Phaser scene: the minimal document the level editor
 *   and designer panels drive (elements with attributes, classList, dataset, style, events that
 *   bubble, a small querySelector), the stub AudioContext the chiptune and audio modules play
 *   into (nodes that record what was scheduled, a currentTime that advances by hand), a fake
 *   saves() store that records every write, and installGlobals(), which puts window, document,
 *   location, matchMedia, getComputedStyle and window.Phaser in place before a phaser module is
 *   imported and hands back the function that takes them away again.
 * @structure FakeNode · makeDom() · makeAudioContext() · makeStore() · makePhaserNamespace() ·
 *   installGlobals()
 * @usage  const restore = installGlobals(); const { fx } = await import('.../phaser/fx.js'); … restore();
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial: the union of the thirteen scratch stubs of 2026-09-02.
 */
import { emitter } from './phaser-stub-objects.mjs';
import { canvasContext } from './phaser-stub-managers.mjs';

/* ── The document ──────────────────────────────────────────────────────────────────────────── */

const VOID = { INPUT: 1, IMG: 1, BR: 1, HR: 1, META: 1, LINK: 1, CANVAS: 0 };

/** One element. Enough of the DOM for a panel to build itself, be read back and be clicked. */
export class FakeNode {
  constructor(tag, doc) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = 1;
    this.ownerDocument = doc || null;
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.parentNode = null;
    this.style = styleBag();
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.selected = false;
    this.hidden = false;
    this.type = this.tagName === 'INPUT' ? 'text' : (this.tagName === 'BUTTON' ? 'submit' : '');
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.width = this.tagName === 'CANVAS' ? 300 : 0;
    this.height = this.tagName === 'CANVAS' ? 150 : 0;
    this._text = '';
    this._html = '';
    this._ctx = null;
    const classes = () => this.className.split(/\s+/).filter(Boolean);
    this.classList = {
      add: (...names) => { for (const c of names) this._cls(c, true); },
      remove: (...names) => { for (const c of names) this._cls(c, false); },
      toggle: (c, force) => { const on = force === undefined ? classes().indexOf(c) < 0 : !!force; this._cls(c, on); return on; },
      contains: (c) => classes().indexOf(c) >= 0,
      replace: (a, b) => { this._cls(a, false); this._cls(b, true); },
      item: (i) => classes()[i] || null,
      toString: () => this.className,
    };
    Object.defineProperty(this.classList, 'length', { get: () => classes().length });
    const dataName = (k) => 'data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    this.dataset = new Proxy({}, {
      get: (_t, k) => (typeof k === 'string' ? this.getAttribute(dataName(k)) : undefined),
      set: (_t, k, v) => { this.setAttribute(dataName(k), v); return true; },
      has: (_t, k) => this.hasAttribute(dataName(k)),
      deleteProperty: (_t, k) => { this.removeAttribute(dataName(k)); return true; },
      ownKeys: () => Object.keys(this.attrs).filter((k) => k.indexOf('data-') === 0).map((k) => k.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase())),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    });
  }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get firstElementChild() { return this.children.find((c) => c.nodeType === 1) || null; }
  get lastElementChild() { const list = this.children.filter((c) => c.nodeType === 1); return list[list.length - 1] || null; }
  get childElementCount() { return this.children.filter((c) => c.nodeType === 1).length; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; return p.children[p.children.indexOf(this) + 1] || null; }
  get previousSibling() { const p = this.parentNode; if (!p) return null; return p.children[p.children.indexOf(this) - 1] || null; }
  get nextElementSibling() { let n = this.nextSibling; while (n && n.nodeType !== 1) n = n.nextSibling; return n; }
  get previousElementSibling() { let n = this.previousSibling; while (n && n.nodeType !== 1) n = n.previousSibling; return n; }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = String(v); }
  get name() { return this.attrs.name || ''; }
  set name(v) { this.attrs.name = String(v); }
  get title() { return this.attrs.title || ''; }
  set title(v) { this.attrs.title = String(v); }
  get href() { return this.attrs.href || ''; }
  set href(v) { this.attrs.href = String(v); }
  get src() { return this.attrs.src || ''; }
  set src(v) { this.attrs.src = String(v); }
  get tabIndex() { return this.attrs.tabindex === undefined ? -1 : parseInt(this.attrs.tabindex, 10); }
  set tabIndex(v) { this.attrs.tabindex = String(v); }
  get textContent() { return this._text || this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get innerHTML() { return this._html || this.children.map((c) => (c.nodeType === 1 ? c.outerHTML : c.textContent)).join(''); }
  set innerHTML(v) { this._html = String(v); this._text = ''; this.children = []; }
  get outerHTML() { const attrs = Object.keys(this.attrs).map((k) => ' ' + k + '="' + this.attrs[k] + '"').join(''); const tag = this.tagName.toLowerCase(); return VOID[this.tagName] ? '<' + tag + attrs + '>' : '<' + tag + attrs + '>' + this.innerHTML + '</' + tag + '>'; }
  get options() { return this.children.filter((c) => c.tagName === 'OPTION'); }
  get selectedIndex() { return this.options.findIndex((o) => o.value === this.value || o.selected); }
  set selectedIndex(i) { const o = this.options[i]; if (o) this.value = o.value; }
  get selectedOptions() { return this.options.filter((o) => o.value === this.value); }
  get offsetWidth() { return this.width || parseFloat(this.style.width) || 0; }
  get offsetHeight() { return this.height || parseFloat(this.style.height) || 0; }
  get clientWidth() { return this.offsetWidth; }
  get clientHeight() { return this.offsetHeight; }
  get scrollWidth() { return this.offsetWidth; }
  get scrollHeight() { return this.offsetHeight; }
  get offsetParent() { return this.parentElement; }
  get offsetTop() { return 0; }
  get offsetLeft() { return 0; }
  get isConnected() { for (let n = this.parentNode; n; n = n.parentNode) if (n.nodeType === 9) return true; return false; }
  get attributes() { return Object.keys(this.attrs).map((name) => ({ name, value: this.attrs[name] })); }
  _cls(c, on) { const set = new Set(this.className.split(/\s+/).filter(Boolean)); if (on) set.add(c); else set.delete(c); this.className = [...set].join(' '); }
  appendChild(c) { if (c.nodeType === 11) { for (const k of c.children.slice()) this.appendChild(k); return c; } if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  append(...list) { for (const c of list) this.appendChild(typeof c === 'object' && c ? c : textNode(String(c), this.ownerDocument)); }
  prepend(...list) { for (const c of list.reverse()) this.insertBefore(typeof c === 'object' && c ? c : textNode(String(c), this.ownerDocument), this.firstChild); }
  insertBefore(c, ref) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  replaceChild(n, old) { const i = this.children.indexOf(old); if (i >= 0) { this.children[i] = n; n.parentNode = this; old.parentNode = null; } return old; }
  replaceChildren(...list) { for (const c of this.children.slice()) this.removeChild(c); this.append(...list); }
  replaceWith(...list) { const p = this.parentNode; if (!p) return; const i = p.children.indexOf(this); p.children.splice(i, 1, ...list.map((c) => { c.parentNode = p; return c; })); this.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  before(...list) { const p = this.parentNode; if (p) for (const c of list) p.insertBefore(c, this); }
  after(...list) { const p = this.parentNode; if (p) for (const c of list.reverse()) p.insertBefore(c, this.nextSibling); }
  insertAdjacentElement(where, el) { if (where === 'beforebegin') this.before(el); else if (where === 'afterbegin') this.prepend(el); else if (where === 'beforeend') this.appendChild(el); else this.after(el); return el; }
  insertAdjacentHTML(where, html) { this.insertAdjacentElement(where, Object.assign(new FakeNode('span', this.ownerDocument), { _html: String(html) })); }
  cloneNode(deep) { const c = new FakeNode(this.tagName, this.ownerDocument); Object.assign(c.attrs, this.attrs); c._text = this._text; c._html = this._html; c.value = this.value; if (deep) for (const k of this.children) c.appendChild(k.nodeType === 1 ? k.cloneNode(true) : textNode(k.textContent, this.ownerDocument)); return c; }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'hidden') this.hidden = true;
    if (k === 'value') this.value = String(v);
    if (k === 'checked') this.checked = true;
    if (k === 'disabled') this.disabled = true;
    if (k === 'selected') this.selected = true;
    if (k === 'type') this.type = String(v);
    if (k === 'style') this.style.cssText = String(v);
    if ((k === 'width' || k === 'height') && this.tagName === 'CANVAS') this[k] = parseInt(String(v), 10) || 0;
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; if (k === 'hidden') this.hidden = false; if (k === 'disabled') this.disabled = false; if (k === 'checked') this.checked = false; }
  hasAttribute(k) { return k in this.attrs; }
  toggleAttribute(k, force) { const on = force === undefined ? !this.hasAttribute(k) : !!force; if (on) this.setAttribute(k, ''); else this.removeAttribute(k); return on; }
  getAttributeNames() { return Object.keys(this.attrs); }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener(t, f) { const l = this.listeners[t] || []; const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); }
  dispatchEvent(ev) {
    const e = normalizeEvent(ev, this);
    bubble(this, e);
    return !e.defaultPrevented;
  }
  click() { this.dispatchEvent({ type: 'click', bubbles: true }); }
  focus() { const d = this.ownerDocument; if (d) d.activeElement = this; this.dispatchEvent({ type: 'focus', bubbles: false }); }
  blur() { const d = this.ownerDocument; if (d && d.activeElement === this) d.activeElement = d.body; this.dispatchEvent({ type: 'blur', bubbles: false }); }
  select() {}
  scrollIntoView() {}
  scrollTo() {}
  matches(sel) { return String(sel).split(',').some((one) => matchCompound(this, one.trim().split(/\s+/).pop() || '')); }
  closest(sel) { if (this.matches(sel)) return this; for (let n = this.parentNode; n && n.nodeType === 1; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel) { return query(this, sel); }
  querySelector(sel) { return query(this, sel)[0] || null; }
  getElementsByTagName(tag) { const t = String(tag).toUpperCase(); return descendants(this).filter((n) => t === '*' || n.tagName === t); }
  getElementsByClassName(c) { return descendants(this).filter((n) => n.classList.contains(c)); }
  getBoundingClientRect() { const w = this.offsetWidth; const h = this.offsetHeight; return { x: 0, y: 0, left: 0, top: 0, width: w, height: h, right: w, bottom: h }; }
  getClientRects() { return [this.getBoundingClientRect()]; }
  getContext(kind) { if (this.tagName !== 'CANVAS') return null; if (!this._ctx) this._ctx = canvasContext(this.width, this.height); this._ctx.kind = kind || '2d'; return this._ctx; }
  toDataURL() { return 'data:image/png;base64,'; }
  toBlob(cb) { if (cb) cb(null); }
  requestFullscreen() { const d = this.ownerDocument; if (d) d.fullscreenElement = this; return Promise.resolve(); }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  toString() { return '[object ' + this.tagName + ']'; }
}

function styleBag() {
  const s = { cssText: '' };
  s.setProperty = (k, v) => { s[k] = v; };
  s.getPropertyValue = (k) => (s[k] === undefined ? '' : String(s[k]));
  s.removeProperty = (k) => { const v = s[k]; delete s[k]; return v === undefined ? '' : v; };
  return s;
}

function textNode(text, doc) {
  return { nodeType: 3, nodeName: '#text', textContent: String(text), data: String(text), parentNode: null, ownerDocument: doc, get parentElement() { return this.parentNode; }, remove() { if (this.parentNode) this.parentNode.removeChild(this); }, cloneNode() { return textNode(this.textContent, doc); } };
}

/** Deliver an event to a node's listeners and then up its parents, until stopped or the document. */
function bubble(start, e) {
  for (let n = start; n && !e._stopped; n = e.bubbles === false ? null : n.parentNode) {
    e.currentTarget = n;
    for (const f of ((n.listeners && n.listeners[e.type]) || []).slice()) { if (typeof f === 'function') f.call(n, e); else if (f && f.handleEvent) f.handleEvent(e); if (e._immediate) break; }
    const prop = n['on' + e.type];
    if (typeof prop === 'function') prop.call(n, e);
  }
}

function normalizeEvent(ev, target) {
  const e = typeof ev === 'string' ? { type: ev } : ev;
  if (!e.target) { try { e.target = target; } catch { /* a native Event locks target; the stub's own carries it */ } }
  if (e.bubbles === undefined) { try { e.bubbles = true; } catch { /* native */ } }
  if (typeof e.preventDefault !== 'function') e.preventDefault = function () { this.defaultPrevented = true; };
  if (typeof e.stopPropagation !== 'function') e.stopPropagation = function () { this._stopped = true; };
  if (typeof e.stopImmediatePropagation !== 'function') e.stopImmediatePropagation = function () { this._stopped = true; this._immediate = true; };
  if (e.composedPath === undefined) e.composedPath = () => { const out = []; for (let n = target; n; n = n.parentNode) out.push(n); return out; };
  return e;
}

function descendants(root, out) {
  const list = out || [];
  for (const c of root.children || []) if (c.nodeType === 1) { list.push(c); descendants(c, list); }
  return list;
}

/** tag#id.class[attr=value]:checked:not(.x) against one element. */
function matchCompound(n, compound) {
  if (!compound || compound === '*') return true;
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~|^$*]?=)"?([^\]"]*)"?)?\]|:not\(([^)]+)\)|:([\w-]+)/g;
  let m;
  let any = false;
  while ((m = re.exec(compound))) {
    any = true;
    if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && n.id !== m[2]) return false;
    if (m[3] && !n.classList.contains(m[3])) return false;
    if (m[4]) {
      const v = n.getAttribute(m[4]);
      if (v === null) return false;
      if (m[5] === '=' && v !== m[6]) return false;
      if (m[5] === '^=' && v.indexOf(m[6]) !== 0) return false;
      if (m[5] === '$=' && !v.endsWith(m[6])) return false;
      if (m[5] === '*=' && v.indexOf(m[6]) < 0) return false;
      if (m[5] === '~=' && v.split(/\s+/).indexOf(m[6]) < 0) return false;
    }
    if (m[7] && matchCompound(n, m[7].trim())) return false;
    if (m[8] === 'checked' && !n.checked) return false;
    if (m[8] === 'disabled' && !n.disabled) return false;
    if (m[8] === 'enabled' && n.disabled) return false;
    if (m[8] === 'first-child' && n.parentNode && n.parentNode.firstElementChild !== n) return false;
    if (m[8] === 'last-child' && n.parentNode && n.parentNode.lastElementChild !== n) return false;
    if (m[8] === 'empty' && n.children.length) return false;
  }
  return any;
}

/** A selector list of descendant (space) and child (>) combinators over compounds. */
function query(root, sel) {
  const out = [];
  for (const one of String(sel).split(',')) {
    const parts = one.trim().replace(/\s*>\s*/g, ' >').split(/\s+/).filter(Boolean);
    let set = [root];
    for (const part of parts) {
      const child = part[0] === '>';
      const compound = child ? part.slice(1) : part;
      const next = [];
      for (const base of set) for (const n of child ? base.children.filter((c) => c.nodeType === 1) : descendants(base)) if (matchCompound(n, compound) && next.indexOf(n) < 0) next.push(n);
      set = next;
    }
    for (const n of set) if (out.indexOf(n) < 0) out.push(n);
  }
  return out;
}

/**
 * The minimal document: createElement / createElementNS / createTextNode, body, head and
 * documentElement, a working querySelector, event dispatch that bubbles, activeElement,
 * and the `data-ak-motion` attribute the modules read through reducedMotion().
 * @param {{ motion?: 'less'|'auto'|null }} [opts]
 * @returns {{ document: any, all: (pred: (n: any) => boolean) => any[], setMotion: (m: any) => void }}
 */
export function makeDom(opts) {
  const o = opts || {};
  const doc = { nodeType: 9, nodeName: '#document', __akStub: true, children: [], listeners: {}, hidden: false, visibilityState: 'visible', readyState: 'complete', currentScript: null, fullscreenElement: null, title: '', cookie: '', referrer: '', log: [] };
  doc.documentElement = new FakeNode('html', doc);
  doc.head = new FakeNode('head', doc);
  doc.body = new FakeNode('body', doc);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.documentElement.parentNode = doc;
  doc.children.push(doc.documentElement);
  doc.activeElement = doc.body;
  doc.createElement = (tag) => { const n = new FakeNode(tag, doc); doc.log.push(['createElement', String(tag).toLowerCase()]); return n; };
  doc.createElementNS = (_ns, tag) => doc.createElement(tag);
  doc.createTextNode = (t) => textNode(t, doc);
  doc.createComment = (t) => Object.assign(textNode(t, doc), { nodeType: 8, nodeName: '#comment' });
  doc.createDocumentFragment = () => { const f = new FakeNode('#fragment', doc); f.nodeType = 11; return f; };
  doc.createEvent = () => ({ type: '', initEvent(type, bubbles) { this.type = type; this.bubbles = bubbles; }, initCustomEvent(type, bubbles, cancelable, detail) { this.type = type; this.bubbles = bubbles; this.detail = detail; } });
  doc.createRange = () => ({ selectNodeContents() {}, setStart() {}, setEnd() {}, getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }), getClientRects: () => [] });
  doc.querySelector = (sel) => query(doc.documentElement, sel)[0] || (doc.documentElement.matches(sel) ? doc.documentElement : null);
  doc.querySelectorAll = (sel) => query(doc.documentElement, sel);
  doc.getElementById = (id) => descendants(doc.documentElement).find((n) => n.id === id) || null;
  doc.getElementsByTagName = (tag) => doc.documentElement.getElementsByTagName(tag);
  doc.getElementsByClassName = (c) => doc.documentElement.getElementsByClassName(c);
  doc.contains = (n) => doc.documentElement.contains(n);
  doc.addEventListener = (t, f) => { (doc.listeners[t] = doc.listeners[t] || []).push(f); };
  doc.removeEventListener = (t, f) => { const l = doc.listeners[t] || []; const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); };
  doc.dispatchEvent = (ev) => { const e = normalizeEvent(ev, doc); for (const f of (doc.listeners[e.type] || []).slice()) f.call(doc, e); return !e.defaultPrevented; };
  doc.hasFocus = () => true;
  doc.exitFullscreen = () => { doc.fullscreenElement = null; return Promise.resolve(); };
  doc.elementFromPoint = () => null;
  doc.getSelection = () => ({ removeAllRanges() {}, addRange() {}, toString: () => '' });
  doc.execCommand = () => true;
  doc.all = (pred) => descendants(doc.documentElement).filter(pred || (() => true));
  doc.setMotion = (m) => { if (m == null) doc.documentElement.removeAttribute('data-ak-motion'); else doc.documentElement.setAttribute('data-ak-motion', m); };
  Object.defineProperty(doc, 'defaultView', { get: () => globalThis.window || null });
  Object.defineProperty(doc, 'scrollingElement', { get: () => doc.documentElement });
  if (o.motion) doc.setMotion(o.motion);
  return { document: doc, all: doc.all, setMotion: doc.setMotion };
}

/* ── The audio context ─────────────────────────────────────────────────────────────────────── */

function audioParam(ctx, value) {
  const p = { value: value === undefined ? 1 : value, defaultValue: value === undefined ? 1 : value, calls: [], minValue: -3.4e38, maxValue: 3.4e38 };
  for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'setValueCurveAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) {
    p[m] = function (v, t, c) { p.calls.push({ m, v, t, c, when: ctx.currentTime }); if (m === 'setValueAtTime' || m === 'setTargetAtTime' || m === 'cancelAndHoldAtTime') p.value = typeof v === 'number' ? v : p.value; ctx.log.push([m, v, t]); return p; };
  }
  return p;
}

/**
 * A stub AudioContext: every node records what it was told, connections are kept as `target`,
 * and `ctx.advance(seconds)` moves currentTime and fires onended on sources that have stopped.
 * @param {{ state?: 'running'|'suspended', sampleRate?: number }} [opts]
 * @returns {any}
 */
export function makeAudioContext(opts) {
  const o = opts || {};
  const ctx = { kind: 'audioContext', currentTime: 0, sampleRate: o.sampleRate || 44100, state: o.state || 'running', baseLatency: 0.01, outputLatency: 0.02, sources: [], gains: [], nodes: [], log: [], listener: { positionX: {}, positionY: {}, positionZ: {}, setPosition() {}, setOrientation() {} } };
  ctx.destination = { kind: 'destination', channelCount: 2, maxChannelCount: 2, context: ctx, connections: [], connect() {}, disconnect() {} };
  const node = (kind, extra) => {
    const n = Object.assign({ kind, context: ctx, target: null, targets: [], numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, log: [] }, extra || {});
    n.connect = (t) => { n.target = t; n.targets.push(t); if (t && t.connections) t.connections.push(n); n.log.push(['connect', t && t.kind]); return t; };
    n.disconnect = (t) => { if (t === undefined || t === n.target) n.target = null; n.targets = t === undefined ? [] : n.targets.filter((x) => x !== t); n.log.push(['disconnect']); };
    ctx.nodes.push(n);
    ctx.log.push(['create', kind]);
    return n;
  };
  const source = (kind, extra) => {
    const s = node(kind, Object.assign({ startAt: null, stopAt: null, scheduledAt: null, started: false, stopped: false, ended: false, onended: null }, extra || {}));
    s.start = (t, offset, duration) => { s.startAt = t === undefined ? ctx.currentTime : t; s.scheduledAt = ctx.currentTime; s.started = true; s.offset = offset; if (duration !== undefined) s.stopAt = s.startAt + duration; s.log.push(['start', t]); };
    s.stop = (t) => { s.stopAt = t === undefined ? ctx.currentTime : t; s.stopped = true; s.log.push(['stop', t]); };
    ctx.sources.push(s);
    return s;
  };
  ctx.createGain = () => { const g = node('gain', { gain: audioParam(ctx, 1) }); ctx.gains.push(g); return g; };
  ctx.createOscillator = () => source('oscillator', { type: 'sine', frequency: audioParam(ctx, 440), detune: audioParam(ctx, 0), setPeriodicWave() {} });
  ctx.createBufferSource = () => source('bufferSource', { buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: audioParam(ctx, 1), detune: audioParam(ctx, 0) });
  ctx.createConstantSource = () => source('constantSource', { offset: audioParam(ctx, 1) });
  ctx.createBuffer = (channels, length, rate) => { const data = []; for (let i = 0; i < (channels || 1); i++) data.push(new Float32Array(length || 0)); return { kind: 'buffer', numberOfChannels: channels || 1, length: length || 0, sampleRate: rate || ctx.sampleRate, duration: (length || 0) / (rate || ctx.sampleRate), getChannelData: (i) => data[i], copyToChannel() {}, copyFromChannel() {} }; };
  ctx.createBiquadFilter = () => node('biquadFilter', { type: 'lowpass', frequency: audioParam(ctx, 350), Q: audioParam(ctx, 1), gain: audioParam(ctx, 0), detune: audioParam(ctx, 0) });
  ctx.createDynamicsCompressor = () => node('compressor', { threshold: audioParam(ctx, -24), knee: audioParam(ctx, 30), ratio: audioParam(ctx, 12), attack: audioParam(ctx, 0.003), release: audioParam(ctx, 0.25), reduction: 0 });
  ctx.createAnalyser = () => node('analyser', { fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0.8, getByteFrequencyData(a) { a.fill(0); }, getByteTimeDomainData(a) { a.fill(128); }, getFloatFrequencyData(a) { a.fill(-100); }, getFloatTimeDomainData(a) { a.fill(0); } });
  ctx.createStereoPanner = () => node('stereoPanner', { pan: audioParam(ctx, 0) });
  ctx.createPanner = () => node('panner', { positionX: audioParam(ctx, 0), positionY: audioParam(ctx, 0), positionZ: audioParam(ctx, 0), setPosition() {} });
  ctx.createDelay = (max) => node('delay', { delayTime: audioParam(ctx, 0), maxDelayTime: max || 1 });
  ctx.createConvolver = () => node('convolver', { buffer: null, normalize: true });
  ctx.createWaveShaper = () => node('waveShaper', { curve: null, oversample: 'none' });
  ctx.createChannelMerger = () => node('channelMerger');
  ctx.createChannelSplitter = () => node('channelSplitter');
  ctx.createMediaElementSource = (el) => node('mediaElementSource', { mediaElement: el });
  ctx.createMediaStreamDestination = () => node('mediaStreamDestination', { stream: {} });
  ctx.createScriptProcessor = () => node('scriptProcessor', { onaudioprocess: null, bufferSize: 4096 });
  ctx.createPeriodicWave = () => ({ kind: 'periodicWave' });
  ctx.decodeAudioData = (data, ok) => { const buffer = ctx.createBuffer(2, 44100, ctx.sampleRate); if (ok) ok(buffer); return Promise.resolve(buffer); };
  ctx.resume = () => { ctx.log.push(['resume']); ctx.state = 'running'; if (ctx.onstatechange) ctx.onstatechange(); return Promise.resolve(); };
  ctx.suspend = () => { ctx.log.push(['suspend']); ctx.state = 'suspended'; if (ctx.onstatechange) ctx.onstatechange(); return Promise.resolve(); };
  ctx.close = () => { ctx.log.push(['close']); ctx.state = 'closed'; if (ctx.onstatechange) ctx.onstatechange(); return Promise.resolve(); };
  ctx.getOutputTimestamp = () => ({ contextTime: ctx.currentTime, performanceTime: ctx.currentTime * 1000 });
  ctx.addEventListener = () => {};
  ctx.removeEventListener = () => {};
  /** Move the clock by seconds and end every source whose stop time has passed. */
  ctx.advance = (seconds) => {
    ctx.currentTime = Math.round((ctx.currentTime + (seconds || 0)) * 1e6) / 1e6;
    for (const s of ctx.sources) if (s.started && !s.ended && s.stopAt !== null && s.stopAt <= ctx.currentTime) { s.ended = true; if (typeof s.onended === 'function') s.onended({ target: s }); }
    return ctx.currentTime;
  };
  ctx.playing = () => ctx.sources.filter((s) => s.started && !s.ended && (s.stopAt === null || s.stopAt > ctx.currentTime));
  return ctx;
}

/* ── The store ─────────────────────────────────────────────────────────────────────────────── */

/**
 * A fake saves() store: the handle save.js hands back, with every write recorded in `store.log`
 * and every save() counted, so a module that persists can be checked without the node.
 * @param {Record<string, any>} [initial]  fields laid over the default state
 * @returns {any}
 */
export function makeStore(initial) {
  const state = Object.assign({ version: 1, profile: { name: '' }, settings: {}, levels: {}, scores: [], inventory: {}, best: 0 }, initial || {});
  const listeners = [];
  const log = [];
  let session = 0;
  let guest = false;
  const emit = () => { for (const fn of listeners.slice()) fn(state); };
  const touch = (op, detail) => { log.push(Object.assign({ op }, detail || {})); store.saves += 1; emit(); };
  const store = {
    kind: 'store', state, log, listeners, saves: 0, loads: 0,
    get: () => state,
    set(patch) { log.push({ op: 'set', keys: Object.keys(patch || {}), patch }); Object.assign(state, patch || {}); emit(); return state; },
    save() { store.saves += 1; log.push({ op: 'save' }); return Promise.resolve(); },
    load() { store.loads += 1; log.push({ op: 'load' }); return Promise.resolve(state); },
    levels: {
      get: (id) => state.levels[id] || null,
      unlock(id) { const was = state.levels[id] && state.levels[id].unlocked; state.levels[id] = Object.assign({ unlocked: false, stars: 0, best: 0 }, state.levels[id] || {}, { unlocked: true }); if (!was) touch('unlock', { id }); return !was; },
      isUnlocked: (id) => !!(state.levels[id] && state.levels[id].unlocked),
      stars(id, n) { const rec = state.levels[id] || (state.levels[id] = { unlocked: true, stars: 0, best: 0 }); if (typeof n === 'number' && n > rec.stars) { rec.stars = n; touch('stars', { id, n }); } return rec.stars; },
      best(id, score) { const rec = state.levels[id] || (state.levels[id] = { unlocked: true, stars: 0, best: 0 }); if (typeof score === 'number' && score > rec.best) { rec.best = score; touch('best', { id, score }); return true; } return false; },
    },
    settings(patch) { if (patch) { Object.assign(state.settings, patch); touch('settings', { patch }); } return state.settings; },
    isGuest: () => guest,
    setGuest: (v) => { guest = !!v; },
    onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    leaderboard: (o) => Promise.resolve((store.rows || []).slice(0, (o && o.limit) || 10)),
    rows: [],
    destroy() { listeners.length = 0; store.destroyed = true; },
  };
  store.score = (add) => { if (typeof add === 'number' && isFinite(add) && add !== 0) { session += add; if (session > (state.best || 0)) { state.best = session; touch('best', { score: session }); } } return session; };
  store.score.reset = () => { const finished = session; session = 0; if (finished > 0) { state.scores = state.scores.concat([finished]).sort((a, b) => b - a).slice(0, 10); touch('scores', { finished }); } return finished; };
  return store;
}

/* ── The Phaser namespace and the globals ──────────────────────────────────────────────────── */

const KEYCODES = { BACKSPACE: 8, TAB: 9, ENTER: 13, SHIFT: 16, CTRL: 17, ALT: 18, ESC: 27, SPACE: 32, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, DELETE: 46, A: 65, B: 66, C: 67, D: 68, E: 69, F: 70, G: 71, H: 72, I: 73, J: 74, K: 75, L: 76, M: 77, N: 78, O: 79, P: 80, Q: 81, R: 82, S: 83, T: 84, U: 85, V: 86, W: 87, X: 88, Y: 89, Z: 90, ZERO: 48, ONE: 49, TWO: 50, THREE: 51, FOUR: 52, FIVE: 53, SIX: 54, SEVEN: 55, EIGHT: 56, NINE: 57 };

class Vector2 {
  constructor(x, y) { this.x = x || 0; this.y = y === undefined ? this.x : y; }
  set(x, y) { this.x = x; this.y = y === undefined ? x : y; return this; }
  setTo(x, y) { return this.set(x, y); }
  clone() { return new Vector2(this.x, this.y); }
  copy(v) { return this.set(v.x, v.y); }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  subtract(v) { this.x -= v.x; this.y -= v.y; return this; }
  scale(n) { this.x *= n; this.y *= n; return this; }
  length() { return Math.hypot(this.x, this.y); }
  lengthSq() { return this.x * this.x + this.y * this.y; }
  normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; }
  setLength(n) { return this.normalize().scale(n); }
  distance(v) { return Math.hypot(v.x - this.x, v.y - this.y); }
  dot(v) { return this.x * v.x + this.y * v.y; }
  angle() { return Math.atan2(this.y, this.x); }
  setToPolar(a, r) { const n = r === undefined ? 1 : r; this.x = Math.cos(a) * n; this.y = Math.sin(a) * n; return this; }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; return this; }
  negate() { this.x = -this.x; this.y = -this.y; return this; }
  equals(v) { return this.x === v.x && this.y === v.y; }
  reset() { return this.set(0, 0); }
}

class Rectangle {
  constructor(x, y, w, h) { this.x = x || 0; this.y = y || 0; this.width = w || 0; this.height = h || 0; this.type = 5; }
  get right() { return this.x + this.width; }
  get bottom() { return this.y + this.height; }
  get centerX() { return this.x + this.width / 2; }
  get centerY() { return this.y + this.height / 2; }
  setTo(x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; return this; }
  setPosition(x, y) { this.x = x; this.y = y === undefined ? x : y; return this; }
  setSize(w, h) { this.width = w; this.height = h === undefined ? w : h; return this; }
  contains(x, y) { return x >= this.x && x <= this.right && y >= this.y && y <= this.bottom; }
  getRandomPoint(out) { const o = out || {}; o.x = this.x + Math.random() * this.width; o.y = this.y + Math.random() * this.height; return o; }
  static Contains(r, x, y) { return r.contains(x, y); }
  static Overlaps(a, b) { return a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y; }
}

class Circle {
  constructor(x, y, r) { this.x = x || 0; this.y = y || 0; this.radius = r || 0; this.type = 0; }
  get diameter() { return this.radius * 2; }
  setTo(x, y, r) { this.x = x; this.y = y; this.radius = r; return this; }
  contains(x, y) { return Math.hypot(x - this.x, y - this.y) <= this.radius; }
  getRandomPoint(out) { const o = out || {}; const a = Math.random() * Math.PI * 2; const r = Math.sqrt(Math.random()) * this.radius; o.x = this.x + Math.cos(a) * r; o.y = this.y + Math.sin(a) * r; return o; }
  static Contains(c, x, y) { return c.contains(x, y); }
}

/**
 * The corner of the Phaser namespace the modules read off window.Phaser: tint and blend modes,
 * the scene states, the scale modes, Math helpers, key codes, JustDown, geometry and colour.
 * @returns {any}
 */
export function makePhaserNamespace() {
  const rnd = { pick: (a) => a[Math.floor(Math.random() * a.length)], weightedPick: (a) => a[Math.floor(Math.random() * a.length)], between: (a, b) => Math.floor(Math.random() * (b - a + 1)) + a, realInRange: (a, b) => a + Math.random() * (b - a), frac: () => Math.random(), integer: () => Math.floor(Math.random() * 4294967296), sign: () => (Math.random() < 0.5 ? -1 : 1), shuffle: (a) => a, angle: () => Math.floor(Math.random() * 360) - 180, rotation: () => Math.random() * Math.PI * 2 - Math.PI, sow() {}, init() {} };
  const games = [];
  class Scene { constructor(cfg) { this.config = cfg; this.sys = { settings: { key: typeof cfg === 'string' ? cfg : (cfg && cfg.key) || '' } }; } }
  class Game { constructor(cfg) { this.config = cfg || {}; this.isBooted = true; this.isRunning = true; this.canvas = cfg && cfg.canvas ? cfg.canvas : null; this.events = emitter(); this.scene = { keys: {}, getScene: () => null, start() {}, stop() {}, add() {} }; this.sound = { locked: false, context: null, volume: 1, mute: false, once() {}, off() {}, add() { return {}; }, play() { return true; } }; this.scale = { width: (cfg && cfg.width) || 960, height: (cfg && cfg.height) || 540, on() {}, off() {}, refresh() {}, resize() {} }; this.loop = { sleep() {}, wake() {}, actualFps: 60 }; games.push(this); } destroy() { this.isRunning = false; this.events.emit('destroy'); } }
  return {
    VERSION: '4.0.0-stub', AUTO: 0, CANVAS: 1, WEBGL: 2, HEADLESS: 3, games,
    TintModes: { MULTIPLY: 0, FILL: 1 },
    BlendModes: { SKIP_CHECK: -1, NORMAL: 0, ADD: 1, MULTIPLY: 2, SCREEN: 3, OVERLAY: 4, DARKEN: 5, LIGHTEN: 6, COLOR_DODGE: 7, COLOR_BURN: 8, HARD_LIGHT: 9, SOFT_LIGHT: 10, DIFFERENCE: 11, EXCLUSION: 12, HUE: 13, SATURATION: 14, COLOR: 15, LUMINOSITY: 16, ERASE: 17, SOURCE_IN: 18, SOURCE_OUT: 19, SOURCE_ATOP: 20, DESTINATION_OVER: 21, DESTINATION_IN: 22, DESTINATION_OUT: 23, DESTINATION_ATOP: 24, LIGHTER: 25, COPY: 26, XOR: 27 },
    Scenes: { PENDING: 0, INIT: 1, START: 2, LOADING: 3, CREATING: 4, RUNNING: 5, PAUSED: 6, SLEEPING: 7, SHUTDOWN: 8, DESTROYED: 9, Events: { SHUTDOWN: 'shutdown', DESTROY: 'destroy', UPDATE: 'update', POST_UPDATE: 'postupdate', PRE_UPDATE: 'preupdate', PAUSE: 'pause', RESUME: 'resume', SLEEP: 'sleep', WAKE: 'wake' } },
    Scale: { NONE: 0, WIDTH_CONTROLS_HEIGHT: 1, HEIGHT_CONTROLS_WIDTH: 2, FIT: 3, ENVELOP: 4, RESIZE: 5, EXPAND: 6, NO_CENTER: 0, CENTER_BOTH: 1, CENTER_HORIZONTALLY: 2, CENTER_VERTICALLY: 3, NO_ZOOM: 1, ZOOM_2X: 2, ZOOM_4X: 4, MAX_ZOOM: -1, LANDSCAPE: 'landscape-primary', PORTRAIT: 'portrait-primary', Events: { RESIZE: 'resize', ENTER_FULLSCREEN: 'enterfullscreen', LEAVE_FULLSCREEN: 'leavefullscreen' } },
    Scene, Game,
    Math: {
      Between: (a, b) => Math.floor(Math.random() * (b - a + 1)) + a,
      FloatBetween: (a, b) => a + Math.random() * (b - a),
      Clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
      Linear: (a, b, t) => a + (b - a) * t,
      Wrap: (v, lo, hi) => { const r = hi - lo; return ((((v - lo) % r) + r) % r) + lo; },
      DegToRad: (d) => (d * Math.PI) / 180, RadToDeg: (r) => (r * 180) / Math.PI,
      PI2: Math.PI * 2, TAU: Math.PI / 2, EPSILON: 1e-6, MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER, MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
      Distance: { Between: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1), BetweenPoints: (a, b) => Math.hypot(b.x - a.x, b.y - a.y), Squared: (x1, y1, x2, y2) => (x2 - x1) ** 2 + (y2 - y1) ** 2 },
      Angle: { Between: (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1), BetweenPoints: (a, b) => Math.atan2(b.y - a.y, b.x - a.x), Wrap: (a) => Math.atan2(Math.sin(a), Math.cos(a)), WrapDegrees: (a) => ((((a + 180) % 360) + 360) % 360) - 180, Normalize: (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), RotateTo: (cur, to, lerp) => { const d = Math.atan2(Math.sin(to - cur), Math.cos(to - cur)); return Math.abs(d) < (lerp || 0.05) ? to : cur + Math.sign(d) * (lerp || 0.05); }, ShortestBetween: (a, b) => { const d = (b - a) % 360; return d > 180 ? d - 360 : (d < -180 ? d + 360 : d); } },
      Easing: { Linear: (v) => v, Quadratic: { In: (v) => v * v, Out: (v) => v * (2 - v), InOut: (v) => (v < 0.5 ? 2 * v * v : -1 + (4 - 2 * v) * v) }, Cubic: { In: (v) => v ** 3, Out: (v) => 1 - (1 - v) ** 3, InOut: (v) => (v < 0.5 ? 4 * v ** 3 : 1 - (-2 * v + 2) ** 3 / 2) }, Sine: { In: (v) => 1 - Math.cos((v * Math.PI) / 2), Out: (v) => Math.sin((v * Math.PI) / 2), InOut: (v) => -(Math.cos(Math.PI * v) - 1) / 2 } },
      Interpolation: { Linear: (v, k) => { const m = v.length - 1; const f = m * k; const i = Math.floor(f); return v[i] + (v[Math.min(m, i + 1)] - v[i]) * (f - i); } },
      RND: rnd, Vector2, Snap: { To: (v, gap) => Math.round(v / gap) * gap, Floor: (v, gap) => Math.floor(v / gap) * gap, Ceil: (v, gap) => Math.ceil(v / gap) * gap },
      Within: (a, b, tol) => Math.abs(a - b) <= tol, Fuzzy: { Equal: (a, b, e) => Math.abs(a - b) < (e === undefined ? 1e-4 : e) }, Percent: (v, min, max) => (v - min) / ((max === undefined ? 1 : max) - min), RoundTo: (v, place) => { const p = 10 ** -(place || 0); return Math.round(v * p) / p; }, SmoothStep: (x, min, max) => { const t = Math.max(0, Math.min(1, (x - min) / (max - min))); return t * t * (3 - 2 * t); }, IsEven: (n) => n % 2 === 0, MinSub: (v, n, min) => Math.max(min, v - n), MaxAdd: (v, n, max) => Math.min(max, v + n),
    },
    Input: { Keyboard: { KeyCodes: KEYCODES, JustDown: (k) => { const was = !!(k && k._justDown); if (k) k._justDown = false; return was; }, JustUp: (k) => { const was = !!(k && k._justUp); if (k) k._justUp = false; return was; }, DownDuration: (k, ms) => !!(k && k.isDown && (ms === undefined || k.getDuration() < ms)), UpDuration: (k, ms) => !!(k && !k.isDown && (ms === undefined || k.duration < ms)), Events: { KEY_DOWN: 'keydown', KEY_UP: 'keyup', ANY_KEY_DOWN: 'keydown', ANY_KEY_UP: 'keyup' } }, Events: { POINTER_DOWN: 'pointerdown', POINTER_UP: 'pointerup', POINTER_MOVE: 'pointermove', GAMEOBJECT_POINTER_DOWN: 'pointerdown', GAMEOBJECT_POINTER_UP: 'pointerup', GAMEOBJECT_POINTER_OVER: 'pointerover', GAMEOBJECT_POINTER_OUT: 'pointerout', DRAG: 'drag', DRAG_START: 'dragstart', DRAG_END: 'dragend', DROP: 'drop' }, Gamepad: { Events: { CONNECTED: 'connected', DISCONNECTED: 'disconnected', BUTTON_DOWN: 'down', BUTTON_UP: 'up' } } },
    Geom: { Rectangle, Circle, Point: Vector2, Line: class { constructor(x1, y1, x2, y2) { this.x1 = x1 || 0; this.y1 = y1 || 0; this.x2 = x2 || 0; this.y2 = y2 || 0; } }, Intersects: { RectangleToRectangle: Rectangle.Overlaps, CircleToRectangle: (c, r) => r.contains(c.x, c.y) } },
    Display: { Color: Object.assign(class { constructor(r, g, b, a) { this.r = r || 0; this.g = g || 0; this.b = b || 0; this.a = a === undefined ? 255 : a; } get color() { return (this.r << 16) | (this.g << 8) | this.b; } get rgba() { return 'rgba(' + this.r + ',' + this.g + ',' + this.b + ',' + this.a / 255 + ')'; } setTo(r, g, b, a) { this.r = r; this.g = g; this.b = b; if (a !== undefined) this.a = a; return this; } }, { GetColor: (r, g, b) => (r << 16) | (g << 8) | b, GetColor32: (r, g, b, a) => (a << 24) | (r << 16) | (g << 8) | b, IntegerToRGB: (c) => ({ r: (c >> 16) & 255, g: (c >> 8) & 255, b: c & 255, a: 255 }), IntegerToColor: (c) => ({ r: (c >> 16) & 255, g: (c >> 8) & 255, b: c & 255, a: 255, color: c }), HexStringToColor: (s) => { const n = parseInt(String(s).replace('#', ''), 16) || 0; return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255, color: n }; }, RGBToString: (r, g, b) => '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0'), ValueToColor: (v) => (typeof v === 'number' ? { color: v } : { color: parseInt(String(v).replace('#', ''), 16) || 0 }), Interpolate: { ColorWithColor: (a, b, len, idx) => { const t = (len ? idx / len : 0); return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }; }, RGBWithRGB: (r1, g1, b1, r2, g2, b2, len, idx) => { const t = (len ? idx / len : 0); return { r: r1 + (r2 - r1) * t, g: g1 + (g2 - g1) * t, b: b1 + (b2 - b1) * t }; } } }), Align: { CENTER: 6, TOP_LEFT: 0, TOP_CENTER: 1, TOP_RIGHT: 2, LEFT_CENTER: 5, RIGHT_CENTER: 7, BOTTOM_LEFT: 8, BOTTOM_CENTER: 9, BOTTOM_RIGHT: 10 } },
    Utils: { Array: { Shuffle: (a) => a, GetRandom: (a) => a[Math.floor(Math.random() * a.length)], Remove: (a, item) => { const i = a.indexOf(item); if (i >= 0) a.splice(i, 1); return item; }, NumberArray: (s, e) => { const out = []; for (let i = s; i <= e; i++) out.push(i); return out; }, Range: () => [], SpliceOne: (a, i) => a.splice(i, 1)[0] }, Objects: { GetValue: (o, k, d) => (o && o[k] !== undefined ? o[k] : d), GetFastValue: (o, k, d) => (o && o[k] !== undefined ? o[k] : d), Merge: (a, b) => Object.assign({}, b, a), Clone: (o) => Object.assign({}, o), DeepCopy: (o) => JSON.parse(JSON.stringify(o)) }, String: { Pad: (s, len, pad, dir) => (dir === 1 ? String(s).padStart(len, pad) : String(s).padEnd(len, pad)), UUID: () => 'stub-uuid', Format: (s) => s } },
    Textures: { Events: { ADD: 'addtexture', REMOVE: 'removetexture' }, FilterMode: { LINEAR: 0, NEAREST: 1 } },
    Animations: { Events: { ANIMATION_COMPLETE: 'animationcomplete', ANIMATION_START: 'animationstart', ANIMATION_REPEAT: 'animationrepeat', ANIMATION_STOP: 'animationstop' } },
    Cameras: { Scene2D: { Events: { FADE_OUT_COMPLETE: 'camerafadeoutcomplete', FADE_IN_COMPLETE: 'camerafadeincomplete', PAN_COMPLETE: 'camerapancomplete', ZOOM_COMPLETE: 'camerazoomcomplete', SHAKE_COMPLETE: 'camerashakecomplete', FLASH_COMPLETE: 'cameraflashcomplete' } } },
    Physics: { Arcade: { Events: { WORLD_BOUNDS: 'worldbounds', COLLIDE: 'collide', OVERLAP: 'overlap', PAUSE: 'pause', RESUME: 'resume' }, STATIC_BODY: 1, DYNAMIC_BODY: 0 } },
    Sound: { Events: { UNLOCKED: 'unlocked', COMPLETE: 'complete', PLAY: 'play', STOP: 'stop', PAUSE: 'pause', RESUME: 'resume', VOLUME: 'volume', MUTE: 'mute', RATE: 'rate', DETUNE: 'detune' } },
    Tweens: { Events: { TWEEN_COMPLETE: 'complete', TWEEN_START: 'start', TWEEN_UPDATE: 'update', TWEEN_STOP: 'stop', TWEEN_YOYO: 'yoyo', TWEEN_REPEAT: 'repeat' } },
    GameObjects: { Events: { DESTROY: 'destroy', ADDED_TO_SCENE: 'addedtoscene', REMOVED_FROM_SCENE: 'removedfromscene' }, Text: { TextStyle: class {} } },
    Core: { Events: { PAUSE: 'pause', RESUME: 'resume', BLUR: 'blur', FOCUS: 'focus', HIDDEN: 'hidden', VISIBLE: 'visible', DESTROY: 'destroy', READY: 'ready', BOOT: 'boot' } },
    Structs: { Size: class { constructor(w, h) { this.width = w || 0; this.height = h || 0; } setSize(w, h) { this.width = w; this.height = h; return this; } } },
    Time: { TimerEvent: class {} }, Loader: { Events: { COMPLETE: 'complete', PROGRESS: 'progress', FILE_COMPLETE: 'filecomplete', START: 'start' } },
    Renderer: { WebGL: { Pipelines: {} } }, Plugins: { BasePlugin: class {}, ScenePlugin: class {} },
  };
}

/**
 * Put the browser the phaser modules import against in place, and hand back the undo. Run it
 * BEFORE `await import()` of a module: the chain tokens → boot → _core/config reads
 * location, document and window.__AIMEAT_SDK_CFG__ at import time.
 * @param {{ motion?: 'less'|'auto'|null, document?: any, location?: any, nodeId?: string,
 *   baseUrl?: string, navigator?: any, phaser?: any, matches?: Record<string, boolean> }} [opts]
 *   `matches` answers matchMedia(query).matches per query string (default false).
 * @returns {() => void} restore: every global put back or removed, in one call
 */
export function installGlobals(opts) {
  const o = opts || {};
  const dom = o.document && o.document.__akStub ? { document: o.document, setMotion: o.document.setMotion } : makeDom({ motion: o.motion });
  if (o.motion !== undefined && o.document) dom.setMotion(o.motion);
  const storage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] || null, get length() { return m.size; }, map: m }; };
  const mediaLists = new Map();
  const matchMedia = (q) => { if (!mediaLists.has(q)) { const ev = emitter(); mediaLists.set(q, Object.assign({ media: q, matches: !!(o.matches && o.matches[q]), onchange: null, addListener: (f) => ev.on('change', f), removeListener: (f) => ev.off('change', f), addEventListener: ev.on, removeEventListener: ev.off, dispatchEvent: (e) => ev.emit(e.type, e), set(v) { this.matches = !!v; ev.emit('change', { matches: this.matches, media: q }); } })); } return mediaLists.get(q); };
  const winEvents = emitter();
  const globals = {
    window: globalThis,
    self: globalThis,
    document: dom.document,
    location: Object.assign({ protocol: 'http:', origin: 'http://localhost:40050', href: 'http://localhost:40050/', hostname: 'localhost', host: 'localhost:40050', pathname: '/', search: '', hash: '', port: '40050', assign() {}, replace() {}, reload() {}, toString() { return this.href; } }, o.location || {}),
    navigator: Object.assign({ userAgent: 'aimeat-phaser-stub', language: 'en', languages: ['en'], platform: 'Win32', onLine: true, maxTouchPoints: 0, hardwareConcurrency: 4, clipboard: { writes: [], writeText(t) { this.writes.push(t); return Promise.resolve(); }, readText: () => Promise.resolve('') }, vibrate: () => true, getGamepads: () => [], mediaDevices: { getUserMedia: () => Promise.reject(new Error('no media in the stub')) }, serviceWorker: undefined, share: undefined, permissions: { query: () => Promise.resolve({ state: 'prompt' }) } }, o.navigator || {}),
    localStorage: storage(),
    sessionStorage: storage(),
    matchMedia,
    getComputedStyle: (el) => ({ getPropertyValue: (k) => (el && el.style && typeof el.style.getPropertyValue === 'function' ? el.style.getPropertyValue(k) : ''), color: (el && el.style && el.style.color) || '', fontFamily: '', fontSize: '', display: 'block', visibility: 'visible', width: '0px', height: '0px' }),
    requestAnimationFrame: (fn) => globalThis.setTimeout(() => fn(globalThis.performance ? globalThis.performance.now() : 0), 0),
    cancelAnimationFrame: (id) => globalThis.clearTimeout(id),
    addEventListener: winEvents.on,
    removeEventListener: winEvents.off,
    dispatchEvent: (e) => { winEvents.emit(e.type, e); return true; },
    screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, orientation: { type: 'landscape-primary', angle: 0, lock: () => Promise.resolve(), unlock() {}, addEventListener() {}, removeEventListener() {} } },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, scrollX: 0, scrollY: 0, pageXOffset: 0, pageYOffset: 0,
    scrollTo() {}, scroll() {}, open: () => null, alert() {}, confirm: () => true, prompt: () => null, focus() {}, blur() {}, print() {},
    getSelection: () => ({ removeAllRanges() {}, toString: () => '' }),
    __AIMEAT_SDK_CFG__: { nodeId: o.nodeId === undefined ? 'stub-node' : o.nodeId, baseUrl: o.baseUrl === undefined ? 'http://localhost:40050' : o.baseUrl, heartbeatMs: 30000 },
    Phaser: o.phaser || makePhaserNamespace(),
    AudioContext: function AudioContext(cfg) { return makeAudioContext(cfg); },
    webkitAudioContext: function webkitAudioContext(cfg) { return makeAudioContext(cfg); },
    ResizeObserver: class { constructor(cb) { this.cb = cb; this.targets = []; } observe(t) { this.targets.push(t); } unobserve(t) { this.targets = this.targets.filter((x) => x !== t); } disconnect() { this.targets = []; } },
    IntersectionObserver: class { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { constructor() { this.width = 0; this.height = 0; this.complete = true; this.onload = null; this.src = ''; } },
    HTMLElement: FakeNode, Element: FakeNode, HTMLCanvasElement: FakeNode, Node: FakeNode,
    speechSynthesis: { speak() {}, cancel() {}, getVoices: () => [], speaking: false, addEventListener() {}, removeEventListener() {} },
    SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
  };
  if (typeof globalThis.CustomEvent !== 'function') globals.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; this.bubbles = !!(init && init.bubbles); } };
  if (typeof globalThis.Event !== 'function') globals.Event = class { constructor(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); } };
  const previous = new Map();
  for (const name in globals) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    try { Object.defineProperty(globalThis, name, { value: globals[name], configurable: true, writable: true, enumerable: false }); } catch { globalThis[name] = globals[name]; }
  }
  const restore = () => {
    for (const [name, desc] of previous) {
      try { if (desc) Object.defineProperty(globalThis, name, desc); else delete globalThis[name]; } catch { globalThis[name] = desc ? desc.value : undefined; }
    }
    previous.clear();
  };
  restore.globals = globals;
  restore.document = dom.document;
  restore.setMotion = dom.setMotion;
  restore.windowEvents = winEvents;
  restore.matchMedia = matchMedia;
  return restore;
}
