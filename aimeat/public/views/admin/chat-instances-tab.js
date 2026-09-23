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
 *   - ChatInstancesTab({ data, reload }): operator-channel CRUD + chat-session table
 *
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared set: the channels are a Section whose channels
 *     fold open (the Fold's arrow replaces the triangle glyphs and the English Expand/Collapse words),
 *     the feed a scrolling Surface of list rows, the fields and actions shared parts, the sessions
 *     the shared Table. Every inline style and the hard-coded cyan borders go.
 *   v1.1.0 — 2026-09-05 — The speech-bubble emoji before a channel name and the cross-mark emoji on the delete button go: no emoji anywhere in the interface.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, StatsGrid, Empty, useToast, Toast, DataTable } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Section, Fold, Stack, Toolbar, Field, Action, Surface, ListRow, Chip, Text } from '/components/poster-parts.js';
import {
  deleteChatInstance,
  getBoards, getBoardPosts, createBoard, postToBoard,
} from '/js/services/admin.js';

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
    <${Stack}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Surface} kind="box" height="scroll" surfaceRef=${feedRef}>
        ${loading && html`<${Text} tone="muted">${t('dashboard.loading')}...<//>`}
        ${!loading && !posts.length && html`<${Text} tone="muted">${t('dashboard.chatNoMessages')}<//>`}
        ${posts.map(p => {
          const raw = p.author_gaii || p.authorGaii || 'operator';
          const author = raw.includes('#') ? raw.split('#')[1].split('@')[0] : raw.split('@')[0];
          return html`
            <${ListRow} key=${p.id} density="compact" name=${escHtml(author)} value=${dt(p.created_at || p.createdAt)}>
              <${Text} lines=${true}>${escHtml(p.body || '')}<//>
            <//>`;
        })}
      <//>

      <${Toolbar} label=${t('dashboard.chatSendMessage')}
        actions=${html`<${Action} onClick=${send}>${t('dashboard.chatSendMessage')}<//>`}>
        <${Field} value=${msg} onInput=${e => setMsg(e.target.value)}
          ariaLabel=${t('dashboard.chatMessagePlaceholder')}
          placeholder=${t('dashboard.chatMessagePlaceholder')}
          onKeyDown=${e => e.key === 'Enter' && send()} />
      <//>
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

  const headers = [t('dashboard.chatChannelName'), t('dashboard.chatChannelPlatform'), 'GHII', t('dashboard.created'), t('dashboard.statusLabel'), ''];
  const rows = sessions.map(s => [
    escHtml(s.app_name || s.id || ''),
    escHtml(s.platform || ''),
    { text: escHtml(String(s.ghii || '').substring(0, 20)), mono: true },
    dt(s.created_at),
    html`<${Chip} tone=${s.is_anonymous ? 'muted' : 'success'}>${s.is_anonymous ? 'anon' : t('dashboard.active')}<//>`,
    html`<${Action} kind="text" tone="danger" onClick=${() => doDeleteInstance(s.id)} title="Delete" label="Delete">✗<//>`,
  ]);

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${Text} tone="muted">${t('dashboard.chatExplain')}<//>

    <${Section} title=${t('dashboard.chatOperatorChannels')} description=${t('dashboard.chatOperatorChannelsExplain')}>
      <${Toolbar} label=${t('dashboard.chatOperatorChannels')}
        actions=${html`<${Action} kind="primary" onClick=${doCreateChannel}>+ ${t('dashboard.chatCreateChannel')}<//>`}>
        <${Field} inputRef=${nameRef} label=${t('dashboard.chatChannelName')} value=${name} onInput=${e => setName(e.target.value)}
          placeholder=${t('dashboard.chatChannelNamePlaceholder')}
          onKeyDown=${e => e.key === 'Enter' && doCreateChannel()} />
      <//>

      ${!channels.length
        ? html`<${Empty} text=${t('dashboard.chatNoChannels')} />`
        : channels.map(ch => {
          const cid = ch.id || ch.name;
          const isOpen = openChats.has(cid);
          const displayName = (ch.name || ch.id).replace(/^ops:/, '');
          return html`
            <${Fold} key=${cid} title=${'# ' + escHtml(displayName)}
              sub=${ch.post_count != null ? `${ch.post_count} messages` : null}
              open=${isOpen} onToggle=${() => toggleChat(cid)}>
              <${ChannelChat} boardId=${cid} />
            <//>`;
        })}
    <//>

    <${StatsGrid} items=${[
      { label: t('dashboard.totalSessions'), value: sessions.length, tone: 'cyan' },
    ]} />

    ${!sessions.length
      ? html`<${Empty} text=${t('dashboard.noChatInstances')} />`
      : html`<${DataTable} headers=${headers} rows=${rows} />`
    }
    <${ConfirmUI} />
  `;
}
