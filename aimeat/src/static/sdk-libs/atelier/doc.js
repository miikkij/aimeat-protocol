/**
 * @file atelier/doc.js
 * @description doc(): one markdown document drawn in the kit's box, with the kit's colours on the
 *   rendered text, light and dark. Measured 2026-10-01: five apps drew a rendered document in nine
 *   places, each with its own CSS around AIMEAT.md's bare .md-body element, and one of them had to
 *   re-ink .md-body with kit colours because a document read as an empty pane in light mode. This
 *   block is that box, once.
 *
 *   WHAT RENDERS. AIMEAT.md (aimeat-markdown.js) draws the text: render() for the safe subset, or
 *   renderRich() for the full pipeline when `rich` is set. A rich render draws the safe subset at
 *   once and swaps in the rich one when it arrives, so the box is never empty while the pipeline
 *   loads. `citations` pulls source lines and bracketed links out of model-written prose with
 *   AIMEAT.md.citations() and lists them under the text.
 *
 *   THE STATES. sample (built-in sample text, marked as such); empty (the kit's emptyState, with
 *   the app's own words when it gives them); no library (the text as written, with its line breaks,
 *   which is what the apps drew before); a render that throws or rejects (the same plain text, and
 *   no throw); rendered.
 *
 *   NOTHING FETCHES HERE. The markdown is the app's; AIMEAT.md loads its own rich pipeline.
 *
 *   THE PLAIN VARIANT. `variant: 'plain'` (data-ak-variant="plain" on the root) draws only the
 *   typeset text: no border, no padding, no background and no readable-width cap, for text that sits
 *   inside a card the app already draws. Asked for 2026-10-02: BUDJETTI undid the box by hand with
 *   --ak-doc-width: none and a rule removing the border, the padding and the background.
 * @parts doc root · title · body · md · text · empty · sources · source
 * @variants doc plain
 * @tokens doc --ak-doc-width
 * @fork doc Copying it out means calling AIMEAT.md.render() or renderRich() yourself, catching a failure into pre-wrapped text, and colouring .md-body's headings, lists, code, tables, quotes and links with the --ak-* tokens.
 * @structure doc(spec) (helpers: mdOf · blank)
 * @usage
 *   const d = AIMEAT.atelier.doc({ target: '#notes', markdown: text, rich: true });
 *   d.set({ markdown: next });
 *   AIMEAT.atelier.doc({ target: card, markdown: story, variant: 'plain' });
 * @version-history
 *   v0.63.0 — 2026-10-02 — variant: 'plain', the typeset text without the box.
 *   v0.62.0 — 2026-10-01 — Initial.
 */
import { el, clear, resolve, uid } from './dom.js';
import { emptyState } from './state.js';
import { td } from './decision-i18n.js';
import { isPlaceholder, sampleBadge, watch } from './members-shared.js';
import { applyVariant } from './parts-model.js';

/** The page's AIMEAT.md, or null. */
function mdOf() {
  const ns = /** @type {any} */ (window).AIMEAT;
  return ns && ns.md && typeof ns.md.render === 'function' ? ns.md : null;
}

/** Whether there is no text to show. */
function blank(v) {
  return v == null || String(v).trim() === '';
}

/**
 * One markdown document in the kit's box.
 * @param {{ target?: string|Element, markdown?: string, rich?: boolean, citations?: boolean,
 *   empty?: { title?: string, hint?: string }, sample?: boolean, title?: string,
 *   variant?: 'plain' }} spec
 * @returns {{ el: HTMLElement, set: (patch: { markdown?: string, title?: string }) => void,
 *   destroy: () => void }}
 */
export function doc(spec) {
  const s = spec || {};
  let markdown = s.markdown == null ? '' : String(s.markdown);
  let title = s.title || '';
  const root = el('section', { class: 'ak-root ak-doc', 'data-ak-part': 'root' });
  applyVariant(root, s, ['plain']);
  const head = el('h3', { class: 'ak-doc__title', 'data-ak-part': 'title', hidden: true });
  const body = el('div', { class: 'ak-doc__body', 'data-ak-part': 'body' });
  const sources = el('div', { class: 'ak-doc__sources', 'data-ak-part': 'sources', hidden: true });
  root.appendChild(head);
  root.appendChild(body);
  root.appendChild(sources);
  if (s.target) resolve(s.target).appendChild(root);
  let gen = 0;
  let destroyed = false;

  function sample() {
    return s.sample === true || isPlaceholder(markdown);
  }

  function heading() {
    clear(head);
    const isSample = sample();
    if (title) head.appendChild(document.createTextNode(title));
    if (isSample) head.appendChild(sampleBadge());
    head.hidden = !title && !isSample;
  }

  /** The text as written, line breaks kept: no library, or a render that failed. */
  function asText(text, state) {
    clear(body);
    body.appendChild(el('div', { class: 'ak-doc__text', 'data-ak-part': 'text' }, text));
    root.setAttribute('data-ak-state', state);
  }

  /** Put one rendered element in the box. */
  function place(node, state) {
    clear(body);
    node.setAttribute('data-ak-part', 'md');
    body.appendChild(node);
    root.setAttribute('data-ak-state', state);
  }

  /** The source list under the text, from AIMEAT.md.citations(). */
  function drawSources(list) {
    clear(sources);
    const md = mdOf();
    const items = el('ul', { class: 'ak-doc__source-list' });
    for (const c of list || []) {
      const href = md && typeof md.sanitizeHref === 'function' ? md.sanitizeHref(c.url) : c.url;
      if (!href) continue;
      items.appendChild(el('li', { class: 'ak-doc__source', 'data-ak-part': 'source' }, [
        el('a', { href: href, target: '_blank', rel: 'noopener noreferrer nofollow', title: c.url }, c.host || c.url),
        c.shortened ? el('span', { class: 'ak-doc__shortened' }, ' (' + td('doc.shortened') + ')') : null,
      ]));
    }
    sources.hidden = !items.firstChild;
    if (sources.hidden) return;
    const id = uid('ak-doc-src');
    sources.appendChild(el('p', { class: 'ak-doc__sources-title', id: id }, td('doc.sources')));
    items.setAttribute('aria-labelledby', id);
    sources.appendChild(items);
  }

  function draw() {
    const mine = ++gen;
    heading();
    drawSources([]);
    const isSample = sample();
    const text = isSample ? td('doc.sample') : markdown;
    if (blank(text)) {
      clear(body);
      const e = s.empty || {};
      const card = emptyState({ title: e.title || td('doc.empty.title'), hint: e.hint || td('doc.empty.hint') });
      card.el.setAttribute('data-ak-part', 'empty');
      body.appendChild(card.el);
      root.setAttribute('data-ak-state', 'empty');
      return;
    }
    const md = mdOf();
    if (!md) { asText(text, isSample ? 'sample' : 'text'); return; }
    let shown = text;
    if (s.citations && !isSample && typeof md.citations === 'function') {
      try {
        const c = md.citations(text);
        shown = c && typeof c.body === 'string' ? c.body : text;
        drawSources(c && c.sources);
      } catch (e) {
        console.debug('aimeat-atelier: doc citations not read', e);
      }
    }
    const done = isSample ? 'sample' : 'rendered';
    try {
      place(md.render(shown), s.rich ? 'rendering' : done);
    } catch (e) {
      console.warn('aimeat-atelier: doc render failed, showing the text', e);
      asText(text, isSample ? 'sample' : 'error');
      return;
    }
    if (!s.rich || typeof md.renderRich !== 'function') { root.setAttribute('data-ak-state', done); return; }
    Promise.resolve().then(function () { return md.renderRich(shown); }).then(function (node) {
      if (mine !== gen || destroyed) return;
      if (node && node.nodeType === 1) place(node, done);
      else root.setAttribute('data-ak-state', done);
    }, function (e) {
      if (mine !== gen || destroyed) return;
      // The safe subset is already on the screen; it stays.
      console.warn('aimeat-atelier: doc rich render failed, keeping the plain render', e);
      root.setAttribute('data-ak-state', done);
    });
  }

  draw();
  // The sample text and the empty card follow the language; a rendered document is the app's own.
  const stop = watch(function () {
    const state = root.getAttribute('data-ak-state');
    if (state === 'sample' || state === 'empty') draw();
  }, root);

  return {
    el: root,
    set(patch) {
      if (!patch || destroyed) return;
      if (patch.markdown !== undefined) markdown = patch.markdown == null ? '' : String(patch.markdown);
      if (patch.title !== undefined) title = patch.title || '';
      draw();
    },
    destroy() {
      destroyed = true;
      gen++;
      stop();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
