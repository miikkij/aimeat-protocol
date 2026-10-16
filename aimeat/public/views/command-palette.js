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
 *   v1.3.0 — 2026-10-16 — The large dialog (840px); a hit names its workspace by name and shows its
 *     ids (key, workspace id) on a typewriter line; the emoji marks in front of a name are gone (Jouni:
 *     "sen pitää olla toimiva", "näytä nimi ja voi noi ID:tkin olla näkyvillä"). A hit in a workspace
 *     opens that document or record itself, not the shared place (Jouni: "se meni organismiin muttei
 *     baronaan"): the openDoc handoff carries its key, and `aimeat-open-doc` reaches an open workspace.
 *   v1.2.0 — 2026-10-14 — The window event `aimeat-command-palette` ({ q }) opens it with the words
 *     already typed: the menu find's way on when no place in a menu matched.
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
import { listOrganisms, listWorkspaces } from '/js/services/organisms.js';
import { getOwner } from '/js/services/auth.js';
import { listRecents } from '/js/recents.js';
import { swallowed } from '/js/swallowed.js';

/** Hand off to the organisms tab using the app's existing nav contract: prime the sessionStorage the
 *  OrganismsTab reads on mount (open id + workspace + an optional ws-search pre-fill), then switch to
 *  the Organisms tab via `aimeat-open-tab` (the LandingPage listener). Also fire `aimeat-open-organism`
 *  for an ALREADY-mounted OrganismsTab (it won't remount, so it can't re-read sessionStorage), and a
 *  route fallback for when we're not on /v1/profile at all. */
function openTarget(navigate, { orgId, wsId, query, key }) {
  try {
    if (orgId) sessionStorage.setItem('aimeat.ws.openId', orgId);
    if (wsId) sessionStorage.setItem('aimeat.ws.openWs', wsId); else sessionStorage.removeItem('aimeat.ws.openWs');
    // A hit is opened itself (the workspace finds its space from the key, organisms/workspace-open-doc.js);
    // without a key, the workspace opens searched for the words.
    if (orgId && wsId && key) sessionStorage.setItem(`aimeat.ws.${orgId}.${wsId}.openDoc`, JSON.stringify({ key }));
    else if (orgId && wsId && query) sessionStorage.setItem(`aimeat.ws.${orgId}.${wsId}.search`, query);
  // eslint-disable-next-line aimeat/no-silent-catch -- private mode — the route fallback still works
  } catch { /* private mode — the route fallback still works */ }
  try {
    window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'organisms' } }));
    window.dispatchEvent(new CustomEvent('aimeat-open-organism', { detail: { orgId, wsId: wsId || null } }));
    if (orgId && wsId && key) window.dispatchEvent(new CustomEvent('aimeat-open-doc', { detail: { orgId, wsId, key } }));
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

  // Opened with words already in it: the menu find's "Search your content for …" when no place in a
  // menu matched (components/MenuFind.js).
  useEffect(() => {
    const onAsk = (e) => { setQ(String(e.detail?.q || '')); setOpen(true); };
    window.addEventListener('aimeat-command-palette', onAsk);
    return () => window.removeEventListener('aimeat-command-palette', onAsk);
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

  // A hit's workspace by its name, not its id: the names of the workspaces the hits are in, read once
  // per shared place (the id stays on the hit's own typewriter line).
  const [wsNames, setWsNames] = useState({});
  useEffect(() => {
    const need = [...new Set((hits || []).map(hh => hh.organismId).filter(id => id && !(id in wsNames)))];
    if (!need.length) return;
    Promise.all(need.map(id => listWorkspaces(id).then(list => [id, list]).catch(err => { swallowed('command-palette: workspaces', err); return [id, []]; })))
      .then(pairs => setWsNames(prev => {
        const next = { ...prev };
        for (const [id, list] of pairs) next[id] = Object.fromEntries((list || []).map(w => [w.id, w.name]));
        return next;
      }));
  }, [hits]);   // eslint-disable-line react-hooks/exhaustive-deps -- wsNames is the cache it fills
  const wsName = (orgId, wsId) => wsNames[orgId]?.[wsId] || wsId;
  // A hit's space by its name: the key's namespace between the workspace and the record's id
  // ("shared.ura" in organism.o.w.ws.shared.ura.<id>.latest reads "ura"); the server's `space` is only
  // the first segment of it.
  const spaceOf = (hh) => {
    const head = `organism.${hh.organismId}.w.${hh.workspaceId}.`;
    if (!hh.workspaceId || !hh.key?.startsWith(head)) return hh.space;
    const parts = hh.key.slice(head.length).replace(/\.(draft|latest|version\.\d+)$/, '').split('.');
    const ns = parts.slice(0, -1);
    return (ns[0] === 'shared' && ns.length > 1 ? ns.slice(1) : ns).join('.') || hh.space;
  };

  // Build a flat, selectable item list (with group headers derived for rendering).
  const query = q.trim();
  const orgMatches = query.length >= 2
    ? orgs.filter(o => (o.name || '').toLowerCase().includes(query.toLowerCase())).slice(0, 6)
        .map(o => ({ kind: 'org', orgId: o.id, label: o.name, sub: tOr(`organisms.types.${o.type}`, o.type), meta: o.id }))
    : [];
  // Each hit: its name, where it is (shared place · workspace · space, by name), the found words in
  // their sentence, and the ids that address it.
  const contentItems = (hits || []).map(hh => ({
    kind: 'hit', orgId: hh.organismId, wsId: hh.workspaceId, hitKey: hh.key, label: hh.title || hh.key,
    sub: [orgName(hh.organismId), hh.workspaceId && wsName(hh.organismId, hh.workspaceId), spaceOf(hh)].filter(Boolean).join(' · '),
    snippet: hh.snippet,
    meta: [hh.key, hh.workspaceId].filter(Boolean).join(' · '),
  })).filter(it => it.orgId);
  const recents = (!query) ? listRecents(8).filter(r => r.type === 'workspace' && r.data?.orgId)
    .map(r => ({ kind: 'recent', orgId: r.data.orgId, wsId: r.data.wsId, label: r.label, sub: r.sub })) : [];
  const choose = (it) => {
    if (!it) return;
    openTarget(navigate, { orgId: it.orgId, wsId: it.wsId, query: it.kind === 'hit' ? query : '', key: it.kind === 'hit' ? it.hitKey : '' });
    setOpen(false);
  };

  if (!open) return null;
  // Each place carries a key; the finder draws it, moves the choice with ↑↓ and takes it with Enter.
  // No sign in front of a name: the group's title says what kind of place it is (no emoji in the
  // interface; the 🏢 🕘 📄 marks went on 2026-10-16).
  const place = (it) => ({ ...it, key: it.kind + (it.orgId || '') + (it.wsId || '') + it.label });

  // The large dialog: a search is read in its results, and a hit's sentence and ids need the width
  // (it was the 560px default, which Jouni found too small to work in, 2026-10-16).
  return html`
    <${Modal} open=${open} onClose=${() => setOpen(false)} title=${t('search.paletteTitle') || 'Search everything'}
      guard=${false} size="lg">
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
