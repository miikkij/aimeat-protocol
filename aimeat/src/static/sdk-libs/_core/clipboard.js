/**
 * @file clipboard.js
 * @description Shared SDK-libs core: the one clipboard write a served browser library makes. The
 *   async clipboard API first; when it is missing or refused (an insecure origin, a frame without
 *   the permission, a browser that answers NotAllowedError), a hidden textarea off the screen and
 *   execCommand('copy'), so a visible selection is never painted over the page. Answers true or
 *   false and never throws, so a caller says what happened in words instead of catching.
 *   AIMEAT.agentface.copyText and the Atelier kit's copy() are this function.
 * @structure copyText(text)
 * @usage import { copyText } from '../_core/clipboard.js';  const ok = await copyText(prompt);
 * @version-history
 *   v1.0.0 — 2026-10-01 — Moved here from agentface/index.js (its v1.1.0 copyText), unchanged, so
 *     the Atelier kit shares it instead of keeping a second copy.
 */

/**
 * Copy text to the clipboard. Resolves to true when it is copied, false when neither way worked.
 * @param {unknown} text  anything; null and undefined copy as the empty string
 * @returns {Promise<boolean>}
 */
export async function copyText(text) {
  const value = String(text == null ? '' : text);
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch { /* fall through to the textarea fallback */ }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}
