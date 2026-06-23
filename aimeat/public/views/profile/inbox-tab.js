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
 * @structure InboxTab (default) · Composer (Toast UI) · MessageBubble · InteractiveForm · Avatar · helpers
 * @usage Lazy-loaded profile tab; registered in profile.js TABS as id `messages`.
 * @version-history
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
 *   v1.8.1 -- 2026-06-23 -- Perf: cache resolved attachment URLs per conversation. A refresh / new message
 *     reused to re-resolve EVERY attachment (fresh presigned URL each time → new <img src> → the whole
 *     image gallery re-downloaded on every send/reply — hundreds of MB on an image-heavy thread). Now only
 *     not-yet-resolved attachments are fetched; existing URLs stay stable so the browser doesn't re-fetch.
 *   v1.8.0 -- 2026-06-23 -- Send-to-many (broadcast): a 📢 Broadcast compose with a recipient-chip picker
 *     (+ Share Group audience) and a mode toggle — Message (repliable) vs Announcement (read-only). An
 *     announcement thread hides the reply composer for the recipient.
 *   v1.7.4 -- 2026-06-23 -- Recipient suggestions when composing: the "to" field autocompletes (datalist)
 *     with your own agents (GAIIs, labelled) + everyone you have a thread with — no retyping long GAIIs.
 *   v1.7.3 -- 2026-06-23 -- Show an AGENT's own presence dot on its conversation row (a nested agent row
 *     now renders <PresenceDot> for the agent GAII — connected = available, recently-seen = away, else
 *     offline — instead of nothing). The owner group header still shows the human's presence.
 *   v1.7.2 -- 2026-06-23 -- Delivery ticks now distinguish delivered from sent: delivered = ✓✓ (grey,
 *     "reached the mailbox" — incl. agent threads, which never send a read receipt), read = ✓✓ coloured,
 *     sent = ✓, queued = clock. Previously delivered rendered as a single ✓ identical to sent, so an
 *     agent DM never showed a "got there" confirmation.
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
import { t, getLocale } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Markdown } from '/components/Markdown.js';
import { minidenticon } from '/lib/minidenticons.min.js';
import { PresenceDot } from '/components/PresenceDot.js';
import * as messages from '/js/services/messages.js';
import * as tracked from '/js/services/tracked-responses.js';
import * as agentsSvc from '/js/services/agents.js';
import { apiGet } from '/js/api.js';
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

// ── Grouping a person + their agents ──
// A peer is a human GHII (owner@node), an agent GAII (agent#owner@node) or an app GEAI
// (eco:app#owner@node). They all belong to ONE person — the owner — so we group conversations under
// the owner key and keep each thread separate beneath it.
function ownerKeyOf(ghii) {
  const s = String(ghii || '');
  const hash = s.indexOf('#');                 // 'agent#owner@node' / 'eco:app#owner@node' → 'owner@node'
  return hash >= 0 ? s.slice(hash + 1) : s;    // human 'owner@node' → itself
}
function isAgentPeer(ghii) { return String(ghii).includes('#'); }
function ownerDisplayName(ownerKey) { return String(ownerKey).split('@')[0]; }
/** Label for one thread INSIDE a person group: the agent/app id before '#', or null for the human thread. */
function subThreadLabel(ghii) {
  const at = String(ghii || '').split('@')[0];
  return at.includes('#') ? at.split('#')[0] : null;
}
/** Group conversations by the owner behind each peer, preserving input (recency) order. */
function groupConversations(conversations) {
  const map = new Map();
  for (const c of conversations) {
    const key = ownerKeyOf(c.peerGhii);
    if (!map.has(key)) map.set(key, { ownerKey: key, convs: [] });
    map.get(key).convs.push(c);
  }
  return [...map.values()];
}

function Avatar({ seed, size = 36 }) {
  const svg = minidenticon(seed || 'user');
  return html`<span class="inbox-avatar" style=${`width:${size}px;height:${size}px`}
    dangerouslySetInnerHTML=${{ __html: svg }}></span>`;
}

// WhatsApp-style ticks: sent = one ✓; delivered (reached the recipient's mailbox, incl. an agent's) =
// two ✓✓ (grey); read (read receipt — humans send one, agents don't yet) = two ✓✓ coloured via
// inbox-tick--read; queued (cross-node, peer unreachable) = a clock.
const TICK = { sent: '✓', delivered: '✓✓', read: '✓✓', queued: '🕒', failed: '⚠', undeliverable: '⚠' };
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

/** Classify an attachment for rendering: how to view it (thumbnail / native tab / markdown viewer). */
const ATTACH_ICO = { image: '🖼', pdf: '📄', markdown: '📄', audio: '🎵', video: '🎬', file: '📎' };
function attachKind(a) {
  const mime = a.mime || '';
  const name = a.name || a.storageKey || '';
  if (a.kind === 'image' || /^image\//.test(mime)) return 'image';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (/markdown/.test(mime) || /\.(md|markdown|mdx)$/i.test(name)) return 'markdown';
  if (a.kind === 'audio' || /^audio\//.test(mime)) return 'audio';
  if (a.kind === 'video' || /^video\//.test(mime)) return 'video';
  return 'file';
}

/** One received/sent attachment. Images render as a thumbnail (click → full-size in a new tab);
 *  PDF/audio/video/file open natively in a new tab; markdown opens the in-app rendered viewer. Every
 *  ready attachment gets a download button. Not-yet-duplicated / expired attachments show their state. */
function AttachmentItem({ a, url, onOpenMarkdown }) {
  const kind = attachKind(a);
  const name = a.name || a.storageKey;
  const ready = !!url && !a.expired;

  if (!ready) {
    const status = a.expired ? t('inbox.attachmentExpired') : (a.mode !== 'duplicate' ? t('inbox.attachmentPending') : null);
    return html`<div class="inbox-attach-chip inbox-attach-chip--pending">
      <span class="inbox-attach-ico">${ATTACH_ICO[kind]}</span>
      <span class="inbox-attach-name">${escHtml(name)}</span>
      ${status ? html`<span class="inbox-attach-pending">${status}</span>` : null}
    </div>`;
  }

  const download = html`<a class="inbox-attach-dl" href=${url} download=${name} title=${t('inbox.attachmentDownload')}>⬇</a>`;

  if (kind === 'image') {
    return html`<div class="inbox-attach-item">
      <a class="inbox-attach-thumb-link" href=${url} target="_blank" rel="noopener" title=${t('inbox.attachmentOpen')}>
        <img class="inbox-attach-thumb" src=${url} alt=${escHtml(name)} loading="lazy" />
      </a>
      <div class="inbox-attach-cap"><span class="inbox-attach-name">${escHtml(name)}</span>${download}</div>
    </div>`;
  }
  if (kind === 'markdown') {
    return html`<div class="inbox-attach-chip">
      <button class="inbox-attach-open" onClick=${() => onOpenMarkdown?.(url, name)} title=${t('inbox.attachmentView')}>
        <span class="inbox-attach-ico">📄</span><span class="inbox-attach-name">${escHtml(name)}</span>
      </button>${download}
    </div>`;
  }
  // pdf / audio / video / file — let the browser open it in a new tab.
  return html`<div class="inbox-attach-chip">
    <a class="inbox-attach-open" href=${url} target="_blank" rel="noopener" title=${t('inbox.attachmentOpen')}>
      <span class="inbox-attach-ico">${ATTACH_ICO[kind]}</span><span class="inbox-attach-name">${escHtml(name)}</span>
    </a>${download}
  </div>`;
}

/** In-app viewer for a markdown attachment — browsers don't render .md, so we fetch the (same-origin,
 *  presigned) file and render it with the shared safe Markdown component. Offers open-raw + download. */
function MarkdownViewer({ url, name, onClose }) {
  const [text, setText] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(url).then(r => r.ok ? r.text() : Promise.reject(new Error('http'))).then(tx => { if (alive) setText(tx); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [url]);
  return html`
    <div class="inbox-mdviewer-overlay" onClick=${onClose}>
      <div class="inbox-mdviewer" onClick=${e => e.stopPropagation()}>
        <div class="inbox-mdviewer-head">
          <span class="inbox-mdviewer-title">📄 ${escHtml(name)}</span>
          <div class="inbox-mdviewer-actions">
            <a class="btn-ghost btn-sm" href=${url} target="_blank" rel="noopener">${t('inbox.attachmentOpenRaw')}</a>
            <a class="btn-ghost btn-sm" href=${url} download=${name}>${t('inbox.attachmentDownload')}</a>
            <button class="btn-ghost btn-sm" onClick=${onClose} title=${t('inbox.close')}>✕</button>
          </div>
        </div>
        <div class="inbox-mdviewer-body">
          ${failed ? html`<div class="inbox-empty-sm">${t('inbox.attachmentLoadError')}</div>`
            : text === null ? html`<div class="inbox-empty-sm">…</div>`
            : html`<${Markdown} text=${text} />`}
        </div>
      </div>
    </div>`;
}

// Sentinel option id for the freeform "Other" choice (never collides with a real option id).
const IFORM_OTHER = '__other__';

/** Build the human-readable markdown summary that becomes the reply body (so the thread + un-upgraded
 *  peers read the answer naturally, alongside the machine-readable `interactive.answers`). */
function buildAnswerSummary(spec, answers) {
  const lines = [`**${t('inbox.answer.summaryTitle')}**`];
  for (const q of (spec?.questions || [])) {
    const a = answers[q.id] || { selected: [], other: null };
    const labels = (q.options || []).filter(o => a.selected.includes(o.id)).map(o => o.label);
    if (a.other) labels.push(`${t('inbox.answer.other')}: ${a.other}`);
    lines.push(`- ${q.header || q.prompt}: ${labels.length ? labels.join(', ') : '—'}`);
  }
  return lines.join('\n');
}

/** The interactive question form rendered inline in the thread (a federated AskUserQuestion): radio
 *  groups (single-select), checkbox groups (multiSelect), an always-available "Other" freeform, and a
 *  Submit button gated until every `required` question is answered. */
function InteractiveForm({ spec, submitting, onSubmit }) {
  const questions = spec?.questions || [];
  const [sel, setSel] = useState(() => {
    const init = {};
    for (const q of questions) init[q.id] = { picks: new Set(), other: '' };
    return init;
  });
  const setQ = (qid, updater) => setSel(prev => ({ ...prev, [qid]: updater(prev[qid] || { picks: new Set(), other: '' }) }));
  const pickSingle = (qid, optId) => setQ(qid, s => ({ picks: new Set([optId]), other: optId === IFORM_OTHER ? s.other : '' }));
  const toggleMulti = (qid, optId) => setQ(qid, s => {
    const picks = new Set(s.picks);
    if (picks.has(optId)) picks.delete(optId); else picks.add(optId);
    return { picks, other: picks.has(IFORM_OTHER) ? s.other : '' };
  });
  const setOther = (qid, text) => setQ(qid, s => ({ picks: s.picks, other: text }));

  const answeredOk = (q) => {
    const s = sel[q.id]; if (!s) return false;
    const realPicks = [...s.picks].filter(p => p !== IFORM_OTHER);
    const otherOk = s.picks.has(IFORM_OTHER) && s.other.trim().length > 0;
    return realPicks.length > 0 || otherOk;
  };
  const canSubmit = questions.every(q => !q.required || answeredOk(q));

  const submit = () => {
    if (!canSubmit || submitting) return;
    const answers = {};
    for (const q of questions) {
      const s = sel[q.id] || { picks: new Set(), other: '' };
      const selected = [...s.picks].filter(p => p !== IFORM_OTHER);
      const other = (s.picks.has(IFORM_OTHER) && s.other.trim()) ? s.other.trim() : null;
      answers[q.id] = { selected, other };
    }
    onSubmit?.(answers);
  };

  const renderOpt = (q, optId, label) => {
    const multi = !!q.multiSelect;
    const on = sel[q.id]?.picks.has(optId);
    return html`
      <label class=${`inbox-iform-opt${on ? ' inbox-iform-opt--on' : ''}`} key=${optId}>
        <input type=${multi ? 'checkbox' : 'radio'} name=${`q-${q.id}`} checked=${!!on}
          onChange=${() => multi ? toggleMulti(q.id, optId) : pickSingle(q.id, optId)} />
        <span class="inbox-iform-opt-label">${escHtml(label)}</span>
      </label>`;
  };

  return html`
    <div class="inbox-iform">
      ${questions.map(q => html`
        <div class="inbox-iform-q" key=${q.id}>
          ${q.header ? html`<span class="inbox-iform-chip">${escHtml(q.header)}</span>` : null}
          <div class="inbox-iform-prompt">${escHtml(q.prompt)}${q.required ? html`<span class="inbox-iform-req"> *</span>` : null}</div>
          <div class="inbox-iform-opts" role=${q.multiSelect ? 'group' : 'radiogroup'}>
            ${(q.options || []).map(o => renderOpt(q, o.id, o.label))}
            ${q.allowOther !== false ? html`
              ${renderOpt(q, IFORM_OTHER, t('inbox.answer.other'))}
              ${sel[q.id]?.picks.has(IFORM_OTHER) ? html`
                <input class="inbox-iform-other" type="text" value=${sel[q.id]?.other || ''}
                  placeholder=${t('inbox.answer.otherPlaceholder')} onInput=${e => setOther(q.id, e.target.value)} />` : null}` : null}
          </div>
        </div>`)}
      <button class="btn-primary btn-sm inbox-iform-submit" disabled=${!canSubmit || submitting} onClick=${submit}>
        ${submitting ? t('inbox.sending') : (spec?.submitLabel || t('inbox.answer.send'))}
      </button>
    </div>`;
}

/** Read-only summary shown on a question bubble once it has been answered. */
function InteractiveAnswered({ spec, answers }) {
  return html`
    <div class="inbox-iform inbox-iform--done">
      ${(spec?.questions || []).map(q => {
        const a = answers[q.id] || { selected: [], other: null };
        const labels = (q.options || []).filter(o => a.selected.includes(o.id)).map(o => o.label);
        if (a.other) labels.push(`${t('inbox.answer.other')}: ${a.other}`);
        return html`
          <div class="inbox-iform-q" key=${q.id}>
            <span class="inbox-iform-chip">${escHtml(q.header || q.prompt)}</span>
            <div class="inbox-iform-answered">✓ ${labels.length ? escHtml(labels.join(', ')) : '—'}</div>
          </div>`;
      })}
    </div>`;
}

/** Compose the questions for a poll broadcast (a fanned-out AskUserQuestion). Controlled — owns no state;
 *  edits go through setQuestions. */
function PollBuilder({ questions, setQuestions }) {
  const uid = () => 'q' + Math.random().toString(36).slice(2, 8);
  const oid = () => 'o' + Math.random().toString(36).slice(2, 8);
  const update = (i, patch) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const addQ = () => setQuestions([...questions, {
    id: uid(), header: '', prompt: '', options: [{ id: oid(), label: '' }, { id: oid(), label: '' }],
    multiSelect: false, allowOther: true, required: false,
  }]);
  const removeQ = (i) => setQuestions(questions.filter((_, j) => j !== i));
  const updateOpt = (qi, oi, label) => update(qi, { options: questions[qi].options.map((o, j) => (j === oi ? { ...o, label } : o)) });
  const addOpt = (qi) => update(qi, { options: [...questions[qi].options, { id: oid(), label: '' }] });
  const removeOpt = (qi, oi) => update(qi, { options: questions[qi].options.filter((_, j) => j !== oi) });

  return html`
    <div class="inbox-poll-builder">
      ${questions.map((q, qi) => html`
        <div class="inbox-poll-q" key=${q.id}>
          <div class="inbox-poll-q-head">
            <span class="inbox-poll-q-n">${qi + 1}.</span>
            <input class="inbox-input" placeholder=${t('inbox.pollHeader')} value=${q.header} onInput=${(e) => update(qi, { header: e.target.value })} />
            <button class="inbox-bc-chip-x" title=${t('inbox.pollRemoveQ')} onClick=${() => removeQ(qi)}>✕</button>
          </div>
          <input class="inbox-input" placeholder=${t('inbox.pollPrompt')} value=${q.prompt} onInput=${(e) => update(qi, { prompt: e.target.value })} />
          <div class="inbox-poll-opts">
            ${q.options.map((o, oi) => html`<div class="inbox-poll-opt" key=${o.id}>
              <input class="inbox-input" placeholder=${`${t('inbox.pollOption')} ${oi + 1}`} value=${o.label} onInput=${(e) => updateOpt(qi, oi, e.target.value)} />
              ${q.options.length > 1 ? html`<button class="inbox-bc-chip-x" onClick=${() => removeOpt(qi, oi)}>✕</button>` : null}
            </div>`)}
            <button class="btn-ghost btn-sm" onClick=${() => addOpt(qi)}>+ ${t('inbox.pollAddOption')}</button>
          </div>
          <div class="inbox-poll-flags">
            <label><input type="checkbox" checked=${q.multiSelect} onChange=${(e) => update(qi, { multiSelect: e.target.checked })} /> ${t('inbox.pollMulti')}</label>
            <label><input type="checkbox" checked=${q.allowOther} onChange=${(e) => update(qi, { allowOther: e.target.checked })} /> ${t('inbox.pollAllowOther')}</label>
            <label><input type="checkbox" checked=${q.required} onChange=${(e) => update(qi, { required: e.target.checked })} /> ${t('inbox.pollRequired')}</label>
          </div>
        </div>`)}
      <button class="btn-outline btn-sm" onClick=${addQ}>+ ${t('inbox.pollAddQuestion')}</button>
    </div>`;
}

/** Aggregate poll answers across a broadcast's recipients into per-option tallies for the results view. */
function tallyPoll(spec, recipients) {
  const out = [];
  for (const q of (spec?.questions || [])) {
    const counts = {};
    const others = [];
    for (const o of (q.options || [])) counts[o.id] = 0;
    for (const r of recipients) {
      const a = r.answers?.[q.id];
      if (!a) continue;
      for (const sel of (a.selected || [])) if (sel in counts) counts[sel]++;
      if (a.other) others.push(a.other);
    }
    out.push({ q, counts, others });
  }
  return out;
}

function MessageBubble({ msg, mine, urlMap, starred, onStar, onTrack, tracked, onOpenMarkdown, answeredWith, onAnswer, submitting }) {
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
        ${msg.interactive?.role === 'questions' ? (
          answeredWith
            ? html`<${InteractiveAnswered} spec=${msg.interactive} answers=${answeredWith.answers || {}} />`
            : html`<${InteractiveForm} spec=${msg.interactive} submitting=${submitting}
                onSubmit=${(answers) => onAnswer?.(msg, answers)} />`
        ) : null}
        ${nonInline.length > 0 && html`
          <div class="inbox-attach-row">
            ${nonInline.map(a => html`<${AttachmentItem} key=${a.id} a=${a} url=${urlMap[a.id]} onOpenMarkdown=${onOpenMarkdown} />`)}
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
function Composer({ recipient, sendLabel, sending, onSend, initialText = '', draftKey = '' }) {
  // Restore an in-progress draft for this conversation/compose (localStorage), or the passed initialText.
  const readDraft = () => { try { return draftKey ? (localStorage.getItem(draftKey) || '') : ''; } catch { return ''; } };
  const seeded = initialText || readDraft();   // an explicit suggested reply wins; else restore a draft
  const [mode, setMode] = useState('rich');     // 'rich' = Toast UI; 'markdown' = fallback textarea
  const [md, setMd] = useState(seeded);
  const [files, setFiles] = useState([]);
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const saveTimer = useRef(null);
  // Debounced auto-save of the draft (skipped when there's no key). Empty text clears the draft.
  const saveDraft = (text) => {
    if (!draftKey) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { if (text && text.trim()) localStorage.setItem(draftKey, text); else localStorage.removeItem(draftKey); } catch { /* quota */ }
    }, 400);
  };
  const clearDraft = () => { try { if (draftKey) localStorage.removeItem(draftKey); } catch { /* noop */ } };

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
        initialValue: seeded,            // seed from a saved draft / suggested reply (remounts via key)
        usageStatistics: false,
        // editorRef is set only AFTER construction, so the constructor's own change (initialValue) is
        // skipped — only real user edits auto-save the draft.
        events: { change: () => { if (editorRef.current) saveDraft(editorRef.current.getMarkdown()); } },
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
    clearDraft();   // a sent message is no longer a draft
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
              value=${md} onInput=${(e) => { setMd(e.target.value); saveDraft(e.target.value); }}></textarea>
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
  const [mdViewer, setMdViewer] = useState(null);         // { url, name } — open markdown attachment viewer
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
  const [myGroups, setMyGroups] = useState([]);           // the owner's Share Groups (audiences)
  const [resultsId, setResultsId] = useState(null);       // broadcast id whose results are shown
  const [results, setResults] = useState(null);           // fetched broadcast results
  const [recentBroadcasts, setRecentBroadcasts] = useState([]); // localStorage-tracked sent broadcasts
  const [sending, setSending] = useState(false);
  const [important, setImportant] = useState(new Set());  // message ids flagged important (Tier 1)
  const [trackedList, setTrackedList] = useState([]);     // active Tracked Responses (Tier 2)
  const [trackMsg, setTrackMsg] = useState(null);         // message being tracked (opens modal)
  const [draftPrefill, setDraftPrefill] = useState('');   // suggested reply seeded into the composer
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
  }, [awaitingIds]);

  // markRead=true ONLY when the user opens the conversation. Marking read POSTs a receipt which itself
  // emits a 'messages' change → SSE → live refresh; doing it on every live refresh creates a
  // self-sustaining request loop. So live refreshes reload the thread WITHOUT marking read.
  const loadThread = useCallback(async (conv, markRead = false) => {
    if (!conv) return;
    const msgs = (await messages.getConversation(conv.conversationId).catch(() => [])).slice().reverse();
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
        if (prev[a.id]) { map[a.id] = prev[a.id]; return; } // keep the stable URL → browser won't re-fetch
        // Inbound: only the recipient's duplicated local copy is fetchable (after accept). Outbound:
        // the sender owns the original storage key, so resolve that — you can view/download what you sent.
        const key = (a.mode === 'duplicate' && a.localKey) ? a.localKey
          : (m.direction === 'outbound' && a.storageKey) ? a.storageKey : null;
        if (!key) return;
        const u = await messages.attachmentUrl(key).catch(() => null);
        if (u) map[a.id] = u;
      })));
    urlCacheRef.current = { convId: conv.conversationId, map };
    setUrlMap(map);
    if (markRead) await messages.markConversationRead(conv.conversationId).catch(() => {});
  }, []);

  useEffect(() => { loadLists(); }, [loadLists]);
  // The owner's own agents — recipient suggestions when composing (so you don't retype long GAIIs).
  useEffect(() => { agentsSvc.listAgents().then(a => setMyAgents(a || [])).catch(() => {}); }, []);
  // The owner's Share Groups — reusable broadcast audiences (distribution lists).
  useEffect(() => { apiGet('/v1/groups').then(r => setMyGroups(r?.data?.groups || [])).catch(() => {}); }, []);

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
  }, []);

  useEffect(() => {
    if (mode === 'thread' && msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [thread, mode]);

  const openConversation = async (conv) => {
    setActiveConv(conv); setMode('thread');
    setDraftPrefill(''); setReplyingTrId(null);   // don't leak a suggested reply across threads
    await loadThread(conv, true);                 // mark read only on explicit open (avoids a refresh loop)
    loadLists();
  };
  const startCompose = () => { setMode('compose'); setActiveConv(null); setTo(''); setComposeSubject(''); };
  const startBroadcast = () => { setMode('broadcast'); setActiveConv(null); setBcRecipients([]); setBcInput(''); setBcMode('broadcast'); setBcGroupId(''); setBcType('message'); setBcQuestions([]); };
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
    if (bcRecipients.length === 0 && !bcGroupId) { showToast?.(t('inbox.bcNoRecipients'), true); return; }

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
        to: bcRecipients, groupId: bcGroupId || undefined,
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
      const resp = await messages.send({ to: recipient, body, attachments, subject, conversationId });
      if (resp?.ok === false) { showToast?.(resp?.error?.message || t('inbox.failed'), true); }
      else {
        reset?.();
        setComposeSubject('');
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
      ${groupConversations(conversations).map(g => {
        // A person with a single human-only thread (no agents) renders flat, as before.
        if (g.convs.length === 1 && !isAgentPeer(g.convs[0].peerGhii)) return convRow(g.convs[0], false);
        // Otherwise: a group header for the person + a nested row per thread (human + each agent).
        const unread = g.convs.reduce((n, c) => n + (c.unread || 0), 0);
        return html`
          <div class="inbox-conv-group" key=${g.ownerKey}>
            <div class="inbox-conv-group-head">
              <${Avatar} seed=${g.ownerKey} size=${28} />
              <span class="inbox-name">${escHtml(ownerDisplayName(g.ownerKey))} <${PresenceDot} ghii=${g.ownerKey} /></span>
              ${unread > 0 ? html`<span class="inbox-conv-badge">${unread}</span>` : null}
            </div>
            ${g.convs.map(c => convRow(c, true))}
          </div>`;
      })}
    </div>`;

  /** One conversation row. `nested` = inside a person group (labelled by the agent/thread, indented). */
  const convRow = (c, nested) => {
    const active = activeConv?.conversationId === c.conversationId ? ' inbox-conv--active' : '';
    const sub = subThreadLabel(c.peerGhii);
    // Nested: a subject thread shows its topic; otherwise the agent name / "Direct". Flat: the person.
    const label = nested ? (c.subject || sub || t('inbox.directThread')) : peerName(c.peerGhii);
    const icon = sub ? '🤖' : (c.subject ? '🏷' : '💬');
    return html`
      <button class=${`inbox-conv${active}${nested ? ' inbox-conv--nested' : ''}`} key=${c.conversationId} onClick=${() => openConversation(c)}>
        ${nested ? html`<span class="inbox-conv-subico">${icon}</span>` : html`<${Avatar} seed=${c.peerGhii} size=${40} />`}
        <div class="inbox-conv-main">
          <div class="inbox-conv-line1">
            <span class="inbox-name">${escHtml(label)} ${(!nested || c.peerGhii?.includes('#')) ? html`<${PresenceDot} ghii=${c.peerGhii} />` : ''}</span>
            <span class="inbox-conv-time">${c.updatedAt ? timeShort(c.updatedAt) : ''}</span>
          </div>
          <div class="inbox-conv-line2">
            ${(!nested && c.subject) ? html`<span class="inbox-conv-subject">🏷 ${escHtml(c.subject)}</span>` : ''}
            <span class="inbox-conv-preview">${c.lastDirection === 'outbound' ? `${t('inbox.youPrefix')} ` : ''}${escHtml(c.lastMessage || '')}</span>
            ${c.unread > 0 ? html`<span class="inbox-conv-badge">${c.unread}</span>` : null}
          </div>
        </div>
      </button>`;
  };

  const renderThread = () => {
    let lastDay = '';
    // Map each interactive QUESTION message id → the answers reply that fulfils it, so an answered
    // question renders its read-only summary instead of the (already-used) form.
    const answersByQ = {};
    for (const m of thread) {
      if (m.interactive?.role === 'answers' && m.interactive.answersFor) answersByQ[m.interactive.answersFor] = m.interactive;
    }
    // An announcement (a non-respondable broadcast) is read-only for the recipient — hide the composer.
    const isAnnouncement = thread.some(m => m.direction === 'inbound' && m.respondable === false);
    return html`
      <div class="inbox-panel">
        <div class="inbox-thread-head">
          <${Avatar} seed=${activeConv.peerGhii} size=${36} />
          <div class="inbox-thread-id">
            <div class="inbox-name">${escHtml(peerName(activeConv.peerGhii))} <${PresenceDot} ghii=${activeConv.peerGhii} label=${true} /></div>
            ${activeConv.subject ? html`<div class="inbox-thread-subject">🏷 ${escHtml(activeConv.subject)}</div>` : null}
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
                starred=${important.has(m.id)} onStar=${toggleImportant} onTrack=${onTrackMsg} tracked=${trackedByMsg[m.id]}
                answeredWith=${m.interactive?.role === 'questions' ? answersByQ[m.id] : null}
                onAnswer=${submitInteractiveAnswers} submitting=${sending}
                onOpenMarkdown=${(url, name) => setMdViewer({ url, name })} />`;
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
        ${isAnnouncement
          ? html`<div class="inbox-announce-note">📢 ${t('inbox.announcementNote')}</div>`
          : html`<${Composer} key=${'c-' + activeConv.conversationId + (draftPrefill ? '-d' : '')} recipient=${activeConv.peerGhii}
              sendLabel=${t('inbox.reply')} sending=${sending} onSend=${doSend} initialText=${draftPrefill}
              draftKey=${'aimeat.inbox.draft.' + activeConv.conversationId} />`}
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
        <div class="inbox-name">🔗 ${t('inbox.trackedTitle')} ${activeTracked.length ? html`<span class="inbox-count">${activeTracked.length}</span>` : ''}</div>
      </div>
      <div class="inbox-tracked-list">
        ${activeTracked.length === 0 ? html`<div class="inbox-empty-sm">${doneCount ? t('inbox.trackedAllDone') : t('inbox.trackedEmpty')}</div>` : null}
        ${activeTracked.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(tr => {
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
                ${tr.references?.organismId ? html`<button class="btn-outline btn-sm" onClick=${() => openRecord(tr)}>📄 ${t('inbox.trackOpenRecord')}</button>` : null}
                ${tr.state === 'awaiting-approval'
                  ? html`<button class="btn-primary btn-sm" onClick=${() => openTracked(tr)}>${t('inbox.trackApprove')}</button>`
                  : html`<button class="btn-ghost btn-sm" onClick=${() => openTracked(tr)} title=${t('inbox.trackedOpenConvo')}>💬</button>`}
                <button class="btn-ghost btn-sm" onClick=${() => cancelTracked(tr)}>${t('inbox.trackedCancel')}</button>
              </div>
            </div>`;
        })}
        ${doneCount ? html`<div class="inbox-tracked-done">✓ ${(t('inbox.trackedDoneCount') || '{n} completed').replace('{n}', String(doneCount))}</div>` : null}
      </div>
    </div>`;

  // Broadcast/poll results: a list of recent broadcasts, or the tallies for the selected one.
  const renderResults = () => {
    if (!resultsId) {
      return html`<div class="inbox-panel">
        <div class="inbox-thread-head"><div class="inbox-name">📊 ${t('inbox.resultsTitle')}</div></div>
        <div class="inbox-tracked-list">
          ${recentBroadcasts.length === 0 ? html`<div class="inbox-empty-sm">${t('inbox.resultsEmpty')}</div>` : null}
          ${recentBroadcasts.map(b => html`
            <button class="inbox-conv" key=${b.id} onClick=${() => openResults(b.id)}>
              <div class="inbox-conv-main">
                <div class="inbox-conv-line1">
                  <span class="inbox-name">${b.type === 'poll' ? '📊' : '📨'} ${escHtml(b.title)}</span>
                  <span class="inbox-conv-time">${b.createdAt ? timeShort(b.createdAt) : ''}</span>
                </div>
              </div>
            </button>`)}
        </div>
      </div>`;
    }
    const r = results;
    const isPoll = r?.interactive?.role === 'questions';
    const tallies = isPoll ? tallyPoll(r.interactive, r.recipients || []) : [];
    return html`<div class="inbox-panel">
      <div class="inbox-thread-head">
        <button class="btn-ghost btn-sm" onClick=${() => { setResultsId(null); setResults(null); }}>←</button>
        <div class="inbox-name">📊 ${t('inbox.resultsTitle')}</div>
      </div>
      <div class="inbox-msgs">
        ${!r ? html`<div class="inbox-empty-sm">…</div>` : html`
          <div class="inbox-results-summary">
            ${t('inbox.resultsRecipients')}: ${r.total} · ${t('inbox.resultsDelivered')}: ${r.delivered} · ${t('inbox.resultsRead')}: ${r.read}${isPoll ? ` · ${t('inbox.resultsAnswered')}: ${r.answered}` : ''}
          </div>
          ${tallies.map(({ q, counts, others }) => html`
            <div class="inbox-results-q" key=${q.id}>
              <div class="inbox-results-prompt">${escHtml(q.prompt)}</div>
              ${(q.options || []).map(o => {
                const n = counts[o.id] || 0;
                const pct = r.answered ? Math.round((n / r.answered) * 100) : 0;
                return html`<div class="inbox-results-bar" key=${o.id}>
                  <div class="inbox-results-bar-label"><span>${escHtml(o.label)}</span><span>${n}</span></div>
                  <div class="inbox-results-bar-track"><div class="inbox-results-bar-fill" style=${`--w:${pct}%`}></div></div>
                </div>`;
              })}
              ${others.length ? html`<div class="inbox-results-others">${t('inbox.answer.other')}: ${others.map(o => escHtml(o)).join(', ')}</div>` : null}
            </div>`)}
          ${!isPoll ? html`<div class="inbox-results-reclist">
            ${(r.recipients || []).map(rec => html`<div class="inbox-results-rec" key=${rec.recipient}><span>${escHtml(peerName(rec.recipient))}</span><span>${rec.status}</span></div>`)}
          </div>` : null}
        `}
      </div>
    </div>`;
  };

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

      <div class="inbox-body">
        ${renderList()}

        ${mode === 'compose' ? html`
          <div class="inbox-panel">
            <div class="inbox-thread-head"><div class="inbox-name">${t('inbox.new')}</div></div>
            <div class="inbox-compose-fields">
              <input class="inbox-input" type="text" placeholder=${t('inbox.toPlaceholder')}
                list="inbox-contact-suggest" value=${to} onInput=${(e) => setTo(e.target.value)} />
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
            </div>
            <${Composer} key="c-bc" recipient=${(bcRecipients.length || bcGroupId) ? 'bc' : ''}
              sendLabel=${bcType === 'poll' ? t('inbox.pollSend') : t('inbox.bcSend')} sending=${sending} onSend=${doBroadcast} />
          </div>` : null}

        ${mode === 'results' ? renderResults() : null}

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
      ${mdViewer && html`<${MarkdownViewer} url=${mdViewer.url} name=${mdViewer.name} onClose=${() => setMdViewer(null)} />`}
    </div>`;
}
