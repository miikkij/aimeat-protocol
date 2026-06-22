/**
 * @file panels.js
 * @description Small standalone organism panels: OrgSearch (content search across a member's
 *   readable workspaces), IncomingInvitations (pending invites banner with Accept/Decline), and
 *   BoardPreview (embedded organism board: latest posts + composer). Extracted from organisms-tab.js
 *   with no behaviour change.
 * @structure OrgSearch, IncomingInvitations, BoardPreview
 * @usage import { OrgSearch, IncomingInvitations, BoardPreview } from '/views/profile/organisms/panels.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 *   v1.1.0 — 2026-06-22 — OrgSearch: instant (debounced) indexed search, results grouped by workspace,
 *     and clicking a hit deep-links to the exact record/document (via the workspace openDoc handoff).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner } from '/views/profile/shared.js';
import { EmptyState } from '/components/EmptyState.js';
import * as orgService from '/js/services/organisms.js';
import { listPosts, createPost } from '/js/services/boards.js';
import { copyToClipboard } from '/js/utils.js';
import { relTime } from '/views/profile/organisms/helpers.js';

/**
 * Content search inside an organism — case-insensitive substring over the records + documents of
 * every workspace the member can read. Backend: GET /v1/organisms/:id/search. Rendered in the
 * expanded card for members; opening a hit takes the user to that workspace.
 */
export function OrgSearch({ orgId, onOpenWorkspace }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);

  // Instant (debounced) search across the organism — indexed FTS backend (GET /:id/search).
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults(null); setBusy(false); return undefined; }
    let cancelled = false;
    setBusy(true);
    const tid = setTimeout(async () => {
      try { const r = await orgService.searchOrganism(orgId, query); if (!cancelled) setResults(r?.data?.results || []); }
      catch { if (!cancelled) setResults([]); }
      finally { if (!cancelled) setBusy(false); }
    }, 220);
    return () => { cancelled = true; clearTimeout(tid); };
  }, [q, orgId]);

  // Open a hit at the exact record/document: stash the deep-link the workspace reads on mount, then
  // navigate to that workspace (its openDoc effect resolves namespace → space tab + opens the item).
  const openHit = (r) => {
    try { sessionStorage.setItem(`aimeat.ws.${orgId}.${r.ws}.openDoc`, JSON.stringify({ namespace: r.namespace, id: r.id })); } catch { /* noop */ }
    onOpenWorkspace?.(r.ws);
  };

  // Group hits by workspace so a big organism's results stay legible.
  const byWs = {};
  for (const r of (results || [])) (byWs[r.ws] = byWs[r.ws] || { name: r.wsName || r.ws, hits: [] }).hits.push(r);

  return html`
    <div class="pj-orgsearch">
      <div class="flex-row-wrap">
        <input class="input-field input-sm pj-orgsearch-input" placeholder=${t('organisms.searchPlaceholder') || 'Find records & documents…'} value=${q}
          onInput=${(e) => setQ(e.target.value)} />
        ${busy ? html`<${Spinner} />` : null}
        ${results !== null ? html`<button class="btn-ghost btn-sm" onClick=${() => setQ('')}>${t('search.clear') || 'Clear'}</button>` : null}
      </div>
      ${results !== null && results.length === 0 && !busy ? html`<div class="section-desc">${t('search.noMatches') || 'No matches.'}</div>` : null}
      ${Object.entries(byWs).map(([ws, grp]) => html`
        <div class="pj-search-group" key=${ws}>
          <div class="pj-search-group-head">${(grp.name)}<span class="pj-org-tab-count">${grp.hits.length}</span></div>
          ${grp.hits.map(r => html`
            <button class="pj-search-hit" key=${r.space + '/' + r.id} onClick=${() => openHit(r)}>
              <span class="pj-search-hit-title">${(r.title)} <span class="pj-mini">· ${(r.space)}</span></span>
              <span class="pj-search-hit-snippet">${(r.snippet)}</span>
            </button>`)}
        </div>`)}
    </div>
  `;
}

/**
 * Banner listing the caller's pending organism invitations (status `invited`) across all
 * organisms, with Accept / Decline. Invited organisms are not in the member's active list, so
 * this is how an invitee discovers them. Backend: GET /v1/organisms/invitations/mine.
 */
export function IncomingInvitations({ showToast, onChanged }) {
  const [invites, setInvites] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await orgService.listMyInvitations().catch(() => null);
    setInvites(r?.data?.invitations || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => onLiveUpdate(['organisms'], () => liveRef.current()), []);
  const act = async (id, accept) => {
    setBusy(true);
    try {
      const r = accept ? await orgService.acceptInvitation(id) : await orgService.declineInvitation(id);
      if (r?.ok === false) showToast(r?.error?.message || (t('organisms.inviteActionFailed') || 'Failed'));
      else showToast(accept ? (t('organisms.invitationAccepted') || 'Joined') : (t('organisms.invitationDeclined') || 'Declined'));
      await load(); onChanged?.();
    } catch (e) { showToast((e && e.message) || (t('organisms.inviteActionFailed') || 'Failed')); }
    finally { setBusy(false); }
  };
  if (!invites.length) return null;
  return html`
    <div class="card">
      <div class="section-title">${t('organisms.youAreInvited') || 'You’re invited'}</div>
      ${invites.map(({ membership, organism }) => html`
        <div class="pj-access-row" key=${organism.id}>
          <span><b>${(organism.name)}</b>${membership.invitedBy ? html` <span class="pj-mini">— ${(t('organisms.invitedByLabel') || 'invited by {who}').replace('{who}', (membership.invitedBy))}</span>` : null}</span>
          <span class="flex-row-wrap">
            <button class="btn-success btn-sm" disabled=${busy} onClick=${() => act(organism.id, true)}>${t('organisms.acceptInvite') || 'Accept'}</button>
            <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => act(organism.id, false)}>${t('organisms.declineInvite') || 'Decline'}</button>
          </span>
        </div>
      `)}
    </div>
  `;
}

/* Board tab — embedded preview of the organism's discussion board: latest posts + a composer,
 * with "Open in Boards" for the full view. The raw board UUID hides behind a copy icon. */
export function BoardPreview({ boardId, showToast }) {
  const [posts, setPosts] = useState(null);   // null = loading
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listPosts(boardId).then(p => setPosts(Array.isArray(p) ? p : [])).catch(() => setPosts([]));
  }, [boardId]);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => onLiveUpdate(['organisms'], () => liveRef.current()), []);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      const r = await createPost(boardId, body);
      if (r?.ok === false) showToast(r?.error?.message || 'Failed to post');
      else { setText(''); load(); }
    } catch (e) { showToast((e && e.message) || 'Failed to post'); }
    finally { setBusy(false); }
  };
  const copyId = async () => {
    const ok = await copyToClipboard(boardId);
    showToast(ok ? (t('organisms.copied') || 'Copied') : (t('organisms.copyFailed') || 'Could not copy'));
  };

  const ts = (p) => p.created_at || p.createdAt || p.at || '';
  const latest = [...(posts || [])].sort((a, b) => String(ts(b)).localeCompare(String(ts(a)))).slice(0, 5);

  return html`
    <div class="card-detail">
      <div class="pj-tabhead">
        <div class="section-desc pj-tabhead-desc">${t('organisms.boardPreviewDesc') || 'Latest messages on this organism’s board.'}</div>
        <button class="pj-icon-btn" title=${(t('organisms.copyId') || 'Copy ID') + ': ' + boardId} onClick=${copyId}>${'📋'}</button>
        <button class="btn-outline btn-sm" onClick=${() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'boards' } }))}>
          ${t('organisms.openBoardsTab') || 'Open in Boards'}</button>
      </div>
      ${posts === null ? html`<${Spinner} />`
        : latest.length === 0 ? html`<${EmptyState} icon="💬" text=${t('organisms.boardEmpty') || 'No messages yet — write the first one.'} />`
        : latest.map(p => html`
          <div class="pj-board-post" key=${p.id || ts(p)}>
            <div class="pj-board-post-head">
              <span class="pj-board-author">${(p.author_gaii || p.author || '?')}</span>
              ${ts(p) ? html`<span class="pj-board-time">${relTime(ts(p))}</span>` : null}
            </div>
            <div class="pj-board-body">${(String(p.body || p.content || '').slice(0, 400))}</div>
          </div>`)}
      <div class="flex-row-wrap pj-board-composer">
        <input class="input-field input-sm pj-board-input" placeholder=${t('organisms.writePost') || 'Write a message…'} value=${text}
          onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') send(); }} />
        <button class="btn-outline btn-sm" disabled=${busy || !text.trim()} onClick=${send}>${t('organisms.send') || 'Send'}</button>
      </div>
    </div>`;
}
