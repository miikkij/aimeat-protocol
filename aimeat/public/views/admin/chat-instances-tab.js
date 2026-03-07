import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, dt, StatsGrid, Empty } from './shared.js';
import { createChatChannel, deleteChatInstance } from '/js/services/admin.js';

export default function ChatInstancesTab({ data, reload }) {
  const sessions = Array.isArray(data.chatInstances) ? data.chatInstances : (data.chatInstances?.sessions || []);

  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('admin');

  async function doCreate() {
    if (!name.trim()) return;
    try {
      await createChatChannel(name.trim(), platform.trim() || 'admin');
      setName('');
      setPlatform('admin');
      reload();
    } catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  async function doDelete(id) {
    if (!confirm(t('dashboard.chatDeleteConfirm').replace('{id}', id))) return;
    try { await deleteChatInstance(id); reload(); }
    catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  return html`
    <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.chatExplain')}</p>
    <${StatsGrid} items=${[
      { label: t('dashboard.totalSessions'), value: sessions.length, color: '#06b6d4' },
      { label: t('dashboard.activeSessions'), value: sessions.filter(s => !s.ended_at).length, color: '#22c55e' },
      { label: t('dashboard.avgMessages'), value: sessions.length ? Math.round(sessions.reduce((a, s) => a + (s.message_count || 0), 0) / sessions.length) : 0, color: '#f59e0b' },
    ]} />

    <!-- Create channel -->
    <div class="adm-card">
      <h3>${t('dashboard.chatCreateChannel')}</h3>
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:2;min-width:160px">
          <label style="font-size:.75rem;color:var(--text-dim)">${t('dashboard.chatChannelName')}</label>
          <input class="adm-inp" value=${name} onInput=${e => setName(e.target.value)}
            placeholder=${t('dashboard.chatChannelNamePlaceholder')}
            onKeyDown=${e => e.key === 'Enter' && doCreate()}
            style="width:100%;background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-bright);padding:8px 12px;border-radius:6px" />
        </div>
        <div style="flex:1;min-width:120px">
          <label style="font-size:.75rem;color:var(--text-dim)">${t('dashboard.chatChannelPlatform')}</label>
          <input class="adm-inp" value=${platform} onInput=${e => setPlatform(e.target.value)}
            placeholder=${t('dashboard.chatChannelPlatformPlaceholder')}
            onKeyDown=${e => e.key === 'Enter' && doCreate()}
            style="width:100%;background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-bright);padding:8px 12px;border-radius:6px" />
        </div>
        <button class="adm-btn-action" onClick=${doCreate} style="white-space:nowrap">+ ${t('dashboard.chatCreateChannel')}</button>
      </div>
    </div>

    ${!sessions.length
      ? html`<${Empty} text=${t('dashboard.noChatInstances')} />`
      : html`<div class="adm-card"><div class="scrollable"><table>
        <thead><tr>
          <th>ID</th>
          <th>GHII</th>
          <th>${t('dashboard.messages')}</th>
          <th>${t('dashboard.started')}</th>
          <th>${t('dashboard.ended')}</th>
          <th>${t('dashboard.statusLabel')}</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${sessions.map(s => html`<tr>
            <td class="mono" style="font-size:.8rem">${escHtml(String(s.id || s.session_id || '').substring(0, 16))}</td>
            <td class="mono" style="font-size:.8rem">${escHtml(String(s.ghii || s.user || '').substring(0, 16))}</td>
            <td>${num(s.message_count)}</td>
            <td style="color:var(--text-dim)">${dt(s.started_at || s.created_at)}</td>
            <td style="color:var(--text-dim)">${s.ended_at ? dt(s.ended_at) : '\u2014'}</td>
            <td><span class="badge ${s.ended_at ? 'bg-dim' : 'bg-green'}">${s.ended_at ? t('dashboard.ended') : t('dashboard.active')}</span></td>
            <td><button class="adm-btn-sm" onClick=${() => doDelete(s.id || s.session_id)} title="Delete">\u274C</button></td>
          </tr>`)}
        </tbody>
      </table></div></div>`
    }
  `;
}
