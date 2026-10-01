/**
 * @file atelier/copy.js
 * @description The kit's one clipboard write. Twenty-two app files and two kit components wrote
 *   navigator.clipboard.writeText themselves, some with no fallback and no word when it failed.
 *   copy() is the platform's own implementation: AIMEAT.agentface.copyText when the page loads
 *   aimeat-agentface.js (a newer served copy wins), else the same code from _core/clipboard.js,
 *   bundled into the kit. Either way it answers true or false and never throws, so the caller says
 *   what happened. When it answers false, selectForHand() selects the text on the screen so the
 *   person copies it with the keyboard.
 * @structure copy(text) · selectForHand(node)
 * @usage
 *   const ok = await AIMEAT.atelier.copy(prompt);
 *   if (!ok) { selectForHand(previewNode); say('Press Ctrl+C'); }
 * @version-history
 *   v0.62.0 — 2026-10-01 — Initial: one copy helper for the kit and the apps.
 */
import { copyText } from '../_core/clipboard.js';

/**
 * Copy text to the clipboard. Resolves true when it is copied, false when the browser refused
 * every way; never rejects.
 * @param {unknown} text
 * @returns {Promise<boolean>}
 */
export function copy(text) {
  const af = typeof window !== 'undefined' && window.AIMEAT && window.AIMEAT.agentface;
  if (af && typeof af.copyText === 'function') {
    return Promise.resolve()
      .then(function () { return af.copyText(text); })
      .then(function (ok) { return !!ok; }, function () { return false; });
  }
  return copyText(text);
}

/**
 * Select the text of one node on the screen, for a person to copy with the keyboard after copy()
 * answered false. Answers whether a selection was made.
 * @param {Node|null|undefined} node
 * @returns {boolean}
 */
export function selectForHand(node) {
  if (!node || typeof document === 'undefined' || typeof window === 'undefined') return false;
  try {
    const sel = window.getSelection && window.getSelection();
    if (!sel || typeof document.createRange !== 'function' || typeof sel.addRange !== 'function') return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch {
    return false;
  }
}
