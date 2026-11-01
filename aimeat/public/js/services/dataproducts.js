/**
 * @file js/services/dataproducts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The browser's calls for data products, the packages they build, the outside parties a
 *   package is shared with and the sale on EXCHANGE (plan doc-mvwxcas3dom3, D1, D3, D5, D9). Each one
 *   is one REST call to the route the MCP tools aimeat_dataproduct, aimeat_party and
 *   aimeat_datapackage_* call too, so the page decides nothing the node does not decide. Errors throw
 *   with the node's code and message (js/api.js).
 *
 *   sendShareLink is the one call site of the e-mailed share link (WP9b builds the invite and the
 *   mail). Until it exists it says so and sends nothing; the share dialog shows the connection file
 *   instead, so no link is ever claimed as sent.
 * @structure listProducts · getProduct · defineProduct · previewDraft · describeDraft · runProduct · deleteProduct ·
 *   getPackage · listVersions · listPackages · withdrawPackage · sellPackage · listParties · getParty ·
 *   shareWithParty · revokeShare · createPartyKey · deletePartyKey · stopParty · resumeParty ·
 *   deleteParty · partyReads · createParty · sendShareLink · listSourceChoices
 * @usage import * as dp from '/js/services/dataproducts.js';
 * @version-history
 *   v1.1.0 — 2026-11-01 — describeDraft (the AI's description draft); shareWithParty takes `recipient`
 *     for a person on another AIMEAT node (WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (WP9a: the owner's screens for data products, shares and parties).
 */
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

const enc = encodeURIComponent;
const data = (r) => r?.data ?? null;

/* ── Data products ─────────────────────────────────────────────────────────────────────────── */

/** `{ products, total, data_intermediation }`: each product with its package, freshness, shares and reads. */
export async function listProducts() { return data(await apiGet('/v1/dataproducts')); }
/** `{ definition, schedule, package }`. */
export async function getProduct(name) { return data(await apiGet(`/v1/dataproducts/${enc(name)}`)); }
/** Store a definition (PUT replaces one of the same name). */
export async function defineProduct(name, body) { return data(await apiPut(`/v1/dataproducts/${enc(name)}`, body)); }
/** Build a draft that is not stored: rows, schema, validation and the ODPS sheet. */
export async function previewDraft(name, body) { return data(await apiPost(`/v1/dataproducts/${enc(name)}/preview`, body)); }
/** A description draft by the owner's own AI: `{ description, lang, provenance }`; a refusal names `details.reason`. */
export async function describeDraft(name, body) { return data(await apiPost(`/v1/dataproducts/${enc(name)}/describe`, body)); }
/** Build and publish one version of a stored definition. */
export async function runProduct(name) { return data(await apiPost(`/v1/dataproducts/${enc(name)}/run`, {})); }
export async function deleteProduct(name) { return data(await apiDelete(`/v1/dataproducts/${enc(name)}`)); }

/* ── The packages a product builds ─────────────────────────────────────────────────────────── */

/** `{ descriptor, freshness, latest, descriptor_url, odps_url }` of the newest version. */
export async function getPackage(owner, name) { return data(await apiGet(`/v1/datapackages/${enc(owner)}/${enc(name)}`)); }
/** `{ versions: [{ contentHash, at, current, changes, rowCount, in_use }], retention_policy }`. */
export async function listVersions(owner, name) { return data(await apiGet(`/v1/datapackages/${enc(owner)}/${enc(name)}/versions`)); }
export async function listPackages() { return data(await apiGet('/v1/datapackages')); }
/** Withdraw a package: every read answers 410, its shares end, it leaves the catalogue. */
export async function withdrawPackage(owner, name) { return data(await apiDelete(`/v1/datapackages/${enc(owner)}/${enc(name)}`)); }
/** Sell a package on EXCHANGE: `{ exchange, model, prices_money, toll_morsels, usage_terms }`. */
export async function sellPackage(owner, name, terms) { return data(await apiPut(`/v1/datapackages/${enc(owner)}/${enc(name)}/exchange`, terms)); }

/* ── Outside parties and named shares ──────────────────────────────────────────────────────── */

/** `{ parties, total, share_max_days, dataspace }`. */
export async function listParties() { return data(await apiGet('/v1/parties')); }
export async function getParty(name) { return data(await apiGet(`/v1/parties/${enc(name)}`)); }
export async function createParty(body) { return data(await apiPost('/v1/parties', body)); }
/** Share one package with a party in one call: `{ party, share, connection, key_note, say }`. */
export async function shareWithParty(body) { return data(await apiPost('/v1/parties/share', body)); }
/** End a named share: the next read is refused. */
export async function revokeShare(consentId) { return data(await apiDelete(`/v1/consent/${enc(consentId)}`)); }
export async function createPartyKey(name) { return data(await apiPost(`/v1/parties/${enc(name)}/keys`, {})); }
export async function deletePartyKey(name, keyId) { return data(await apiDelete(`/v1/parties/${enc(name)}/keys/${enc(keyId)}`)); }
export async function stopParty(name) { return data(await apiPost(`/v1/parties/${enc(name)}/stop`, {})); }
export async function resumeParty(name) { return data(await apiPost(`/v1/parties/${enc(name)}/resume`, {})); }
export async function deleteParty(name) { return data(await apiDelete(`/v1/parties/${enc(name)}`)); }
/** `{ reads: [{ at, what, rows, verdict, code }] }`, newest first. */
export async function partyReads(name, limit = 20) { return data(await apiGet(`/v1/parties/${enc(name)}/reads?limit=${limit}`)); }

/**
 * Mail the share's one-time link to the recipient. WP9b builds the invite and the mail; until then this
 * sends nothing and answers `{ sent: false, reason: 'not-available' }`, so the dialog hands over the
 * connection file itself. This is the only place a share link is sent from.
 * @param {{ share: object, party: object }} _shared what POST /v1/parties/share answered
 * @param {string} _email the recipient's address
 */
export async function sendShareLink(_shared, _email) {
  return { sent: false, reason: 'not-available' };
}

/* ── What a source can be picked from ──────────────────────────────────────────────────────── */

/**
 * The owner's own material a source names, read once when the wizard opens: apps, extensions,
 * stored CSV and Excel files, packages and organisms. A list that cannot be read is empty, and its
 * field stays a typed one.
 */
export async function listSourceChoices(owner) {
  const safe = async (path, pick) => {
    try { return pick(data(await apiGet(path)) || {}); }
    catch (err) { swallowed(`dataproducts: ${path}`, err); return []; }
  };
  const [apps, extensions, files, packages, organisms] = await Promise.all([
    safe('/v1/apps?mine=true', (d) => (d.apps || []).filter((a) => !owner || a.owner === owner).map((a) => ({ value: a.filename, label: a.manifest?.name || a.filename }))),
    safe('/v1/extensions', (d) => (d.extensions || []).filter((e) => !owner || e.owner === owner).map((e) => ({ value: e.name, label: e.name }))),
    // A package's own CSV files (datapkg/…) are read as a data product source, not as a file.
    safe('/v1/storage', (d) => (d.files || []).filter((f) => /\.(csv|xlsx)$/i.test(f.key) && !f.key.startsWith('datapkg/')).map((f) => ({ value: f.key, label: f.key }))),
    safe('/v1/datapackages', (d) => (d.packages || []).filter((p) => p.status !== 'withdrawn').map((p) => ({ value: p.name, label: p.name }))),
    safe('/v1/organisms/tab', (d) => (d.mine || []).map((o) => ({ value: o.id, label: o.name || o.id }))),
  ]);
  return { apps, extensions, files, packages, organisms };
}

/** The workspaces of one organism, for a records source. */
export async function listWorkspaces(organismId) {
  try {
    // The same read the organism library makes (sdk-libs/organism listWorkspaces), counts included.
    const d = data(await apiGet(`/v1/organisms/${enc(organismId)}/workspaces?include=enrichment`)) || {};
    return (d.workspaces || []).filter((w) => !w.archived).map((w) => ({ value: w.id, label: w.name || w.id }));
  } catch (err) { swallowed('dataproducts: workspaces', err); return []; }
}
