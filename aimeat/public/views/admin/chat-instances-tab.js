import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, StatsGrid, Empty, useToast, Toast } from './shared.js';
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
  const [toast, showErr, showOk, clearToast] = useToast();

  async function loadPosts() {
    try {
      const res = await getBoardPosts(boardId, 100);
      setPosts((res.data?.posts || []).reverse());
    } catch (e) { console.warn('Failed to load:', e.message); setPosts([]); }
    setLoading(false);
  }

  useEffect(() => {
    loadPosts();
    const iv = setInterval(loadPosts, 5000);
    return () => clearInterval(iv);
  }, [boardId]);

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
        ${loading && html`<div style="color:var(--text-dim)">${t('dashboard.loading')}...</div>`}
        ${!loading && !posts.length && html`<div style="color:var(--text-dim);text-align:center;padding:24px;font-style:italic;font-size:.85rem">${t('dashboard.chatNoMessages')}</div>`}
        ${posts.map(p => {
          const raw = p.author_gaii || p.authorGaii || 'operator';
          const author = raw.includes('#') ? raw.split('#')[1].split('@')[0] : raw.split('@')[0];
          return html`
            <div style="margin-bottom:10px;padding:8px 10px;border-radius:6px;background:rgba(255,255,255,0.04);border-left:2px solid rgba(6,182,212,0.3)">
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">
                <span style="font-size:.72rem;font-weight:700;color:#06b6d4">${escHtml(author)}</span>
                <span style="font-size:.62rem;color:var(--text-dim)">${dt(p.created_at || p.createdAt)}</span>
              </div>
              <div style="font-size:.85rem;line-height:1.5;white-space:pre-wrap;color:var(--text-bright)">${escHtml(p.body || '')}</div>
            </div>
          `;
        })}
      </div>

      <div style="display:flex;gap:8px">
        <input class="adm-inp" value=${msg} onInput=${e => setMsg(e.target.value)}
          placeholder=${t('dashboard.chatMessagePlaceholder')}
          onKeyDown=${e => e.key === 'Enter' && send()}
          style="flex:1;background:rgba(0,0,0,0.2);border:1px solid var(--glass-border);color:var(--text-bright);padding:8px 12px;border-radius:6px;font-size:.85rem" />
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
  const [toast, showErr, showOk, clearToast] = useToast();

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
    if (!confirm(t('dashboard.chatDeleteConfirm').replace('{id}', id))) return;
    try { await deleteChatInstance(id); reload(); }
    catch (e) { showErr(e.message); }
  }

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.chatExplain')}</p>

    <!-- Operator Channels -->
    <div class="adm-card">
      <h3>${t('dashboard.chatOperatorChannels')}</h3>
      <p style="color:var(--text-dim);font-size:.8rem;margin-bottom:10px">${t('dashboard.chatOperatorChannelsExplain')}</p>

      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px">
        <div style="flex:1;min-width:160px">
          <label style="font-size:.75rem;color:var(--text-dim)">${t('dashboard.chatChannelName')}</label>
          <input ref=${nameRef} class="adm-inp" value=${name} onInput=${e => setName(e.target.value)}
            placeholder=${t('dashboard.chatChannelNamePlaceholder')}
            onKeyDown=${e => e.key === 'Enter' && doCreateChannel()}
            style="width:100%;background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-bright);padding:8px 12px;border-radius:6px" />
        </div>
        <button class="adm-btn-action" onClick=${doCreateChannel} style="white-space:nowrap">+ ${t('dashboard.chatCreateChannel')}</button>
      </div>

      ${!channels.length
        ? html`<div style="color:var(--text-dim);font-style:italic;padding:8px 0">${t('dashboard.chatNoChannels')}</div>`
        : html`<div style="display:flex;flex-direction:column;gap:12px">
          ${channels.map(ch => {
            const cid = ch.id || ch.name;
            const isOpen = openChats.has(cid);
            const displayName = (ch.name || ch.id).replace(/^ops:/, '');
            return html`
              <div style="border:1px solid ${isOpen ? '#06b6d4' : 'var(--glass-border)'};border-radius:10px;padding:12px 14px;background:${isOpen ? 'rgba(6,182,212,0.04)' : 'rgba(255,255,255,0.02)'};transition:all .2s ease">
                <div style="display:flex;align-items:center;justify-content:space-between">
                  <div style="display:flex;align-items:center;gap:10px">
                    <span style="font-size:1.1rem">\u{1F4AC}</span>
                    <div>
                      <div style="font-weight:700;font-size:.95rem"># ${escHtml(displayName)}</div>
                      ${ch.post_count != null ? html`<div style="font-size:.7rem;color:var(--text-dim)">${ch.post_count} messages</div>` : null}
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
      { label: t('dashboard.totalSessions'), value: sessions.length, color: '#06b6d4' },
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
            <td class="mono" style="font-size:.8rem">${escHtml(String(s.ghii || '').substring(0, 20))}</td>
            <td style="color:var(--text-dim)">${dt(s.created_at)}</td>
            <td><span class="badge ${s.is_anonymous ? 'bg-dim' : 'bg-green'}">${s.is_anonymous ? 'anon' : t('dashboard.active')}</span></td>
            <td><button class="adm-btn-sm" onClick=${() => doDeleteInstance(s.id)} title="Delete">\u274C</button></td>
          </tr>`)}
        </tbody>
      </table></div></div>`
    }
  `;
}
