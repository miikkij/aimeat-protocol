/**
 * @file inbox-tab.js
 * @description Profile Inbox tab — human↔human direct messaging UI. Lists first-contact requests
 *   (accept/block) and accepted conversations, opens a thread (markdown bodies via the shared
 *   Markdown renderer, with cid: inline media resolved to the recipient's local copies and external
 *   <img> stripped as a tracking-pixel defense), and provides a composer to start or reply to a
 *   conversation with optional file attachments. Re-fetches on SSE live updates.
 * @structure InboxTab (default) — requests + conversation list + thread + composer; MessageBubble.
 * @usage Lazy-loaded profile tab; registered in profile.js TABS as id `messages`.
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial creation for user-to-user messaging (layer 5).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { Markdown } from '/components/Markdown.js';
import * as messages from '/js/services/messages.js';

/* Build a markdown body safe to render: resolve cid:{id} inline media to the recipient's local
 * presigned URLs, and strip external http(s) images (tracking-pixel defense — DECISION #11). */
function prepareBody(body, urlMap) {
  let out = String(body || '');
  // Replace cid:{id} image refs with resolved URLs (or a placeholder if not yet available).
  out = out.replace(/!\[([^\]]*)\]\(cid:([a-zA-Z0-9_-]+)\)/g, (m, alt, id) => {
    const url = urlMap[id];
    return url ? `![${alt}](${url})` : `*[${alt || t('inbox.attachmentPending')}]*`;
  });
  // Strip any remaining external images (only cid-resolved local images are allowed inline).
  out = out.replace(/!\[([^\]]*)\]\((https?:[^)]+)\)/g, (m, alt) => (alt ? `\`${alt}\`` : ''));
  return out;
}

function MessageBubble({ msg, mine, urlMap }) {
  const cls = `inbox-bubble ${mine ? 'inbox-bubble--mine' : 'inbox-bubble--theirs'}`;
  const nonInline = (msg.attachments || []).filter(a => !a.inline);
  const statusLabel = mine && msg.status ? t(`inbox.status.${msg.status}`) : '';
  return html`
    <div class=${cls}>
      <div class="inbox-bubble-body"><${Markdown} text=${prepareBody(msg.body, urlMap)} /></div>
      ${nonInline.length > 0 && html`
        <div class="inbox-attach-row">
          ${nonInline.map(a => html`
            <a class="inbox-attach-chip" key=${a.id}
              href=${urlMap[a.id] || '#'} target="_blank" rel="noopener"
              class=${`inbox-attach-chip${urlMap[a.id] ? '' : ' inbox-attach-chip--pending'}`}>
              ${a.kind === 'image' ? '🖼' : a.kind === 'audio' ? '🎵' : a.kind === 'video' ? '🎬' : '📎'}
              ${' '}${escHtml(a.name || a.storageKey)}
              ${a.mode !== 'duplicate' ? html`<span class="inbox-attach-pending"> · ${t('inbox.attachmentPending')}</span>` : null}
            </a>`)}
        </div>`}
      <div class="inbox-bubble-meta">
        ${new Date(msg.createdAt).toLocaleString()}
        ${statusLabel ? html`<span class="inbox-bubble-status"> · ${statusLabel}</span>` : null}
      </div>
    </div>`;
}

export default function InboxTab({ showToast }) {
  useViewCSS('/css/views/inbox.css');

  const [requests, setRequests] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);     // { conversationId, peerGhii }
  const [thread, setThread] = useState([]);
  const [urlMap, setUrlMap] = useState({});               // attachment id -> resolved URL
  const [composeOpen, setComposeOpen] = useState(false);
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);

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
    // Resolve presigned URLs for any locally-duplicated attachments (for <img> + download chips).
    const map = {};
    await Promise.all(msgs.flatMap(m => (m.attachments || [])
      .filter(a => a.mode === 'duplicate' && a.localKey)
      .map(async a => { const u = await messages.attachmentUrl(a.localKey).catch(() => null); if (u) map[a.id] = u; })));
    setUrlMap(map);
    // Mark the thread read.
    await messages.markConversationRead(conv.conversationId).catch(() => {});
  }, []);

  useEffect(() => { loadLists(); }, [loadLists]);

  // Re-fetch on SSE live updates.
  const liveRef = useRef(null);
  liveRef.current = () => { loadLists(); if (activeConv) loadThread(activeConv); };
  useEffect(() => {
    const handler = () => liveRef.current?.();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const openConversation = async (conv) => {
    setActiveConv(conv);
    await loadThread(conv);
    loadLists();
  };

  const accept = async (contactId) => {
    await messages.acceptRequest(contactId).catch(() => {});
    showToast?.(t('inbox.acceptedToast'));
    loadLists();
  };
  const block = async (contactId) => {
    await messages.blockContact(contactId).catch(() => {});
    showToast?.(t('inbox.blockedToast'));
    loadLists();
    if (activeConv?.peerGhii === contactId) { setActiveConv(null); setThread([]); }
  };

  const doSend = async (recipient, replyTo) => {
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
      const resp = await messages.send({ to: recipient, body: text, attachments, replyTo });
      if (resp?.ok === false) { showToast?.(resp?.error?.message || t('inbox.failed'), true); }
      else {
        setBody(''); setFiles([]); if (fileRef.current) fileRef.current.value = '';
        setComposeOpen(false);
        const conv = activeConv || { conversationId: resp?.data?.message?.conversationId, peerGhii: recipient };
        setActiveConv(conv);
        await loadThread(conv);
        loadLists();
      }
    } catch (e) {
      showToast?.(t('inbox.failed'), true);
    }
    setSending(false);
  };

  const onPickFiles = (e) => setFiles(Array.from(e.target.files || []));

  return html`
    <div class="inbox-tab">
      <div class="section-title">${t('inbox.title')}</div>
      <div class="section-desc">${t('inbox.desc')}</div>

      <div class="inbox-toolbar">
        <button class="btn-primary" onClick=${() => { setComposeOpen(o => !o); setActiveConv(null); }}>
          ✉️ ${t('inbox.new')}
        </button>
      </div>

      ${composeOpen && !activeConv ? html`
        <div class="inbox-compose">
          <input class="inbox-input" type="text" placeholder=${t('inbox.toPlaceholder')}
            value=${to} onInput=${(e) => setTo(e.target.value)} />
          <textarea class="inbox-textarea" rows="4" placeholder=${t('inbox.bodyPlaceholder')}
            value=${body} onInput=${(e) => setBody(e.target.value)}></textarea>
          <div class="inbox-compose-actions">
            <input ref=${fileRef} type="file" multiple onChange=${onPickFiles} />
            <button class="btn-primary" disabled=${sending || !to.trim()} onClick=${() => doSend(to.trim(), undefined)}>
              ${sending ? t('inbox.sending') : t('inbox.send')}
            </button>
          </div>
        </div>` : null}

      <div class="inbox-grid">
        <div class="inbox-list">
          ${requests.length > 0 ? html`
            <div class="inbox-list-section">${t('inbox.requests')}</div>
            ${requests.map(r => html`
              <div class="inbox-request" key=${r.contactId}>
                <div class="inbox-request-head">
                  <span class="inbox-peer">${escHtml(r.contactId)}</span>
                </div>
                <div class="inbox-request-preview">${escHtml(r.preview || '')}</div>
                <div class="inbox-request-actions">
                  <button class="btn-success btn-sm" onClick=${() => accept(r.contactId)}>${t('inbox.accept')}</button>
                  <button class="btn-danger btn-sm" onClick=${() => block(r.contactId)}>${t('inbox.block')}</button>
                </div>
              </div>`)}
          ` : null}

          <div class="inbox-list-section">${t('inbox.conversations')}</div>
          ${conversations.length === 0 ? html`<div class="inbox-empty">${t('inbox.noConversations')}</div>` : null}
          ${conversations.map(c => html`
            <button class=${`inbox-conv${activeConv?.conversationId === c.conversationId ? ' inbox-conv--active' : ''}`}
              key=${c.conversationId} onClick=${() => openConversation(c)}>
              <span class="inbox-conv-peer">${escHtml(c.peerGhii)}</span>
              <span class="inbox-conv-preview">${escHtml(c.lastMessage || '')}</span>
              ${c.unread > 0 ? html`<span class="inbox-conv-badge">${c.unread}</span>` : null}
            </button>`)}
        </div>

        <div class="inbox-thread">
          ${!activeConv ? html`<div class="inbox-empty">${t('inbox.selectConversation')}</div>` : html`
            <div class="inbox-thread-head">${escHtml(activeConv.peerGhii)}</div>
            <div class="inbox-thread-body">
              ${thread.length === 0 ? html`<div class="inbox-empty">${t('inbox.noThread')}</div>` : null}
              ${thread.map(m => html`<${MessageBubble} key=${m.id + m.direction} msg=${m}
                mine=${m.direction === 'outbound'} urlMap=${urlMap} />`)}
            </div>
            <div class="inbox-reply">
              <textarea class="inbox-textarea" rows="2" placeholder=${t('inbox.bodyPlaceholder')}
                value=${body} onInput=${(e) => setBody(e.target.value)}></textarea>
              <div class="inbox-compose-actions">
                <input ref=${fileRef} type="file" multiple onChange=${onPickFiles} />
                <button class="btn-primary" disabled=${sending} onClick=${() => doSend(activeConv.peerGhii, undefined)}>
                  ${sending ? t('inbox.sending') : t('inbox.reply')}
                </button>
              </div>
            </div>
          `}
        </div>
      </div>
    </div>`;
}
