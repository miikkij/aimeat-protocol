/**
 * @file atelier/mosaic-layout.js
 * @description The mosaic's identity-and-layout helpers, extracted whole from mosaic.js (pure
 *   extraction under the 800-line rule — the lines are mosaic's own, unchanged): `appRef` reads
 *   the app's own identity from the `#aimeat-app-ref` block the node injects, `loadLayout` is
 *   THE ONE FETCH the kit makes (the app's stored layout, sessionless, as public as the app),
 *   and `labelOf` names a block for tabs, decks and tiles.
 * @structure appRef() · loadLayout(owner, filename) · labelOf(block)
 * @usage  import { appRef, loadLayout, labelOf } from './mosaic-layout.js';
 * @version-history
 *   v0.33.0 — 2026-08-29 — Extracted from mosaic.js when the ops/atlas/console cases pushed it
 *     past the 800-line rule. No behaviour change.
 */
import { APEX_URL } from '../_core/config.js';

/**
 * The app's own identity, from the `#aimeat-app-ref` block the node injects into every served
 * app. Null when absent (a raw file open, a test page) — the mosaic then renders the fallback.
 * @returns {{ owner: string, filename: string }|null}
 */
export function appRef() {
  try {
    const node = document.getElementById('aimeat-app-ref');
    if (!node) return null;
    // The node HTML-escapes the block on injection (a JSON value could otherwise carry a
    // </script> breakout), and script content is raw text, so the entities arrive literal.
    const text = (node.textContent || '')
      .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const parsed = JSON.parse(text);
    return parsed && parsed.owner && parsed.app_id
      ? { owner: String(parsed.owner), filename: String(parsed.app_id) }
      : null;
  } catch {
    return null;
  }
}

/**
 * The one fetch: this app's stored layout, sessionless. Resolves to the layout object or null
 * (none stored, or the read failed — the caller falls back either way).
 * @param {string} owner @param {string} filename
 * @returns {Promise<object|null>}
 */
export async function loadLayout(owner, filename) {
  try {
    const base = APEX_URL || '';
    const res = await fetch(base + '/v1/apps/' + encodeURIComponent(owner)
      + '/' + encodeURIComponent(filename) + '/ui');
    if (!res.ok) return null;
    const body = await res.json();
    return (body && body.data && body.data.layout) || null;
  } catch {
    return null;
  }
}

/** The unit's tab/step/tile label: its own words first, the component name as the visible
 *  floor that nudges the layout author to give the block a `title`. */
export function labelOf(block) {
  const p = block.props || {};
  return p.title || p.caption || block.component;
}
