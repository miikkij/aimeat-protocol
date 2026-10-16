/**
 * @file public/views/appcat/sections/tools-manifest.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one copy of an app's tool manifest that two sections of the detail view share:
 *   EXCHANGE & ODPS (the market status and the app's ODPS defaults) and Monetize (the tools). The
 *   manifest is the owner's PUBLIC memory record `apps.{filename}.tools` (the filename with its
 *   `.html`) = { version, updatedAt, tools: [...], odps?, provenance? }; the node projects the
 *   marketplace listing from it on every write. Its shape is kept exactly as the old catalogue wrote
 *   it (js/monetize.js, js/odps.js): a save merges over the loaded record, so the fields no screen
 *   shows (inputSchema, outputSchema, plans, the app-level odps and provenance) survive every save.
 *
 *   The two sections read it with useToolsManifest(d); the first to mount loads it, the second reuses
 *   it, and the copy is dropped when the last of them unmounts (a new detail view reads it again, as
 *   the old page did on every open). Also here: the rules both sections use (why a flagged tool cannot
 *   be listed, the price in words) and the write.
 * @structure useToolsManifest(d) · patchManifest(patch) · manifestNow() · writeManifest(doc) ·
 *   blockedReason(tool) · priceLabel(tool) · ownerGhiiOf(m) · MONEY_UNIT · CURRENCIES
 * @usage const m = useToolsManifest(d); m.state === 'ready' && m.doc.tools.map(…)
 * @version-history
 *   v1.1.2 — 2026-10-16 — A manifest read that failed (not a 404) is marked readFailed, and writeManifest
 *     refuses to save on top of it: the save replaces the whole public record (QA audit F6-04).
 *   v1.1.1 — 2026-10-12 — A money price shows two decimals ("0.50 EUR").
 *   v1.1.0 — 2026-10-11 — priceLabel says the money price (or Free) and the pacing amount; a tool
 *     with a pacing amount and no money price can be listed (ruling "morseli on tahdistus, ei hinta").
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder C), from the old catalogue's monetize.js and
 *     odps.js module state.
 */
import { useEffect, useState } from 'preact/hooks';
import { apiGet, apiPost } from '/js/api.js';
import { getSession, getNodeId } from '/js/services/auth.js';
import { x } from '/views/appcat/i18n.js';
import { t } from '/js/i18n.js';
import { pacingOf } from '/js/format.js';

/** 6-decimal micro-units, the node-wide money convention. */
export const MONEY_UNIT = 1000000;
/** Mirrors MONEY_CURRENCIES in src/commerce/money.ts. */
export const CURRENCIES = ['EUR', 'USD'];

/**
 * The shared state. `state`: 'off' | 'loading' | 'ready'. `editing`: -1 closed · -2 a new tool ·
 * i editing tools[i]. `offerings` / `timing`: tool name → its live listing id / its measured delivery
 * time. `defaultsOpen` / `toolOpen`: the ODPS defaults form and the per-tool ODPS block.
 */
function blank() {
  return { ref: '', owner: '', filename: '', state: 'off', doc: null, offerings: {}, timing: {}, nodeId: '',
    editing: -1, busy: false, defaultsOpen: false, toolOpen: false, readFailed: false };
}

let cur = blank();
const users = new Map();
const listeners = new Set();

function emit() { for (const fn of listeners) fn(); }

/** Change the shared state and re-render both sections. */
export function patchManifest(patch) { cur = { ...cur, ...patch }; emit(); }

/** The state as it is now (for a handler that runs after an await). */
export function manifestNow() { return cur; }

function keyOf(filename) { return `apps.${filename}.tools`; }

async function loadOfferings(ref, owner, filename) {
  // Best effort: the market is public, and a missing listing only means no odps.yaml link.
  try {
    const res = await apiGet('/v1/exchange/offerings?stats=1&q=' + encodeURIComponent(filename));
    if (cur.ref !== ref) return;
    const ext = `apptool:${owner}/${filename}`;
    const offerings = {};
    const timing = {};
    for (const o of (res?.data?.offerings) || []) {
      if (o.ext === ext && o.state === 'listed') {
        offerings[o.action] = o.offeringId;
        if (o.stats && o.stats.timing) timing[o.action] = o.stats.timing;
      }
    }
    patchManifest({ offerings, timing, nodeId: res?.node || cur.nodeId });
  } catch (e) {
    // No market link is a cosmetic loss, never an error the person has to see.
    console.warn('appcat: the marketplace listings could not be read', e);
  }
}

async function load(ref, owner, filename) {
  let doc = { tools: [] };
  let readFailed = false;
  try {
    const res = await apiGet('/v1/memory/' + encodeURIComponent(keyOf(filename)));
    const value = res?.data && (res.data.value || (res.data.record && res.data.record.value));
    if (value && Array.isArray(value.tools)) doc = value;
  } catch (e) {
    // A missing record (404) is the normal "no tools yet"; anything else is said in the console and
    // shown as no tools, as the old page did, but marked: writeManifest refuses to save a manifest
    // built on a read that failed, because the save replaces the whole public record.
    if (e && e.status !== 404) { console.warn('appcat: the tool manifest could not be read', e); readFailed = true; }
  }
  if (cur.ref !== ref) return;
  patchManifest({ doc, state: 'ready', readFailed });
  loadOfferings(ref, owner, filename);
}

/** Start reading the manifest of the app `d` shows, unless it is already read or being read. */
function open(d) {
  if (cur.ref === d.ref && cur.state !== 'off') return;
  cur = { ...blank(), ref: d.ref, owner: d.owner, filename: d.filename, state: 'loading', nodeId: getNodeId() || '' };
  emit();
  load(d.ref, d.owner, d.filename);
}

/**
 * The manifest of the app the detail view shows, for an own published app (the only place the two
 * sections are drawn). Re-renders its caller on every change.
 */
export function useToolsManifest(d) {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    const ref = d.ref;
    users.set(ref, (users.get(ref) || 0) + 1);
    open(d);
    return () => {
      listeners.delete(fn);
      const left = (users.get(ref) || 1) - 1;
      if (left > 0) users.set(ref, left);
      else {
        users.delete(ref);
        if (cur.ref === ref) cur = blank();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the app is named by its ref; d is a new object on every render
  }, [d.ref]);
  return cur;
}

/**
 * Persist the whole manifest as the PUBLIC apps.{filename}.tools record (version + 1, updatedAt),
 * as the old page's writeManifest did. Throws with the server's words when the node refuses.
 */
export async function writeManifest(doc) {
  if (!getSession()?.jwt) throw new Error(x('monetize.needLogin'));
  if (cur.readFailed) {
    // Built on "no tools" after a failed read, the save would replace the app's whole manifest.
    const e = /** @type {Error & { code?: string }} */ (new Error(t('common.notLoadedNotSaved')));
    e.code = 'NOT_LOADED';
    throw e;
  }
  doc.version = (doc.version || 0) + 1;
  doc.updatedAt = new Date().toISOString();
  return apiPost('/v1/memory', { key: keyOf(cur.filename), value: doc, visibility: 'public' });
}

/**
 * Why a tool flagged for EXCHANGE does not reach the market (the node's reconcile skips it silently:
 * SCHEMA_REQUIRED / TOOL_UNBOUND / NOT_PRICED). '' when it can be listed or is not flagged.
 */
export function blockedReason(tool) {
  if (!tool || !tool.exchange) return '';
  const hasIn = tool.inputSchema && Object.keys(tool.inputSchema).length;
  const hasOut = tool.outputSchema && Object.keys(tool.outputSchema).length;
  if (!hasIn || !hasOut) return x('odps.blockedSchema');
  if (!tool.action_id) return x('odps.blockedBinding');
  // A tool goes on the market with a money price, a pacing amount, or both (ruling 2026-10-11).
  const priced = pacingOf(tool) > 0 || (tool.priceMoney && tool.priceMoney.amount > 0);
  if (!priced) return x('odps.blockedPrice');
  return '';
}

/**
 * "0.02 EUR · pacing 2 morsels", "Free · pacing 2 morsels", or "not for sale" when the tool declares
 * neither. The pacing amount is `tollMorsels`, plus a 3.x `price.morsels` (the node adds the two).
 */
export function priceLabel(tool) {
  const parts = [];
  const seen = {};
  const money = [tool.priceMoney].concat(tool.pricesMoney || []);
  for (const m of money) {
    if (!m || !(m.amount > 0) || seen[m.currency]) continue;
    seen[m.currency] = true;
    parts.push((m.amount / MONEY_UNIT).toFixed(2) + ' ' + m.currency);
  }
  const toll = Math.min(100, (tool.tollMorsels > 0 ? tool.tollMorsels : 0) + (tool.price && tool.price.morsels > 0 ? tool.price.morsels : 0));
  if (!parts.length && !toll) return x('monetize.notForSale');
  if (!parts.length) parts.push(t('pacing.free'));
  if (toll) parts.push(t('pacing.amount', { n: toll }));
  return parts.join(' · ');
}

/** The owner's full identity, which the public file address /v1/pub/{GHII}/{key} needs. */
export function ownerGhiiOf(m) { return (m.owner && m.nodeId) ? `${m.owner}@${m.nodeId}` : ''; }
