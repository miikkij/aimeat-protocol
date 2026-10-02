/**
 * @file atelier/handbook.js
 * @description The handbook: an app's own manual, opened from its header. A table of contents, one
 *   chapter at a time, a search over every chapter, and on a chapter that names a place in the app
 *   a "Show me" link that closes the way to that place and marks it there. It opens from the side
 *   (the app stays in view beside it) or as a dialog.
 *
 *   WHERE THE CHAPTERS COME FROM. Two places, merged: the app's own list (`chapters`), and the
 *   page itself, collected each time the book opens from every element that carries
 *   `data-ak-help="<chapter id>"` with `data-ak-help-title` and `data-ak-help-text` (and
 *   `data-ak-help-group`). A collected chapter's place is the element that carries it, so writing
 *   the help where the control is gives the chapter its "Show me" for nothing. An app chapter
 *   with the same id wins on the words and takes the element as its place when it names none.
 *
 *   EVERY WORD IN EVERY LANGUAGE. A chapter's title, body and group are a string, or an object
 *   per language ({ en, fi, es }), read in the kit's language each time the book draws; the book
 *   draws again when the language changes. An attribute can hold the same object as JSON.
 *
 *   WHAT FETCHES AND WHY. Nothing. The book reads the page and the app's list; what a chapter
 *   says is the app's.
 *
 *   THE SAMPLE STATE. `sample: true` carries four chapters in three groups, and changes nothing.
 * @parts handbook root · panel · head · title · search · close · toc · group · entry · article · heading · text · go · back · note · empty · button
 * @slots handbook body(chapter)
 * @variants handbook dense
 * @tokens handbook --ak-handbook-w
 * @fork handbook Write the chapters into a dialog of your own; you give up the table of contents, the search, the chapters the page carries, the languages and the marked place.
 * @structure handbook(spec) → { el, open, close, toggle, isOpen, set, add, scan, button, destroy }
 * @usage
 *   var book = AIMEAT.atelier.handbook({ title: { en: 'Guide', fi: 'Opas' }, chapters: [
 *     { id: 'ask', group: 'Start', title: 'Ask', body: 'Type what you want.', target: '#ask' } ] });
 *   AIMEAT.atelier.app({ title: 'Errands', help: book });   // a button in the header opens it
 *   <button data-ak-help="save" data-ak-help-title="Save" data-ak-help-text="Keeps the board.">
 * @version-history
 *   v0.65.0 — 2026-10-03 — Initial (wish-ohjekirja-komponentti-atelieriin-sis-llysluettelo-ohjeet-app).
 */
import { el, clear, wearLook, reducedMotion, attention } from './dom.js';
import { applyVariant } from './parts-model.js';
import { i18n } from './i18n.js';
import { searchBar } from './table.js';

const VARIANTS = ['dense'];
const MARK_MS = 2600;

const STRINGS = {
  en: {
    title: 'Guide', open: 'Open the guide', close: 'Close', contents: 'Contents', search: 'Search the guide',
    show: 'Show me', back: 'Contents', empty: 'Nothing in the guide matches.', none: 'This app has no guide yet.',
    away: 'That place is not on the screen right now.', group: 'General',
  },
  fi: {
    title: 'Opas', open: 'Avaa opas', close: 'Sulje', contents: 'Sisällys', search: 'Hae oppaasta',
    show: 'Näytä missä', back: 'Sisällys', empty: 'Oppaasta ei löydy tällaista.', none: 'Tällä appilla ei ole vielä opasta.',
    away: 'Se kohta ei ole nyt näkyvissä.', group: 'Yleistä',
  },
  es: {
    title: 'Guía', open: 'Abrir la guía', close: 'Cerrar', contents: 'Contenido', search: 'Buscar en la guía',
    show: 'Muéstrame dónde', back: 'Contenido', empty: 'Nada en la guía coincide.', none: 'Esta app aún no tiene guía.',
    away: 'Ese lugar no está en la pantalla ahora.', group: 'General',
  },
};

/** A word of the handbook: the host's own `handbook.<key>` first, then the kit's language. */
function hb(key) {
  const hosted = i18n.t('handbook.' + key);
  if (hosted !== 'handbook.' + key) return hosted;
  const table = /** @type {Record<string, string>} */ (STRINGS[/** @type {'en'|'fi'|'es'} */ (i18n.lang())] || STRINGS.en);
  return table[key] || STRINGS.en[key] || key;
}

/**
 * Words in the language in force: a string as it is, an object per language, or JSON of one.
 * @param {any} v
 * @returns {string}
 */
export function wordsOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.charAt(0) === '{') { try { return wordsOf(JSON.parse(s)); } catch { return v; } }
    return v;
  }
  if (typeof v === 'object') {
    const lang = i18n.lang();
    return String(v[lang] || v.en || v[Object.keys(v)[0]] || '');
  }
  return String(v);
}

/**
 * @typedef {{ id: string, title: any, body?: any, group?: any, keywords?: string,
 *   target?: string|Element|(() => Element|null), from?: Element }} Chapter
 */

/** The page's own chapters: every element with data-ak-help, in document order. */
function collect(root) {
  /** @type {Chapter[]} */
  const out = [];
  const scope = root || document;
  if (!scope || typeof scope.querySelectorAll !== 'function') return out;
  Array.prototype.forEach.call(scope.querySelectorAll('[data-ak-help]'), function (n) {
    const id = n.getAttribute('data-ak-help');
    if (!id) return;
    out.push({
      id: id,
      title: n.getAttribute('data-ak-help-title') || n.getAttribute('aria-label') || n.textContent || id,
      body: n.getAttribute('data-ak-help-text') || '',
      group: n.getAttribute('data-ak-help-group') || '',
      from: n,
    });
  });
  return out;
}

function sampleChapters() {
  return [
    { id: 's-ask', group: { en: 'Start', fi: 'Aloitus' }, title: { en: 'Ask for something', fi: 'Pyydä jotain' },
      body: { en: 'Type what you want in your own words. The app shows its plan before it does anything.', fi: 'Kirjoita omin sanoin, mitä haluat. Appi näyttää suunnitelmansa ennen kuin tekee mitään.' } },
    { id: 's-data', group: { en: 'Start', fi: 'Aloitus' }, title: { en: 'Add from your data', fi: 'Lisää omasta datasta' },
      body: { en: 'Pick a memory key or a workspace, and a panel is built from its real fields.', fi: 'Valitse muistiavain tai työtila, niin paneeli rakentuu sen oikeista kentistä.' } },
    { id: 's-move', group: { en: 'The board', fi: 'Lauta' }, title: { en: 'Move and Use', fi: 'Siirrä ja Käytä' },
      body: { en: 'Move drags frames; Use lets you click inside them.', fi: 'Siirrä raahaa kehyksiä, Käytä päästää klikkaamaan niiden sisällä.' } },
    { id: 's-share', group: { en: 'Together', fi: 'Yhdessä' }, title: { en: 'Share a board', fi: 'Jaa lauta' },
      body: { en: 'Invite people to the workspace the board lives in.', fi: 'Kutsu ihmisiä työtilaan, jossa lauta on.' } },
  ];
}

/**
 * The handbook.
 * @param {{
 *   title?: any, mode?: 'side'|'dialog', side?: 'right'|'left', variant?: string, sample?: boolean,
 *   chapters?: Chapter[], collect?: boolean|Element, search?: boolean,
 *   parts?: { body?: (chapter: Chapter) => any },
 *   onGo?: (chapter: Chapter, place: Element|null) => void, onOpen?: () => void, onClose?: () => void,
 * }} spec
 */
export function handbook(spec) {
  const s = spec || {};
  const sample = s.sample === true;
  const mode = s.mode === 'dialog' ? 'dialog' : 'side';
  const side = s.side === 'left' ? 'left' : 'right';
  const parts = s.parts || {};
  /** @type {Chapter[]} */
  let own = sample ? sampleChapters() : (s.chapters || []).slice();
  /** @type {Chapter[]} */
  let shown = [];
  let current = null;
  let query = '';
  let marked = null;
  let markTimer = null;
  let destroyed = false;
  /** @type {HTMLElement[]} */
  const buttons = [];

  const root = /** @type {HTMLDialogElement} */ (el('dialog', {
    class: 'ak-root ak-handbook ak-handbook--' + mode + ' ak-handbook--' + side,
    'data-ak-part': 'root', 'data-ak-view': 'toc',
  }));
  applyVariant(root, s, VARIANTS);
  const titleEl = el('h2', { class: 'ak-handbook__title', 'data-ak-part': 'title' });
  const closeBtn = el('button', {
    type: 'button', class: 'ak-btn ak-btn--ghost ak-handbook__close', 'data-ak-part': 'close', 'data-ak-noguard': true,
    on: { click: function () { close(); } },
  }, '✕');
  const head = el('div', { class: 'ak-handbook__head', 'data-ak-part': 'head' }, [titleEl, closeBtn]);
  const find = s.search === false ? null : searchBar({ placeholder: hb('search'), label: hb('search'),
    onChange: function (q) { query = String(q || '').trim().toLowerCase(); draw(); } });
  if (find) find.el.setAttribute('data-ak-part', 'search');
  const toc = el('nav', { class: 'ak-handbook__toc', 'data-ak-part': 'toc' });
  const article = el('article', { class: 'ak-handbook__article', 'data-ak-part': 'article', 'aria-live': 'polite' });
  const panel = el('div', { class: 'ak-handbook__panel', 'data-ak-part': 'panel' },
    [head, find ? find.el : null, el('div', { class: 'ak-handbook__cols' }, [toc, article])]);
  root.appendChild(panel);
  root.addEventListener('cancel', function (ev) { ev.preventDefault(); close(); });
  root.addEventListener('click', function (ev) { if (ev.target === root) close(); });

  /** Every chapter the book holds right now: the app's, then the page's that the app did not name. */
  function chapters() {
    // The sample collects only where it is told to (a gallery card), never the whole page.
    const page = s.collect === false || (sample && !s.collect) ? [] : collect(s.collect && s.collect !== true ? s.collect : document);
    const byId = new Map();
    own.forEach(function (c) { byId.set(c.id, Object.assign({}, c)); });
    page.forEach(function (c) {
      const have = byId.get(c.id);
      if (have) { if (!have.target && !have.from) have.from = c.from; return; }
      byId.set(c.id, c);
    });
    return Array.from(byId.values());
  }

  function textOf(c) {
    return [wordsOf(c.title), wordsOf(c.body), wordsOf(c.group), c.keywords || ''].join(' ').toLowerCase();
  }

  /** Where a chapter points, if it points anywhere and that place exists. */
  function placeOf(c) {
    let t = c.target;
    if (typeof t === 'function') { try { t = t(); } catch { t = null; } }
    if (typeof t === 'string') t = document.querySelector(t);
    return /** @type {Element|null} */ (t || c.from || null);
  }

  function fill(host, v) {
    clear(host);
    if (v == null || v === false) return;
    if (typeof v === 'function') { v(host); return; }
    if (v instanceof Node) { host.appendChild(v); return; }
    wordsOf(v).split(/\n{2,}/).forEach(function (para) {
      if (para.trim()) host.appendChild(el('p', { text: para.trim() }));
    });
  }

  function drawToc() {
    clear(toc);
    const hits = query ? shown.filter(function (c) { return textOf(c).indexOf(query) >= 0; }) : shown;
    if (!shown.length || !hits.length) {
      toc.appendChild(el('p', { class: 'ak-handbook__empty', 'data-ak-part': 'empty', text: hb(shown.length ? 'empty' : 'none') }));
      return;
    }
    let group = null, list = null;
    hits.forEach(function (c) {
      const g = wordsOf(c.group) || hb('group');
      if (g !== group || !list) {
        group = g;
        list = el('div', { class: 'ak-handbook__group', 'data-ak-part': 'group', role: 'group', 'aria-label': g },
          [el('div', { class: 'ak-handbook__groupname', text: g, 'aria-hidden': 'true' })]);
        toc.appendChild(list);
      }
      list.appendChild(el('button', {
        type: 'button', class: 'ak-handbook__entry', 'data-ak-part': 'entry', 'data-ak-id': c.id, 'data-ak-noguard': true,
        'aria-current': current === c.id ? 'true' : null,
        on: { click: function () { read(c.id); } },
      }, wordsOf(c.title)));
    });
  }

  function drawArticle() {
    clear(article);
    const c = shown.filter(function (x) { return x.id === current; })[0];
    article.appendChild(el('button', {
      type: 'button', class: 'ak-btn ak-btn--ghost ak-handbook__back', 'data-ak-part': 'back', 'data-ak-noguard': true,
      on: { click: function () { setView('toc'); } },
    }, '← ' + hb('back')));
    if (!c) return;
    article.appendChild(el('h3', { class: 'ak-handbook__heading', 'data-ak-part': 'heading', text: wordsOf(c.title) }));
    const body = el('div', { class: 'ak-handbook__text', 'data-ak-part': 'text' });
    fill(body, parts.body ? parts.body(c) : c.body);
    article.appendChild(body);
    if (c.target || c.from) {
      const note = el('p', { class: 'ak-handbook__note', 'data-ak-part': 'note', hidden: true, text: hb('away') });
      article.appendChild(el('button', {
        type: 'button', class: 'ak-btn ak-btn--primary ak-handbook__go', 'data-ak-part': 'go', 'data-ak-noguard': true,
        on: { click: function () { if (!go(c)) note.hidden = false; } },
      }, hb('show') + ' →'));
      article.appendChild(note);
    }
  }

  function draw() {
    if (destroyed) return;
    titleEl.textContent = wordsOf(s.title) || hb('title');
    closeBtn.setAttribute('aria-label', hb('close'));
    root.setAttribute('aria-label', wordsOf(s.title) || hb('title'));
    toc.setAttribute('aria-label', hb('contents'));
    if (find) {
      const box = find.el.querySelector('input');
      if (box) { box.setAttribute('placeholder', hb('search')); box.setAttribute('aria-label', hb('search')); }
    }
    drawToc();
    drawArticle();
    buttons.forEach(paintButton);
  }

  /** Narrow, the contents and the chapter take turns; the stylesheet reads which. */
  function setView(v) { root.setAttribute('data-ak-view', v); }

  /** Read one chapter: the article shows it, the contents mark it. */
  function read(id) {
    current = id;
    setView('read');
    draw();
  }

  /** Mark a place in the app for a moment: in view, ringed, and a flash where motion is allowed. */
  function mark(node) {
    unmark();
    marked = /** @type {HTMLElement} */ (node);
    marked.classList.add('ak-handbook__mark');
    if (typeof marked.scrollIntoView === 'function') marked.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    attention(marked, 'flash');
    markTimer = setTimeout(unmark, MARK_MS);
  }
  function unmark() {
    if (markTimer) { clearTimeout(markTimer); markTimer = null; }
    if (marked) marked.classList.remove('ak-handbook__mark');
    marked = null;
  }

  /**
   * Take the reader to a chapter's place. The app hears it first (onGo), so it can bring the
   * place on screen (open a panel, select a frame); then the place is marked. A dialog steps
   * aside first, a side book stays open beside the app. False when there is no such place now.
   * @param {Chapter} c
   */
  function go(c) {
    let node = placeOf(c);
    if (s.onGo) { try { s.onGo(c, node); } catch { /* the app's hook failing must not stop the mark */ } node = placeOf(c); }
    if (!node || !node.isConnected || (/** @type {HTMLElement} */ (node)).offsetParent === null) return false;
    // A dialog steps aside; so does a side book that covers most of the screen (a phone).
    if (mode === 'dialog' || panel.offsetWidth >= window.innerWidth * 0.75) close();
    mark(node);
    return true;
  }

  function isOpen() { return !!root.open; }

  /** @param {string} [id] a chapter to open on */
  function open(id) {
    if (destroyed) return;
    if (!root.isConnected) document.body.appendChild(root);
    root.removeAttribute('data-ak-look');
    wearLook(root, document.activeElement);
    shown = chapters();
    if (id && shown.some(function (c) { return c.id === id; })) { current = id; setView('read'); }
    else if (!current || !shown.some(function (c) { return c.id === current; })) { current = shown[0] ? shown[0].id : null; setView('toc'); }
    draw();
    if (!root.open) {
      if (mode === 'dialog' || typeof root.show !== 'function') root.showModal(); else root.show();
      if (!reducedMotion() && typeof panel.animate === 'function') {
        const from = mode === 'dialog' ? 'translateY(10px)' : (side === 'left' ? 'translateX(-100%)' : 'translateX(100%)');
        panel.animate([{ transform: from, opacity: mode === 'dialog' ? 0 : 1 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' });
      }
      buttons.forEach(paintButton);
      if (s.onOpen) s.onOpen();
    }
  }

  function close() {
    if (!root.open) return;
    root.close();
    buttons.forEach(paintButton);
    if (s.onClose) s.onClose();
  }

  function toggle() { if (isOpen()) close(); else open(); }

  function paintButton(b) {
    b.setAttribute('aria-label', hb('open'));
    b.setAttribute('title', hb('open'));
    b.setAttribute('aria-expanded', isOpen() ? 'true' : 'false');
  }

  /** The header's button: one per call, all kept in step with the book. */
  function button() {
    const b = el('button', {
      type: 'button', class: 'ak-handbook__button', 'data-ak-part': 'button', 'data-ak-noguard': true,
      'aria-haspopup': 'dialog', on: { click: function () { toggle(); } },
    }, '?');
    buttons.push(b);
    paintButton(b);
    return b;
  }

  const stopLang = i18n.onChange(function () { if (isOpen()) { shown = chapters(); draw(); } else buttons.forEach(paintButton); });

  return {
    el: root,
    open: open,
    close: close,
    toggle: toggle,
    isOpen: isOpen,
    /** @param {{ chapters?: Chapter[], title?: any }} patch */
    set: function (patch) {
      if (!patch || destroyed) return;
      if (patch.chapters) own = patch.chapters.slice();
      if (patch.title !== undefined) s.title = patch.title;
      if (isOpen()) { shown = chapters(); draw(); }
    },
    /** @param {Chapter|Chapter[]} more */
    add: function (more) {
      (Array.isArray(more) ? more : [more]).forEach(function (c) {
        own = own.filter(function (x) { return x.id !== c.id; }).concat([c]);
      });
      if (isOpen()) { shown = chapters(); draw(); }
    },
    /** Every chapter the book would show now, the page's included: for an agent or a test. */
    scan: function () { return chapters().map(function (c) { return { id: c.id, title: wordsOf(c.title), group: wordsOf(c.group), place: !!placeOf(c) }; }); },
    button: button,
    destroy: function () {
      destroyed = true;
      unmark();
      if (typeof stopLang === 'function') stopLang();
      if (root.open) root.close();
      root.remove();
      buttons.forEach(function (b) { b.remove(); });
    },
  };
}
