/**
 * @file inbox-tab.js
 * @description Profile Inbox tab — human↔human direct messaging UI. A two-pane messenger: a
 *   conversation/request list (avatars, last-message preview, time, unread pill) and a thread pane
 *   with date-grouped chat bubbles (left = received / right = sent, with delivery-status ticks),
 *   markdown bodies via the shared Markdown renderer (cid: inline media resolved to the recipient's
 *   local copies; external <img> stripped as a tracking-pixel defense), and a sticky composer with
 *   file attachments. First contact is gated as a request (accept/block). Re-fetches on SSE updates.
 * @structure InboxTab (default) · Avatar · MessageBubble · helpers (peerName, statusTick, dayKey)
 * @usage Lazy-loaded profile tab; registered in profile.js TABS as id `messages`.
 * @version-history
 *   v1.1.0 -- 2026-06-16 -- Redesigned as a proper messenger: avatars, chat bubbles with status
 *     ticks, date dividers, sticky composer, empty states. (CSS is linked in spa.html.)
 *   v1.0.0 -- 2026-06-16 -- Initial creation for user-to-user messaging (layer 5).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Markdown } from '/components/Markdown.js';
import { minidenticon } from '/lib/minidenticons.min.js';
import * as messages from '/js/services/messages.js';

/* ── Helpers ── */

/** Short display name for a GHII/GAII (the part before @, after any #). */
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
function statusTick(status) {
  return TICK[status] || '';
}

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
function prepareBody(body, urlMap) {
  let out = String(body || '');
  out = out.replace(/!\[([^\]]*)\]\(cid:([a-zA-Z0-9_-]+)\)/g, (m, alt, id) => {
    const url = urlMap[id];
    return url ? `![${alt}](${url})` : `*[${alt || t('inbox.attachmentPending')}]*`;
  });
  out = out.replace(/!\[([^\]]*)\]\((https?:[^)]+)\)/g, (m, alt) => (alt ? `\`${alt}\`` : ''));
  return out;
}

function MessageBubble({ msg, mine, urlMap }) {
  const nonInline = (msg.attachments || []).filter(a => !a.inline);
  return html`
    <div class=${`inbox-row ${mine ? 'inbox-row--mine' : 'inbox-row--theirs'}`}>
      ${!mine ? html`<${Avatar} seed=${msg.senderGhii} size=${28} />` : null}
      <div class=${`inbox-bubble ${mine ? 'inbox-bubble--mine' : 'inbox-bubble--theirs'}`}>
        <div class="inbox-bubble-body"><${Markdown} text=${prepareBody(msg.body, urlMap)} /></div>
        ${nonInline.length > 0 && html`
          <div class="inbox-attach-row">
            ${nonInline.map(a => html`
              <a key=${a.id} class=${`inbox-attach-chip${urlMap[a.id] ? '' : ' inbox-attach-chip--pending'}`}
                href=${urlMap[a.id] || '#'} target="_blank" rel="noopener">
                <span class="inbox-attach-ico">${a.kind === 'image' ? '🖼' : a.kind === 'audio' ? '🎵' : a.kind === 'video' ? '🎬' : '📎'}</span>
                <span class="inbox-attach-name">${escHtml(a.name || a.storageKey)}</span>
                ${a.mode !== 'duplicate' ? html`<span class="inbox-attach-pending">${t('inbox.attachmentPending')}</span>` : null}
              </a>`)}
          </div>`}
        <div class="inbox-bubble-meta">
          <span>${timeShort(msg.createdAt)}</span>
          ${mine && msg.status ? html`<span class=${`inbox-tick${msg.status === 'read' ? ' inbox-tick--read' : ''}${(msg.status === 'failed' || msg.status === 'undeliverable') ? ' inbox-tick--err' : ''}`}>${statusTick(msg.status)}</span>` : null}
        </div>
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
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);
  const msgsRef = useRef(null);

  const loadLists = useCallback(async () => {
    const [reqs, convs] = await Promise.all([
      messages.listRequests().catch(() => []),
      messages.listConversations().catch(() => []),
    ]);
    setRequests(reqs);
    setConversations(convs);
  }, []);

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
  useEffect(() => {
    const handler = () => liveRef.current?.();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  // Keep the thread scrolled to the newest message.
  useEffect(() => {
    if (mode === 'thread' && msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [thread, mode]);

  const openConversation = async (conv) => {
    setActiveConv(conv); setMode('thread'); setBody('');
    await loadThread(conv);
    loadLists();
  };
  const startCompose = () => { setMode('compose'); setActiveConv(null); setTo(''); setBody(''); setFiles([]); };

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

  const doSend = async (recipient) => {
    if (sending) return;
    const text = body.trim();
    if (!text && files.length === 0) return;
    setSending(true);
    try {
      const attachments = [];
      for (let i = 0; i < files.length; i++) {
        const desc = await messages.uploadAttachment(files[i]);
        attachments.push({ ...desc, inline: false, id: `at${i}` });
      }
      const resp = await messages.send({ to: recipient, body: text, attachments });
      if (resp?.ok === false) { showToast?.(resp?.error?.message || t('inbox.failed'), true); }
      else {
        setBody(''); setFiles([]); if (fileRef.current) fileRef.current.value = '';
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

  const onPickFiles = (e) => setFiles(Array.from(e.target.files || []));

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
                <div class="inbox-name">${escHtml(peerName(r.contactId))}</div>
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
              <span class="inbox-name">${escHtml(peerName(c.peerGhii))}</span>
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
            <div class="inbox-name">${escHtml(peerName(activeConv.peerGhii))}</div>
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
              <${MessageBubble} key=${m.id + m.direction} msg=${m} mine=${m.direction === 'outbound'} urlMap=${urlMap} />`;
          })}
        </div>
        ${renderComposer(activeConv.peerGhii, t('inbox.reply'))}
      </div>`;
  };

  const renderComposer = (recipient, sendLabel) => html`
    <div class="inbox-composer">
      ${files.length > 0 ? html`<div class="inbox-file-chips">
        ${files.map((f, i) => html`<span class="inbox-file-chip" key=${i}>📎 ${escHtml(f.name)}</span>`)}
      </div>` : null}
      <textarea class="inbox-textarea" rows="2" placeholder=${t('inbox.bodyPlaceholder')}
        value=${body} onInput=${(e) => setBody(e.target.value)}></textarea>
      <div class="inbox-composer-bar">
        <label class="inbox-attach-btn" title=${t('inbox.attach')}>
          📎<input ref=${fileRef} type="file" multiple hidden onChange=${onPickFiles} />
        </label>
        <button class="btn-primary btn-sm" disabled=${sending || (!recipient)} onClick=${() => doSend(recipient)}>
          ${sending ? t('inbox.sending') : sendLabel}
        </button>
      </div>
    </div>`;

  return html`
    <div class="inbox">
      <div class="inbox-head">
        <div>
          <div class="section-title">${t('inbox.title')}</div>
          <div class="section-desc">${t('inbox.desc')}</div>
        </div>
        <button class="btn-primary" onClick=${startCompose}>✉️ ${t('inbox.new')}</button>
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
            ${renderComposer(to.trim(), t('inbox.send'))}
          </div>` : null}

        ${mode === 'thread' && activeConv ? renderThread() : null}

        ${mode === 'idle' ? html`
          <div class="inbox-panel inbox-panel--empty">
            <div class="inbox-empty">
              <div class="inbox-empty-ico">📬</div>
              <div>${t('inbox.selectConversation')}</div>
            </div>
          </div>` : null}
      </div>
    </div>`;
}
