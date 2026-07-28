/**
 * @file game/menu.js
 * @description The full-screen menu — the shell an app opens on. Entries carry a label, an
 *   optional sublabel, a state (`available` / `locked` / `done`), an optional badge and, when
 *   locked, a reason the viewer can read instead of guessing.
 *
 *   A LOCKED ENTRY IS NOT A DEAD BUTTON. It stays readable, says why it is locked, and still
 *   reports the pick so the host can point the player at what unlocks it. That difference is the
 *   whole reason this is a component rather than a list of divs.
 *
 *   NESTING replaces the list in place and leaves a back affordance (↩ and Escape), rather than
 *   stacking overlays — which is what keeps it correct at 1280x460 and on a phone.
 *
 *   KEYBOARD: Up/Down/Home/End move, Enter/Space pick, Escape goes back one level and closes at
 *   the root. Focus follows navigation but never moves on a `set()`, so a live update cannot
 *   snatch the keyboard out of the player's hands.
 * @structure menu(spec) → handle { el, set, open, close, path, destroy }
 * @usage  const m = AIMEAT.game.menu({ title: 'Chapters', entries, onPick(e) {…} });
 *         m.set({ entries: next });   // updates in place, keeps position and focus
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 01).
 */
import { el, clear, resolve, uid } from './dom.js';
import { t, i18n } from './i18n.js';

/**
 * @typedef {object} MenuEntry
 * @property {string} id
 * @property {string} label
 * @property {string} [sublabel]
 * @property {'available'|'locked'|'done'} [state]
 * @property {string} [badge]        Short marker shown on the right (a count, a level, a tag).
 * @property {string} [lockReason]   Shown under a locked entry — say what unlocks it.
 * @property {MenuEntry[]} [entries] Nested submenu.
 */

/**
 * A full-screen menu.
 * @param {{
 *   target?: string|Element, full?: boolean, head?: boolean, title: string, subtitle?: string, entries: MenuEntry[],
 *   onPick?: (entry: MenuEntry, path: string[]) => void,
 *   onClose?: () => void, closeLabel?: string, open?: boolean
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: any) => void, open: () => void, close: () => void,
 *   path: () => string[], destroy: () => void }}
 */
export function menu(spec) {
  const state = {
    title: spec.title,
    subtitle: spec.subtitle,
    entries: spec.entries || [],
    /** @type {MenuEntry[]} the chain of opened submenus */
    trail: [],
  };
  const titleId = uid('ag-menu-title');

  const heading = el('h2', { class: 'ag-title', id: titleId });
  const sub = el('p', { class: 'ag-menu__sub' });
  const crumb = el('div', { class: 'ag-menu__crumb' });
  const titles = el('div', { class: 'ag-menu__titles' }, [crumb, heading, sub]);
  const closeBtn = el('button', {
    type: 'button', class: 'ag-btn ag-btn--ghost',
    on: { click: function () { api.close(); } },
  }, spec.closeLabel || t('close'));
  // `head: false` drops the title strip, for a host that already draws its own (a hub screen
  // with a logo above the entries). The entries, the keyboard and the nesting are unchanged.
  const head = spec.head === false ? null : el('div', { class: 'ag-menu__head' }, [titles, closeBtn]);
  const list = el('div', {
    class: 'ag-menu__list ag-scroll', role: 'menu', 'aria-labelledby': titleId,
    on: { keydown: onKey },
  });
  // Full-screen by default; `full: false` fills the container it is mounted into instead, which is
  // what a menu living inside a panel (or a documentation page) needs.
  const full = spec.full !== false;
  const root = el('div', {
    class: 'ag-root ag-menu' + (full ? '' : ' ag-menu--inline') + (head ? '' : ' ag-menu--nohead'),
    role: full ? 'dialog' : 'group',
    'aria-modal': full ? 'true' : null,
    'aria-labelledby': titleId,
  }, head ? [head, list] : [list]);

  const host = resolve(spec.target, document.body);
  host.appendChild(root);

  const stopLang = i18n.onChange(function () { render(false); });

  /** The entries at the current depth. @returns {MenuEntry[]} */
  function level() {
    const last = state.trail[state.trail.length - 1];
    return last ? (last.entries || []) : state.entries;
  }

  /** @returns {string[]} the ids of the opened submenus, outermost first */
  function pathIds() {
    return state.trail.map(function (e) { return e.id; });
  }

  /** @param {boolean} moveFocus */
  function render(moveFocus) {
    const depth = state.trail.length;
    const here = state.trail[depth - 1];
    heading.textContent = here ? here.label : state.title;
    const subText = here ? (here.sublabel || '') : (state.subtitle || '');
    sub.textContent = subText;
    sub.hidden = !subText;

    clear(crumb);
    if (depth) {
      crumb.appendChild(el('button', {
        type: 'button', class: 'ag-btn ag-btn--ghost',
        on: { click: back },
      }, '↩ ' + t('back')));
      crumb.appendChild(el('span', { class: 'ag-label', text: state.title }));
    }

    clear(list);
    // With no head there is no crumb to go back from, so the way out becomes the first entry.
    // Escape works either way, but a pointer user must never be stranded in a submenu.
    if (!head && depth) {
      list.appendChild(el('button', {
        type: 'button', class: 'ag-menu__item ag-menu__item--back', role: 'menuitem',
        on: { click: back },
      }, el('span', {}, el('span', { class: 'ag-menu__label', text: '↩ ' + t('back') }))));
    }

    const entries = level();
    if (!entries.length) {
      list.appendChild(el('p', { class: 'ag-empty', text: t('empty') }));
      return;
    }
    for (const entry of entries) list.appendChild(item(entry));
    if (moveFocus) {
      const first = /** @type {HTMLElement|null} */ (list.querySelector('.ag-menu__item'));
      if (first) first.focus();
    }
  }

  /**
   * @param {MenuEntry} entry
   * @returns {HTMLElement}
   */
  function item(entry) {
    const st = entry.state || 'available';
    const locked = st === 'locked';
    const nested = !!(entry.entries && entry.entries.length);
    const marks = el('div', { class: 'ag-menu__marks' });
    if (entry.badge) marks.appendChild(el('span', { class: 'ag-chip ag-chip--accent', text: entry.badge }));
    if (st === 'done') marks.appendChild(el('span', { class: 'ag-chip ag-chip--ok', text: '✓ ' + t('done') }));
    if (locked) marks.appendChild(el('span', { class: 'ag-chip', text: t('locked') }));
    if (nested && !locked) marks.appendChild(el('span', { class: 'ag-menu__arrow', text: '→', 'aria-hidden': 'true' }));

    const body = el('span', {}, [
      el('span', { class: 'ag-menu__label', text: entry.label }),
      entry.sublabel ? el('span', { class: 'ag-menu__sublabel', text: entry.sublabel }) : null,
      locked && entry.lockReason ? el('span', { class: 'ag-menu__reason', text: entry.lockReason }) : null,
    ]);

    return el('button', {
      type: 'button',
      class: 'ag-menu__item' + (locked ? ' ag-menu__item--locked' : '') + (st === 'done' ? ' ag-menu__item--done' : ''),
      role: 'menuitem',
      'data-ag-id': entry.id,
      'aria-disabled': locked ? 'true' : null,
      on: { click: function () { pick(entry); } },
    }, [body, marks]);
  }

  /** @param {MenuEntry} entry */
  function pick(entry) {
    const path = pathIds();
    if (spec.onPick) spec.onPick(entry, path);
    if ((entry.state || 'available') === 'locked') return;
    if (entry.entries && entry.entries.length) {
      state.trail.push(entry);
      render(true);
    }
  }

  function back() {
    if (!state.trail.length) return api.close();
    state.trail.pop();
    render(true);
  }

  /** @param {KeyboardEvent} ev */
  function onKey(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); back(); return; }
    const items = /** @type {HTMLElement[]} */ (Array.prototype.slice.call(list.querySelectorAll('.ag-menu__item')));
    if (!items.length) return;
    const at = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    let next = -1;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') next = at < 0 ? 0 : (at + 1) % items.length;
    else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = items.length - 1;
    if (next < 0) return;
    ev.preventDefault();
    items[next].focus();
  }

  const api = {
    el: root,

    /**
     * Update in place. Position and focus are kept — a live update never moves the player.
     * @param {{ title?: string, subtitle?: string, entries?: MenuEntry[] }} patch
     */
    set(patch) {
      if (!patch) return;
      if (patch.title != null) state.title = patch.title;
      if (patch.subtitle != null) state.subtitle = patch.subtitle;
      if (patch.entries) {
        state.entries = patch.entries;
        // Re-resolve the open trail against the new data so a submenu survives its own update.
        const ids = pathIds();
        state.trail = [];
        let scope = state.entries;
        for (const id of ids) {
          const found = scope.find(function (e) { return e.id === id; });
          if (!found || !found.entries) break;
          state.trail.push(found);
          scope = found.entries;
        }
      }
      render(false);
    },

    open() {
      root.hidden = false;
      render(true);
    },

    close() {
      root.hidden = true;
      if (spec.onClose) spec.onClose();
    },

    path() { return pathIds(); },

    destroy() {
      stopLang();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };

  root.hidden = spec.open === false;
  // A full-screen menu takes focus on arrival, because it IS the screen. An inline one does not:
  // stealing focus into a panel would scroll the host page out from under the reader.
  render(full && spec.open !== false);
  return api;
}
