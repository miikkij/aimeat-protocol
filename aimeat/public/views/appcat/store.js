/**
 * @file public/views/appcat/store.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description appcat's shared state: the node's app listing (own and community), the stars, the
 *   bound skills, and the few acts every part of the page needs (reload, star, notice, open the
 *   detail). One store for the page; a part reads it with useCatalog() and never keeps its own copy.
 *   Nothing about apps is kept in the browser's own storage (Jouni: "selaimen omaa tallennusta ei
 *   pitäisi olla"): the stars live on the node (the memory record app-catalog.favorites, which the
 *   home page reads too), the listing is read again on every load.
 *
 *   The listing (features.md F179): GET /v1/apps?limit=200&offset=n, page after page while a page is
 *   full and below `total`, with the owner's session when signed in (so the owner's unlisted apps and
 *   their access codes come back). Own versus community (F45, F351): the bare owner name against the
 *   session's; signed out every app is the community's. `loaded` turns true when the first listing has
 *   answered, success or failure (F41). The stars (F181, F182) and the bound skills (F180, the "No
 *   skill" row) are read beside it; a star is flipped at once and the whole set written back.
 * @structure useCatalog() · getCatalog() · reloadCatalog() · toggleFavourite(ref) · notice(text, kind) ·
 *   clearNotice() · openDetail(app) · closeDetail() · appRef(app) · isOwn(app) · findApp(owner, filename) ·
 *   subscribe(fn) · setState(patch)
 * @usage const cat = useCatalog(); cat.own.map(…)
 * @version-history
 *   v1.0.0 — 2026-09-27 — The listing with paging, own and community, the stars and the bound skills on
 *     the node, the notice (drawn by the shell with the Toast component), findApp, getCatalog. isOwn
 *     compares bare owner names (F351).
 *   v0.1.0 — 2026-09-27 — The contract (the shell's builder fills it in).
 */
import { useEffect, useState } from 'preact/hooks';
import { api, apiPost } from '/js/api.js';
import { getSession } from '/js/services/auth.js';

/**
 * The state. `loaded` turns true when the first listing has answered (success or failure).
 * `notice` is { text, kind, at } or null; `skillsLoaded` says the bound skills have been read.
 * @typedef {{ loaded: boolean, error: string|null, me: string|null, all: any[], own: any[],
 *   community: any[], favourites: Set<string>, skillsBound: Set<string>, skillsLoaded: boolean,
 *   detail: any|null, notice: { text: string, kind: string, at: number }|null }} CatalogState
 */
/** @type {CatalogState} */
const state = {
  loaded: false, error: null, me: null, all: [], own: [], community: [], favourites: new Set(),
  skillsBound: new Set(), skillsLoaded: false, detail: null, notice: null,
};
const listeners = new Set();
const FAV_KEY = 'app-catalog.favorites';
const PAGE = 200; // the node caps limit at 200

/** @param {() => void} fn */
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(); }

/** @param {Partial<CatalogState>} patch */
export function setState(patch) { Object.assign(state, patch); emit(); }

/** The state as it is now, without subscribing (for an act that runs outside a render). */
export function getCatalog() { return state; }

/** The state, re-rendering the caller on every change. */
export function useCatalog() {
  const [, tick] = useState(0);
  useEffect(() => subscribe(() => tick((n) => n + 1)), []);
  return state;
}

/** The bare account name ("alice@node" → "alice"), lower case (F351). */
const bare = (name) => String(name || '').split('@')[0].toLowerCase();
const sameOwner = (a, b) => !!b && !!bare(a) && bare(a) === bare(b);

/** "owner/filename" for a listing row. */
export function appRef(app) { return app ? `${app.owner}/${app.filename}` : ''; }

/** Whether the signed-in person owns the app (bare names, as the old page compared them). */
export function isOwn(app) { return !!(app && state.me && sameOwner(app.owner, state.me)); }

/** The listing row of owner/filename, or null. */
export function findApp(owner, filename) {
  return state.all.find((a) => a && a.filename === filename && sameOwner(a.owner, owner)) || null;
}

/** Every page of the listing (F179): while a page is full and the rows are fewer than `total`. */
async function fetchAll() {
  let all = [];
  for (let offset = 0; ; offset += PAGE) {
    const json = await api(`/v1/apps?limit=${PAGE}&offset=${offset}`, { method: 'GET' });
    const apps = json?.data?.apps || [];
    all = all.concat(apps);
    const total = typeof json?.data?.total === 'number' ? json.data.total : all.length;
    if (apps.length < PAGE || all.length >= total) return all;
  }
}

/** The star set on the node (F181); an empty set when signed out or when none is stored. */
async function fetchFavourites() {
  if (!getSession()) return new Set();
  try {
    const json = await api(`/v1/memory/${encodeURIComponent(FAV_KEY)}?soft=1`, { method: 'GET' });
    const refs = json?.data?.value?.refs;
    return new Set(Array.isArray(refs) ? refs.filter((r) => typeof r === 'string') : []);
  } catch (err) {
    console.warn('[appcat] the stars could not be read', err);
    return state.favourites; // a passing failure leaves the stars as they were, as the old page did
  }
}

/** The apps a skill of the person's own is bound to ("owner/filename"), for the "No skill" row (F180). */
async function fetchSkillsBound() {
  const json = await api('/v1/skills?scope=user', { method: 'GET' });
  const skills = json?.data?.skills || (Array.isArray(json?.data) ? json.data : []);
  const bound = new Set();
  for (const s of skills) {
    const b = (s && ((s.metadata && s.metadata.binding) || s.binding)) || '';
    if (typeof b === 'string' && b.startsWith('app:')) bound.add(b.slice(4));
  }
  return bound;
}

let round = 0;

/**
 * Read the listing again (on load, on a sign-in or sign-out, after a write, on a language change;
 * F342). A later call wins over an earlier one still on its way.
 */
export async function reloadCatalog() {
  const mine = ++round;
  const session = getSession();
  const me = session?.owner || null;
  const [listing, favourites] = await Promise.all([
    fetchAll().then((rows) => ({ rows, error: null }), (err) => ({ rows: [], error: err?.message || String(err) })),
    fetchFavourites(),
  ]);
  if (mine !== round) return;
  const all = listing.rows;
  const own = me ? all.filter((a) => sameOwner(a.owner, me)) : [];
  const community = me ? all.filter((a) => !sameOwner(a.owner, me)) : all;
  setState({ loaded: true, error: listing.error || null, me, all, own, community, favourites });
  if (!me || listing.error) { setState({ skillsBound: new Set(), skillsLoaded: !!me }); return; }
  // The skills are read after the lists are up, so a slow or refused read only delays that one row.
  try {
    const bound = await fetchSkillsBound();
    if (mine === round) setState({ skillsBound: bound, skillsLoaded: true });
  } catch (err) {
    console.warn('[appcat] the bound skills could not be read', err);
    if (mine === round) setState({ skillsBound: new Set(), skillsLoaded: false });
  }
}

/**
 * Star or unstar an app (F78, F182): the star flips at once, then the whole set is written to the
 * node. Signed out, the write is skipped (the old page did the same).
 * @param {string} ref "owner/filename"
 */
export async function toggleFavourite(ref) {
  const next = new Set(state.favourites);
  if (next.has(ref)) next.delete(ref); else next.add(ref);
  setState({ favourites: next });
  if (!getSession()) return;
  try {
    await apiPost('/v1/memory', {
      key: FAV_KEY,
      value: { version: 1, updatedAt: new Date().toISOString(), refs: Array.from(next) },
      visibility: 'private',
    });
  // eslint-disable-next-line aimeat/no-silent-catch -- best effort, as the old page: the star stays as pressed, the next load says what the node kept
  } catch { /* nothing to undo */ }
}

/** Show a short message. kind: 'info' | 'success' | 'error' (the shell draws it with the Toast). */
export function notice(text, kind = 'info') { setState({ notice: { text: String(text ?? ''), kind, at: Date.now() } }); }

/** Take the message away (its time ran out, or it was pressed). */
export function clearNotice() { setState({ notice: null }); }

/** Open an app's detail view. */
export function openDetail(app) { setState({ detail: app }); }

/** Close the detail view. */
export function closeDetail() { setState({ detail: null }); }
