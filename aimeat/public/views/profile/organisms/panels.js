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
 *   v1.14.0 -- 2026-09-26 -- Every part is a kit component (page group G2a): the search is the Search line with its loading mark and Clear, its hits the List under a Group heading per workspace (a hit's name opens it, its space a tag, its snippet the line under); the invitations the List with "invited by" as the small grey words beside the name; the board preview a Split with the Row of its description, the copy Icon and Open in Boards (openTab), and its composer the TextField with Send beside it (Enter sends). The page writes no class.
 *   v1.13.0 -- 2026-09-26 -- The board preview's messages are the BoardNotice component (components/BoardNotice.js): the same markup and look, given as data.
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
import { BoardNotice } from '/components/BoardNotice.js';
import { PageSection } from '/components/PageSection.js';
import { List, Row as ListRow, Name, Doors, Group, SearchLine } from '/components/List.js';
import { Action, Icon } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { HeadDesc } from '/components/SubHeading.js';
import { Row, Split, Space } from '/components/Layout.js';
import { TextField } from '/components/TextField.js';
import { openTab } from '/components/Rail.js';
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
    <${SearchLine} text value=${q} onInput=${(e) => setQ(e.target.value)} placeholder=${t('organisms.searchPlaceholder') || 'Find records & documents…'}>
      ${busy ? html`<${Note} kind="loading" inline>${t('profile.loading')}<//>` : null}
      ${results !== null ? html`<${Action} small onClick=${() => setQ('')}>${t('search.clear') || 'Clear'}<//>` : null}
    <//>
    ${results !== null && results.length === 0 && !busy ? html`<${HeadDesc}>${t('search.noMatches') || 'No matches.'}<//>` : null}
    ${Object.entries(byWs).map(([ws, grp]) => html`
      <${Group} key=${ws} title=${(grp.name)} count=${grp.hits.length}>
        <${List} cols="name">
          ${grp.hits.map(r => html`
            <${ListRow} key=${r.space + '/' + r.id}>
              <${Name} onOpen=${() => openHit(r)} after=${html` <${Mark}>${(r.space)}<//>`} desc=${(r.snippet)}>${(r.title)}<//>
            <//>`)}
        <//>
      <//>`)}
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
      <${List} cols="name-doors" keepCols>
        ${invites.map(({ membership, organism }) => html`
          <${ListRow} key=${organism.id}>
            <${Name} after=${membership.invitedBy ? html` <${Note} kind="meta" inline>— ${(t('organisms.invitedByLabel') || 'invited by {who}').replace('{who}', (membership.invitedBy))}<//>` : null}>${(organism.name)}<//>
            <${Doors}>
              <${Action} small row disabled=${busy} onClick=${() => act(organism.id, true)}>${t('organisms.acceptInvite') || 'Accept'}<//>
              <${Action} small row disabled=${busy} onClick=${() => act(organism.id, false)}>${t('organisms.declineInvite') || 'Decline'}<//>
            <//>
          <//>
        `)}
      <//>
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
    <${Split}>
      <${Row} align="start" gap="medium">
        <${HeadDesc}>${t('organisms.boardPreviewDesc') || 'Latest messages on this organism’s board.'}<//>
        <${Icon} small title=${(t('organisms.copyId') || 'Copy ID') + ': ' + boardId} label=${t('organisms.copyId') || 'Copy ID'} onClick=${copyId}>${'📋'}<//>
        <${Action} small onClick=${() => openTab('boards')}>${t('organisms.openBoardsTab') || 'Open in Boards'}<//>
      <//>
      ${posts === null ? html`<${Note} kind="loading" />`
        : latest.length === 0 ? html`<${Note} kind="quiet">${t('organisms.boardEmpty') || 'No messages yet — write the first one.'}<//>`
        : latest.map(p => html`<${BoardNotice} key=${p.id || ts(p)} kind=${p.category || null}
            words=${String(p.body || p.content || '').slice(0, 400)} who=${p.author_gaii || p.author || '?'}
            time=${ts(p) ? relTime(ts(p)) : null} />`)}
      <${Space} above="medium">
        <${TextField} placeholder=${t('organisms.writePost') || 'Write a message…'} ariaLabel=${t('organisms.writePost') || 'Write a message…'}
          value=${text} onInput=${setText} onEnter=${send}
          actions=${html`<${Action} small disabled=${busy || !text.trim()} onClick=${send}>${t('organisms.send') || 'Send'}<//>`} />
      <//>
    <//>`;
}
