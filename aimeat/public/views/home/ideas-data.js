/**
 * @file public/views/home/ideas-data.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ideas the home offers, read from the node (GET /v1/prompts/home-ideas, the
 *   managed prompt `home-ideas` the operator edits) in the person's language. One read per page and
 *   language: the new-agent page, the home's tasks and an agent's app offer share it.
 *
 *   The list is the node's, not this file's (Jouni, 2026-10-14: one record the operator edits, so
 *   the page, the home and a connected AI read the same ideas). What stays here is how a page
 *   reads it.
 * @structure useHomeIdeas() · whenText(kind) · STRIP_IDEAS
 * @usage const ideas = useHomeIdeas(); ideas?.agents.map(...)
 * @version-history
 *   v1.0.0 — 2026-10-14 — The list moves to the node; the page reads it (wish-esimerkit-agenteista-ja-sovelluksista-kotiruudulle-mielikuvi).
 *   v0.1.0 — 2026-10-14 — Design draft with the texts in this file.
 */
import { useState, useEffect } from 'preact/hooks';
import { apiGet } from '/js/api.js';
import { getLocale, tOr } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';

/** The agent ideas the new-agent page shows before the person opens the dialog, by id. */
export const STRIP_IDEAS = ['minutes', 'due', 'news'];

/** When an idea works, in the words the home's agent list already uses (home.agents.when.*). */
const WHEN_FALLBACK = { records: 'When something new arrives in a workspace', clock: 'By the clock', talk: 'When someone writes to it', ask: 'When I ask' };
export const whenText = (kind) => tOr('home.agents.when.' + kind, WHEN_FALLBACK[kind] ?? kind);

const cache = new Map();

/** The list in the person's language: { groups, agents, apps }, or null while it is read. */
export function useHomeIdeas() {
  const lang = getLocale();
  const [ideas, setIdeas] = useState(() => cache.get(lang) ?? null);
  useEffect(() => {
    if (cache.has(lang)) { setIdeas(cache.get(lang)); return undefined; }
    let live = true;
    apiGet('/v1/prompts/home-ideas?lang=' + encodeURIComponent(lang))
      .then((resp) => {
        const d = resp?.data ?? {};
        const read = { groups: d.groups ?? [], agents: d.agents ?? [], apps: d.apps ?? [] };
        cache.set(lang, read);
        if (live) setIdeas(read);
      })
      .catch((err) => { swallowed('home ideas: read', err); if (live) setIdeas({ groups: [], agents: [], apps: [] }); });
    return () => { live = false; };
  }, [lang]);
  return ideas;
}
