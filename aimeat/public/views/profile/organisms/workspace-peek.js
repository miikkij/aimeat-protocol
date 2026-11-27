/**
 * @file public/views/profile/organisms/workspace-peek.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What one workspace holds, read before a person opens it: its purpose (the
 *   manifest's summary, in the reader's language when the manifest carries one) and its three newest
 *   documents by title. One bounded index read per readable workspace (GET
 *   /v1/organisms/:id/workspace/index?ws=&bounded=true&limit=3), made when the shared place's
 *   workspace list draws, and made again for a workspace only when its enrichment says it changed
 *   (its last event, its record or document count), so a live update re-reads what changed and
 *   nothing else. No timer: the list itself reloads on the existing `organisms` live event.
 * @structure peekOf(data, lang) · readWorkspacePeek(orgId, wsId) · useWorkspacePeeks(orgId, rows)
 * @usage const peeks = useWorkspacePeeks(org.id, readable.map(w => ({ id: w.id, sig: sigOf(w) })));
 * @version-history
 *   v1.0.0 -- 2026-11-27 -- Initial: the workspace row says what is inside before it is opened.
 */
import { useState, useEffect, useRef } from 'preact/hooks';
import { apiGet } from '/js/api.js';
import { getLocale } from '/js/i18n.js';
import { isMemorySpace, isDocSpace } from '/js/services/organisms.js';
import { swallowed } from '/js/swallowed.js';

const NEWEST = 3;
const enc = encodeURIComponent;

/**
 * The parts of a bounded index read a workspace row shows: `summary` (the purpose) and `newest`
 * ([{ id, title, space, draft, at }], newest change first, documents only).
 */
export function peekOf(data, lang) {
  const m = data?.manifest || {};
  const i18n = m.i18n && typeof m.i18n === 'object' ? m.i18n : null;
  const summary = (i18n && ((i18n[lang] && i18n[lang].summary) || (i18n.en && i18n.en.summary))) || m.summary || '';
  const docSpaces = (Array.isArray(m.objectTypes) ? m.objectTypes : []).filter(ot => isMemorySpace(ot) && isDocSpace(ot)).map(ot => ot.name);
  const index = data?.index || {};
  const newest = docSpaces
    .flatMap(space => (Array.isArray(index[space]) ? index[space] : []).map(d => ({
      id: d.id, title: d.title || d.id, space, draft: d.published === false, at: d.updated || '',
    })))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, NEWEST);
  return { summary: String(summary || ''), newest };
}

/** One bounded index read of a workspace, turned into what its row shows. */
export async function readWorkspacePeek(orgId, wsId) {
  const r = await apiGet(`/v1/organisms/${enc(orgId)}/workspace/index?ws=${enc(wsId)}&bounded=true&limit=${NEWEST}`);
  return peekOf(r?.data, String(getLocale() || 'en').slice(0, 2));
}

/**
 * The peeks of the given workspaces ({ id, sig }), keyed by id. A workspace is read once, and again
 * only when its `sig` changes; a read that did not land before the rows changed is read again.
 */
export function useWorkspacePeeks(orgId, rows) {
  const [peeks, setPeeks] = useState({});
  const read = useRef({});
  const key = rows.map(r => `${r.id}:${r.sig}`).join('|');
  useEffect(() => {
    if (!orgId) return undefined;
    const marks = read.current;
    const due = rows.filter(r => marks[r.id] !== r.sig);
    if (!due.length) return undefined;
    for (const r of due) marks[r.id] = r.sig;
    const landed = new Set();
    let alive = true;
    Promise.all(due.map(r => readWorkspacePeek(orgId, r.id)
      .then(p => [r.id, p])
      .catch(err => { swallowed('workspace-peek: read', err); return [r.id, null]; })))
      .then(pairs => {
        if (!alive) return;
        for (const [id] of pairs) landed.add(id);
        setPeeks(prev => {
          const next = { ...prev };
          for (const [id, p] of pairs) if (p) next[id] = p;
          return next;
        });
      });
    return () => {
      alive = false;
      for (const r of due) if (!landed.has(r.id)) delete marks[r.id];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the rows' ids and signatures; the array itself is new on every render.
  }, [orgId, key]);
  return peeks;
}
