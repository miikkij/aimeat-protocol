/**
 * @file atelier/disclose.js
 * @description THE THINGS THAT OPEN — the fan and the sliding menu.
 *
 *   REVEAL (the fan): stacked panels that open and close, one at a time or many at once. The
 *   height is ANIMATED from its measured value to auto and back, which is the part every app
 *   gets wrong by hand (a CSS max-height guess either clips long content or makes short content
 *   crawl). The header is a real button carrying aria-expanded and aria-controls, so the whole
 *   accessibility story is the component's, not the app's.
 *
 *   DRAWER (the sliding menu): a panel that arrives from an edge over a scrim, on the native
 *   <dialog> top layer — so the focus trap, the Escape key and the focus RETURN are the
 *   browser's own, exactly as in the dialog department, and a drawer can never end up under
 *   something else on the page.
 *
 *   BOTH COLLAPSE UNDER REDUCED MOTION into an instant open. The panel still opens; only the
 *   travel disappears.
 * @structure reveal(spec) → { el, set, open, close, destroy } · drawer(spec) → { el, open, close, destroy }
 * @usage
 *   AIMEAT.atelier.reveal({ target: host, mode: 'one', items: [
 *     { id: 'a', title: 'What is a morsel?', text: 'A pacer, never a currency.' } ] });
 *   const menu = AIMEAT.atelier.drawer({ side: 'left', title: 'Menu',
 *     items: [{ id: 'home', label: 'Home' }], onPick: go });
 * @version-history
 *   v0.25.0 — 2026-08-29 — Initial (TARGET-074: the fan and the sliding menu).
 */
import { el, clear, resolve, uid, enter, reducedMotion } from './dom.js';
import { t } from './i18n.js';

/**
 * @typedef {object} RevealItem
 * @property {string} id
 * @property {string} title
 * @property {string} [sub]
 * @property {string} [text]
 * @property {(host: HTMLElement) => void} [body]
 */

/** Animate one panel between its measured height and auto — the part hand-rolling gets wrong. */
function slideOpen(panel, opening, span, ease) {
  if (reducedMotion() || typeof panel.animate !== 'function') {
    panel.style.height = opening ? 'auto' : '0px';
    return;
  }
  const from = panel.getBoundingClientRect().height;
  panel.style.height = 'auto';
  const to = opening ? panel.getBoundingClientRect().height : 0;
  panel.style.height = from + 'px';
  const anim = panel.animate(
    [{ height: from + 'px', opacity: opening ? 0.4 : 1 }, { height: to + 'px', opacity: opening ? 1 : 0.4 }],
    { duration: span, easing: ease },
  );
  const settle = function () { panel.style.height = opening ? 'auto' : '0px'; };
  anim.onfinish = settle;
  anim.oncancel = settle;
}

/**
 * The fan.
 * @param {{
 *   target?: string|Element, items: RevealItem[], mode?: 'one'|'many', open?: string[],
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { items: RevealItem[] }) => void,
 *   open: (id: string) => void, close: (id: string) => void, destroy: () => void }}
 */
export function reveal(spec) {
  const root = el('div', { class: 'ak-root ak-reveal' });
  if (spec.target) resolve(spec.target).appendChild(root);
  const single = spec.mode !== 'many';
  /** @type {Map<string, { head: HTMLElement, panel: HTMLElement }>} */
  const panes = new Map();

  function motion() {
    const cs = getComputedStyle(root);
    return {
      span: parseFloat(cs.getPropertyValue('--ak-motion')) || 200,
      ease: (cs.getPropertyValue('--ak-ease') || '').trim() || 'cubic-bezier(0.2, 0.7, 0.3, 1)',
    };
  }

  /** @param {string} id @param {boolean} want */
  function setOpen(id, want) {
    const pane = panes.get(id);
    if (!pane) return;
    const isOpen = pane.head.getAttribute('aria-expanded') === 'true';
    if (isOpen === want) return;
    const { span, ease } = motion();
    if (want && single) {
      for (const [otherId, other] of panes) {
        if (otherId !== id && other.head.getAttribute('aria-expanded') === 'true') {
          other.head.setAttribute('aria-expanded', 'false');
          slideOpen(other.panel, false, span, ease);
        }
      }
    }
    pane.head.setAttribute('aria-expanded', String(want));
    slideOpen(pane.panel, want, span, ease);
  }

  /** @param {RevealItem[]} items */
  function render(items) {
    clear(root);
    panes.clear();
    const openIds = spec.open || [];
    for (const item of items) {
      const panelId = 'ak-rv-' + uid();
      const headId = panelId + '-h';
      const startOpen = openIds.indexOf(item.id) >= 0;
      const head = el('button', {
        type: 'button', class: 'ak-reveal__head', id: headId,
        'aria-expanded': String(startOpen), 'aria-controls': panelId,
        on: {
          click: function () {
            setOpen(item.id, head.getAttribute('aria-expanded') !== 'true');
          },
        },
      }, [
        el('span', { class: 'ak-reveal__titles' }, [
          el('span', { class: 'ak-reveal__title', text: item.title }),
          item.sub != null ? el('span', { class: 'ak-reveal__sub', text: item.sub }) : null,
        ]),
        el('span', { class: 'ak-reveal__chevron', 'aria-hidden': 'true' }, '⌄'),
      ]);
      const panel = el('div', {
        class: 'ak-reveal__panel', id: panelId, role: 'region', 'aria-labelledby': headId,
      });
      const inner = el('div', { class: 'ak-reveal__inner' });
      if (item.text) inner.appendChild(el('p', { class: 'ak-reveal__text', text: item.text }));
      if (item.body) item.body(inner);
      panel.appendChild(inner);
      panel.style.height = startOpen ? 'auto' : '0px';
      root.appendChild(el('div', { class: 'ak-reveal__pane' }, [head, panel]));
      panes.set(item.id, { head: head, panel: panel });
    }
    enter(root);
  }

  render(spec.items || []);

  return {
    el: root,
    set(patch) { if (patch && patch.items) render(patch.items); },
    open(id) { setOpen(id, true); },
    close(id) { setOpen(id, false); },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * The sliding menu. Rides the native <dialog> top layer, so focus, Escape and the focus return
 * are the browser's; the kit owns the slide, the scrim and the look.
 * @param {{
 *   side?: 'left'|'right'|'bottom', title?: string,
 *   items?: Array<{ id: string, label: string, sub?: string, current?: boolean }>,
 *   body?: (host: HTMLElement) => void,
 *   onPick?: (id: string) => void, onClose?: () => void,
 * }} spec
 * @returns {{ el: HTMLDialogElement, open: () => void, close: () => void, destroy: () => void }}
 */
export function drawer(spec) {
  const side = spec.side === 'right' ? 'right' : spec.side === 'bottom' ? 'bottom' : 'left';
  const node = /** @type {HTMLDialogElement} */ (el('dialog', {
    class: 'ak-root ak-drawer ak-drawer--' + side,
    'aria-label': spec.title || t('menu'),
  }));
  const panel = el('div', { class: 'ak-drawer__panel' });

  const head = el('div', { class: 'ak-drawer__head' }, [
    el('span', { class: 'ak-drawer__title', text: spec.title || t('menu') }),
    el('button', {
      type: 'button', class: 'ak-btn ak-btn--ghost ak-drawer__x',
      'aria-label': t('close'), on: { click: function () { close(); } },
    }, '✕'),
  ]);
  panel.appendChild(head);

  const list = el('nav', { class: 'ak-drawer__list' });
  for (const item of spec.items || []) {
    list.appendChild(el('button', {
      type: 'button', class: 'ak-drawer__item',
      ...(item.current ? { 'aria-current': 'page' } : {}),
      on: {
        click: function () {
          if (spec.onPick) spec.onPick(item.id);
          close();
        },
      },
    }, [
      el('span', { class: 'ak-drawer__label', text: item.label }),
      item.sub != null ? el('span', { class: 'ak-drawer__sub', text: item.sub }) : null,
    ]));
  }
  if ((spec.items || []).length) panel.appendChild(list);
  if (spec.body) {
    const host = el('div', { class: 'ak-drawer__body' });
    spec.body(host);
    panel.appendChild(host);
  }

  node.appendChild(panel);
  document.body.appendChild(node);

  const travel = side === 'bottom' ? '0, 100%' : side === 'right' ? '100%, 0' : '-100%, 0';

  function motion() {
    const cs = getComputedStyle(node);
    return {
      span: parseFloat(cs.getPropertyValue('--ak-motion')) || 200,
      ease: (cs.getPropertyValue('--ak-ease') || '').trim() || 'cubic-bezier(0.2, 0.7, 0.3, 1)',
    };
  }

  function open() {
    if (node.open) return;
    node.showModal();
    if (reducedMotion() || typeof panel.animate !== 'function') return;
    const { span, ease } = motion();
    panel.animate(
      [{ transform: 'translate(' + travel + ')' }, { transform: 'none' }],
      { duration: span * 1.4, easing: ease },
    );
  }

  function close() {
    if (!node.open) return;
    const done = function () {
      if (node.open) node.close();
      if (spec.onClose) spec.onClose();
    };
    if (reducedMotion() || typeof panel.animate !== 'function') return done();
    const { span, ease } = motion();
    const anim = panel.animate(
      [{ transform: 'none' }, { transform: 'translate(' + travel + ')' }],
      { duration: span, easing: ease },
    );
    anim.onfinish = done;
    anim.oncancel = done;
  }

  node.addEventListener('cancel', function (ev) { ev.preventDefault(); close(); });
  node.addEventListener('click', function (ev) { if (ev.target === node) close(); });

  return {
    el: node,
    open: open,
    close: close,
    destroy() {
      if (node.open) node.close();
      if (node.parentNode) node.parentNode.removeChild(node);
    },
  };
}
