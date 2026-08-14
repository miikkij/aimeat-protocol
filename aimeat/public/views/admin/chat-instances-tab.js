/**
 * @file public/views/admin/chat-instances-tab.js
 * @description Admin dashboard tab for AI chat instances and operator channels:
 *   lists active chat sessions (with delete), and manages `ops:`-prefixed operator
 *   boards with an inline live chat panel that polls posts every 5s.
 *
 * @structure
 *   - ChannelChat({ boardId }): inline board chat feed + composer (5s polling)
 *   - ChatInstancesTab({ data, reload }): operator-channel CRUD + chat-session table
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, StatsGrid, Empty, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
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
    <div style="margin-top:10px;padding:10px 12px 12px;border-radius:8px;background:rgba(0,0,0,0.15)">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <div ref=${feedRef} style="
        height:220px;min-height:100px;overflow-y:auto;resize:vertical;
        border:1px solid var(--glass-border);border-radius:8px;
        background:rgba(0,0,0,0.25);padding:10px;margin-bottom:10px;
      ">
        ${loading && html`<div class="adm-text-dim">${t('dashboard.loading')}...</div>`}
        ${!loading && !posts.length && html`<div class="adm-text-dim adm-text-base" style="text-align:center;padding:24px;font-style:italic">${t('dashboard.chatNoMessages')}</div>`}
        ${posts.map(p => {
          const raw = p.author_gaii || p.authorGaii || 'operator';
          const author = raw.includes('#') ? raw.split('#')[1].split('@')[0] : raw.split('@')[0];
          return html`
            <div style="margin-bottom:10px;padding:8px 10px;border-radius:6px;background:rgba(255,255,255,0.04);border-left:2px solid rgba(6,182,212,0.3)">
              <div class="adm-flex-between" style="align-items:baseline;margin-bottom:3px">
                <span class="adm-text-accent" style="font-size:.72rem;font-weight:700">${escHtml(author)}</span>
                <span class="adm-text-dim" style="font-size:.62rem">${dt(p.created_at || p.createdAt)}</span>
              </div>
              <div class="adm-text-base adm-text-bright" style="line-height:1.5;white-space:pre-wrap">${escHtml(p.body || '')}</div>
            </div>
          `;
        })}
      </div>

      <div class="adm-flex">
        <input class="adm-input" value=${msg} onInput=${e => setMsg(e.target.value)}
          placeholder=${t('dashboard.chatMessagePlaceholder')}
          onKeyDown=${e => e.key === 'Enter' && send()}
          style="flex:1;background:rgba(0,0,0,0.2)" />
        <button class="adm-btn-action" onClick=${send}>${t('dashboard.chatSendMessage')}</button>
      </div>
    </div>
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

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <p class="adm-text-dim adm-text-base adm-mb-md">${t('dashboard.chatExplain')}</p>

    <!-- Operator Channels -->
    <div class="adm-card">
      <h3>${t('dashboard.chatOperatorChannels')}</h3>
      <p class="adm-text-sm adm-text-dim" style="margin-bottom:10px">${t('dashboard.chatOperatorChannelsExplain')}</p>

      <div class="adm-flex-wrap adm-mb-lg" style="align-items:flex-end">
        <div style="flex:1;min-width:160px">
          <label class="adm-text-xs adm-text-dim">${t('dashboard.chatChannelName')}</label>
          <input ref=${nameRef} class="adm-input adm-input-full" value=${name} onInput=${e => setName(e.target.value)}
            placeholder=${t('dashboard.chatChannelNamePlaceholder')}
            onKeyDown=${e => e.key === 'Enter' && doCreateChannel()} />
        </div>
        <button class="adm-btn-action" onClick=${doCreateChannel} style="white-space:nowrap">+ ${t('dashboard.chatCreateChannel')}</button>
      </div>

      ${!channels.length
        ? html`<div class="adm-text-dim" style="font-style:italic;padding:8px 0">${t('dashboard.chatNoChannels')}</div>`
        : html`<div class="adm-flex-col" style="gap:12px">
          ${channels.map(ch => {
            const cid = ch.id || ch.name;
            const isOpen = openChats.has(cid);
            const displayName = (ch.name || ch.id).replace(/^ops:/, '');
            return html`
              <div style="border:1px solid ${isOpen ? '#06b6d4' : 'var(--glass-border)'};border-radius:10px;padding:12px 14px;background:${isOpen ? 'rgba(6,182,212,0.04)' : 'rgba(255,255,255,0.02)'};transition:all .2s ease">
                <div class="adm-flex-between">
                  <div class="adm-flex-center" style="gap:10px">
                    <span style="font-size:1.1rem">\u{1F4AC}</span>
                    <div>
                      <div style="font-weight:700;font-size:.95rem"># ${escHtml(displayName)}</div>
                      ${ch.post_count != null ? html`<div class="adm-text-xs adm-text-dim">${ch.post_count} messages</div>` : null}
                    </div>
                  </div>
                  <button class="adm-btn-action" onClick=${() => toggleChat(cid)} style="font-size:.8rem"
                  >${isOpen ? '\u25B2 Collapse' : '\u25BC Expand'}</button>
                </div>
                ${isOpen && html`<${ChannelChat} boardId=${cid} />`}
              </div>
            `;
          })}
        </div>`
      }
    </div>

    <!-- AI Chat Instances -->
    <${StatsGrid} items=${[
      { label: t('dashboard.totalSessions'), value: sessions.length, tone: 'cyan' },
    ]} />

    ${!sessions.length
      ? html`<${Empty} text=${t('dashboard.noChatInstances')} />`
      : html`<div class="adm-card"><div class="scrollable"><table>
        <thead><tr>
          <th>${t('dashboard.chatChannelName')}</th>
          <th>${t('dashboard.chatChannelPlatform')}</th>
          <th>GHII</th>
          <th>${t('dashboard.created')}</th>
          <th>${t('dashboard.statusLabel')}</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${sessions.map(s => html`<tr>
            <td>${escHtml(s.app_name || s.id || '')}</td>
            <td>${escHtml(s.platform || '')}</td>
            <td class="mono adm-text-sm">${escHtml(String(s.ghii || '').substring(0, 20))}</td>
            <td class="adm-text-dim">${dt(s.created_at)}</td>
            <td><span class="badge ${s.is_anonymous ? 'bg-dim' : 'bg-green'}">${s.is_anonymous ? 'anon' : t('dashboard.active')}</span></td>
            <td><button class="adm-btn-sm" onClick=${() => doDeleteInstance(s.id)} title="Delete">\u274C</button></td>
          </tr>`)}
        </tbody>
      </table></div></div>`
    }
    <${ConfirmUI} />
  `;
}
