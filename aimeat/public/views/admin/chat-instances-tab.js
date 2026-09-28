/**
 * @file public/views/admin/chat-instances-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab for AI chat instances and operator channels:
 *   lists active chat sessions (with delete), and manages `ops:`-prefixed operator
 *   boards with an inline live chat panel that polls posts every 5s.
 *
 * @structure
 *   - ChannelChat({ boardId }): inline board chat feed + composer (5s polling)
 *   - ChatInstancesTab({ data, reload }): operator-channel CRUD + chat-session list
 *
 * @version-history
 *   v1.2.1 — 2026-09-28 — No escHtml() on text preact renders: preact escapes text and attributes
 *     itself (the Message is `plain`, so its body is a text node), so a channel name, a message
 *     body, an author or an app name with a quote or an ampersand showed as &quot; / &amp;.
 *   v1.2.0 — 2026-09-27 — On the library components (page group G5): the channels are a Section
 *     with the name field and its create action (TextField), each channel a List row that opens its
 *     chat in the row's Panel; the chat is the Thread of comment Messages (scrolls, kept at its foot)
 *     with the send field under it; the sessions the List with its heading row, the status the Status
 *     mark, the delete the icon button. The file writes no class and no style.
 *   v1.1.0 — 2026-09-05 — The speech-bubble emoji before a channel name and the cross-mark emoji on the delete button go: no emoji anywhere in the interface.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { dt, StatsGrid, Empty, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import {
  deleteChatInstance,
  getBoards, getBoardPosts, createBoard, postToBoard,
} from '/js/services/admin.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Cell, When, Doors } from '/components/List.js';
import { Action, Icon } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { TextField } from '/components/TextField.js';
import { Thread, Message } from '/components/Message.js';
import { Space } from '/components/Layout.js';

/* ── Inline Chat View ── */
function ChannelChat({ boardId }) {
  const [posts, setPosts] = useState([]);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const feedRef = useRef(null);
  const [toast, showErr, , clearToast] = useToast();

  const loadPosts = useCallback(async () => {
    try {
      const res = await getBoardPosts(boardId, 100);
      setPosts((res.data?.posts || []).reverse());
    } catch (e) { console.warn('Failed to load:', e.message); setPosts([]); }
    setLoading(false);
  }, [boardId]);

  useEffect(() => {
    loadPosts();
    const iv = setInterval(loadPosts, 5000);
    return () => clearInterval(iv);
  }, [boardId, loadPosts]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [posts]);

  async function send() {
    if (!msg.trim()) return;
    try {
      await postToBoard(boardId, msg.trim());
      setMsg('');
      loadPosts();
    } catch (e) { showErr(e.message); }
  }

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${Thread} capped scrollRef=${feedRef}>
      ${loading && html`<${Note} kind="loading">${t('dashboard.loading')}...<//>`}
      ${!loading && !posts.length && html`<${Note} kind="quiet">${t('dashboard.chatNoMessages')}<//>`}
      ${posts.map(p => {
        const raw = p.author_gaii || p.authorGaii || 'operator';
        const author = raw.includes('#') ? raw.split('#')[1].split('@')[0] : raw.split('@')[0];
        return html`
          <${Message} key=${p.id || (p.created_at || p.createdAt)} tone="comment" plain
            who=${author} time=${dt(p.created_at || p.createdAt)} body=${p.body || ''} />
        `;
      })}
    <//>

    <${Space} above="small">
      <${TextField} value=${msg} onInput=${setMsg} onEnter=${send}
        placeholder=${t('dashboard.chatMessagePlaceholder')} ariaLabel=${t('dashboard.chatMessagePlaceholder')}
        actions=${html`<${Action} small onClick=${send}>${t('dashboard.chatSendMessage')}<//>`} />
    <//>
  `;
}

/* ── Main Tab ── */
export default function ChatInstancesTab({ data, reload }) {
  const sessions = Array.isArray(data.chatInstances) ? data.chatInstances : (data.chatInstances?.sessions || []);

  const [name, setName] = useState('');
  const [channels, setChannels] = useState([]);
  const [openChats, setOpenChats] = useState(new Set());
  const nameRef = useRef(null);
  const [toast, showErr, , clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  async function loadChannels() {
    try {
      const res = await getBoards();
      setChannels((res.data?.boards || []).filter(b => b.name?.startsWith('ops:')));
    } catch (e) { console.warn('Failed to load:', e.message); setChannels([]); }
  }

  useEffect(() => { loadChannels(); }, []);

  async function doCreateChannel() {
    if (!name.trim()) { nameRef.current?.focus(); return; }
    const channelName = name.trim().startsWith('ops:') ? name.trim() : 'ops:' + name.trim();
    try {
      await createBoard(channelName, 'shared', t('dashboard.chatOperatorChannelsExplain'));
      setName('');
      loadChannels();
    } catch (e) { showErr(e.message); }
  }

  function toggleChat(id) {
    setOpenChats(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function doDeleteInstance(id) {
    confirm(t('dashboard.chatDeleteConfirm').replace('{id}', id), async () => {
      try { await deleteChatInstance(id); reload(); }
      catch (e) { showErr(e.message); }
    }, { danger: true });
  }

  const head = [t('dashboard.chatChannelName'), t('dashboard.chatChannelPlatform'), 'GHII', t('dashboard.created'),
    t('dashboard.statusLabel'), ''];

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${Note}>${t('dashboard.chatExplain')}<//>

    <!-- Operator Channels -->
    <${Section} first title=${t('dashboard.chatOperatorChannels')}>
      <${Note}>${t('dashboard.chatOperatorChannelsExplain')}<//>

      <${Space} below="large">
        <${TextField} inputRef=${nameRef} label=${t('dashboard.chatChannelName')} value=${name} onInput=${setName}
          placeholder=${t('dashboard.chatChannelNamePlaceholder')} onEnter=${doCreateChannel}
          actions=${html`<${Action} small onClick=${doCreateChannel}>+ ${t('dashboard.chatCreateChannel')}<//>`} />
      <//>

      ${!channels.length
        ? html`<${Note} kind="quiet">${t('dashboard.chatNoChannels')}<//>`
        : html`<${List} cols="name-doors">
          ${channels.map(ch => {
            const cid = ch.id || ch.name;
            const isOpen = openChats.has(cid);
            const displayName = (ch.name || ch.id).replace(/^ops:/, '');
            return html`
              <${Row} key=${cid} open=${isOpen} panel=${isOpen ? html`<${ChannelChat} boardId=${cid} />` : null}>
                <${Name} meta=${ch.post_count != null ? `${ch.post_count} messages` : null}># ${displayName}<//>
                <${Doors}>
                  <${Action} small expanded=${isOpen} onClick=${() => toggleChat(cid)}
                  >${isOpen ? '▲ Collapse' : '▼ Expand'}<//>
                <//>
              <//>
            `;
          })}
        <//>`
      }
    <//>

    <!-- AI Chat Instances -->
    <${StatsGrid} items=${[
      { label: t('dashboard.totalSessions'), value: sessions.length, tone: 'cyan' },
    ]} />

    ${!sessions.length
      ? html`<${Empty} text=${t('dashboard.noChatInstances')} />`
      : html`<${List} cols="name-kind-id-when-state-doors" head=${head} labels>
          ${sessions.map(s => html`<${Row} key=${s.id}>
            <${Name}>${s.app_name || s.id || ''}<//>
            <${Cell}>${s.platform || ''}<//>
            <${Cell} meta>${String(s.ghii || '').substring(0, 20)}<//>
            <${When}>${dt(s.created_at)}<//>
            <${Cell}><${Mark} kind="status" tone=${s.is_anonymous ? 'off' : 'fine'}>${s.is_anonymous ? 'anon' : t('dashboard.active')}<//><//>
            <${Doors}><${Icon} small label="Delete" onClick=${() => doDeleteInstance(s.id)}>✗<//><//>
          <//>`)}
        <//>`
    }
    <${ConfirmUI} />
  `;
}
