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
 *   v1.12.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.11.0 -- 2026-09-26 -- The board preview's messages are the Board notices (css/components/board-notices.css): the category or a grey dot, the words, who wrote it in typewriter, the time at the right; a rule under each (a unification: the library part that carries the kind).
 *   v1.10.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- The incoming invitations are the Listing (css/components/listing.css), a unification: the look most tabs use. The search hits stay: the line under a title is in the body face, an open conflict.
 *   v1.8.0 -- 2026-09-25 -- A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.7.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.6.0 -- 2026-09-25 -- A section is the kit's section (PageSection in an .og page) and the line under its title is the lead (.og-lead), the look most tabs use (a unification).
 *   v1.5.0 -- 2026-09-25 -- Every small number is the Count (.poster-count waiting or tally), a unification: Jouni's decision Count.
 *   v1.4.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.3.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.2.0 — 2026-09-25 — A button that is a mark, not a word (a delete or close mark, a menu's dots,
 *     an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's decision
 *     "Icon button").
 *   v1.1.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { LoadingLine } from '/views/profile/shared.js';
import { QuietNote } from '/components/QuietNote.js';
import { PageSection } from '/components/PageSection.js';
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

  return html`
    <div class="pj-orgsearch">
      <div class="search-line">
        <input class="og-input" placeholder=${t('organisms.searchPlaceholder') || 'Find records & documents…'} value=${q}
          onInput=${(e) => setQ(e.target.value)} />
        ${busy ? html`<span class="poster-quiet loading-mark">${t('profile.loading')}</span>` : null}
        ${results !== null ? html`<button class="poster-action poster-action--small" onClick=${() => setQ('')}>${t('search.clear') || 'Clear'}</button>` : null}
      </div>
      ${results !== null && results.length === 0 && !busy ? html`<div class="section-desc">${t('search.noMatches') || 'No matches.'}</div>` : null}
      ${Object.entries(byWs).map(([ws, grp]) => html`
        <div class="pj-search-group" key=${ws}>
          <div class="pj-search-group-head poster-day-title">${(grp.name)}<span class="poster-count poster-count--tally">${grp.hits.length}</span></div>
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
    <${PageSection} title=${t('organisms.youAreInvited') || 'You’re invited'}>
      <div class="listing listing--name-doors listing--cols">
        ${invites.map(({ membership, organism }) => html`
          <div class="listing-row" key=${organism.id}>
            <div class="listing-name"><b>${(organism.name)}</b>${membership.invitedBy ? html` <span class="pj-mini">— ${(t('organisms.invitedByLabel') || 'invited by {who}').replace('{who}', (membership.invitedBy))}</span>` : null}</div>
            <div class="listing-doors">
              <button class="poster-action poster-action--small poster-action--row" disabled=${busy} onClick=${() => act(organism.id, true)}>${t('organisms.acceptInvite') || 'Accept'}</button>
              <button class="poster-action poster-action--small poster-action--row" disabled=${busy} onClick=${() => act(organism.id, false)}>${t('organisms.declineInvite') || 'Decline'}</button>
            </div>
          </div>
        `)}
      </div>
    <//>
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
    showToast(ok ? (t('common.copied') || 'Copied') : (t('organisms.copyFailed') || 'Could not copy'));
  };

  const ts = (p) => p.created_at || p.createdAt || p.at || '';
  const latest = [...(posts || [])].sort((a, b) => String(ts(b)).localeCompare(String(ts(a)))).slice(0, 5);

  return html`
    <div class="card-detail">
      <div class="pj-tabhead">
        <div class="section-desc pj-tabhead-desc">${t('organisms.boardPreviewDesc') || 'Latest messages on this organism’s board.'}</div>
        <button class="poster-icon poster-icon--small" title=${(t('organisms.copyId') || 'Copy ID') + ': ' + boardId} onClick=${copyId}>${'📋'}</button>
        <button class="poster-action poster-action--small" onClick=${() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'boards' } }))}>
          ${t('organisms.openBoardsTab') || 'Open in Boards'}</button>
      </div>
      ${posts === null ? html`<${LoadingLine} />`
        : latest.length === 0 ? html`<${QuietNote}>${t('organisms.boardEmpty') || 'No messages yet — write the first one.'}<//>`
        : latest.map(p => html`
          <div class="bp-notice" key=${p.id || ts(p)}>
            <div class=${`bp-cat ${p.category ? '' : 'bp-cat--q'}`}>${p.category ? html`<span class="poster-chip">${p.category}</span>` : '·'}</div>
            <div class="bp-notice-body">
              <p>${(String(p.body || p.content || '').slice(0, 400))}</p>
              <div class="bp-who"><b>${(p.author_gaii || p.author || '?')}</b></div>
            </div>
            <div class="bp-r">${ts(p) ? html`<b class="poster-time">${relTime(ts(p))}</b>` : null}</div>
          </div>`)}
      <div class="flex-row-wrap pj-board-composer">
        <input class="og-input pj-board-input" placeholder=${t('organisms.writePost') || 'Write a message…'} value=${text}
          onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') send(); }} />
        <button class="poster-action poster-action--small" disabled=${busy || !text.trim()} onClick=${send}>${t('organisms.send') || 'Send'}</button>
      </div>
    </div>`;
}
