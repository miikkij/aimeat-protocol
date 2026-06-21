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
 * @structure InboxTab (default) · Composer (Toast UI) · MessageBubble · Avatar · helpers
 * @usage Lazy-loaded profile tab; registered in profile.js TABS as id `messages`.
 * @version-history
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
import { t, getLocale } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Markdown } from '/components/Markdown.js';
import { minidenticon } from '/lib/minidenticons.min.js';
import { PresenceDot } from '/components/PresenceDot.js';
import * as messages from '/js/services/messages.js';
import * as tracked from '/js/services/tracked-responses.js';
import { TrackResponseModal } from './track-response-modal.js';

/* Lazy-load the vendored Toast UI Editor (MIT, /lib/toastui/) — the same editor the workspace
 * document space uses, so composing a message feels like editing a document (Markdown⇄WYSIWYG).
 * ~520KB, so it stays out of the main bundle and loads only when the Inbox composer mounts. */
let _tuiPromise = null;
function loadToastUI() {
  if (window.toastui && window.toastui.Editor) return Promise.resolve(window.toastui.Editor);
  if (_tuiPromise) return _tuiPromise;
  _tuiPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-tui]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = '/lib/toastui/toastui-editor.min.css'; css.setAttribute('data-tui', '1');
      document.head.appendChild(css);
    }
    const s = document.createElement('script');
    s.src = '/lib/toastui/toastui-editor-all.min.js';
    s.onload = () => (window.toastui && window.toastui.Editor) ? resolve(window.toastui.Editor) : reject(new Error('editor missing'));
    s.onerror = () => reject(new Error('failed to load editor'));
    document.head.appendChild(s);
  });
  return _tuiPromise;
}

/* ── Helpers ── */

function peerName(id) {
  if (!id) return '';
  const beforeAt = id.split('@')[0];
  return beforeAt.includes('#') ? beforeAt.split('#').pop() : beforeAt;
}

function Avatar({ seed, size = 36 }) {
  const svg = minidenticon(seed || 'user');
  return html`<span class="inbox-avatar" style=${`width:${size}px;height:${size}px`}
    dangerouslySetInnerHTML=${{ __html: svg }}></span>`;
}

const TICK = { sent: '✓', delivered: '✓', read: '✓✓', queued: '🕒', failed: '⚠', undeliverable: '⚠' };
function statusTick(status) { return TICK[status] || ''; }

function timeShort(s) {
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString(getLocale() === 'fi' ? 'fi-FI' : undefined, { hour: '2-digit', minute: '2-digit' });
}
function dayKey(s) { return new Date(s).toDateString(); }
function dayLabel(s) {
  const d = new Date(s);
  const today = new Date().toDateString();
  const yest = new Date(Date.now() - 86400000).toDateString();
  if (d.toDateString() === today) return t('inbox.today');
  if (d.toDateString() === yest) return t('inbox.yesterday');
  return d.toLocaleDateString(getLocale() === 'fi' ? 'fi-FI' : undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* Build a markdown body safe to render: resolve cid:{id} inline media to the recipient's local
 * presigned URLs, and strip external http(s) images (tracking-pixel defense — DECISION #11). */
function prepareBody(body, urlMap, expiredIds) {
  let out = String(body || '');
  out = out.replace(/!\[([^\]]*)\]\(cid:([a-zA-Z0-9_-]+)\)/g, (m, alt, id) => {
    if (expiredIds && expiredIds.has(id)) return `*[${alt ? alt + ' — ' : ''}${t('inbox.attachmentExpired')}]*`;
    const url = urlMap[id];
    return url ? `![${alt}](${url})` : `*[${alt || t('inbox.attachmentPending')}]*`;
  });
  out = out.replace(/!\[([^\]]*)\]\((https?:[^)]+)\)/g, (m, alt) => (alt ? `\`${alt}\`` : ''));
  return out;
}

/** Short label + tone for a Tracked Response state (used on the message badge + the list). */
function trackStateLabel(state) {
  switch (state) {
    case 'watching': return { text: t('inbox.trackStateWatching'), tone: 'watch' };
    case 'awaiting-approval': return { text: t('inbox.trackStateAwaiting'), tone: 'ready' };
    case 'replied': return { text: t('inbox.trackStateReplied'), tone: 'done' };
    case 'error': return { text: t('inbox.trackStateError'), tone: 'err' };
    case 'sent': return { text: t('inbox.trackStateWatching'), tone: 'watch' };
    default: return { text: state || '', tone: 'watch' };
  }
}

function MessageBubble({ msg, mine, urlMap, starred, onStar, onTrack, tracked }) {
  const nonInline = (msg.attachments || []).filter(a => !a.inline);
  const expiredIds = new Set((msg.attachments || []).filter(a => a.expired).map(a => a.id));
  const trk = tracked ? trackStateLabel(tracked.state) : null;
  return html`
    <div class=${`inbox-row ${mine ? 'inbox-row--mine' : 'inbox-row--theirs'}`}>
      ${!mine ? html`<${Avatar} seed=${msg.senderGhii} size=${28} />` : null}
      <div class=${`inbox-bubble ${mine ? 'inbox-bubble--mine' : 'inbox-bubble--theirs'}`}>
        <div class="inbox-bubble-actions">
          <button class=${`inbox-bubble-act${starred ? ' inbox-bubble-act--on' : ''}`} title=${t('inbox.markImportant')}
            onClick=${() => onStar?.(msg)}>${starred ? '⭐' : '☆'}</button>
          <button class=${`inbox-bubble-act${tracked ? ' inbox-bubble-act--on' : ''}`}
            title=${tracked ? `${t('inbox.trackResponse')} — ${trk.text}` : t('inbox.trackResponse')}
            onClick=${() => onTrack?.(msg)}>🔗</button>
        </div>
        <div class="inbox-bubble-body"><${Markdown} text=${prepareBody(msg.body, urlMap, expiredIds)} /></div>
        ${nonInline.length > 0 && html`
          <div class="inbox-attach-row">
            ${nonInline.map(a => html`
              <a key=${a.id} class=${`inbox-attach-chip${(urlMap[a.id] && !a.expired) ? '' : ' inbox-attach-chip--pending'}`}
                href=${(urlMap[a.id] && !a.expired) ? urlMap[a.id] : '#'} target="_blank" rel="noopener">
                <span class="inbox-attach-ico">${a.kind === 'image' ? '🖼' : a.kind === 'audio' ? '🎵' : a.kind === 'video' ? '🎬' : '📎'}</span>
                <span class="inbox-attach-name">${escHtml(a.name || a.storageKey)}</span>
                ${a.expired ? html`<span class="inbox-attach-pending">${t('inbox.attachmentExpired')}</span>`
                  : a.mode !== 'duplicate' ? html`<span class="inbox-attach-pending">${t('inbox.attachmentPending')}</span>` : null}
              </a>`)}
          </div>`}
        <div class="inbox-bubble-meta">
          ${trk ? html`<span class=${`inbox-track-badge inbox-track-badge--${trk.tone}`} title=${t('inbox.trackResponse')}>🔗 ${trk.text}</span>` : null}
          <span>${timeShort(msg.createdAt)}</span>
          ${mine && msg.status ? html`<span class=${`inbox-tick${msg.status === 'read' ? ' inbox-tick--read' : ''}${(msg.status === 'failed' || msg.status === 'undeliverable') ? ' inbox-tick--err' : ''}`}>${statusTick(msg.status)}</span>` : null}
        </div>
      </div>
    </div>`;
}

/* Composer — the Toast UI editor (Markdown⇄WYSIWYG toggle, same as workspace documents), with a
 * markdown-textarea + live-preview fallback if the editor can't load. Owns its own draft + file
 * state; calls onSend(recipient, markdown, files, reset). Remount it (via key) per conversation so
 * the draft doesn't leak between threads. */
function Composer({ recipient, sendLabel, sending, onSend, initialText = '' }) {
  const [mode, setMode] = useState('rich');     // 'rich' = Toast UI; 'markdown' = fallback textarea
  const [md, setMd] = useState(initialText);
  const [files, setFiles] = useState([]);
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (mode !== 'rich') return undefined;
    let inst = null, cancelled = false;
    (async () => {
      const Editor = await loadToastUI().catch(() => null);
      if (cancelled) return;
      if (!Editor) { setMode('markdown'); return; }
      if (!containerRef.current) return;
      inst = new Editor({
        el: containerRef.current,
        height: '160px',
        initialEditType: 'markdown',     // open in markdown mode; the built-in toggle switches to WYSIWYG
        previewStyle: 'tab',
        initialValue: initialText || '', // seed the suggested reply (Composer remounts via key on change)
        usageStatistics: false,
        toolbarItems: [
          ['bold', 'italic', 'strike'],
          ['ul', 'ol', 'task'],
          ['quote', 'code', 'codeblock'],
          ['link'],
        ],
      });
      editorRef.current = inst;
    })();
    return () => {
      cancelled = true;
      if (inst) { try { inst.destroy(); } catch { /* noop */ } }
      editorRef.current = null;
    };
  }, [mode]);

  // Seed the rich editor with an initial draft (e.g. a Tracked Response suggested reply) once it mounts.
  useEffect(() => {
    if (mode === 'rich' && initialText && editorRef.current) {
      try { editorRef.current.setMarkdown(initialText); } catch { /* noop */ }
    }
  }, [mode, initialText]);

  const getText = () => (mode === 'rich' && editorRef.current) ? editorRef.current.getMarkdown() : md;
  const reset = () => {
    try { editorRef.current?.setMarkdown(''); } catch { /* noop */ }
    setMd(''); setFiles([]); if (fileRef.current) fileRef.current.value = '';
  };
  const submit = () => onSend(recipient, getText(), files, reset);

  return html`
    <div class="inbox-composer">
      ${files.length > 0 ? html`<div class="inbox-file-chips">
        ${files.map((f, i) => html`<span class="inbox-file-chip" key=${i}>📎 ${escHtml(f.name)}</span>`)}
      </div>` : null}
      ${mode === 'rich'
        ? html`<div class="inbox-editor" ref=${containerRef}></div>`
        : html`<div class="inbox-md-fallback">
            <textarea class="inbox-textarea" rows="3" placeholder=${t('inbox.bodyPlaceholder')}
              value=${md} onInput=${(e) => setMd(e.target.value)}></textarea>
            <div class="inbox-md-preview"><${Markdown} text=${md} /></div>
          </div>`}
      <div class="inbox-composer-bar">
        <label class="inbox-attach-btn" title=${t('inbox.attach')}>
          📎<input ref=${fileRef} type="file" multiple hidden onChange=${(e) => setFiles(Array.from(e.target.files || []))} />
        </label>
        <button class="btn-primary btn-sm" disabled=${sending || !recipient} onClick=${submit}>
          ${sending ? t('inbox.sending') : sendLabel}
        </button>
      </div>
    </div>`;
}

export default function InboxTab({ showToast }) {
  const [requests, setRequests] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);     // { conversationId, peerGhii }
  const [thread, setThread] = useState([]);
  const [urlMap, setUrlMap] = useState({});
  const [mode, setMode] = useState('idle');               // 'idle' | 'compose' | 'thread'
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [important, setImportant] = useState(new Set());  // message ids flagged important (Tier 1)
  const [trackedList, setTrackedList] = useState([]);     // active Tracked Responses (Tier 2)
  const [trackMsg, setTrackMsg] = useState(null);         // message being tracked (opens modal)
  const [draftPrefill, setDraftPrefill] = useState('');   // suggested reply seeded into the composer
  const [replyingTrId, setReplyingTrId] = useState(null); // contract id whose approved reply is being sent
  const [awaitingDrafts, setAwaitingDrafts] = useState({}); // tr.id → suggested reply body (for the bubble)
  const msgsRef = useRef(null);
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

  // Clicking 🔗: if the message already has an ACTIVE tracked response, surface it (don't make a
  // duplicate); a finished (replied) one may be tracked again as a fresh task.
  const onTrackMsg = (msg) => {
    const existing = trackedByMsg[msg.id];
    if (existing && existing.state !== 'replied') { showToast?.(t('inbox.trackAlready')); setMode('tracked'); return; }
    setTrackMsg(msg);
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

  const useSuggestedReply = async (tr) => {
    const d = await tracked.getTrackedResponseDraft(tr.id).catch(() => null);
    setDraftPrefill(d?.draft?.body || awaitingDrafts[tr.id] || '');
    setReplyingTrId(tr.id);
  };

  // Open the workspace record this tracked response watches (so you can jump straight to the bug).
  const openRecord = (tr) => {
    const r = tr.references || {};
    if (!r.organismId || !r.workspaceId) { showToast?.(t('inbox.trackNoRecord'), true); return; }
    try {
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
  }, [awaitingIds]);

  const loadThread = useCallback(async (conv) => {
    if (!conv) return;
    const msgs = (await messages.getConversation(conv.conversationId).catch(() => [])).slice().reverse();
    setThread(msgs);
    const map = {};
    await Promise.all(msgs.flatMap(m => (m.attachments || [])
      .filter(a => a.mode === 'duplicate' && a.localKey)
      .map(async a => { const u = await messages.attachmentUrl(a.localKey).catch(() => null); if (u) map[a.id] = u; })));
    setUrlMap(map);
    await messages.markConversationRead(conv.conversationId).catch(() => {});
  }, []);

  useEffect(() => { loadLists(); }, [loadLists]);

  const liveRef = useRef(null);
  liveRef.current = () => { loadLists(); if (activeConv) loadThread(activeConv); };
  // Coalesce a burst of SSE 'change' events into one refresh — on a multi-node node these arrive
  // rapidly and uncoalesced re-fetches make the list flicker (different replicas, different states).
  const liveTimerRef = useRef(null);
  useEffect(() => {
    const handler = () => {
      if (liveTimerRef.current) return;
      liveTimerRef.current = setTimeout(() => { liveTimerRef.current = null; liveRef.current?.(); }, 700);
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => { window.removeEventListener('aimeat-live-update', handler); if (liveTimerRef.current) clearTimeout(liveTimerRef.current); };
  }, []);

  useEffect(() => {
    if (mode === 'thread' && msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [thread, mode]);

  const openConversation = async (conv) => {
    setActiveConv(conv); setMode('thread');
    setDraftPrefill(''); setReplyingTrId(null);   // don't leak a suggested reply across threads
    await loadThread(conv);
    loadLists();
  };
  const startCompose = () => { setMode('compose'); setActiveConv(null); setTo(''); };

  // Open the conversation for a tracked response, then (for awaiting-approval) seed the suggested reply.
  const openTracked = async (tr) => {
    if (!tr.source?.conversationId) return;
    await openConversation({ conversationId: tr.source.conversationId, peerGhii: tr.source.peerGhii });
    if (tr.state === 'awaiting-approval') await useSuggestedReply(tr);
  };

  // Open a specific thread when arriving from a notification deep-link (sessionStorage hint set by
  // the notification bell). 'requests' just lands on the inbox (requests show at the top of the list).
  const consumeDeepLink = useCallback(async () => {
    let target = null;
    try { target = sessionStorage.getItem('aimeat.inbox.open'); } catch { /* noop */ }
    if (!target) return;
    try { sessionStorage.removeItem('aimeat.inbox.open'); } catch { /* noop */ }
    if (target === 'requests') { await loadLists(); return; }
    const convs = await messages.listConversations().catch(() => []);
    const conv = convs.find(c => c.conversationId === target);
    if (conv) openConversation(conv);
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
      const resp = await messages.send({ to: recipient, body, attachments });
      if (resp?.ok === false) { showToast?.(resp?.error?.message || t('inbox.failed'), true); }
      else {
        reset?.();
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
  const renderList = () => html`
    <div class="inbox-list">
      ${requests.length > 0 ? html`
        <div class="inbox-list-section">${t('inbox.requests')} <span class="inbox-count">${requests.length}</span></div>
        ${requests.map(r => html`
          <div class="inbox-request" key=${r.contactId}>
            <div class="inbox-request-top">
              <${Avatar} seed=${r.contactId} size=${36} />
              <div class="inbox-request-id">
                <div class="inbox-name">${escHtml(peerName(r.contactId))} <${PresenceDot} ghii=${r.contactId} /></div>
                <div class="inbox-sub">${escHtml(r.contactId)}</div>
              </div>
            </div>
            <div class="inbox-request-preview">${escHtml(r.preview || '')}</div>
            <div class="inbox-request-actions">
              <button class="btn-success btn-sm" onClick=${() => accept(r.contactId)}>${t('inbox.accept')}</button>
              <button class="btn-outline btn-sm" onClick=${() => block(r.contactId)}>${t('inbox.block')}</button>
            </div>
          </div>`)}` : null}

      <div class="inbox-list-section">${t('inbox.conversations')}</div>
      ${conversations.length === 0 ? html`<div class="inbox-empty-sm">${t('inbox.noConversations')}</div>` : null}
      ${conversations.map(c => html`
        <button class=${`inbox-conv${activeConv?.conversationId === c.conversationId ? ' inbox-conv--active' : ''}`}
          key=${c.conversationId} onClick=${() => openConversation(c)}>
          <${Avatar} seed=${c.peerGhii} size=${40} />
          <div class="inbox-conv-main">
            <div class="inbox-conv-line1">
              <span class="inbox-name">${escHtml(peerName(c.peerGhii))} <${PresenceDot} ghii=${c.peerGhii} /></span>
              <span class="inbox-conv-time">${c.updatedAt ? timeShort(c.updatedAt) : ''}</span>
            </div>
            <div class="inbox-conv-line2">
              <span class="inbox-conv-preview">${c.lastDirection === 'outbound' ? `${t('inbox.youPrefix')} ` : ''}${escHtml(c.lastMessage || '')}</span>
              ${c.unread > 0 ? html`<span class="inbox-conv-badge">${c.unread}</span>` : null}
            </div>
          </div>
        </button>`)}
    </div>`;

  const renderThread = () => {
    let lastDay = '';
    return html`
      <div class="inbox-panel">
        <div class="inbox-thread-head">
          <${Avatar} seed=${activeConv.peerGhii} size=${36} />
          <div class="inbox-thread-id">
            <div class="inbox-name">${escHtml(peerName(activeConv.peerGhii))} <${PresenceDot} ghii=${activeConv.peerGhii} label=${true} /></div>
            <div class="inbox-sub">${escHtml(activeConv.peerGhii)}</div>
          </div>
        </div>
        <div class="inbox-msgs" ref=${msgsRef}>
          ${thread.length === 0 ? html`<div class="inbox-empty-sm">${t('inbox.noThread')}</div>` : null}
          ${thread.map(m => {
            const dk = dayKey(m.createdAt);
            const showDay = dk !== lastDay; lastDay = dk;
            return html`
              ${showDay ? html`<div class="inbox-day" key=${'d' + m.id}><span>${dayLabel(m.createdAt)}</span></div>` : null}
              <${MessageBubble} key=${m.id + m.direction} msg=${m} mine=${m.direction === 'outbound'} urlMap=${urlMap}
                starred=${important.has(m.id)} onStar=${toggleImportant} onTrack=${onTrackMsg} tracked=${trackedByMsg[m.id]} />`;
          })}
        </div>
        ${awaitingForConv.map(tr => html`
          <div class="inbox-row inbox-row--mine" key=${tr.id}>
            <div class="inbox-bubble inbox-bubble--mine inbox-bubble--draft">
              <div class="inbox-draft-label">🔗 ${t('inbox.trackReady')}</div>
              <div class="inbox-bubble-body"><${Markdown} text=${awaitingDrafts[tr.id] || tr.title || ''} /></div>
              <div class="inbox-draft-actions">
                <button class="btn-ghost btn-sm" onClick=${() => openRecord(tr)} title=${t('inbox.trackOpenRecord')}>📄 ${t('inbox.trackOpenRecord')}</button>
                <button class="btn-ghost btn-sm" onClick=${() => cancelTracked(tr)}>${t('inbox.trackReject')}</button>
                <button class="btn-primary btn-sm" onClick=${() => useSuggestedReply(tr)}>${t('inbox.trackApprove')}</button>
              </div>
            </div>
          </div>`)}
        <${Composer} key=${'c-' + activeConv.conversationId + (draftPrefill ? '-d' : '')} recipient=${activeConv.peerGhii}
          sendLabel=${t('inbox.reply')} sending=${sending} onSend=${doSend} initialText=${draftPrefill} />
      </div>`;
  };

  // Tracked-responses dashboard: every contract + its state, with open / approve-now / cancel actions.
  const recordLabel = (tr) => {
    const rec = tr.references?.records?.[0];
    if (rec?.namespace) return `${rec.namespace}/${rec.id}`;
    const k = tr.watch?.key || '';
    const parts = k.split('.');
    return parts.slice(-2).join('.') || k;
  };
  const renderTrackedList = () => html`
    <div class="inbox-panel">
      <div class="inbox-thread-head">
        <div class="inbox-name">🔗 ${t('inbox.trackedTitle')} <span class="inbox-count">${trackedList.length}</span></div>
      </div>
      <div class="inbox-tracked-list">
        ${trackedList.length === 0 ? html`<div class="inbox-empty-sm">${t('inbox.trackedEmpty')}</div>` : null}
        ${trackedList.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(tr => {
          const trk = trackStateLabel(tr.state);
          return html`
            <div class="inbox-tracked-row" key=${tr.id}>
              <div class="inbox-tracked-main">
                <div class="inbox-tracked-line1">
                  <span class=${`inbox-track-badge inbox-track-badge--${trk.tone}`}>${trk.text}</span>
                  <span class="inbox-tracked-name">${escHtml(tr.title || t('inbox.trackResponse'))}</span>
                </div>
                <div class="inbox-tracked-sub">
                  ${t('inbox.trackedTo')} ${escHtml(peerName(tr.source?.peerGhii || ''))}
                  · ${t('inbox.trackedWatching')} <code>${escHtml(recordLabel(tr))}</code>
                  · ${tr.response?.mode === 'auto' ? t('inbox.trackModeAuto') : t('inbox.trackModeApprove')}
                  ${tr.tracking?.lastError ? html` · <span class="inbox-tracked-err">${escHtml(tr.tracking.lastError)}</span>` : null}
                </div>
              </div>
              <div class="inbox-tracked-actions">
                ${tr.references?.organismId ? html`<button class="btn-ghost btn-sm" onClick=${() => openRecord(tr)} title=${t('inbox.trackOpenRecord')}>📄</button>` : null}
                ${tr.state === 'awaiting-approval'
                  ? html`<button class="btn-primary btn-sm" onClick=${() => openTracked(tr)}>${t('inbox.trackApprove')}</button>`
                  : html`<button class="btn-outline btn-sm" onClick=${() => openTracked(tr)}>${t('inbox.trackedOpen')}</button>`}
                ${tr.state !== 'replied' ? html`<button class="btn-ghost btn-sm" onClick=${() => cancelTracked(tr)}>${t('inbox.trackedCancel')}</button>` : null}
              </div>
            </div>`;
        })}
      </div>
    </div>`;

  return html`
    <div class="inbox">
      <div class="inbox-head">
        <div>
          <div class="section-title">${t('inbox.title')}</div>
          <div class="section-desc">${t('inbox.desc')}</div>
        </div>
        <div class="inbox-head-actions">
          <button class=${`btn-outline${mode === 'tracked' ? ' btn-outline--active' : ''}${awaitingCount ? ' btn-outline--active' : ''}`} onClick=${() => { setMode('tracked'); setActiveConv(null); }}
            title=${awaitingCount ? t('inbox.trackReady') : ''}>
            🔗 ${t('inbox.trackedTitle')}${trackedList.length ? html` <span class="inbox-count">${trackedList.length}</span>` : ''}
          </button>
          <button class="btn-primary" onClick=${startCompose}>✉️ ${t('inbox.new')}</button>
        </div>
      </div>

      <div class="inbox-body">
        ${renderList()}

        ${mode === 'compose' ? html`
          <div class="inbox-panel">
            <div class="inbox-thread-head"><div class="inbox-name">${t('inbox.new')}</div></div>
            <div class="inbox-compose-fields">
              <input class="inbox-input" type="text" placeholder=${t('inbox.toPlaceholder')}
                value=${to} onInput=${(e) => setTo(e.target.value)} />
            </div>
            <${Composer} key="c-new" recipient=${to.trim()} sendLabel=${t('inbox.send')}
              sending=${sending} onSend=${doSend} />
          </div>` : null}

        ${mode === 'thread' && activeConv ? renderThread() : null}

        ${mode === 'tracked' ? renderTrackedList() : null}

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
    </div>`;
}
