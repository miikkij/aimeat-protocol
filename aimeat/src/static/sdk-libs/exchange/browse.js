/**
 * @file exchange/browse.js
 * @description The BROWSE half of AIMEAT.exchange — reading the market. Every call here maps to a
 *   route the node publishes without authentication, so an app can render the catalogue, one
 *   listing's full decision context, and its ODPS v4.1 descriptor to a signed-out visitor. The
 *   session is sent when there is one (see client.js `maybe`) purely so a seller's own projections
 *   are fresh; it changes what is CURRENT, never what is VISIBLE.
 * @structure info() · list(filter) · search(q, filter) · get(id) · odps(id) · odpsYaml(id)
 * @usage const { offerings } = await AIMEAT.exchange.list({ q: 'company', stats: true });
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 02 — the EXCHANGE browser library, gap G19).
 */
import { pub, pubText, maybe, qs } from './client.js';

const enc = encodeURIComponent;

/**
 * The marketplace's public economics: `{ rake_percent, rake_note, units, morsel_note }` — what the
 * platform takes on each metered call, set by the node operator. Show it BEFORE a seller prices
 * something, so the split is stated rather than discovered on the first sale.
 * @returns {Promise<any>}
 */
export function info() {
  return pub('/v1/exchange/info', 'Failed to read the EXCHANGE economics');
}

/**
 * Browse listed offerings. Every supplied filter NARROWS, independently.
 * @param {{ ext?: string, action?: string, q?: string, stats?: boolean }} [filter]
 *   `q` free-text over title/description/coordinate/tags; `stats: true` folds each listing's usage
 *   (contracts, calls, consumers, settled units, observed p50/p95) into the row.
 * @returns {Promise<{ offerings: any[], count: number }>}
 */
export function list(filter) {
  const f = filter || {};
  const query = qs({ ext: f.ext, action: f.action, q: f.q, stats: f.stats ? '1' : null });
  return maybe('/v1/exchange/offerings' + query, 'Failed to browse the marketplace');
}

/**
 * Free-text search — the same route as {@link list}, named for what an app's search box does.
 * @param {string} q
 * @param {{ ext?: string, action?: string, stats?: boolean }} [filter]
 * @returns {Promise<{ offerings: any[], count: number }>}
 */
export function search(q, filter) {
  return list({ ...(filter || {}), q });
}

/**
 * One offering in FULL: `{ offering, capability, call_recipe, stats, pacing, odps }` — the I/O
 * schema, how to call it (the contract IS the access; no API key is issued), what it costs per call
 * in morsels burned for pacing on top of the price, the observed usage, and a pointer to the ODPS
 * document. One call, so an app need not stitch four.
 * @param {string} id  Offering id (`off-…`).
 * @returns {Promise<any>}
 */
export function get(id) {
  return pub('/v1/exchange/offerings/' + enc(id), 'No such offering');
}

/**
 * The offering as an Open Data Product Specification v4.1 document (JSON) — the interoperable
 * descriptor an outside catalogue or a negotiating agent reads without knowing anything about
 * AIMEAT. Derived on read, so it cannot drift from the listing it describes.
 * @param {string} id
 * @returns {Promise<{ odps_version: string, odps: any }>}
 */
export function odps(id) {
  return pub('/v1/exchange/offerings/' + enc(id) + '/odps', 'No such offering');
}

/**
 * The same ODPS v4.1 document in the spec's native YAML, as raw text — what you hand to a catalogue
 * that expects the file, or show in a "copy this descriptor" box.
 * @param {string} id
 * @returns {Promise<string>}
 */
export function odpsYaml(id) {
  return pubText('/v1/exchange/offerings/' + enc(id) + '/odps.yaml', 'No such offering');
}
