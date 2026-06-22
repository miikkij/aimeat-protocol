/**
 * @file command-palette.js
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
 *   v1.0.0 — 2026-06-22 — Initial: Cmd-K quick-switcher over librarian search + organism names + recents.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Modal } from '/components/Modal.js';
import { SearchBar } from '/components/SearchBar.js';
import { Spinner } from '/components/Spinner.js';
import { EmptyState } from '/components/EmptyState.js';
import { librarianSearch } from '/js/services/memory.js';
import { listOrganisms } from '/js/services/organisms.js';
import { getOwner } from '/js/services/auth.js';
import { listRecents } from '/js/recents.js';

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
  } catch { /* private mode — the route fallback still works */ }
  try {
    window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'organisms' } }));
    window.dispatchEvent(new CustomEvent('aimeat-open-organism', { detail: { orgId, wsId: wsId || null } }));
  } catch { /* noop */ }
  if (!location.pathname.startsWith('/v1/profile')) navigate('/v1/profile?tab=organisms');
}

export function CommandPalette({ navigate }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);     // librarian content hits
  const [orgs, setOrgs] = useState([]);       // caller's organisms (for name match)
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

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

  // On open: load recents + the caller's organisms (for name matching), focus the input.
  useEffect(() => {
    if (!open) { setQ(''); setHits(null); setSel(0); return; }
    const me = getOwner();
    if (me) listOrganisms({ member: me }).then(r => setOrgs((r?.data?.organisms) || [])).catch(() => {});
    setTimeout(() => inputRef.current?.querySelector('input')?.focus(), 30);
  }, [open]);

  // Debounced content search.
  useEffect(() => {
    if (!open) return undefined;
    const query = q.trim();
    if (query.length < 2) { setHits(null); setBusy(false); return undefined; }
    let cancelled = false;
    setBusy(true);
    const tid = setTimeout(async () => {
      const r = await librarianSearch(query, 30, 'own').catch(() => []);
      if (!cancelled) { setHits(r || []); setBusy(false); setSel(0); }
    }, 200);
    return () => { cancelled = true; clearTimeout(tid); };
  }, [q, open]);

  const orgName = useCallback((id) => orgs.find(o => o.id === id)?.name || id, [orgs]);

  // Build a flat, selectable item list (with group headers derived for rendering).
  const query = q.trim();
  const orgMatches = query.length >= 2
    ? orgs.filter(o => (o.name || '').toLowerCase().includes(query.toLowerCase())).slice(0, 6)
        .map(o => ({ kind: 'org', orgId: o.id, label: o.name, sub: t(`organisms.types.${o.type}`) || o.type }))
    : [];
  const contentItems = (hits || []).map(hh => ({
    kind: 'hit', orgId: hh.organismId, wsId: hh.workspaceId, label: hh.title || hh.key,
    sub: [orgName(hh.organismId), hh.workspaceId, hh.space].filter(Boolean).join(' · '), snippet: hh.snippet,
  })).filter(it => it.orgId);
  const recents = (!query) ? listRecents(8).filter(r => r.type === 'workspace' && r.data?.orgId)
    .map(r => ({ kind: 'recent', orgId: r.data.orgId, wsId: r.data.wsId, label: r.label, sub: r.sub })) : [];
  const items = [...orgMatches, ...contentItems, ...recents];

  const choose = (it) => {
    if (!it) return;
    openTarget(navigate, { orgId: it.orgId, wsId: it.wsId, query: it.kind === 'hit' ? query : '' });
    setOpen(false);
  };
  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(items[sel]); }
  };

  if (!open) return null;
  let idx = -1;
  const row = (it) => { idx++; const i = idx; return html`
    <button class=${'cmdk-item' + (i === sel ? ' is-sel' : '')} key=${it.kind + (it.orgId || '') + (it.wsId || '') + it.label}
      onMouseEnter=${() => setSel(i)} onClick=${() => choose(it)}>
      <span class="cmdk-item-label">${it.kind === 'org' ? '🏢 ' : it.kind === 'recent' ? '🕘 ' : '📄 '}${it.label}</span>
      ${it.sub ? html`<span class="cmdk-item-sub">${it.sub}</span>` : null}
      ${it.snippet ? html`<span class="cmdk-item-snippet">${it.snippet}</span>` : null}
    </button>`; };

  return html`
    <${Modal} open=${open} onClose=${() => setOpen(false)} title=${t('search.paletteTitle') || 'Search everything'} className="cmdk-modal">
      <div class="cmdk" ref=${inputRef} onKeyDown=${onInputKey}>
        <${SearchBar} value=${q} onInput=${e => setQ(e.target.value)} placeholder=${t('search.palettePlaceholder') || 'Search organisms, workspaces, records…'} />
        <div class="cmdk-hint section-desc">${t('search.openHint') || '↵ open · Esc close'}</div>
        <div class="cmdk-list">
          ${busy && !items.length ? html`<${Spinner} text=${t('search.searching') || 'Searching…'} />` : null}
          ${!busy && query.length >= 2 && !items.length ? html`<${EmptyState} text=${t('search.noMatches') || 'No matches'} />` : null}
          ${orgMatches.length ? html`<div class="cmdk-group">${t('organisms.title') || 'Organisms'}</div>` : null}
          ${orgMatches.map(row)}
          ${contentItems.length ? html`<div class="cmdk-group">${t('search.results') || 'Results'}</div>` : null}
          ${contentItems.map(row)}
          ${recents.length ? html`<div class="cmdk-group">${t('search.recents') || 'Recent'}</div>` : null}
          ${recents.map(row)}
        </div>
      </div>
    </${Modal}>`;
}
