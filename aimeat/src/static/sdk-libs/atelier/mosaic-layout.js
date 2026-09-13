/**
 * @file atelier/mosaic-layout.js
 * @description The mosaic's identity-and-layout helpers, extracted whole from mosaic.js (pure
 *   extraction under the 800-line rule — the lines are mosaic's own, unchanged): `appRef` reads
 *   the app's own identity from the `#aimeat-app-ref` block the node injects, `loadLayout` is
 *   THE ONE FETCH the kit makes (the app's stored layout, sessionless, as public as the app),
 *   `labelOf` names a block for tabs, decks and tiles, and `applyViewerOverlay` lays one viewer's
 *   own hide, order and navigation choices over the owner's layout.
 * @structure appRef() · loadLayout(owner, filename) · labelOf(block) · applyViewerOverlay(layout, o)
 * @usage  import { appRef, loadLayout, labelOf, applyViewerOverlay } from './mosaic-layout.js';
 * @version-history
 *   v0.53.2 — 2026-09-13 — appRef() parses the block as served, because the node now writes it into
 *     the head as plain JSON (unicode escapes instead of HTML entities), and decodes entities only
 *     for a page served before that. applyViewerOverlay moved here whole from mosaic.js under the
 *     800-line rule, unchanged.
 *   v0.33.0 — 2026-08-29 — Extracted from mosaic.js when the ops/atlas/console cases pushed it
 *     past the 800-line rule. No behaviour change.
 */
import { APEX_URL } from '../_core/config.js';

/**
 * The app's own identity, from the `#aimeat-app-ref` block the node injects into the head of every
 * served app, so it is readable from the app's first line of script. Null when absent (a raw file
 * open, a test page), and the mosaic then renders the fallback.
 * @returns {{ owner: string, filename: string }|null}
 */
export function appRef() {
  try {
    const node = document.getElementById('aimeat-app-ref');
    if (!node) return null;
    const raw = node.textContent || '';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A page served before 2026-09-13 carries the block HTML-escaped, and script content is raw
      // text, so the entities arrive literal and have to be decoded by hand.
      parsed = JSON.parse(raw
        .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    }
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

/**
 * Apply one viewer's overlay to a layout copy: `hidden` drops blocks, `order` re-sorts the
 * rest (ids it does not name keep their place at the end), `nav` re-projects. Props are
 * deliberately untouchable — an overlay arranges, it never rewrites content.
 * @param {any} layout @param {{ hidden?: string[], order?: string[], nav?: string }|null} o
 */
export function applyViewerOverlay(layout, o) {
  if (!o) return layout;
  const out = {
    v: layout.v, look: layout.look, nav: o.nav || layout.nav, choreography: layout.choreography,
    tokens: layout.tokens, ambient: layout.ambient, meta: layout.meta, blocks: layout.blocks.slice(),
  };
  if (Array.isArray(o.hidden) && o.hidden.length) {
    out.blocks = out.blocks.filter(function (b) { return o.hidden.indexOf(b.id) < 0; });
  }
  if (Array.isArray(o.order) && o.order.length) {
    out.blocks.sort(function (a, b) {
      const ia = o.order.indexOf(a.id); const ib = o.order.indexOf(b.id);
      return (ia < 0 ? o.order.length : ia) - (ib < 0 ? o.order.length : ib);
    });
  }
  return out;
}
