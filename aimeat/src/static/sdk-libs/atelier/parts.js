/**
 * @file atelier/parts.js
 * @description Five of the nine parts the Atelier Next canvas found the kit lacked (accepted
 *   2026-09-01) — the data-shaped ones, which also join the mosaic vocabulary:
 *     ring      progress toward a whole — a journey with an end (the gauge is a dial)
 *     crew      who is on this: people AND agents as one stack, with the live dot
 *     poll      one question, live shares — the hearts-and-votes pattern made a part
 *     keys      declared shortcuts, rendered — the sheet, the hints and the handlers agree
 *     dropzone  bring-a-file as a first-class part; the app uploads, or passes `upload` and the
 *               kit uploads through AIMEAT.storage (dropzone-upload.js)
 *   The behaviour-shaped four (toast, palette, compare, tour) live in parts-ui.js. Nothing here
 *   fetches itself; every component renders what it is given and reports what happens.
 * @structure ring · crew · poll · keys · dropzone
 * @usage
 *   AIMEAT.atelier.ring({ target, data: { value: 5, total: 7, label: 'Pages written' } });
 *   AIMEAT.atelier.dropzone({ target, accept: ['.html', '.png'], maxBytes: 5e6, onFiles(files) {} });
 *   const zone = AIMEAT.atelier.dropzone({ target, upload: { visibility: 'public' }, onUploaded(f, a) {} });
 *   if (zone.pending()) return;  // hold the app's own submit while files are still going up
 * @version-history
 *   v0.62.1 — 2026-10-01 — dropzone: the refusal line carries role="alert", so a screen reader
 *     announces "is not a kind this takes" and "is over N MB" when they appear.
 *   v0.62.0 — 2026-10-01 — dropzone takes `upload` (key, visibility, workspaceRef, chunkedOver,
 *     target), `onUploaded` and `onUploadError`, and its handle has `pending()`. Without `upload`, or
 *     without aimeat-storage.js on the page, it draws and behaves as before. Its own label and
 *     refusals are in the kit's three languages (the English text is unchanged).
 *   v0.42.0 — 2026-09-01 — Initial (wish-atelier-night-gallery, stage 3).
 */
import { el, clear, resolve, enter } from './dom.js';
import { svg } from './chart-core.js';
import { emptyState } from './state.js';
import { storageLib, uploader } from './dropzone-upload.js';
import { tu } from './copy-upload-i18n.js';

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

/**
 * The progress ring. `data`: { value, total, label?, sub? }.
 * @param {{ target?: string|Element, data?: any, title?: string, size?: number,
 *   empty?: { title?: string, hint?: string } }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: any }) => void, destroy: () => void }}
 */
export function ring(spec) {
  const s = spec || {};
  const root = el('div', { class: 'ak-root ak-ring' });
  if (s.target) resolve(s.target).appendChild(root);
  const size = s.size || 96;
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;

  function render(d) {
    clear(root);
    if (!d || typeof d.value !== 'number' || !(d.total > 0)) {
      const e = s.empty || {};
      emptyState({ target: root, tone: 'quiet', title: e.title || s.title || '—', hint: e.hint });
      return;
    }
    const share = Math.max(0, Math.min(d.value / d.total, 1));
    const node = svg('svg', { class: 'ak-ring__svg', width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, role: 'img',
      'aria-label': (d.label ? d.label + ': ' : '') + d.value + ' / ' + d.total });
    node.appendChild(svg('circle', { class: 'ak-ring__track', cx: size / 2, cy: size / 2, r, 'stroke-width': 10 }));
    node.appendChild(svg('circle', { class: 'ak-ring__fill', cx: size / 2, cy: size / 2, r, 'stroke-width': 10,
      'stroke-dasharray': circ.toFixed(1), 'stroke-dashoffset': (circ * (1 - share)).toFixed(1),
      transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')' }));
    const t = svg('text', { class: 'ak-ring__value', x: size / 2, y: size / 2 + 6, 'text-anchor': 'middle', 'font-size': Math.round(size / 5) });
    t.textContent = d.value + '/' + d.total;
    node.appendChild(t);
    root.appendChild(node);
    root.appendChild(el('div', {}, [
      d.label ? el('div', { class: 'ak-ring__label' }, String(d.label)) : null,
      d.sub ? el('div', { class: 'ak-ring__sub' }, String(d.sub)) : null,
    ].filter(Boolean)));
    enter(root);
  }
  render(s.data);
  return { el: root, set(patch) { if (patch && 'data' in patch) render(patch.data); }, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}

/**
 * The crew stack. `data`: { people: [{ id, label, agent? }], live?: number, max?: number }.
 * A person is a round face, an agent a square one; beyond `max` the rest fold into "+N".
 * @param {{ target?: string|Element, data?: any, title?: string, empty?: { title?: string, hint?: string } }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: any }) => void, destroy: () => void }}
 */
export function crew(spec) {
  const s = spec || {};
  const root = el('div', { class: 'ak-root ak-crew' });
  if (s.target) resolve(s.target).appendChild(root);

  function render(d) {
    clear(root);
    const people = (d && Array.isArray(d.people)) ? d.people : rowsOf(d);
    if (!people.length) {
      const e = s.empty || {};
      emptyState({ target: root, tone: 'quiet', title: e.title || s.title || '—', hint: e.hint });
      return;
    }
    const max = (d && d.max) || 4;
    const stack = el('div', { class: 'ak-crew__stack' });
    people.slice(0, max).forEach(function (p, i) {
      const initials = String(p.label || p.id || '?').trim().split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
      stack.appendChild(el('span', {
        class: 'ak-crew__face ak-crew__face--' + ((i % 3) + 1) + (p.agent ? ' ak-crew__face--agent' : ''),
        title: String(p.label || p.id || ''),
      }, initials));
    });
    if (people.length > max) stack.appendChild(el('span', { class: 'ak-crew__face ak-crew__more' }, '+' + (people.length - max)));
    root.appendChild(stack);
    if (d && typeof d.live === 'number' && d.live > 0) {
      root.appendChild(el('span', { class: 'ak-crew__live' }, [el('span', { class: 'ak-crew__dot' }), String(d.live) + ' ' + (d.liveLabel || 'here now')]));
    }
    enter(root);
  }
  render(s.data);
  return { el: root, set(patch) { if (patch && 'data' in patch) render(patch.data); }, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}

/**
 * The poll. `data`: { question, options: [{ id, label, count? | share? }], picked? }. Shares are
 * computed from counts when given; a pick calls back and marks the option — the app records
 * the vote wherever votes live.
 * @param {{ target?: string|Element, data?: any, onPick?: (opt: any) => void,
 *   empty?: { title?: string, hint?: string } }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: any }) => void, destroy: () => void }}
 */
export function poll(spec) {
  const s = spec || {};
  const root = el('div', { class: 'ak-root ak-poll' });
  if (s.target) resolve(s.target).appendChild(root);

  function render(d) {
    clear(root);
    const opts = (d && Array.isArray(d.options)) ? d.options : rowsOf(d);
    if (!opts.length) {
      const e = s.empty || {};
      emptyState({ target: root, tone: 'quiet', title: e.title || '—', hint: e.hint });
      return;
    }
    if (d && d.question) root.appendChild(el('div', { class: 'ak-poll__q' }, String(d.question)));
    const total = opts.reduce(function (n, o) { return n + (typeof o.count === 'number' ? o.count : 0); }, 0);
    opts.forEach(function (o) {
      const share = typeof o.share === 'number' ? o.share : (total > 0 ? (o.count || 0) / total : 0);
      const pct = Math.round(Math.max(0, Math.min(share, 1)) * 100);
      root.appendChild(el('button', {
        type: 'button', class: 'ak-poll__opt', 'aria-pressed': d && d.picked === o.id ? 'true' : 'false',
        on: s.onPick ? { click: function () { s.onPick(o); } } : undefined,
      }, [
        el('span', { class: 'ak-poll__fill', style: '--ak-share:' + pct + '%' }),
        el('span', { class: 'ak-poll__row' }, [el('span', {}, String(o.label || o.id)), el('span', { class: 'ak-poll__share' }, pct + '%')]),
      ]));
    });
    enter(root);
  }
  render(s.data);
  return { el: root, set(patch) { if (patch && 'data' in patch) render(patch.data); }, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}

/**
 * The key hints. `data`: rows of { keys: '⌘K' | ['⌘', 'K'], label }.
 * @param {{ target?: string|Element, data?: any }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: any }) => void, destroy: () => void }}
 */
export function keys(spec) {
  const s = spec || {};
  const root = el('ul', { class: 'ak-root ak-keys' });
  if (s.target) resolve(s.target).appendChild(root);

  function render(d) {
    clear(root);
    rowsOf(d).forEach(function (row) {
      const ks = Array.isArray(row.keys) ? row.keys : [String(row.keys || '')];
      root.appendChild(el('li', { class: 'ak-keys__row' }, ks.map(function (k) { return el('kbd', { class: 'ak-kbd' }, k); }).concat([el('span', {}, String(row.label || ''))])));
    });
  }
  render(s.data);
  return { el: root, set(patch) { if (patch && 'data' in patch) render(patch.data); }, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}

/**
 * The drop zone: drag a file onto it or press to pick; the accepted files reach the app through
 * `onFiles`, and a refused one (wrong kind, too big) is said on the zone in words. Without
 * `upload` the kit never uploads and the app owns that. With `upload` and aimeat-storage.js on the
 * page, the kit uploads each accepted file through AIMEAT.storage (dropzone-upload.js), shows its
 * state under the zone, and calls `onUploaded`; `pending()` says how many are still waiting or
 * running, so the app can hold its own submit.
 * @param {{ target?: string|Element, accept?: string[], maxBytes?: number, multiple?: boolean,
 *   label?: string, hint?: string, onFiles?: (files: File[]) => void,
 *   upload?: import('./dropzone-upload.js').DropzoneUpload,
 *   onUploaded?: (file: File, answer: import('./dropzone-upload.js').UploadAnswer) => void,
 *   onUploadError?: (file: File, err: any) => void }} spec
 * @returns {{ el: HTMLElement, pending: () => number, destroy: () => void }}
 */
export function dropzone(spec) {
  const s = spec || /** @type {any} */ ({});
  const accept = (s.accept || []).map(function (a) { return String(a).toLowerCase(); });
  const input = /** @type {HTMLInputElement} */ (el('input', { type: 'file', multiple: s.multiple ? true : null, accept: accept.length ? accept.join(',') : null }));
  // role="alert" from the start, so a screen reader announces the refusal when its text changes.
  const err = el('div', { class: 'ak-dropzone__err', role: 'alert', hidden: true });
  const root = el('div', { class: 'ak-root ak-dropzone', role: 'button', tabindex: '0' }, [
    el('div', { class: 'ak-dropzone__label' }, s.label || tu('drop.label')),
    s.hint ? el('div', { class: 'ak-dropzone__hint' }, s.hint) : null,
    err, input,
  ].filter(Boolean));
  if (s.target) resolve(s.target).appendChild(root);
  /** The upload queue, made at the first accepted file when `upload` is set. @type {ReturnType<typeof uploader>|null} */
  let up = null;
  let warned = false;

  function take(list) {
    const files = Array.prototype.slice.call(list || []);
    const bad = files.find(function (f) {
      const ext = '.' + String(f.name).split('.').pop().toLowerCase();
      if (accept.length && accept.indexOf(ext) < 0 && accept.indexOf(f.type) < 0) return true;
      return s.maxBytes ? f.size > s.maxBytes : false;
    });
    if (bad) {
      err.textContent = s.maxBytes && bad.size > s.maxBytes
        ? tu('drop.tooBig', { name: bad.name, mb: Math.round(s.maxBytes / 1e6) })
        : tu('drop.wrongKind', { name: bad.name });
      err.hidden = false;
      return;
    }
    err.hidden = true;
    if (!files.length) return;
    const picked = s.multiple ? files : files.slice(0, 1);
    if (s.onFiles) s.onFiles(picked);
    if (s.upload) {
      if (!up) {
        const lib = storageLib();
        if (lib) up = uploader({ zone: root, upload: s.upload, lib: lib, onUploaded: s.onUploaded, onUploadError: s.onUploadError });
        else if (!warned) { warned = true; console.warn('[atelier] dropzone: upload needs aimeat-storage.js on the page; the files went to onFiles only.'); }
      }
      if (up) up.add(picked);
    }
  }
  root.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
  root.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', function () { take(input.files); input.value = ''; });
  root.addEventListener('dragover', function (e) { e.preventDefault(); root.classList.add('is-over'); });
  root.addEventListener('dragleave', function () { root.classList.remove('is-over'); });
  root.addEventListener('drop', function (e) { e.preventDefault(); root.classList.remove('is-over'); take(e.dataTransfer ? e.dataTransfer.files : null); });
  enter(root);
  return {
    el: root,
    pending() { return up ? up.pending() : 0; },
    destroy() { if (up) up.destroy(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
