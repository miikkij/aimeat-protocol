/**
 * @file inbox-tab.js
 * @description Profile Inbox tab — human↔human direct messaging UI. A two-pane messenger: a
 *   conversation/request list (avatars, last-message preview, time, unread pill) and a thread pane
 *   with date-grouped chat bubbles (left = received / right = sent, with delivery-status ticks),
 *   markdown bodies via the shared Markdown renderer (cid: inline media resolved to the recipient's
 *   local copies; external <img> stripped as a tracking-pixel defense). The composer is the same
 *   Toast UI editor used by workspace documents (Markdown⇄WYSIWYG toggle, lazy-loaded), with a
 *   markdown-textarea + live-preview fallback. First contact is gated as a request (accept/block).
 *   Re-fetches on SSE updates.
 * @structure InboxTab (default, stateful container) · panels (ListPanel/ThreadPanel/TrackedPanel/ResultsPanel
 *   in ./inbox-tab/panels.js) · sub-components (Composer/MessageBubble/ReplyWithAiPopover/… in
 *   ./inbox-tab/components.js) · pure helpers (./inbox-tab/helpers.js) · thread UX hooks
 *   (./inbox-tab/use-thread-ux.js)
 * @usage Lazy-loaded profile tab; registered in profile.js TABS as id `messages`.
 * @version-history
 *   v1.24.0 -- 2026-07-19 -- Conversation → Notebook (📓 on the thread head next to ✨): summarize the
 *     whole thread — with its images — and park it into the Notebook for filing/enrichment. Three modes:
 *     server-side AI summary (owner's OpenRouter key, vision-aware), copy-prompt (own chat), or raw.
 *   v1.23.1 -- 2026-07-19 -- Fix "badge shows N new but the open thread never updates": a 'messages'
 *     live-update now ALWAYS reloads the open thread (dropped the isComposingInThread guard that skipped
 *     the whole reload while an editable was focused, so incoming messages stayed invisible until
 *     send/reopen). Scroll-yank-while-typing is handled in useThreadAutoScroll instead (css/use-thread-ux v1.2.0).
 *   v1.23.0 -- 2026-07-18 -- ↩ Reply on a bubble focuses the composer (`composerFocus`→Composer.focusNonce);
 *     root gets `inbox--panel` so ≤760px drops the section header for a near-full-viewport thread (css v1.4.0).
 *   v1.22.0 -- 2026-07-17 -- Reply-to with quote (↩ on a bubble quotes the message into the reply via
 *     `reply_to`; bubbles render their quoted original) + mobile thread ergonomics: the messenger shrinks
 *     above the on-screen keyboard (visualViewport → --inbox-kb), focusing the composer scrolls it into
 *     view, and a NEW message auto-scrolls the thread down once (a single jump — scrolling back up is
 *     never fought). Drops the stale ≤760px `.inbox-msgs{max-height:50vh}` cap from the old stacked layout.
 *   v1.21.0 -- 2026-07-17 -- Mobile single-pane on ≤760px: shows the list OR an open thread/composer
 *     full-width (mode!=='idle' ⇒ `.inbox-body--panel`) with a ← Back button. Desktop two-pane unchanged.
 *   v1.20.1 -- 2026-07-17 -- Fix images bleeding between messages: attachment url map keyed by `msgId::attId` (per-message ids at0/at1… repeat across messages).
 *   v1.20.0 -- 2026-07-16 -- Compose "to" field is the shared ContactPicker (contacts + directory
 *     suggestions + email resolve, valueMode 'full'); the datalist remains for the broadcast picker.
 *   v1.19.0 -- 2026-07-16 -- Mount folds the 6-request fan-out into ONE GET /v1/messages/overview
 *     (MessagesInboxService composite); interactive refreshes keep the individual loaders. Falls back to
 *     the per-endpoint loaders if the composite fails. (Phase 4 slice 1 — frontend half.)
 *   v1.18.0 -- 2026-07-13 -- Split for max-file-lines: pure helpers → ./inbox-tab/helpers.js, presentational
 *     sub-components → ./inbox-tab/components.js, and the render panels (list/thread/tracked/results) →
 *     ./inbox-tab/panels.js as prop-driven components. Behavior/hooks unchanged; InboxTab keeps all state.
 *   v1.17.0 -- 2026-07-12 -- Owner-aggregation: the list also shows conversations one of the owner's OWN
 *     agents had with external people (tagged `viaAgent`, labelled "via <agent>"), opened READ-ONLY (no
 *     composer/receipt) via GET conversations/:id?agent=<gaii>.
 *   v1.16.0 -- 2026-07-12 -- Peer display names (TARGET-031 part A): thread head / list / group headers /
 *     requests show "display name (handle)" — "Kalle (kkk)" — resolved once per peer (agents via
 *     /v1/agents/:gaii, humans via /v1/ghii/:ghii) and cached; federated peers keep the bare handle.
 *   v1.15.0 -- 2026-07-12 -- Reply with AI (TARGET-031): ✨ on the thread head + each bubble hands the
 *     conversation/message to the user's own AI chat (COPY prompt or MCP mode); prompts in /js/services/messages-ai-prompts.js.
 *   v1.14.0 -- 2026-06-23 -- Per-message 📓 action parks a message straight into the notebook for later
 *     processing (instant copy via parkMessageToNotebook — keeps the source link + reply intent; no AI step).
 *   v1.13.0 -- 2026-06-23 -- Agent capabilities in chat: (A) a peer agent's `chat.commands` render as
 *     fill-in command chips above the composer; (B) a 📅 schedule panel for the human's OWN agents (recurring agent_task).
 *   v1.12.1 -- 2026-06-23 -- Operator broadcast audience is now a select: All node users OR All federation
 *     users (genesis operator → every owner across the federation; delegated per-peer fan-out server-side).
 *   v1.12.0 -- 2026-06-23 -- Operator broadcast: an operator sees an "📣 All node users" audience in the
 *     broadcast compose (sends audience:'node-users', gated operator-only server-side) — e.g. a node-wide
 *     announcement. Announcement read stats are in the existing Results view (delivered/read per recipient).
 *   v1.11.0 -- 2026-06-23 -- Inbox-links: the tab reads ?to=<id[,id]>&subject= on mount and opens a
 *     prefilled compose (single) or broadcast (multiple), then clears the URL. Pairs with the reusable
 *     <InboxLink> component (mailto-style one-click DM), wired into the agent profile.
 *   v1.10.0 -- 2026-06-23 -- Drafts: the composer auto-saves its text (debounced) to localStorage keyed by
 *     conversation (or `new`), restoring it when you reopen the thread/compose so an in-progress message
 *     isn't lost when switching threads; cleared on send. A suggested reply (Tracked Response) still wins.
 *   v1.9.0 -- 2026-06-23 -- Polls: the broadcast compose gains a Message/Poll toggle + a PollBuilder
 *     (questions, options, multi/Other/required) that fans out an interactive AskUserQuestion to the
 *     audience; a Results view aggregates per-option tallies + delivered/read/answered counts. Sent
 *     broadcasts are tracked in localStorage so results stay re-accessible (📊 Results).
 *   v1.8.1 -- 2026-06-23 -- Perf: cache resolved attachment URLs per conversation so a refresh / new
 *     message only fetches not-yet-resolved attachments (was re-downloading every image — hundreds of MB).
 *   v1.8.0 -- 2026-06-23 -- Send-to-many (broadcast): a 📢 Broadcast compose with a recipient-chip picker
 *     (+ Share Group audience) and a mode toggle — Message (repliable) vs Announcement (read-only). An
 *     announcement thread hides the reply composer for the recipient.
 *   v1.7.4 -- 2026-06-23 -- Recipient suggestions when composing: the "to" field autocompletes (datalist)
 *     with your own agents (GAIIs, labelled) + everyone you have a thread with — no retyping long GAIIs.
 *   v1.7.3 -- 2026-06-23 -- Show an AGENT's own presence dot on its nested conversation row (connected =
 *     available, recently-seen = away, else offline); the owner group header still shows the human's.
 *   v1.7.2 -- 2026-06-23 -- Delivery ticks distinguish delivered (✓✓ grey) / read (✓✓ coloured) / sent (✓)
 *     / queued (clock) — previously delivered looked identical to sent (agent DMs never send a read receipt).
 *   v1.7.1 -- 2026-06-23 -- Fix thread-splitting: a reply in an open thread now pins to that
 *     conversationId. Without it, replying in a SUBJECT thread fell back to the default per-pair thread,
 *     so the reply spawned a brand-new thread named after the agent (e.g. "concierge") and the subject
 *     thread was abandoned.
 *   v1.7.0 -- 2026-06-23 -- Interactive messages (federated AskUserQuestion): a question message renders
 *     inline as a form (radio/checkbox + "Other" + Submit, gated on required); submitting sends a normal
 *     reply carrying a human-readable summary + machine-readable `interactive.answers`. Answered questions
 *     show a read-only summary. (InteractiveForm/InteractiveAnswered + submitInteractiveAnswers.)
 *   v1.6.2 -- 2026-06-21 -- Fix live-update request storm: the SSE payload's `domains` is a Set, but
 *     the handler tested `Array.isArray(domains)` (always false) so the domain filter never matched and
 *     the inbox re-fetched its whole state on EVERY change (memory/organism/task churn from dozens of
 *     agents). Now branch on the Set: 'messages' → full refresh, 'agent-messages' → tracked-responses
 *     only (1 request, not 5).
 *   v1.6.1 -- 2026-06-21 -- Approve-mode fixes: the "reply ready" suggestion now renders as a dashed
 *     draft bubble (Open record · Reject · Approve & edit) and "Approve & edit" actually seeds the
 *     composer (the rich editor was initialising empty). Single header badge (no confusing double "1"),
 *     a record link to jump to the watched workspace record, cancel shows real errors + removes the row
 *     immediately, and SSE refreshes are debounced to stop the tracked-list flicker on multi-node nodes.
 *   v1.6.0 -- 2026-06-21 -- TrackResponseModal extracted to ./track-response-modal.js (shared with the
 *     Notebook) + a "park to notebook for later" action (keeps the message's source link + reply intent).
 *   v1.5.0 -- 2026-06-21 -- Track-a-response now forms the INTENT with AI (notebook classifier picks
 *     the organism/workspace + title/content; no AI key → feature disabled, no static guessing) and
 *     writes the record through the proper workspace draft→publish flow (real record type from the
 *     workspace manifest, schema-aware value, activity + publish gate) instead of a raw memory write.
 *   v1.4.1 -- 2026-06-21 -- Tracked Response UX: per-message "tracked" badge + state on the 🔗 action
 *     (clicking an already-tracked message surfaces it instead of duplicating); a "Tracked responses"
 *     dashboard (open / approve-now / cancel, with state badges); create-modal spinner + disabled
 *     buttons (and no close) while creating.
 *   v1.4.0 -- 2026-06-21 -- Two-tier message follow-up: ⭐ Important flag (Tier 1) + "Track a response"
 *     (Tier 2 — materialize a workspace record + bind a Tracked Response that replies when the work is
 *     done) + an approve-mode banner that pre-fills the composer with the suggested reply.
 *   v1.3.0 -- 2026-06-19 -- Show a presence dot next to peers (request rows, conversation list,
 *     thread header) via the shared <PresenceDot>.
 *   v1.2.0 -- 2026-06-16 -- Composer upgraded to the shared Toast UI editor (parity with the
 *     workspace document editor) + markdown-preview fallback.
 *   v1.1.0 -- 2026-06-16 -- Redesigned as a proper messenger (avatars, bubbles, ticks, dividers).
 *   v1.0.0 -- 2026-06-16 -- Initial creation for user-to-user messaging (layer 5).
 *   v1.3.1 -- 2026-06-19 -- JSDoc type annotations for frontend type-checking
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import * as messages from '/js/services/messages.js';
import * as tracked from '/js/services/tracked-responses.js';
import * as agentsSvc from '/js/services/agents.js';
import { parkMessageToNotebook } from '/js/services/notebook.js';
import { firstLine } from './notebook-helpers.js';
import { apiGet } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import { TrackResponseModal } from './track-response-modal.js';
import { peerLabel } from '/js/services/messages-ai-prompts.js';
import { peerName, ownerKeyOf, isAgentPeer, buildAnswerSummary } from './inbox-tab/helpers.js';
import { Composer, PollBuilder, MarkdownViewer, ReplyWithAiPopover, ConversationToNotebookPopover } from './inbox-tab/components.js';
import { buildConversationReplyProps, buildMessageReplyProps, buildConversationNotebookProps } from './inbox-tab/ai-actions.js';
import { ListPanel, ThreadPanel, TrackedPanel, ResultsPanel } from './inbox-tab/panels.js';
import { useThreadAutoScroll, useMobileComposerKeyboard, useLinkPreviewToggle } from './inbox-tab/use-thread-ux.js';
import { ContactPicker } from '/components/ContactPicker.js';

export default function InboxTab({ showToast }) {
  const [requests, setRequests] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);     // { conversationId, peerGhii }
  const [thread, setThread] = useState([]);
  const [urlMap, setUrlMap] = useState({});
  const { showLinkPreviews, toggleLinkPreviews } = useLinkPreviewToggle(); const [mdViewer, setMdViewer] = useState(null); // link-preview toggle (persisted) + markdown viewer state
  const [aiReply, setAiReply] = useState(null);           // { title, build } — Reply with AI popover (TARGET-031)
  const [nbConv, setNbConv] = useState(null);             // { title, promptText, runServerSummary, parkConversation } — Conversation → Notebook popover
  const [peerNames, setPeerNames] = useState({});         // id (GHII/GAII or owner@node) → resolved display name
  const peerNamesRef = useRef({});                        // dedup bookkeeping: an id present here was already looked up
  const [composeSubject, setComposeSubject] = useState(''); // optional subject → opens a new topic thread
  const [mode, setMode] = useState('idle');               // 'idle' | 'compose' | 'thread'
  const [to, setTo] = useState('');
  const [myAgents, setMyAgents] = useState([]);           // the owner's own agents (recipient suggestions)
  const [bcRecipients, setBcRecipients] = useState([]);   // broadcast: selected recipient ids
  const [bcInput, setBcInput] = useState('');             // broadcast: add-recipient field
  const [bcMode, setBcMode] = useState('broadcast');      // broadcast: 'broadcast' | 'announcement'
  const [bcGroupId, setBcGroupId] = useState('');         // broadcast: optional Share Group audience
  const [bcType, setBcType] = useState('message');        // broadcast content: 'message' | 'poll'
  const [bcQuestions, setBcQuestions] = useState([]);     // poll: the questions being built
  const [bcAudience, setBcAudience] = useState('');       // broadcast: '' | 'node-users' | 'federation-users' (operator)
  const isOperator = (getSession()?.roles || []).includes('operator');
  const [myGroups, setMyGroups] = useState([]);           // the owner's Share Groups (audiences)
  const [resultsId, setResultsId] = useState(null);       // broadcast id whose results are shown
  const [results, setResults] = useState(null);           // fetched broadcast results
  const [recentBroadcasts, setRecentBroadcasts] = useState([]); // localStorage-tracked sent broadcasts
  const [sending, setSending] = useState(false);
  const [important, setImportant] = useState(new Set());  // message ids flagged important (Tier 1)
  const [trackedList, setTrackedList] = useState([]);     // active Tracked Responses (Tier 2)
  const [trackMsg, setTrackMsg] = useState(null);         // message being tracked (opens modal)
  const [replyQuote, setReplyQuote] = useState(null);     // message being quoted-replied to (↩)
  const [composerFocus, setComposerFocus] = useState(0);  // bump → focus the composer (e.g. after ↩ Reply)
  const [draftPrefill, setDraftPrefill] = useState('');   // suggested reply / filled command seeded into the composer
  const [prefillNonce, setPrefillNonce] = useState(0);    // bump to force a composer remount on each insert
  const [agentCommands, setAgentCommands] = useState(null); // peer agent's chat.commands (Phase A)
  const [cmdFill, setCmdFill] = useState(null);           // a command being filled in (param form)
  const [schedOpen, setSchedOpen] = useState(false);      // schedule panel open (own agent, Phase B)
  const [replyingTrId, setReplyingTrId] = useState(null); // contract id whose approved reply is being sent
  const [awaitingDrafts, setAwaitingDrafts] = useState({}); // tr.id → suggested reply body (for the bubble)
  const msgsRef = useRef(null);
  // Resolved attachment URLs cached per conversation, so a refresh / new message reuses them instead of
  // re-resolving (re-downloading) every image. { convId, map: { attachmentId → presignedUrl } }.
  const urlCacheRef = useRef({ convId: null, map: {} });
  // Ids the user just cancelled — kept so a stale re-fetch (replica lag on a multi-node node) can't
  // re-add a row the user already dismissed until the cancel has propagated.
  const dismissedRef = useRef(new Set());

  const loadLists = useCallback(async () => {
    const [reqs, convs, impIds, trs] = await Promise.all([
      messages.listRequests().catch(() => []),
      messages.listConversations().catch(() => []),
      tracked.listImportantMessageIds().catch(() => []),
      tracked.listTrackedResponses().catch(() => []),
    ]);
    setRequests(reqs);
    setConversations(convs);
    setImportant(new Set(impIds));
    setTrackedList(trs.filter(tr => tr.state !== 'cancelled' && !dismissedRef.current.has(tr.id)));
  }, []);

  // Inbox mount: ONE composite call (GET /v1/messages/overview) seeds all six sections — requests +
  // conversations + important flags + tracked responses + the owner's agents + share groups — instead of
  // the 6-request fan-out. Interactive refreshes (live-update, post-send) keep using loadLists (the 4
  // lists); a composite failure falls back to the individual loaders so the inbox still populates.
  const loadOverview = useCallback(async () => {
    const r = await apiGet('/v1/messages/overview').catch(() => null);
    const d = r?.data;
    if (!d) {
      loadLists();
      agentsSvc.listAgents().then(a => setMyAgents(a || [])).catch(() => {});
      apiGet('/v1/groups').then(gr => setMyGroups(gr?.data?.groups || [])).catch(() => {});
      return;
    }
    setRequests(d.requests || []);
    setConversations(d.conversations || []);
    setImportant(new Set(d.important || []));
    setTrackedList((d.tracked || []).filter(tr => tr.state !== 'cancelled' && !dismissedRef.current.has(tr.id)));
    setMyAgents(d.agents || []);
    setMyGroups(d.groups || []);
  }, [loadLists]);

  // Cheap, single-request refresh of ONLY the Tracked Responses list. Used for 'agent-messages'
  // live events: on a busy node 40+ agents emit agent-message changes every second, and those only
  // affect tracked responses — reloading the whole inbox (conversations + flags + open thread +
  // requests = 5 requests) on each is the request storm. Direct-message changes ('messages') still
  // do the full refresh below.
  const loadTrackedOnly = useCallback(async () => {
    const trs = await tracked.listTrackedResponses().catch(() => []);
    setTrackedList(trs.filter(tr => tr.state !== 'cancelled' && !dismissedRef.current.has(tr.id)));
  }, []);

  // Tracked Responses for the open conversation that are awaiting the owner's approval to reply.
  const awaitingForConv = activeConv
    ? trackedList.filter(tr => tr.state === 'awaiting-approval' && tr.source?.conversationId === activeConv.conversationId)
    : [];

  // Map each message id → its Tracked Response (so a message shows its tracking state + we don't
  // double-create). Prefer an active contract over a finished (replied) one for the same message.
  const trackedByMsg = {};
  for (const tr of trackedList) {
    const mid = tr.source?.messageId;
    if (!mid) continue;
    const cur = trackedByMsg[mid];
    if (!cur || (cur.state === 'replied' && tr.state !== 'replied')) trackedByMsg[mid] = tr;
  }
  const awaitingCount = trackedList.filter(tr => tr.state === 'awaiting-approval').length;
  // A replied contract is DONE — drop it from the active dashboard + counts (the message keeps its
  // "Replied" badge as the record). A small footer notes how many were completed.
  const activeTracked = trackedList.filter(tr => tr.state !== 'replied');
  const doneCount = trackedList.length - activeTracked.length;

  // Clicking 🔗: if the message already has an ACTIVE tracked response, surface it (don't make a
  // duplicate); a finished (replied) one may be tracked again as a fresh task.
  const onTrackMsg = (msg) => {
    const existing = trackedByMsg[msg.id];
    if (existing && existing.state !== 'replied') { showToast?.(t('inbox.trackAlready')); setMode('tracked'); return; }
    setTrackMsg(msg);
  };

  // Clicking 📓: copy the message straight into the notebook for later processing (no AI step) — keeps the
  // source link + reply intent so it can be replied to or enriched/filed from the notebook later.
  const onParkMsg = async (msg) => {
    try {
      await parkMessageToNotebook(msg, { title: firstLine(msg.body) });
      showToast?.(t('inbox.parkedToNotebook'));
    } catch (e) { showToast?.(e?.message || t('inbox.trackFailed'), true); }
  };

  const cancelTracked = async (tr) => {
    let resp;
    try { resp = await tracked.cancelTrackedResponse(tr.id); }
    catch { showToast?.(t('inbox.trackFailed'), true); return; }
    if (resp?.ok === false) { showToast?.(resp.error?.message || t('inbox.trackFailed'), true); return; }
    // Only on confirmed success: dismiss it immediately (so a stale re-fetch can't bring it back) + toast.
    dismissedRef.current.add(tr.id);
    setTrackedList(prev => prev.filter(x => x.id !== tr.id));
    showToast?.(t('inbox.trackCancelled'));
    loadLists();
  };

  const toggleImportant = async (msg) => {
    const next = new Set(important);
    const on = !next.has(msg.id);
    if (on) next.add(msg.id); else next.delete(msg.id);
    setImportant(next);
    await tracked.setMessageImportant(msg.id, on).catch(() => {});
  };

  const startSuggestedReply = async (tr) => {
    const d = await tracked.getTrackedResponseDraft(tr.id).catch(() => null);
    setDraftPrefill(d?.draft?.body || awaitingDrafts[tr.id] || '');
    setReplyingTrId(tr.id);
  };

  // Open the workspace record this tracked response watches (so you can jump straight to the bug). Set
  // BOTH the saved-tab (so the profile loads straight onto Organisms) and the workspace deep-link
  // (so the Organisms tab opens that exact workspace), then hard-navigate.
  const openRecord = (tr) => {
    const r = tr.references || {};
    if (!r.organismId || !r.workspaceId) { showToast?.(t('inbox.trackNoRecord'), true); return; }
    try {
      sessionStorage.setItem('aimeat-profile-tab', 'organisms');
      sessionStorage.setItem('aimeat.ws.openId', r.organismId);
      sessionStorage.setItem('aimeat.ws.openWs', r.workspaceId);
    } catch { /* noop */ }
    window.location.assign('/v1/profile?tab=organisms');
  };

  // Fetch the suggested-reply body for each awaiting contract in the open conversation (for the bubble).
  const awaitingIds = awaitingForConv.map(t => t.id).join(',');
  useEffect(() => {
    if (!awaitingForConv.length) { setAwaitingDrafts({}); return undefined; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(awaitingForConv.map(async tr => {
        const d = await tracked.getTrackedResponseDraft(tr.id).catch(() => null);
        return [tr.id, d?.draft?.body || ''];
      }));
      if (!cancelled) setAwaitingDrafts(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
    // `awaitingIds` is the stable join of awaitingForConv ids — the intended trigger. Depending on the
    // array itself (new identity every render) would re-fetch every draft on each render and loop via
    // setAwaitingDrafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingIds]);

  // markRead=true ONLY when the user opens the conversation. Marking read POSTs a receipt which itself
  // emits a 'messages' change → SSE → live refresh; doing it on every live refresh creates a
  // self-sustaining request loop. So live refreshes reload the thread WITHOUT marking read.
  const loadThread = useCallback(async (conv, markRead = false) => {
    if (!conv) return;
    const msgs = (await messages.getConversation(conv.conversationId, conv.viaAgent).catch(() => [])).slice().reverse();
    setThread(msgs);
    // REUSE already-resolved attachment URLs for the SAME conversation: a refresh / new message must NOT
    // re-resolve (and thus re-download via a fresh presigned URL) every existing image. Only fetch URLs
    // for attachments we haven't resolved yet. A different conversation starts a fresh cache.
    const sameConv = urlCacheRef.current.convId === conv.conversationId;
    const prev = sameConv ? urlCacheRef.current.map : {};
    const map = {};
    await Promise.all(msgs.flatMap(m => (m.attachments || [])
      .filter(a => !a.inline)
      .map(async a => {
        // Key by messageId::attachmentId — per-message ids (at0, at1…) repeat, so a flat a.id map made every message's `at0` share one image.
        const uk = `${m.id}::${a.id}`;
        if (prev[uk]) { map[uk] = prev[uk]; return; } // cached → browser won't re-fetch
        // Inbound: only the recipient's duplicated local copy is fetchable. Outbound: resolve the original.
        const key = (a.mode === 'duplicate' && a.localKey) ? a.localKey
          : (m.direction === 'outbound' && a.storageKey) ? a.storageKey : null;
        if (!key) return;
        const u = await messages.attachmentUrl(key).catch(() => null);
        if (u) map[uk] = u;
      })));
    urlCacheRef.current = { convId: conv.conversationId, map };
    setUrlMap(map);
    // Agent-owned ("via <agent>") threads are read-only for the owner — don't post a read receipt as them.
    if (markRead && !conv.viaAgent) await messages.markConversationRead(conv.conversationId).catch(() => {});
  }, []);

  // Mount: one composite call seeds all six sections (requests/conversations/important/tracked/agents/groups).
  useEffect(() => { loadOverview(); }, [loadOverview]);

  // Phase A: when the active thread is with an AGENT, read its public `chat.commands` so the composer can
  // offer fill-in command chips. Absent/empty key → no chips (graceful). Reset per-thread UI on switch.
  const activePeer = activeConv?.peerGhii;
  useEffect(() => {
    setAgentCommands(null); setCmdFill(null); setSchedOpen(false);
    if (!activePeer || !isAgentPeer(activePeer)) return;
    let cancelled = false;
    apiGet(`/v1/memory/${encodeURIComponent(activePeer)}/${encodeURIComponent('chat.commands')}`)
      .then(r => {
        const val = r?.data?.value;
        const cmds = val && Array.isArray(val.commands) ? val.commands.filter(c => c && c.id) : [];
        if (!cancelled && cmds.length) setAgentCommands(cmds);
      })
      .catch(() => { /* no commands published — fine */ });
    return () => { cancelled = true; };
  }, [activePeer]);

  // Recent broadcasts/polls the user sent — tracked in localStorage so results stay re-accessible.
  const BC_STORE = 'aimeat.inbox.broadcasts';
  useEffect(() => { try { setRecentBroadcasts(JSON.parse(localStorage.getItem(BC_STORE) || '[]')); } catch { /* none */ } }, []);
  const trackBroadcast = (entry) => setRecentBroadcasts(prev => {
    const next = [entry, ...prev.filter(b => b.id !== entry.id)].slice(0, 30);
    try { localStorage.setItem(BC_STORE, JSON.stringify(next)); } catch { /* quota */ }
    return next;
  });
  const openResults = async (id) => {
    setMode('results'); setResultsId(id); setResults(null); setActiveConv(null);
    setResults(await messages.getBroadcastResults(id).catch(() => null));
  };

  // Inbox-link (mailto-style): /v1/profile?tab=messages&to=<id>[,<id>]&subject=<s> opens a prefilled
  // compose (single recipient) or broadcast (multiple). Cleared from the URL so a refresh doesn't re-open.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const toParam = (params.get('to') || '').trim();
    if (!toParam) return;
    const recips = toParam.split(',').map(s => s.trim()).filter(Boolean);
    const subject = params.get('subject') || '';
    if (recips.length > 1) {
      setMode('broadcast'); setActiveConv(null); setBcRecipients(recips); setBcMode('broadcast'); setBcType('message'); setBcGroupId('');
    } else {
      setMode('compose'); setActiveConv(null); setTo(recips[0]); setComposeSubject(subject);
    }
    try { window.history.replaceState({}, '', '/v1/profile?tab=messages'); } catch { /* noop */ }
  }, []);

  // Recipient suggestions for a new message: your own agents (GAIIs) + everyone you've a thread with.
  const contactOptions = (() => {
    const map = new Map();
    for (const a of myAgents) {
      if (a?.gaii) map.set(a.gaii, `${a.name || a.gaii} ${t('inbox.contactAgentSuffix')}`);
    }
    for (const c of conversations) {
      if (c?.peerGhii && !map.has(c.peerGhii)) map.set(c.peerGhii, peerName(c.peerGhii));
    }
    return [...map.entries()].map(([id, label]) => ({ id, label }));
  })();

  // A 'messages' live-update ALWAYS reloads the open thread so incoming messages render immediately —
  // even while you're typing a reply (previously the whole reload was skipped when an editable was
  // focused, so new messages stayed invisible until send/reopen: the "badge shows N new but the thread
  // never updates" bug). The "don't yank scroll while I write" concern is handled where it belongs —
  // useThreadAutoScroll suppresses the new-message jump while the composer is focused (near-bottom
  // follow still applies), so the message list re-renders without stealing the caret or the scroll.
  const liveRef = useRef(null);
  liveRef.current = () => { loadLists(); if (activeConv) loadThread(activeConv); };
  // Selective live refresh. `e.detail.domains` is a Set<string> (or null = "everything changed",
  // e.g. a reconnect catch-up). IMPORTANT: it is a Set, not an Array — an earlier `Array.isArray`
  // check silently never matched, so the inbox re-fetched on EVERY change (memory/organism/task
  // churn from dozens of agents → a request storm). We branch by domain:
  //   • 'messages'        (a direct message changed)  → full refresh (conversations + flags +
  //                                                      open thread + requests)
  //   • 'agent-messages'  (agent activity)            → ONLY the tracked-responses list (1 request)
  // Everything else (memory, organisms, agent-tasks, …) is ignored. A burst is coalesced into one
  // refresh; if any 'messages' event lands in the window we do the full refresh.
  const liveTimerRef = useRef(null);
  const pendingFullRef = useRef(false);
  useEffect(() => {
    const handler = (e) => {
      const domains = e?.detail?.domains;                  // Set<string> | null
      const full = !domains || domains.has('messages');         // direct-message change
      const agentOnly = !domains || domains.has('agent-messages'); // agent activity → tracked only
      if (!full && !agentOnly) return;                     // not for us
      if (full) pendingFullRef.current = true;
      if (liveTimerRef.current) return;                    // coalesce a burst into one refresh
      liveTimerRef.current = setTimeout(() => {
        liveTimerRef.current = null;
        if (pendingFullRef.current) { pendingFullRef.current = false; liveRef.current?.(); }
        else loadTrackedOnly();
      }, 700);
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => { window.removeEventListener('aimeat-live-update', handler); if (liveTimerRef.current) clearTimeout(liveTimerRef.current); };
  }, [loadTrackedOnly]);

  // Auto-scroll (open / near-bottom follow / one-time jump on a NEW message) + mobile keyboard
  // ergonomics (--inbox-kb + composer focus scroll) — extracted to ./inbox-tab/use-thread-ux.js.
  useThreadAutoScroll(msgsRef, mode, thread, activeConv);
  useMobileComposerKeyboard(mode);

  const openConversation = async (conv) => {
    setActiveConv(conv); setMode('thread');
    setDraftPrefill(''); setReplyingTrId(null); setReplyQuote(null);   // don't leak a suggested reply / quote across threads
    await loadThread(conv, true);                 // mark read only on explicit open (avoids a refresh loop)
    loadLists();
  };
  // Peer display names (TARGET-031, part A): the conversation payload carries only ids, so resolve a
  // human-friendly name once per peer and cache it. Agents → GET /v1/agents/:gaii, humans (owner@node) →
  // GET /v1/ghii/:ghii (both public, both return display_name). Federated peers on another node aren't
  // in the local store → 404 → we keep the handle. Reserve each id synchronously so we fetch it once.
  const resolvePeerNames = useCallback((ids) => {
    const todo = [...new Set((ids || []).filter(Boolean))].filter(id => !(id in peerNamesRef.current));
    if (!todo.length) return;
    todo.forEach(id => { peerNamesRef.current[id] = ''; });   // reserve (fallback = handle) so we look it up once
    Promise.all(todo.map(async (id) => {
      const path = String(id).includes('#') ? `/v1/agents/${encodeURIComponent(id)}` : `/v1/ghii/${encodeURIComponent(id)}`;
      const r = await apiGet(path).catch(() => null);
      const dn = String(r?.data?.display_name || '').trim();
      if (dn) peerNamesRef.current[id] = dn;
    })).then(() => setPeerNames({ ...peerNamesRef.current }));
  }, []);
  // Resolve names for every peer currently on screen (conversation peers + their owners + requests + open thread).
  useEffect(() => {
    const ids = [];
    for (const c of conversations) { if (c.peerGhii) { ids.push(c.peerGhii); ids.push(ownerKeyOf(c.peerGhii)); } }
    for (const r of requests) if (r.contactId) ids.push(r.contactId);
    if (activeConv?.peerGhii) { ids.push(activeConv.peerGhii); ids.push(ownerKeyOf(activeConv.peerGhii)); }
    resolvePeerNames(ids);
  }, [conversations, requests, activeConv, resolvePeerNames]);
  // "Display name (handle)" for an id, falling back to the bare handle when we have no display name.
  const peerDisplay = (id) => peerLabel(id, peerNames[id]);

  // Thread-head AI actions — Reply with AI (TARGET-031) and Conversation → Notebook (summarize the whole
  // thread + images, park it for filing/enrichment). Config assembly lives in ./inbox-tab/ai-actions.js.
  const openConversationAi = () => { if (activeConv) setAiReply(buildConversationReplyProps({ activeConv, thread, peerName: peerNames[activeConv.peerGhii], peerDisplayName: peerDisplay(activeConv.peerGhii) })); };
  const openMessageAi = (msg) => { if (activeConv) setAiReply(buildMessageReplyProps({ activeConv, msg, peerName: peerNames[activeConv.peerGhii] })); };
  const openConversationNotebook = () => { if (activeConv) setNbConv(buildConversationNotebookProps({ activeConv, thread, urlMap, peerName: peerNames[activeConv.peerGhii], title: `${t('inbox.notebook.toNotebook')} — ${peerDisplay(activeConv.peerGhii)}` })); };

  // ↩ Reply on a bubble: pin the quote AND focus the composer (bump a nonce the Composer watches). Kept
  // separate from the raw setter so cancelling the quote (✕) doesn't re-pop the keyboard.
  const startQuoteReply = useCallback((msg) => { setReplyQuote(msg); setComposerFocus(n => n + 1); }, []);

  const startCompose = () => { setMode('compose'); setActiveConv(null); setTo(''); setComposeSubject(''); };
  const startBroadcast = () => { setMode('broadcast'); setActiveConv(null); setBcRecipients([]); setBcInput(''); setBcMode('broadcast'); setBcGroupId(''); setBcType('message'); setBcQuestions([]); setBcAudience(''); };
  const addBcRecipient = (id) => {
    const v = (id ?? bcInput).trim();
    if (v && !bcRecipients.includes(v)) setBcRecipients([...bcRecipients, v]);
    setBcInput('');
  };
  const removeBcRecipient = (id) => setBcRecipients(bcRecipients.filter(r => r !== id));

  // Send one message to many: explicit recipients and/or a Share Group audience. doBroadcast is the
  // Composer's onSend for the broadcast panel.
  const doBroadcast = async (_recipient, text, files, reset) => {
    if (sending) return;
    const body = (text || '').trim();
    if (bcRecipients.length === 0 && !bcGroupId && !bcAudience) { showToast?.(t('inbox.bcNoRecipients'), true); return; }

    let interactive;
    if (bcType === 'poll') {
      const questions = bcQuestions
        .map(q => ({ ...q, options: (q.options || []).filter(o => o.label.trim()) }))
        .filter(q => q.prompt.trim() && q.options.length >= 1)
        .map(q => ({
          id: q.id, header: (q.header || q.prompt).slice(0, 80), prompt: q.prompt.trim(),
          options: q.options.map(o => ({ id: o.id, label: o.label.trim() })),
          multiSelect: !!q.multiSelect, allowOther: q.allowOther !== false, required: !!q.required,
        }));
      if (!questions.length) { showToast?.(t('inbox.pollNeedQuestion'), true); return; }
      interactive = { role: 'questions', v: 1, questions };
    } else if (!body && files.length === 0) { return; }

    setSending(true);
    try {
      const attachments = [];
      for (let i = 0; i < files.length; i++) {
        const desc = await messages.uploadAttachment(files[i]);
        attachments.push({ ...desc, inline: false, id: `at${i}` });
      }
      const resp = await messages.sendBroadcast({
        to: bcRecipients, groupId: bcGroupId || undefined, audience: bcAudience || undefined,
        mode: bcType === 'poll' ? 'broadcast' : bcMode,   // a poll must be repliable (recipients answer)
        body, attachments, interactive,
      });
      if (resp?.ok === false) { showToast?.(resp?.error?.message || t('inbox.failed'), true); }
      else {
        reset?.();
        const id = resp?.data?.broadcast_id;
        const titleSrc = (bcType === 'poll' ? (interactive.questions[0]?.prompt || '') : body) || '';
        if (id) trackBroadcast({
          id, type: bcType,
          title: titleSrc.slice(0, 60) || t('inbox.broadcast'),
          createdAt: new Date().toISOString(),
        });
        showToast?.(`${t('inbox.bcSent')} (${resp?.data?.sent ?? 0})`);
        loadLists();
        if (id) openResults(id); else setMode('idle');
      }
    } catch { showToast?.(t('inbox.failed'), true); }
    setSending(false);
  };

  // Open the conversation for a tracked response, then (for awaiting-approval) seed the suggested reply.
  const openTracked = async (tr) => {
    if (!tr.source?.conversationId) return;
    await openConversation({ conversationId: tr.source.conversationId, peerGhii: tr.source.peerGhii });
    if (tr.state === 'awaiting-approval') await startSuggestedReply(tr);
  };

  // Open a specific thread from a notification deep-link (sessionStorage hint set by the bell).
  // 'requests' lands on the inbox list; 'req:<id>' (a "wants to message you" request notif) opens the
  // thread once accepted, else falls back to the list (sender still pending accept/block).
  const consumeDeepLink = useCallback(async () => {
    let target = null;
    try { target = sessionStorage.getItem('aimeat.inbox.open'); } catch { /* noop */ }
    if (!target) return;
    try { sessionStorage.removeItem('aimeat.inbox.open'); } catch { /* noop */ }
    if (target === 'requests') { await loadLists(); return; }
    const fromRequest = target.startsWith('req:'); if (fromRequest) target = target.slice(4);
    const convs = await messages.listConversations().catch(() => []);
    const conv = convs.find(c => c.conversationId === target);
    if (conv) openConversation(conv); else if (fromRequest) await loadLists();
    // openConversation uses only stable setters/refs (no stale-closure risk); keeping it out of deps
    // keeps consumeDeepLink stable (loadLists is a []-useCallback) so the two effects below don't re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadLists]);
  useEffect(() => { consumeDeepLink(); }, [consumeDeepLink]);
  useEffect(() => {
    const handler = (e) => { if (!e.detail?.tabId || e.detail.tabId === 'messages') consumeDeepLink(); };
    window.addEventListener('aimeat-open-tab', handler);
    return () => window.removeEventListener('aimeat-open-tab', handler);
  }, [consumeDeepLink]);

  const accept = async (contactId) => {
    await messages.acceptRequest(contactId).catch(() => {});
    showToast?.(t('inbox.acceptedToast'));
    await loadLists();
  };
  const block = async (contactId) => {
    await messages.blockContact(contactId).catch(() => {});
    showToast?.(t('inbox.blockedToast'));
    await loadLists();
    if (activeConv?.peerGhii === contactId) { setActiveConv(null); setThread([]); setMode('idle'); }
  };

  // Submit answers to an interactive question: send a normal reply (so it threads + reads naturally on
  // any peer) carrying both a human-readable summary body AND the machine-readable answers payload.
  const submitInteractiveAnswers = async (questionMsg, answers) => {
    if (sending || !activeConv) return;
    setSending(true);
    try {
      const resp = await messages.send({
        to: activeConv.peerGhii, replyTo: questionMsg.id, conversationId: activeConv.conversationId,
        body: buildAnswerSummary(questionMsg.interactive, answers),
        interactive: { role: 'answers', v: 1, answersFor: questionMsg.id, answers },
      });
      if (resp?.ok === false) showToast?.(resp?.error?.message || t('inbox.failed'), true);
      else { await loadThread(activeConv); loadLists(); }
    } catch { showToast?.(t('inbox.failed'), true); }
    setSending(false);
  };

  // Phase A: substitute a command's {{param}} placeholders and drop the resulting prose into the
  // composer (the human reviews + sends it). Bump the nonce so the composer remounts on every insert.
  const insertCommand = (cmd, values) => {
    let text = cmd.template || '';
    for (const p of (Array.isArray(cmd.params) ? cmd.params : [])) {
      const raw = values[p.name];
      const v = (raw == null || raw === '') ? (p.default ?? '') : raw;
      text = text.split(`{{${p.name}}}`).join(String(v));
    }
    setCmdFill(null); setDraftPrefill(text); setPrefillNonce(n => n + 1);
  };

  const doSend = async (recipient, text, files, reset) => {
    if (sending) return;
    const body = (text || '').trim();
    if (!body && files.length === 0) return;
    setSending(true);
    try {
      const attachments = [];
      for (let i = 0; i < files.length; i++) {
        const desc = await messages.uploadAttachment(files[i]);
        attachments.push({ ...desc, inline: false, id: `at${i}` });
      }
      // A subject (compose mode only) opens a new topic thread. When REPLYING in an open thread, pin the
      // send to that exact conversationId — without it the server derives the default per-pair thread, so
      // a reply to a subject thread (e.g. "keskustelu") spawned a brand-new thread named after the agent.
      const subject = (mode === 'compose' && composeSubject.trim()) ? composeSubject.trim() : undefined;
      const conversationId = (mode === 'thread' && activeConv) ? activeConv.conversationId : undefined;
      // A quoted reply (↩) pins reply_to to the quoted message — the bubble renders the quote from it.
      const replyTo = (mode === 'thread' && replyQuote) ? replyQuote.id : undefined;
      const resp = await messages.send({ to: recipient, body, attachments, subject, conversationId, replyTo });
      if (resp?.ok === false) { showToast?.(resp?.error?.message || t('inbox.failed'), true); }
      else {
        reset?.();
        setComposeSubject('');
        setReplyQuote(null);
        // If this send fulfils a Tracked Response awaiting approval, mark it replied.
        if (replyingTrId) {
          await tracked.markTrackedResponseReplied(replyingTrId, resp?.data?.message?.id).catch(() => {});
          setReplyingTrId(null); setDraftPrefill('');
        }
        const conv = activeConv || { conversationId: resp?.data?.message?.conversationId, peerGhii: recipient };
        setActiveConv(conv); setMode('thread');
        await loadThread(conv);
        loadLists();
      }
    } catch {
      showToast?.(t('inbox.failed'), true);
    }
    setSending(false);
  };

  /* ── Render ── */
  return html`
    <div class=${`inbox${mode !== 'idle' ? ' inbox--panel' : ''}`}>
      <div class="inbox-head">
        <div>
          <div class="section-title">${t('inbox.title')}</div>
          <div class="section-desc">${t('inbox.desc')}</div>
        </div>
        <div class="inbox-head-actions">
          <button class=${`btn-outline${mode === 'tracked' ? ' btn-outline--active' : ''}${awaitingCount ? ' btn-outline--active' : ''}`} onClick=${() => { setMode('tracked'); setActiveConv(null); }}
            title=${awaitingCount ? t('inbox.trackReady') : ''}>
            🔗 ${t('inbox.trackedTitle')}${activeTracked.length ? html` <span class="inbox-count">${activeTracked.length}</span>` : ''}
          </button>
          ${recentBroadcasts.length ? html`<button class=${`btn-outline${mode === 'results' ? ' btn-outline--active' : ''}`} onClick=${() => { setMode('results'); setResultsId(null); setActiveConv(null); }}>📊 ${t('inbox.results')}</button>` : null}
          <button class=${`btn-outline${mode === 'broadcast' ? ' btn-outline--active' : ''}`} onClick=${startBroadcast}>📢 ${t('inbox.broadcast')}</button>
          <button class="btn-primary" onClick=${startCompose}>✉️ ${t('inbox.new')}</button>
        </div>
      </div>
      <datalist id="inbox-contact-suggest">
        ${contactOptions.map(c => html`<option value=${c.id} key=${c.id}>${c.label}</option>`)}
      </datalist>

      <div class=${`inbox-body${mode !== 'idle' ? ' inbox-body--panel' : ''}`}>
        <button class="inbox-back" onClick=${() => { setMode('idle'); setActiveConv(null); setReplyQuote(null); }}>← ${t('inbox.back')}</button>
        <${ListPanel} requests=${requests} conversations=${conversations} activeConv=${activeConv}
          peerDisplay=${peerDisplay} accept=${accept} block=${block} openConversation=${openConversation} />

        ${mode === 'compose' ? html`
          <div class="inbox-panel">
            <div class="inbox-thread-head"><div class="inbox-name">${t('inbox.new')}</div></div>
            <div class="inbox-compose-fields">
              <${ContactPicker} value=${to} onChange=${setTo} valueMode="full"
                placeholder=${t('inbox.toPlaceholder')} />
              <input class="inbox-input" type="text" placeholder=${t('inbox.subjectPlaceholder')}
                value=${composeSubject} onInput=${(e) => setComposeSubject(e.target.value)} />
            </div>
            <${Composer} key="c-new" recipient=${to.trim()} sendLabel=${t('inbox.send')}
              sending=${sending} onSend=${doSend} draftKey="aimeat.inbox.draft.new" />
          </div>` : null}

        ${mode === 'broadcast' ? html`
          <div class="inbox-panel">
            <div class="inbox-thread-head"><div class="inbox-name">📢 ${t('inbox.broadcastTitle')}</div></div>
            <div class="inbox-compose-fields">
              <div class="inbox-bc-mode">
                <label class=${`inbox-bc-modeopt${bcType === 'message' ? ' inbox-bc-modeopt--on' : ''}`}>
                  <input type="radio" name="bctype" checked=${bcType === 'message'} onChange=${() => setBcType('message')} />
                  <span>📨 ${t('inbox.bcTypeMessage')}</span>
                </label>
                <label class=${`inbox-bc-modeopt${bcType === 'poll' ? ' inbox-bc-modeopt--on' : ''}`}>
                  <input type="radio" name="bctype" checked=${bcType === 'poll'} onChange=${() => setBcType('poll')} />
                  <span>📊 ${t('inbox.bcTypePoll')}</span>
                </label>
              </div>
              ${bcType === 'message' ? html`<div class="inbox-bc-mode">
                <label class=${`inbox-bc-modeopt${bcMode === 'broadcast' ? ' inbox-bc-modeopt--on' : ''}`}>
                  <input type="radio" name="bcmode" checked=${bcMode === 'broadcast'} onChange=${() => setBcMode('broadcast')} />
                  <span>${t('inbox.bcModeBroadcast')}</span>
                </label>
                <label class=${`inbox-bc-modeopt${bcMode === 'announcement' ? ' inbox-bc-modeopt--on' : ''}`}>
                  <input type="radio" name="bcmode" checked=${bcMode === 'announcement'} onChange=${() => setBcMode('announcement')} />
                  <span>${t('inbox.bcModeAnnouncement')}</span>
                </label>
              </div>` : html`<${PollBuilder} questions=${bcQuestions} setQuestions=${setBcQuestions} />`}
              ${bcRecipients.length ? html`<div class="inbox-bc-chips">
                ${bcRecipients.map(r => html`<span class="inbox-bc-chip" key=${r}>${escHtml(peerName(r))}
                  <button class="inbox-bc-chip-x" title=${t('inbox.bcRemove')} onClick=${() => removeBcRecipient(r)}>✕</button></span>`)}
              </div>` : null}
              <div class="inbox-bc-add">
                <input class="inbox-input" type="text" list="inbox-contact-suggest" placeholder=${t('inbox.bcAddPlaceholder')}
                  value=${bcInput} onInput=${(e) => setBcInput(e.target.value)}
                  onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); addBcRecipient(); } }} />
                <button class="btn-outline btn-sm" onClick=${() => addBcRecipient()}>${t('inbox.bcAdd')}</button>
              </div>
              ${myGroups.length ? html`<select class="inbox-input" value=${bcGroupId} onChange=${(e) => setBcGroupId(e.target.value)}>
                <option value="">${t('inbox.bcNoGroup')}</option>
                ${myGroups.map(g => html`<option value=${g.id} key=${g.id}>${escHtml(g.name)} (${(g.members || []).length})</option>`)}
              </select>` : null}
              ${isOperator ? html`<select class=${`inbox-input${bcAudience ? ' inbox-bc-audience--on' : ''}`} value=${bcAudience} onChange=${(e) => setBcAudience(e.target.value)}>
                <option value="">${t('inbox.bcNoAudience')}</option>
                <option value="node-users">📣 ${t('inbox.bcNodeUsers')}</option>
                <option value="federation-users">🌐 ${t('inbox.bcFederationUsers')}</option>
              </select>` : null}
            </div>
            <${Composer} key="c-bc" recipient=${(bcRecipients.length || bcGroupId || bcAudience) ? 'bc' : ''}
              sendLabel=${bcType === 'poll' ? t('inbox.pollSend') : t('inbox.bcSend')} sending=${sending} onSend=${doBroadcast} />
          </div>` : null}

        ${mode === 'results' ? html`<${ResultsPanel} resultsId=${resultsId} recentBroadcasts=${recentBroadcasts}
          results=${results} openResults=${openResults} setResultsId=${setResultsId} setResults=${setResults} />` : null}

        ${mode === 'thread' && activeConv ? html`<${ThreadPanel}
          activeConv=${activeConv} thread=${thread} urlMap=${urlMap} important=${important} trackedByMsg=${trackedByMsg}
          awaitingForConv=${awaitingForConv} awaitingDrafts=${awaitingDrafts} schedOpen=${schedOpen} setSchedOpen=${setSchedOpen}
          cmdFill=${cmdFill} agentCommands=${agentCommands} sending=${sending} draftPrefill=${draftPrefill} prefillNonce=${prefillNonce}
          msgsRef=${msgsRef} peerDisplay=${peerDisplay} showToast=${showToast} toggleImportant=${toggleImportant}
          replyQuote=${replyQuote} setReplyQuote=${setReplyQuote} onQuoteReply=${startQuoteReply} composerFocus=${composerFocus}
          onTrackMsg=${onTrackMsg} onParkMsg=${onParkMsg} openMessageAi=${openMessageAi} submitInteractiveAnswers=${submitInteractiveAnswers}
          setMdViewer=${setMdViewer} openConversationAi=${openConversationAi} openConversationNotebook=${openConversationNotebook} insertCommand=${insertCommand} setCmdFill=${setCmdFill}
          cancelTracked=${cancelTracked} openRecord=${openRecord} startSuggestedReply=${startSuggestedReply} doSend=${doSend} showLinkPreviews=${showLinkPreviews} toggleLinkPreviews=${toggleLinkPreviews} />` : null}

        ${mode === 'tracked' ? html`<${TrackedPanel} activeTracked=${activeTracked} doneCount=${doneCount}
          openRecord=${openRecord} openTracked=${openTracked} cancelTracked=${cancelTracked} />` : null}

        ${mode === 'idle' ? html`
          <div class="inbox-panel inbox-panel--empty">
            <div class="inbox-empty">
              <div class="inbox-empty-ico">📬</div>
              <div>${t('inbox.selectConversation')}</div>
            </div>
          </div>` : null}
      </div>

      <${TrackResponseModal} open=${!!trackMsg} msg=${trackMsg}
        onClose=${() => setTrackMsg(null)} onDone=${loadLists} showToast=${showToast} />
      ${mdViewer && html`<${MarkdownViewer} url=${mdViewer.url} name=${mdViewer.name} onClose=${() => setMdViewer(null)} />`}
      ${aiReply && html`<${ReplyWithAiPopover} title=${aiReply.title} build=${aiReply.build} showToast=${showToast} onClose=${() => setAiReply(null)} />`}
      ${nbConv && html`<${ConversationToNotebookPopover} title=${nbConv.title} promptText=${nbConv.promptText}
        runServerSummary=${nbConv.runServerSummary} parkConversation=${nbConv.parkConversation}
        showToast=${showToast} onClose=${() => setNbConv(null)} />`}
    </div>`;
}
