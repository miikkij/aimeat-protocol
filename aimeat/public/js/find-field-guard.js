/**
 * @file find-field-guard.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Keeps the browser's own autofill out of every find field on the page.
 *
 *   A find field is an `<input type="search">` or an input marked `data-find` (a find field drawn
 *   as type="text" for its look: the App Catalog search, the menu find, the contact picker).
 *   A browser's built-in password manager (Chrome, Edge and Samsung Internet on Android, the
 *   Android autofill service) ignores autocomplete="off" and the password-manager attributes the
 *   fields carry, writes the saved sign-in name into the field, and fires an `input` event with
 *   `isTrusted` true. The list under the field then filters on the sign-in name and shows "No
 *   matches". typedByPerson (components/Field.js) refused only untrusted events, which is what an
 *   extension dispatches, so the browser's own fill passed it.
 *
 *   The one reliable mark of a browser fill is the `:autofill` state (`:-webkit-autofill` in older
 *   engines): the browser sets it on the field it filled and clears it when the value changes by
 *   any other means. This module listens on window in the capture phase, before any component's
 *   handler, and for a find field:
 *   - refuses an untrusted input event with text (an extension's fill) and an input event that
 *     arrives while the field is in the autofill state, and puts back the value the field had
 *     when it got the focus (empty when it never had it);
 *   - checks again on the next task, because an engine can set the autofill state after its
 *     input event has run (Firefox does); when the field is then autofilled, it puts the value
 *     back and dispatches one input event of its own, which fromGuard() names so that the
 *     component takes it.
 *   Emptying a field is always allowed: the native clear button of a type="search" field fires
 *   an input event of its own kind.
 *
 *   Imported for its side effect by spa.html's main module, before any view; a standalone page
 *   with a find field loads it with a module script tag. `pnpm check:find-fields` refuses a find
 *   field the guard cannot see.
 * @structure isFindField(el) · browserFilled(el) · refusedInput(e) · fromGuard(e) · (side effect)
 *   the focusin and input listeners on window
 * @usage import '/js/find-field-guard.js';  ·  import { refusedInput, fromGuard } from '/js/find-field-guard.js';
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial: Edge on Android wrote the owner's sign-in name into the App
 *     Catalog search with a trusted input event, past every earlier fix.
 */

/** The input events this module dispatched itself to put a field's value back. */
const ours = new WeakSet();
/** The value each find field held when it got the focus, or after the last input it accepted. */
const kept = new WeakMap();

/**
 * True for an `<input type="search">` and for an input marked `data-find`.
 * @param {EventTarget | null} el
 * @returns {el is HTMLInputElement}
 */
export function isFindField(el) {
  const input = /** @type {HTMLInputElement | null} */ (el);
  return !!input && input.tagName === 'INPUT' && (input.type === 'search' || input.hasAttribute('data-find'));
}

/** The autofill selectors this engine knows; matches() throws on one it does not. */
const AUTOFILL = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
  ? [':autofill', ':-webkit-autofill'].filter((sel) => CSS.supports(`selector(${sel})`))
  : [];

/** True while the browser shows the field as autofilled by itself. */
export function browserFilled(el) {
  return AUTOFILL.some((sel) => el.matches(sel));
}

/** True when this input event is one the guard put there itself; a component takes it. */
export function fromGuard(e) {
  return ours.has(e);
}

/**
 * True when a find field's input event did not come from the person: an extension dispatched it
 * (`isTrusted` false) or the browser filled the field itself (the autofill state). An emptied field
 * is never refused.
 */
export function refusedInput(e) {
  if (fromGuard(e)) return false;
  // The field itself: an input has no children, so the target is the field in every phase.
  const el = e.target;
  if (!el || el.value === '') return false;
  return !e.isTrusted || browserFilled(el);
}

/** Sets the field back to `before`; with `dispatch`, tells the component with an input event of its own. */
function putBack(el, before, dispatch) {
  el.value = before;
  kept.set(el, before);
  if (!dispatch) return;
  const ev = new Event('input', { bubbles: true });
  ours.add(ev);
  el.dispatchEvent(ev);
}

if (typeof window !== 'undefined') {
  window.addEventListener('focusin', (e) => {
    const el = e.target;
    if (isFindField(el)) kept.set(el, el.value);
  }, true);
  window.addEventListener('input', (e) => {
    const el = e.target;
    if (!isFindField(el) || fromGuard(e)) return;
    const before = kept.get(el) ?? '';
    if (refusedInput(e)) {
      // Stopped here, the event reaches no component, so what the component holds stays as it
      // was; the field's text is put back to match it.
      e.stopImmediatePropagation();
      putBack(el, before, false);
      return;
    }
    kept.set(el, el.value);
    if (el.value === '') return;
    const now = el.value;
    setTimeout(() => {
      if (el.isConnected && el.value === now && browserFilled(el)) putBack(el, before, true);
    }, 0);
  }, true);
}
