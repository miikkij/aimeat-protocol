/**
 * @file command-palette.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Global command palette / quick-switcher (Cmd/Ctrl-K) — Layer 2 of the search feature.
 *   Mounted once at the app shell so it works on any authenticated page. Empty query shows recents;
 *   typing runs the indexed cross-owner librarian search (GET /v1/librarian/search, own scope) plus a
 *   name match over the caller's organisms. Results are grouped (Organisms / content hits), keyboard-
 *   navigable (↑↓/Enter/Esc), and selecting one jumps to that organism/workspace — pre-filling the
 *   in-workspace search (Layer 1) with the same query so you land on the filtered list. Navigation
 *   hands off via sessionStorage (read by OrganismsTab on mount) + an `aimeat-open-organism` event
 *   (picked up if the tab is already mounted) + a route change to the organisms tab.
 * @structure CommandPalette({ navigate })
 * @usage import { CommandPalette } from '/views/command-palette.js';  html`<${CommandPalette} navigate=${navigate} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — The list is the QuickFind component (components/QuickFind.js), which owns
 *     the field's focus, ↑↓ and Enter, the pointer's choice and the groups; the palette passes the
 *     places and what taking one does, and writes no class. A group's name is the row label
 *     (page group G9).
 *   v1.0.2 — 2026-09-13 — Escape closes the palette after a query has been typed too: a search box is
 *     not a half-written form, so the dialog's guard is off here ("↵ open · Esc close" stays true).
 *   v1.0.1 — 2026-08-29 — A free-text organism type shows as written, not as a raw locale key.
 *   v1.0.0 — 2026-06-22 — Initial: Cmd-K quick-switcher over librarian search + organism names + recents.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, tOr } from '/js/i18n.js';
import { Modal } from '/components/Modal.js';
import { QuickFind } from '/components/QuickFind.js';
import { librarianSearch } from '/js/services/memory.js';
import { listOrganisms } from '/js/services/organisms.js';
import { getOwner } from '/js/services/auth.js';
import { listRecents } from '/js/recents.js';
import { swallowed } from '/js/swallowed.js';

/** Hand off to the organisms tab using the app's existing nav contract: prime the sessionStorage the
 *  OrganismsTab reads on mount (open id + workspace + an optional ws-search pre-fill), then switch to
 *  the Organisms tab via `aimeat-open-tab` (the LandingPage listener). Also fire `aimeat-open-organism`
 *  for an ALREADY-mounted OrganismsTab (it won't remount, so it can't re-read sessionStorage), and a
 *  route fallback for when we're not on /v1/profile at all. */
function openTarget(navigate, { orgId, wsId, query }) {
  try {
    if (orgId) sessionStorage.setItem('aimeat.ws.openId', orgId);
    if (wsId) sessionStorage.setItem('aimeat.ws.openWs', wsId); else sessionStorage.removeItem('aimeat.ws.openWs');
    if (orgId && wsId && query) sessionStorage.setItem(`aimeat.ws.${orgId}.${wsId}.search`, query);
  // eslint-disable-next-line aimeat/no-silent-catch -- private mode — the route fallback still works
  } catch { /* private mode — the route fallback still works */ }
  try {
    window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'organisms' } }));
    window.dispatchEvent(new CustomEvent('aimeat-open-organism', { detail: { orgId, wsId: wsId || null } }));
  } catch (err) { swallowed('command-palette: openTarget', err); }
  if (!location.pathname.startsWith('/v1/profile')) navigate('/v1/profile?tab=organisms');
}

export function CommandPalette({ navigate }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);     // librarian content hits
  const [orgs, setOrgs] = useState([]);       // caller's organisms (for name match)
  const [busy, setBusy] = useState(false);

  // Global Cmd/Ctrl-K to open (ignore when typing in a field, except to toggle); Esc handled by Modal.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // On open: load recents + the caller's organisms (for name matching). The finder focuses its own
  // field when it appears.
  useEffect(() => {
    if (!open) { setQ(''); setHits(null); return; }
    const me = getOwner();
    if (me) listOrganisms({ member: me }).then(r => setOrgs((r?.data?.organisms) || [])).catch(err => { swallowed('command-palette: onKey', err); });
  }, [open]);

  // Debounced content search.
  useEffect(() => {
    if (!open) return undefined;
    const query = q.trim();
    if (query.length < 2) { setHits(null); setBusy(false); return undefined; }
    let cancelled = false;
    setBusy(true);
    const tid = setTimeout(async () => {
      const r = await librarianSearch(query, 30, 'own').catch(err => { swallowed('command-palette: onKey', err); return []; });
      if (!cancelled) { setHits(r || []); setBusy(false); }
    }, 200);
    return () => { cancelled = true; clearTimeout(tid); };
  }, [q, open]);

  const orgName = useCallback((id) => orgs.find(o => o.id === id)?.name || id, [orgs]);

  // Build a flat, selectable item list (with group headers derived for rendering).
  const query = q.trim();
  const orgMatches = query.length >= 2
    ? orgs.filter(o => (o.name || '').toLowerCase().includes(query.toLowerCase())).slice(0, 6)
        .map(o => ({ kind: 'org', orgId: o.id, label: o.name, sub: tOr(`organisms.types.${o.type}`, o.type) }))
    : [];
  const contentItems = (hits || []).map(hh => ({
    kind: 'hit', orgId: hh.organismId, wsId: hh.workspaceId, label: hh.title || hh.key,
    sub: [orgName(hh.organismId), hh.workspaceId, hh.space].filter(Boolean).join(' · '), snippet: hh.snippet,
  })).filter(it => it.orgId);
  const recents = (!query) ? listRecents(8).filter(r => r.type === 'workspace' && r.data?.orgId)
    .map(r => ({ kind: 'recent', orgId: r.data.orgId, wsId: r.data.wsId, label: r.label, sub: r.sub })) : [];
  const choose = (it) => {
    if (!it) return;
    openTarget(navigate, { orgId: it.orgId, wsId: it.wsId, query: it.kind === 'hit' ? query : '' });
    setOpen(false);
  };

  if (!open) return null;
  // Each place carries its sign and a key; the finder draws them, moves the choice with ↑↓ and takes
  // it with Enter.
  const place = (it) => ({
    ...it,
    key: it.kind + (it.orgId || '') + (it.wsId || '') + it.label,
    mark: it.kind === 'org' ? '🏢' : it.kind === 'recent' ? '🕘' : '📄',
  });

  return html`
    <${Modal} open=${open} onClose=${() => setOpen(false)} title=${t('search.paletteTitle') || 'Search everything'}
      guard=${false}>
      <${QuickFind}
        value=${q}
        onInput=${setQ}
        placeholder=${t('search.palettePlaceholder') || 'Search organisms, workspaces, records…'}
        hint=${t('search.openHint') || '↵ open · Esc close'}
        busy=${busy}
        busyLabel=${t('search.searching') || 'Searching…'}
        emptyLabel=${query.length >= 2 ? (t('search.noMatches') || 'No matches') : null}
        groups=${[
          { key: 'orgs', label: t('organisms.title') || 'Organisms', items: orgMatches.map(place) },
          { key: 'hits', label: t('search.results') || 'Results', items: contentItems.map(place) },
          { key: 'recents', label: t('search.recents') || 'Recent', items: recents.map(place) },
        ]}
        onPick=${choose} />
    </${Modal}>`;
}
