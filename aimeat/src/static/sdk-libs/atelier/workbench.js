/**
 * @file atelier/workbench.js
 * @description The WORKBENCH pieces: the parts a working tool is built from once the app has
 *   more than one screen and a person comes back to it every day. They were drawn first for the
 *   mail intake app (Postinjalostamo) on 2026-09-28, approved as a design, and moved here so the
 *   next tool starts from them instead of re-drawing them:
 *
 *     sideNav         the left navigation: grouped entries, a count and a tone dot each
 *     statusBand      the page's opening card: a title, one sentence, a progress bar, one action
 *     checkGrid       the readiness tiles: what is done, what needs the person, what is optional
 *     choiceCards     two to four ways to do one thing, side by side, and a panel for the chosen one
 *     settingsGroup   one group of settings: the help on the left, the controls on the right
 *     progressFigure  a batch while it runs: "3 / 10", the bar, the current item, the tallies
 *     callout         a tinted note with a tone: why this is unclear, what went wrong
 *
 *   A TOOL IS READ, NOT WATCHED. None of these pieces moves at idle. The progress figure counts
 *   up when its number changes, the chosen card gets its outline at once, and everything else
 *   is a still surface: a person working through forty messages needs the page to hold still.
 *
 *   THE WIDTH IS THE CONTENT'S. A settings group caps its controls at a measure, a check tile
 *   holds one line, and the grids fold to one column on a narrow box by container query, so the
 *   same page reads on a phone without the app writing a media query.
 * @structure sideNav · statusBand · checkGrid · choiceCards · settingsGroup · progressFigure · callout
 * @usage  const nav = AIMEAT.atelier.sideNav({ target: side, value: 'setup', items: [
 *           { id: 'setup', label: 'Setup', count: '5/5', tone: 'ok' },
 *           { id: 'unclear', label: 'Unclear', count: 1, tone: 'warn', group: 'Waiting for you' } ],
 *           onChange: show });
 *         AIMEAT.atelier.statusBand({ target: a.main, title: 'Ready', text: 'Five of five done.',
 *           progress: { value: 5, total: 5 }, action: { label: 'Run a batch', onClick: run } });
 * @parts sideNav root · group · item · dot · label · count · foot
 * @slots sideNav item(entry) · foot()
 * @tokens sideNav --ak-sidenav-w · --ak-sidenav-main
 * @fork sideNav Copy .ak-sidenav* out of workbench.css; you give up the grouping, the counts and the view transition.
 * @parts statusBand root · head · words · title · text · actions · bar · fill · body · after
 * @slots statusBand actions() · after()
 * @tokens statusBand --ak-band-pad
 * @fork statusBand A section with a heading, a sentence and a bar; copy .ak-band* out of workbench.css.
 * @parts checkGrid root · tile · icon · title · sub
 * @slots checkGrid sub(item)
 * @tokens checkGrid --ak-checkgrid-min
 * @fork checkGrid Copy .ak-checkgrid* out of workbench.css; the five state marks are inline SVG in this file.
 * @parts choiceCards root · grid · card · kicker · title · text · panel
 * @slots choiceCards text(item)
 * @tokens choiceCards --ak-choice-min
 * @fork choiceCards A radio group drawn as cards; copy .ak-choices* out of workbench.css and keep role=radiogroup.
 * @parts settingsGroup root · help · title · hint · body · after
 * @slots settingsGroup after()
 * @tokens settingsGroup --ak-setgroup-help · --ak-setgroup-measure
 * @fork settingsGroup Two columns that fold to one; copy .ak-setgroup* out of workbench.css.
 * @parts progressFigure root · kicker · figure · total · actions · bar · fill · now · nowLabel · nowText · chips · chip · counts · count
 * @slots progressFigure actions()
 * @tokens progressFigure --ak-progress-figure
 * @fork progressFigure Copy .ak-progress* out of workbench.css; the count-up is dom.js countUp.
 * @parts callout root · icon · words · title · text · after
 * @slots callout after()
 * @tokens callout --ak-callout-pad
 * @fork callout A tinted box with an icon; copy .ak-callout* out of workbench.css.
 * @version-history
 *   v0.1.0 — 2026-09-28 — Initial: the approved Postinjalostamo design, moved into the kit
 *     (wish-ty-p-yt-asettelu-atelieriin-ja-design-bookiin-postinjalostam).
 */
import { el, clear, resolve, enter, countUp, attention } from './dom.js';
import { viewSwap } from './arrive.js';
import { t } from './i18n.js';
import { slotInto, partValue } from './parts-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The tones a dot, a tile or a count may carry. Anything else reads as quiet. */
const TONES = ['ok', 'warn', 'err', 'accent', 'quiet', 'info'];

/** @param {any} tone @returns {string} */
function toneOf(tone) { return TONES.indexOf(tone) >= 0 ? tone : 'quiet'; }

/**
 * One state mark: a circle with a check, a bang, a dash, a cross or three dots. Drawn in
 * currentColor so the tile's tone class colours it.
 * @param {'ok'|'todo'|'optional'|'fail'|'wait'|'info'} state
 * @returns {SVGElement}
 */
function stateIcon(state) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('cx', '12');
  ring.setAttribute('cy', '12');
  ring.setAttribute('r', '10');
  svg.appendChild(ring);
  const marks = {
    ok: 'M8 12.5l2.6 2.6L16 9.6',
    todo: 'M12 7v6M12 16.5v.5',
    info: 'M12 11v6M12 7.5v.5',
    optional: 'M8 12h8',
    fail: 'M9 9l6 6M15 9l-6 6',
    wait: 'M8 12h.01M12 12h.01M16 12h.01',
  };
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', marks[state] || marks.optional);
  svg.appendChild(path);
  return svg;
}

/** The tone each check state wears. */
const STATE_TONE = { ok: 'ok', todo: 'warn', fail: 'err', wait: 'accent', optional: 'quiet', info: 'info' };

/** The words a screen reader hears for a state, before the tile's own title. */
function stateWords(state) {
  const key = { ok: 'checkOk', todo: 'checkTodo', fail: 'checkFail', wait: 'checkWait', optional: 'checkOptional' }[state];
  const said = key ? t(key) : '';
  return said && said !== key ? said : '';
}

/**
 * THE SIDE NAVIGATION — the left column of a working tool. Entries may sit under a group
 * heading, and each carries a count and a tone dot, so the column says where the work is before
 * anything is opened. A pick runs inside the kit's view transition, like a tab. (The mosaic's
 * `rail` nav mode is a different thing: it projects mosaic blocks, this lists the app's pages.)
 * @param {{
 *   target?: string|Element, label?: string, value?: string,
 *   items: Array<{ id: string, label: string, count?: number|string, tone?: string, group?: string,
 *     onPick?: (item: any) => void }>,
 *   onChange?: (id: string, item: any) => void,
 *   transition?: 'fade'|'wipe'|'curtain'|'zoom'|'iris'|'slide', parts?: any,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { value?: string, items?: any[] }) => void, destroy: () => void }}
 */
export function sideNav(spec) {
  const state = { items: spec.items || [], value: spec.value || (spec.items && spec.items[0] ? spec.items[0].id : '') };
  const root = el('nav', { class: 'ak-root ak-sidenav', 'data-ak-part': 'root', 'aria-label': spec.label || null });
  if (spec.target) resolve(spec.target).appendChild(root);

  function pick(item) {
    if (item.id === state.value) { if (item.onPick) item.onPick(item); return; }
    viewSwap(function () {
      state.value = item.id;
      render();
      if (item.onPick) item.onPick(item);
      if (spec.onChange) spec.onChange(item.id, item);
    }, { kind: spec.transition, node: root });
  }

  function render() {
    clear(root);
    let group = null;
    let list = null;
    for (const item of state.items) {
      const g = item.group || '';
      if (list === null || g !== group) {
        group = g;
        list = el('div', { class: 'ak-sidenav__group', 'data-ak-part': 'group', role: 'group', 'aria-label': g || null },
          g ? el('div', { class: 'ak-sidenav__heading', 'aria-hidden': 'true', text: g }) : null);
        root.appendChild(list);
      }
      const active = item.id === state.value;
      const given = partValue(spec, 'item', item);
      list.appendChild(el('button', {
        type: 'button',
        class: 'ak-sidenav__item' + (active ? ' ak-sidenav__item--active' : ''),
        'data-ak-part': 'item',
        'data-ak-id': item.id,
        'aria-current': active ? 'page' : null,
        'data-ak-noguard': true,
        on: { click: function () { pick(item); } },
      }, given !== undefined ? given : [
        item.tone ? el('span', { class: 'ak-sidenav__dot ak-tone--' + toneOf(item.tone), 'data-ak-part': 'dot', 'aria-hidden': 'true' }) : null,
        el('span', { class: 'ak-sidenav__label', 'data-ak-part': 'label', text: item.label }),
        item.count != null && item.count !== ''
          ? el('span', { class: 'ak-sidenav__count' + (item.tone ? ' ak-tone-text--' + toneOf(item.tone) : ''), 'data-ak-part': 'count', text: String(item.count) })
          : null,
      ]));
    }
    slotInto(root, spec, 'foot', null, { cls: 'ak-sidenav__foot', tag: 'div' });
  }
  render();

  return {
    el: root,
    /** @param {{ value?: string, items?: any[] }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.items) state.items = patch.items;
      if (patch.value != null) state.value = patch.value;
      render();
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * A progress bar with its numbers on the element, so a screen reader hears "3 of 10".
 * @param {string} cls  the component's own class prefix
 * @param {{ value: number, total: number, tone?: string }|number|null|undefined} p
 */
function progressBar(cls, p) {
  if (p == null) return null;
  const value = typeof p === 'number' ? p : Number(p.value) || 0;
  const total = typeof p === 'number' ? 1 : Math.max(Number(p.total) || 0, 0);
  const ratio = total > 0 ? Math.min(Math.max(value / total, 0), 1) : 0;
  const tone = typeof p === 'object' && p.tone ? toneOf(p.tone) : (ratio >= 1 ? 'ok' : 'accent');
  const fill = el('div', { class: cls + '__fill ak-tone-fill--' + tone, 'data-ak-part': 'fill', vars: { '--ak-fill': (ratio * 100).toFixed(1) + '%' } });
  return el('div', {
    class: cls + '__bar', 'data-ak-part': 'bar', role: 'progressbar',
    'aria-valuemin': '0', 'aria-valuemax': String(total || 1), 'aria-valuenow': String(value),
    'aria-valuetext': total ? t('ofTotal', { value: value, total: total }) : null,
  }, fill);
}

/**
 * THE STATUS BAND — the opening card of a page: where things stand in a title and one
 * sentence, how far along in a bar, and the one thing to do next. Its `body` takes what belongs
 * with it (a check grid, a note).
 * @param {{
 *   target?: string|Element, title: string, text?: string,
 *   progress?: { value: number, total: number, tone?: string }|number,
 *   action?: { label: string, onClick: () => any, kind?: 'primary'|'ghost'|'plain' },
 *   level?: 1|2, parts?: any,
 * }} spec
 * @returns {{ el: HTMLElement, body: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function statusBand(spec) {
  const s = Object.assign({}, spec);
  const root = el('section', { class: 'ak-root ak-band', 'data-ak-part': 'root' });
  const body = el('div', { class: 'ak-band__body', 'data-ak-part': 'body' });

  function render() {
    clear(root);
    const head = el('div', { class: 'ak-band__head', 'data-ak-part': 'head' }, [
      el('div', { class: 'ak-band__words', 'data-ak-part': 'words' }, [
        el(s.level === 2 ? 'h2' : 'h1', { class: 'ak-band__title', 'data-ak-part': 'title', text: s.title }),
        s.text ? el('p', { class: 'ak-band__text', 'data-ak-part': 'text', text: s.text }) : null,
      ]),
    ]);
    const actions = el('div', { class: 'ak-band__actions', 'data-ak-part': 'actions' });
    if (s.action) {
      actions.appendChild(el('button', {
        type: 'button', class: 'ak-btn' + (s.action.kind === 'plain' ? '' : ' ak-btn--' + (s.action.kind || 'primary')),
        on: { click: function () { return s.action && s.action.onClick && s.action.onClick(); } },
      }, s.action.label));
    }
    slotInto(actions, s, 'actions', null, { cls: 'ak-band__own', tag: 'span' });
    if (actions.firstChild) head.appendChild(actions);
    root.appendChild(head);
    const bar = progressBar('ak-band', s.progress);
    if (bar) root.appendChild(bar);
    root.appendChild(body);
    slotInto(root, s, 'after', null, { cls: 'ak-band__after', tag: 'div' });
  }
  render();
  if (s.target) resolve(s.target).appendChild(root);
  enter(root);

  return {
    el: root,
    body: body,
    /** @param {{ title?: string, text?: string, progress?: any, action?: any }} patch */
    set(patch) {
      if (!patch) return;
      Object.assign(s, patch);
      render();
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * THE CHECK GRID — readiness at a glance. One tile per thing the tool needs: done (a check),
 * needs the person (a bang, and a click to fix it), optional (a dash), failed (a cross) or
 * waiting (three dots). One line of words under each title, never a paragraph.
 * @param {{
 *   target?: string|Element,
 *   items: Array<{ id: string, state: 'ok'|'todo'|'optional'|'fail'|'wait', title: string, sub?: string }>,
 *   onPick?: (item: any) => void, parts?: any, variant?: string,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { items?: any[] }) => void, destroy: () => void }}
 */
export function checkGrid(spec) {
  const state = { items: spec.items || [] };
  const root = el('div', { class: 'ak-root ak-checkgrid', 'data-ak-part': 'root', role: 'list' });
  if (spec.target) resolve(spec.target).appendChild(root);

  function render() {
    clear(root);
    for (const item of state.items) {
      const tone = STATE_TONE[item.state] || 'quiet';
      const heard = stateWords(item.state);
      const inner = [
        el('span', { class: 'ak-checkgrid__icon ak-tone-mark--' + tone, 'data-ak-part': 'icon' }, stateIcon(item.state)),
        (function () {
          const words = el('span', { class: 'ak-checkgrid__words' }, [
            el('span', { class: 'ak-checkgrid__title', 'data-ak-part': 'title' }, [
              heard ? el('span', { class: 'ak-sr-only', text: heard + ': ' }) : null,
              item.title,
            ]),
          ]);
          slotInto(words, spec, 'sub', item.sub || null, { cls: 'ak-checkgrid__sub', args: [item] });
          return words;
        })(),
      ];
      const tile = spec.onPick
        ? el('button', {
          type: 'button', class: 'ak-checkgrid__tile ak-checkgrid__tile--' + item.state, 'data-ak-part': 'tile', 'data-ak-id': item.id,
          on: { click: function () { if (spec.onPick) spec.onPick(item); } },
        }, inner)
        : el('div', { class: 'ak-checkgrid__tile ak-checkgrid__tile--' + item.state, 'data-ak-part': 'tile', 'data-ak-id': item.id }, inner);
      root.appendChild(el('div', { role: 'listitem', class: 'ak-checkgrid__cell' }, tile));
    }
  }
  render();
  enter(root);

  return {
    el: root,
    /** @param {{ items?: any[] }} patch */
    set(patch) { if (patch && patch.items) { state.items = patch.items; render(); } },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * THE CHOICE CARDS — two to four ways to do one thing, side by side as a radio group, and one
 * panel under them for the chosen way. The chosen card says so in words and gets the accent
 * outline; the panel is the app's to fill (renderPanel runs on every change).
 * @param {{
 *   target?: string|Element, label?: string, value?: string,
 *   items: Array<{ id: string, kicker?: string, title: string, text?: string }>,
 *   onChange?: (id: string, item: any) => void,
 *   renderPanel?: (item: any, host: HTMLElement) => void, parts?: any, variant?: string,
 * }} spec
 * @returns {{ el: HTMLElement, panel: HTMLElement, set: (patch: { value?: string, items?: any[] }) => void, destroy: () => void }}
 */
export function choiceCards(spec) {
  const state = { items: spec.items || [], value: spec.value || (spec.items && spec.items[0] ? spec.items[0].id : '') };
  const root = el('div', { class: 'ak-root ak-choices', 'data-ak-part': 'root' });
  const grid = el('div', { class: 'ak-choices__grid', 'data-ak-part': 'grid', role: 'radiogroup', 'aria-label': spec.label || null });
  const panel = el('div', { class: 'ak-choices__panel', 'data-ak-part': 'panel' });
  root.appendChild(grid);
  root.appendChild(panel);
  if (spec.target) resolve(spec.target).appendChild(root);

  function current() {
    for (const item of state.items) if (item.id === state.value) return item;
    return null;
  }

  function renderPanel() {
    clear(panel);
    const item = current();
    panel.hidden = !item || !spec.renderPanel;
    if (item && spec.renderPanel) spec.renderPanel(item, panel);
  }

  function choose(item, focus) {
    if (item.id === state.value) return;
    state.value = item.id;
    renderCards(focus);
    renderPanel();
    if (spec.onChange) spec.onChange(item.id, item);
  }

  /** @param {boolean} [focus] move focus to the chosen card (arrow keys) */
  function renderCards(focus) {
    clear(grid);
    const items = state.items;
    items.forEach(function (item, i) {
      const on = item.id === state.value;
      const card = el('button', {
        type: 'button', role: 'radio', class: 'ak-choices__card' + (on ? ' ak-choices__card--on' : ''),
        'aria-checked': on ? 'true' : 'false', tabindex: on ? '0' : '-1',
        'data-ak-part': 'card', 'data-ak-id': item.id, 'data-ak-noguard': true,
        on: {
          click: function () { choose(item, false); },
          keydown: function (ev) {
            const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
            if (!step) return;
            ev.preventDefault();
            choose(items[(i + step + items.length) % items.length], true);
          },
        },
      }, [
        el('span', { class: 'ak-choices__kicker', 'data-ak-part': 'kicker', text: on ? t('chosen') : (item.kicker || '') }),
        el('span', { class: 'ak-choices__title', 'data-ak-part': 'title', text: item.title }),
      ]);
      slotInto(card, spec, 'text', item.text || null, { cls: 'ak-choices__text', args: [item] });
      grid.appendChild(card);
      if (on && focus) card.focus();
    });
  }
  renderCards(false);
  renderPanel();
  enter(grid);

  return {
    el: root,
    panel: panel,
    /** @param {{ value?: string, items?: any[] }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.items) state.items = patch.items;
      if (patch.value != null) state.value = patch.value;
      renderCards(false);
      renderPanel();
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * THE SETTINGS GROUP — one group of settings the way a settings page reads best: the words
 * that explain it on the left, the controls on the right at the width their content needs. On a
 * narrow box the help moves above the controls. Put a form (or several) in `body`.
 * @param {{ target?: string|Element, title: string, hint?: string, body?: any, parts?: any, variant?: string }} spec
 * @returns {{ el: HTMLElement, body: HTMLElement, set: (patch: { title?: string, hint?: string }) => void, destroy: () => void }}
 */
export function settingsGroup(spec) {
  const title = el('h2', { class: 'ak-setgroup__title', 'data-ak-part': 'title', text: spec.title });
  const hint = el('p', { class: 'ak-setgroup__hint', 'data-ak-part': 'hint', text: spec.hint || '' });
  hint.hidden = !spec.hint;
  const body = el('div', { class: 'ak-setgroup__body', 'data-ak-part': 'body' });
  if (spec.body != null) { const b = spec.body; (Array.isArray(b) ? b : [b]).forEach(function (n) { if (n) body.appendChild(typeof n === 'object' ? n : document.createTextNode(String(n))); }); }
  // The grid sits one level in: the section is the size container, and an element never matches
  // its own container query, so the two columns have to be a child's.
  const grid = el('div', { class: 'ak-setgroup__grid' }, [
    el('div', { class: 'ak-setgroup__help', 'data-ak-part': 'help' }, [title, hint]),
    body,
  ]);
  const root = el('section', { class: 'ak-root ak-setgroup', 'data-ak-part': 'root' }, grid);
  slotInto(root, spec, 'after', null, { cls: 'ak-setgroup__after', tag: 'div' });
  if (spec.target) resolve(spec.target).appendChild(root);
  enter(root);
  return {
    el: root,
    body: body,
    /** @param {{ title?: string, hint?: string }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.title != null) title.textContent = patch.title;
      if (patch.hint != null) { hint.textContent = patch.hint; hint.hidden = !patch.hint; }
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * THE PROGRESS FIGURE — a batch while it runs. The count is the largest thing on the card
 * ("3 / 10") and counts up as it changes, the bar follows it, the current item is named with the
 * steps it has passed, and the tallies sit under it in their tones.
 * @param {{
 *   target?: string|Element, label?: string, value: number, total: number,
 *   now?: string, steps?: Array<{ label: string, state?: 'done'|'now'|'todo' }>,
 *   counts?: Array<{ id: string, label: string, value: number, tone?: string }>,
 *   action?: { label: string, onClick: () => any }, parts?: any, variant?: string,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function progressFigure(spec) {
  const s = Object.assign({}, spec);
  const root = el('section', { class: 'ak-root ak-progress', 'data-ak-part': 'root' });
  let shown = Number(s.value) || 0;
  /** @type {Record<string, number>} */
  let shownCounts = {};

  function render(prev) {
    clear(root);
    const figure = el('span', { class: 'ak-progress__figure', 'data-ak-part': 'figure', text: String(prev != null ? prev : s.value) });
    const actions = el('div', { class: 'ak-progress__actions', 'data-ak-part': 'actions' });
    if (s.action) {
      actions.appendChild(el('button', {
        type: 'button', class: 'ak-btn',
        on: { click: function () { return s.action && s.action.onClick && s.action.onClick(); } },
      }, s.action.label));
    }
    slotInto(actions, s, 'actions', null, { cls: 'ak-progress__own', tag: 'span' });
    root.appendChild(el('div', { class: 'ak-progress__head' }, [
      el('div', { class: 'ak-progress__words' }, [
        s.label ? el('div', { class: 'ak-progress__kicker', 'data-ak-part': 'kicker', text: s.label }) : null,
        el('div', { class: 'ak-progress__line', role: 'status', 'aria-live': 'polite', 'aria-label': t('ofTotal', { value: s.value, total: s.total }) }, [
          figure,
          el('span', { class: 'ak-progress__total', 'data-ak-part': 'total', 'aria-hidden': 'true', text: ' / ' + s.total }),
        ]),
      ]),
      actions.firstChild ? actions : null,
    ]));
    root.appendChild(progressBar('ak-progress', { value: s.value, total: s.total, tone: 'accent' }));
    if (s.now || (s.steps && s.steps.length)) {
      root.appendChild(el('div', { class: 'ak-progress__now', 'data-ak-part': 'now' }, [
        el('div', { class: 'ak-progress__now-label', 'data-ak-part': 'nowLabel', text: t('now') }),
        s.now ? el('div', { class: 'ak-progress__now-text', 'data-ak-part': 'nowText', text: s.now }) : null,
        s.steps && s.steps.length ? el('div', { class: 'ak-progress__chips', 'data-ak-part': 'chips' }, s.steps.map(function (st) {
          const kind = st.state === 'done' || st.state === 'now' ? st.state : 'todo';
          return el('span', { class: 'ak-progress__chip ak-progress__chip--' + kind, 'data-ak-part': 'chip', 'aria-current': kind === 'now' ? 'step' : null, text: st.label });
        })) : null,
      ]));
    }
    if (s.counts && s.counts.length) {
      root.appendChild(el('div', { class: 'ak-progress__counts', 'data-ak-part': 'counts' }, s.counts.map(function (c) {
        const n = el('span', { class: 'ak-progress__count-n', text: String(c.value) });
        const before = shownCounts[c.id];
        if (before != null && before !== c.value) countUp(n, before, c.value);
        return el('div', { class: 'ak-progress__count ak-tone-soft--' + toneOf(c.tone), 'data-ak-part': 'count', 'data-ak-id': c.id }, [
          n, el('span', { class: 'ak-progress__count-label', text: c.label }),
        ]);
      })));
    }
    /** @type {Record<string, number>} */
    const next = {};
    (s.counts || []).forEach(function (c) { next[c.id] = c.value; });
    shownCounts = next;
    return figure;
  }

  render(null);
  if (s.target) resolve(s.target).appendChild(root);
  enter(root);

  return {
    el: root,
    /** @param {{ value?: number, total?: number, now?: string, steps?: any[], counts?: any[], label?: string }} patch */
    set(patch) {
      if (!patch) return;
      const from = shown;
      Object.assign(s, patch);
      const figure = render(from);
      const to = Number(s.value) || 0;
      if (to !== from) { countUp(figure, from, to); if (to > from) attention(figure, 'pulse'); }
      else figure.textContent = String(to);
      shown = to;
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * THE CALLOUT — a tinted note that says why: why a message is unclear, what went wrong, what to
 * do next. Warn and err are announced (role=alert on err, status otherwise).
 * @param {{ target?: string|Element, tone?: 'info'|'ok'|'warn'|'err', title?: string, text?: string, parts?: any, variant?: string }} spec
 * @returns {{ el: HTMLElement, set: (patch: { tone?: string, title?: string, text?: string }) => void, destroy: () => void }}
 */
export function callout(spec) {
  const s = Object.assign({ tone: 'info' }, spec);
  const root = el('div', { class: 'ak-root ak-callout', 'data-ak-part': 'root' });

  function render() {
    clear(root);
    const tone = ['info', 'ok', 'warn', 'err'].indexOf(s.tone) >= 0 ? s.tone : 'info';
    root.className = 'ak-root ak-callout ak-callout--' + tone;
    root.setAttribute('role', tone === 'err' ? 'alert' : 'status');
    const icon = { info: 'info', ok: 'ok', warn: 'todo', err: 'fail' }[tone];
    root.appendChild(el('span', { class: 'ak-callout__icon', 'data-ak-part': 'icon' }, stateIcon(/** @type {any} */ (icon))));
    root.appendChild(el('div', { class: 'ak-callout__words', 'data-ak-part': 'words' }, [
      s.title ? el('div', { class: 'ak-callout__title', 'data-ak-part': 'title', text: s.title }) : null,
      s.text ? el('div', { class: 'ak-callout__text', 'data-ak-part': 'text', text: s.text }) : null,
    ]));
    slotInto(root, s, 'after', null, { cls: 'ak-callout__after', tag: 'div' });
  }
  render();
  if (s.target) resolve(s.target).appendChild(root);

  return {
    el: root,
    /** @param {{ tone?: string, title?: string, text?: string }} patch */
    set(patch) { if (patch) { Object.assign(s, patch); render(); } },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
