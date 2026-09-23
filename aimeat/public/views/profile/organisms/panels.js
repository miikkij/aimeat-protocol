/**
 * @file panels.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Small standalone organism panels: OrgSearch (content search across a member's
 *   readable workspaces), IncomingInvitations (pending invites banner with Accept/Decline), and
 *   BoardPreview (embedded organism board: latest posts + composer). Extracted from organisms-tab.js
 *   with no behaviour change.
 * @structure OrgSearch, IncomingInvitations, BoardPreview
 * @usage import { OrgSearch, IncomingInvitations, BoardPreview } from '/views/profile/organisms/panels.js';
 * @version-history
 *   2026-09-22 -- An invitation's Accept carries the success tone and Decline the danger tone.
 *   2026-09-22 -- Composed from the shared set (Section, ListRow, Field, Action): no class of its own; the
 *     board's copy-ID clipboard emoji is the worded action, the invitations banner is a selected Section.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 *   v1.1.0 — 2026-06-22 — OrgSearch: instant (debounced) indexed search, results grouped by workspace,
 *     and clicking a hit deep-links to the exact record/document (via the workspace openDoc handoff).
 *   v1.2.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Stack, ListRow, Action, Field, Text, Toolbar } from '/components/poster-parts.js';
import * as orgService from '/js/services/organisms.js';
import { listPosts, createPost } from '/js/services/boards.js';
import { copyToClipboard } from '/js/utils.js';
import { relTime } from '/views/profile/organisms/helpers.js';
import { swallowed } from '/js/swallowed.js';

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
      catch (err) { swallowed('panels', err); if (!cancelled) setResults([]); }
      finally { if (!cancelled) setBusy(false); }
    }, 220);
    return () => { cancelled = true; clearTimeout(tid); };
  }, [q, orgId]);

  // Open a hit at the exact record/document: stash the deep-link the workspace reads on mount, then
  // navigate to that workspace (its openDoc effect resolves namespace → space tab + opens the item).
  const openHit = (r) => {
    try { sessionStorage.setItem(`aimeat.ws.${orgId}.${r.ws}.openDoc`, JSON.stringify({ namespace: r.namespace, id: r.id })); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
    onOpenWorkspace?.(r.ws);
  };

  // Group hits by workspace so a big organism's results stay legible.
  const byWs = {};
  for (const r of (results || [])) (byWs[r.ws] = byWs[r.ws] || { name: r.wsName || r.ws, hits: [] }).hits.push(r);

  return html`<${Stack} density="compact">
    <${Toolbar} label=${t('organisms.searchPlaceholder') || 'Find records & documents…'}
      search=${{ label: t('organisms.searchPlaceholder') || 'Find records & documents…', value: q, onInput: (e) => setQ(e.target.value) }}
      count=${busy ? (t('search.searching') || 'Searching…') : null}
      actions=${results !== null ? html`<${Action} onClick=${() => setQ('')}>${t('search.clear') || 'Clear'}<//>` : null} />
    ${results !== null && results.length === 0 && !busy ? html`<${Text} kind="caption" tone="muted">${t('search.noMatches') || 'No matches.'}<//>` : null}
    ${Object.entries(byWs).map(([ws, grp]) => html`
      <${Stack} key=${ws} density="compact">
        <${Text} kind="label">${grp.name} ${grp.hits.length}<//>
        ${grp.hits.map(r => html`<${ListRow} key=${r.space + '/' + r.id} density="compact" preview=${true} onOpen=${() => openHit(r)}
          name=${`${r.title} · ${r.space}`} detail=${r.snippet} />`)}
      <//>`)}
  <//>`;
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
    const r = await orgService.listMyInvitations().catch(err => { swallowed('panels: IncomingInvitations', err); return null; });
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
    <${Section} title=${t('organisms.youAreInvited') || 'You’re invited'} count=${invites.length} selected=${true} density="compact">
      <${Stack} density="compact">
        ${invites.map(({ membership, organism }) => html`
          <${ListRow} key=${organism.id} density="compact" detailKind="text" name=${organism.name}
            detail=${membership.invitedBy ? `— ${(t('organisms.invitedByLabel') || 'invited by {who}').replace('{who}', membership.invitedBy)}` : undefined}
            actions=${html`<${Action} tone="success" disabled=${busy} onClick=${() => act(organism.id, true)}>${t('organisms.acceptInvite') || 'Accept'}<//>
              <${Action} kind="text" tone="danger" disabled=${busy} onClick=${() => act(organism.id, false)}>${t('organisms.declineInvite') || 'Decline'}<//>`} />`)}
      <//>
    <//>`;
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
    showToast(ok ? (t('common.copied') || 'Copied') : (t('organisms.copyFailed') || 'Could not copy'));
  };

  const ts = (p) => p.created_at || p.createdAt || p.at || '';
  const latest = [...(posts || [])].sort((a, b) => String(ts(b)).localeCompare(String(ts(a)))).slice(0, 5);

  return html`<${Stack}>
    <${Stack} direction="wrap" align="between">
      <${Text} tone="muted">${t('organisms.boardPreviewDesc') || 'Latest messages on this organism’s board.'}<//>
      <${Stack} direction="wrap" align="center">
        <${Action} kind="text" title=${(t('organisms.copyId') || 'Copy ID') + ': ' + boardId} onClick=${copyId}>${t('organisms.copyId') || 'Copy ID'}<//>
        <${Action} onClick=${() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'boards' } }))}>
          ${t('organisms.openBoardsTab') || 'Open in Boards'}<//>
      <//>
    <//>
    ${posts === null ? html`<${Text} tone="muted">${t('profile.loading')}<//>`
      : latest.length === 0 ? html`<${Text} tone="muted">${t('organisms.boardEmpty') || 'No messages yet — write the first one.'}<//>`
      : html`<${Stack} density="compact">${latest.map(p => html`
        <${ListRow} key=${p.id || ts(p)} density="compact" preview=${true}
          name=${p.author_gaii || p.author || '?'} value=${ts(p) ? relTime(ts(p)) : undefined}
          detail=${String(p.body || p.content || '').slice(0, 400)} />`)}<//>`}
    <${Toolbar} label=${t('organisms.writePost') || 'Write a message…'}
      actions=${html`<${Action} disabled=${busy || !text.trim()} onClick=${send}>${t('organisms.send') || 'Send'}<//>`}>
      <${Field} placeholder=${t('organisms.writePost') || 'Write a message…'} value=${text}
        onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') send(); }} />
    <//>
  <//>`;
}
