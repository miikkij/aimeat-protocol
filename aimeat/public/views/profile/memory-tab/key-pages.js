/**
 * @file public/views/profile/memory-tab/key-pages.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Memory page without the whole key list (performance work, Jouni's choice "Key
 *   spaces, paged"). The cover reads the server's summary (GET /v1/memory/tab?summary=true: the key
 *   spaces with their counts, the newest changes, the stale keys, who else sees); a key space page
 *   reads its keys a page at a time (GET /v1/memory?include=meta&prefix&sort&offset&limit); a record
 *   page finds its row among what is already read, or reads it by its key. At a heavy account's size
 *   the page's first answer was 6.4 MB with every key, and every live update read it again.
 *   The full list still comes when a part of the page needs every key: All as keys, Archived, one
 *   agent's memory, every stale key, every value loaded (memory-tab.js loadFull).
 * @structure useKeyPages({ onStats, setMemQuota }) → { summary, loadSummary, applySummary, spacePages,
 *   loadSpacePage, ensureRecord, knownRow, refreshOpen, addSpaceToCart } · prefixOf(g) · todayFrom()
 * @usage const pages = useKeyPages({ onStats, setMemQuota });
 * @version-history
 *   2026-11-10 — Initial.
 */
import { useState, useRef } from 'preact/hooks';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import * as memoryService from '/js/services/memory.js';

const PAGE = 100;
const CART_PAGE = 1000;

/** The key prefix of a key space, or null for the keys without a dot (they share no prefix). */
export const prefixOf = (g) => (g.kind === 'organism' ? `organism.${g.uuid}.` : g.kind === 'plain' ? `${g.id}.` : null);

/** The reader's own start of today, ISO. */
export function todayFrom() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function useKeyPages({ onStats, setMemQuota }) {
  const [summary, setSummary] = useState(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [spacePages, setSpacePages] = useState({});
  const [recordRows, setRecordRows] = useState({});
  // The latest state for the async loaders, which outlive the render that started them.
  const pagesRef = useRef(spacePages);
  pagesRef.current = spacePages;

  /** The memory part of a GET /v1/memory/tab?summary=true answer. */
  const applySummary = (memory) => {
    setSummary({ ...memory.summary, total: memory.total ?? 0 });
    setSummaryFailed(false);
    setMemQuota(memory.quota || null);
    onStats?.({ memory: memory.total ?? 0 });
  };

  const loadSummary = async () => {
    try {
      const r = await apiGet(`/v1/memory/tab?summary=true&today_from=${encodeURIComponent(todayFrom())}`);
      if (r?.data?.memory?.summary) applySummary(r.data.memory);
      else setSummaryFailed(true);
    } catch (err) { swallowed('memory-tab: summary', err); setSummaryFailed(true); }
  };

  /** One key space's keys in `sort` order; `more` adds the next page, otherwise the first `keep` rows (at least a page) are read again. */
  const loadSpacePage = async (space, sort, more = false, keep = 0) => {
    const prefix = prefixOf(space.g);
    if (!prefix) return;
    const cur = pagesRef.current[space.id];
    const same = cur && cur.sort === sort;
    const offset = more && same ? cur.rows.length : 0;
    const limit = more ? PAGE : Math.max(PAGE, keep);
    setSpacePages((s) => ({ ...s, [space.id]: { ...(same ? cur : { rows: [], total: 0 }), sort, loading: true, failed: false } }));
    try {
      // The page names its alphabetical order 'alpha'; the server calls it 'key'.
      const r = await memoryService.listMemoriesMetaPage({ prefix, sort: sort === 'alpha' ? 'key' : sort, offset, limit });
      setSpacePages((s) => {
        const was = s[space.id];
        const rows = more && was?.sort === sort ? [...was.rows, ...r.items] : r.items;
        return { ...s, [space.id]: { sort, rows, total: r.total, loading: false, failed: false } };
      });
    } catch (err) {
      swallowed('memory-tab: space page', err);
      setSpacePages((s) => ({ ...s, [space.id]: { ...(s[space.id] || { rows: [], total: 0 }), sort, loading: false, failed: true } }));
    }
  };

  /** A row already read: the summary's, a space page's or a record's own. */
  const knownRow = (key) => {
    if (recordRows[key]) return recordRows[key];
    for (const p of Object.values(spacePages)) { const m = p.rows.find((x) => x.key === key); if (m) return m; }
    if (summary) {
      const m = (summary.recent || []).find((x) => x.key === key) || (summary.stale?.items || []).find((x) => x.key === key)
        || (summary.spaces || []).map((s) => s.latest).find((x) => x && x.key === key);
      if (m) return m;
    }
    return null;
  };

  /** Read one record's row by its key, unless it is already known (or `force`). */
  const ensureRecord = async (key, force = false) => {
    if (!force && knownRow(key)) return;
    try {
      const r = await memoryService.listMemoriesMetaPage({ prefix: key, limit: 50 });
      const row = r.items.find((x) => x.key === key) || null;
      setRecordRows((s) => ({ ...s, [key]: row || { key, missing: true } }));
    } catch (err) { swallowed('memory-tab: record row', err); }
  };

  /** After a change: the summary, and the open key space or record read again. */
  const refreshOpen = (view, spaceOf) => {
    loadSummary();
    if (view.kind === 'space') {
      const cur = pagesRef.current[view.id];
      const space = spaceOf(view.id);
      if (cur && space) loadSpacePage(space, cur.sort, false, cur.rows.length);
    } else if (view.kind === 'record') ensureRecord(view.key, true);
  };

  /** Every key of a space into the collection, read a thousand at a time. */
  const addSpaceToCart = async (space, addCartItems, memCartItem) => {
    const prefix = prefixOf(space.g);
    if (!prefix) return;
    const all = [];
    try {
      for (let offset = 0; ; offset += CART_PAGE) {
        const r = await memoryService.listMemoriesMetaPage({ prefix, offset, limit: CART_PAGE });
        all.push(...r.items);
        if (!r.items.length || all.length >= r.total) break;
      }
      addCartItems(all.map(memCartItem));
    } catch (err) { swallowed('memory-tab: space to cart', err); }
  };

  return { summary, summaryFailed, loadSummary, applySummary, spacePages, loadSpacePage, ensureRecord, knownRow, refreshOpen, addSpaceToCart };
}
