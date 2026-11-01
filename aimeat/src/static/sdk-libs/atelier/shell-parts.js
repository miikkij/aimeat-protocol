/**
 * @file atelier/shell-parts.js
 * @description The shell's parts an app or a mosaic also uses on their own: section (the titled
 *   surface and escape hatch), tabs and the bottom navigation bar. They stand apart from app() so
 *   that the mosaic and the dialog family, which draw them, do not import the shell, and the shell
 *   can open a dialog (the phone's Menu sheet) without a cycle. shell.js exports them too.
 * @structure section(spec) · tabs(spec) · bottomNav(spec)
 * @parts section root · head · words · title · hint · actions · before · body · after
 * @slots section actions() · before() · after()
 * @variants section dense · plain · quiet
 * @tokens section --ak-section-pad · --ak-section-gap
 * @fork section It IS the escape hatch: put your own markup in its body and keep the frame.
 * @parts tabs root · tab
 * @slots tabs tab(item)
 * @variants tabs dense · pill
 * @tokens tabs --ak-tabs-gap
 * @fork tabs A row of buttons; copy .ak-tabs* out of shell.css and you give up the view transition.
 * @parts bottomNav root · item
 * @slots bottomNav item(entry)
 * @variants bottomNav dense
 * @tokens bottomNav --ak-chrome-bottom
 * @fork bottomNav Copy .ak-bottomnav* out of shell.css; the chrome reserve is the shell's.
 * @version-history
 *   v0.68.1 — 2026-11-02 — Moved out of shell.js unchanged, except that a bottom-bar entry with
 *     `action: true` runs its pick without moving the mark or the view.
 */

import { el, append, clear, resolve, enter } from './dom.js';
import { viewSwap } from './arrive.js';
import { partEl, slotInto, applyVariant, hasPart, partValue } from './parts-model.js';
import { ink } from './ink.js';
import { keepInView } from './scroll-edge.js';

/** A navigation entry's own words, or whatever the app declared for that part — a string, a
 *  node, or an array of both. The kit's label is the default, never the ceiling. */
function tabLabel(spec, name, item) {
  const given = partValue(spec, name, item);
  return given === undefined ? item.label : given;
}

/**
 * A titled surface — and the ESCAPE HATCH: whatever the catalogue cannot express goes inside a
 * section as the app's own markup, so custom work stays inside a frame that still carries the
 * card surface, the measure cap and the entrance.
 * @param {{ target?: string|Element, title?: string, hint?: string, body?: any, flush?: boolean }} spec
 * @returns {{ el: HTMLElement, body: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function section(spec) {
  const s = spec || {};
  const heading = s.title != null ? el('h2', { class: 'ak-section__title', 'data-ak-part': 'title', text: s.title }) : null;
  const hint = s.hint != null ? el('p', { class: 'ak-section__hint', 'data-ak-part': 'hint', text: s.hint }) : null;
  const body = el('div', { class: 'ak-section__body', 'data-ak-part': 'body' });
  if (s.body != null) append(body, s.body);
  const root = el('section', {
    class: 'ak-root ak-section' + (s.flush ? ' ak-section--flush' : ''),
    'data-ak-part': 'root',
  });
  applyVariant(root, s, ['dense', 'plain', 'quiet']);
  // THE HEAD IS A ROW ONLY WHEN THE APP GAVE IT A RIGHT-HAND SIDE. A section nobody customised
  // keeps exactly the markup and the 8px column it had; declare `parts.actions` and the words
  // move into a head that puts them beside the count, the filter or the one control that
  // belongs to this block rather than to the page.
  if (hasPart(s, 'actions')) {
    const head = partEl('div', 'ak-section__head', 'head');
    const words = el('div', { class: 'ak-section__words', 'data-ak-part': 'words' });
    if (heading) words.appendChild(heading);
    if (hint) words.appendChild(hint);
    head.appendChild(words);
    slotInto(head, s, 'actions', null, { cls: 'ak-section__actions', tag: 'div' });
    root.appendChild(head);
  } else {
    if (heading) root.appendChild(heading);
    if (hint) root.appendChild(hint);
  }
  slotInto(root, s, 'before', null, { cls: 'ak-section__before', tag: 'div' });
  root.appendChild(body);
  slotInto(root, s, 'after', null, { cls: 'ak-section__after', tag: 'div' });
  if (s.target) resolve(s.target).appendChild(root);
  enter(body);
  return {
    el: root,
    body: body,
    /** @param {{ title?: string, hint?: string, body?: any }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.title != null && heading) heading.textContent = patch.title;
      if (patch.hint != null && hint) hint.textContent = patch.hint;
      if (patch.body !== undefined) { clear(body); append(body, patch.body); }
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * A tab row. Reports the pick; the host swaps the view — inside the kit's screen transition, so
 * the swap is SEEN as a change without the host asking for it. `transition` names another move
 * (slide, wipe, zoom, iris, curtain); the app's `motion: false` and reduced motion collapse it.
 * A row wider than its box scrolls sideways by itself so the chosen tab is fully in view.
 * @param {{
 *   target?: string|Element, items: Array<{ id: string, label: string }>,
 *   value?: string, onChange?: (id: string) => void,
 *   transition?: 'fade'|'wipe'|'curtain'|'zoom'|'iris'|'slide',
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { value?: string, items?: any[] }) => void, destroy: () => void }}
 */
export function tabs(spec) {
  const state = { items: spec.items || [], value: spec.value || (spec.items && spec.items[0] ? spec.items[0].id : '') };
  const root = el('div', { class: 'ak-root ak-tabs', role: 'tablist', 'data-ak-part': 'root' });
  applyVariant(root, spec, ['dense', 'pill']);
  if (spec.target) resolve(spec.target).appendChild(root);
  // The chosen tab's fill is the ink, one marker that travels to the next pick (ink.js).
  const mark = ink(root, { active: '.ak-tab--active' });
  // The strip scrolls itself (never the page) so the chosen tab is fully in view.
  const follow = keepInView(root, '.ak-tab--active');

  /** @param {boolean} [moved]  a change of choice, which may scroll smoothly; the first draw never does */
  function render(moved) {
    clear(root);
    for (const item of state.items) {
      const active = item.id === state.value;
      root.appendChild(el('button', {
        type: 'button',
        class: 'ak-tab' + (active ? ' ak-tab--active' : ''),
        role: 'tab',
        'data-ak-part': 'tab',
        'data-ak-id': item.id,
        'aria-selected': active ? 'true' : 'false',
        'data-ak-noguard': true,
        on: {
          click: function () {
            if (item.id === state.value) return;
            // A TAB CHANGE IS A SCREEN CHANGE, and the kit makes it look like one without being
            // asked. The host's onChange is what swaps the view, so it runs INSIDE the
            // transition: the browser crosses the old screen into the new one where it has View
            // Transitions, the kit's curtain does it where it does not, and under reduced motion
            // or an opt-out it is the plain swap it always was.
            const release = mark.pin();
            viewSwap(function () {
              state.value = item.id;
              render(true);
              if (spec.onChange) spec.onChange(item.id);
            }, { kind: spec.transition, node: root }).then(release, release);
          },
        },
      }, tabLabel(spec, 'tab', item)));
    }
    mark.sync();
    follow.request(moved);
  }
  render();

  return {
    el: root,
    /** @param {{ value?: string, items?: Array<{ id: string, label: string }> }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.items) state.items = patch.items;
      if (patch.value != null) state.value = patch.value;
      render(true);
    },
    destroy() { follow.destroy(); mark.destroy(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * The bottom navigation bar — fixed above the node's chrome strip (the stylesheet reserves
 * var(--aimeat-chrome-bottom), so it never sits under the injected controls). A pick runs inside
 * the kit's screen transition, the same as a tab.
 * @param {{
 *   target?: string|Element, items: Array<{ id: string, label: string, action?: boolean, onPick?: (item: any) => void }>,
 *   value?: string, transition?: 'fade'|'wipe'|'curtain'|'zoom'|'iris'|'slide',
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { value?: string, items?: any[] }) => void, destroy: () => void }}
 */
export function bottomNav(spec) {
  const state = { items: spec.items || [], value: spec.value || '' };
  const root = el('nav', { class: 'ak-root ak-bottomnav', 'data-ak-part': 'root' });
  applyVariant(root, spec, ['dense']);
  if (spec.target) resolve(spec.target).appendChild(root);

  function render() {
    clear(root);
    for (const item of state.items) {
      const active = item.id === state.value;
      root.appendChild(el('button', {
        type: 'button',
        class: 'ak-bottomnav__item' + (active ? ' ak-bottomnav__item--active' : ''),
        'aria-current': active ? 'page' : null,
        'data-ak-part': 'item',
        'data-ak-id': item.id,
        'data-ak-noguard': true,
        on: {
          click: function () {
            // An action entry (the side navigation's Menu) opens something over the page and
            // leaves the page, and the mark, where they are.
            if (item.action || item.id === state.value) { if (item.onPick) item.onPick(item); return; }
            // The bottom bar changes the screen exactly as the tabs do, and gets the same move.
            viewSwap(function () {
              state.value = item.id;
              render();
              if (item.onPick) item.onPick(item);
            }, { kind: spec.transition, node: root });
          },
        },
      }, tabLabel(spec, 'item', item)));
    }
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
