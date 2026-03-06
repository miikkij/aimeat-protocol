import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { listAgents } from '/js/services/agents.js';

export default function ChatSessionsTab({ session, showToast, onStats }) {
  const [chatSessions, setChatSessions] = useState(null);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  async function loadData() {
    try {
      const agents = await listAgents(session.owner);
      const sessions = agents.filter(a => a.owner === session.owner && a.name?.startsWith('session-'));
      setChatSessions(sessions);
      onStats?.({ chatSessions: sessions.length });
    } catch { setChatSessions([]); }
  }

  if (!chatSessions) return html`<${Spinner} text=${t('profile.chatSessions.loading')} />`;
  return html`
    <div class="section-title">${t('profile.chatSessions.title')}</div>
    <div class="section-desc">${t('profile.chatSessions.desc')}</div>
    ${chatSessions.length === 0
      ? html`<div class="empty">${t('profile.chatSessions.empty')}</div>`
      : chatSessions.map(s => html`
        <div class="card">
          <div class="card-header">
            <div class="card-title">${escHtml(s.display_name || s.name || t('profile.chatSessions.anonymous'))}</div>
            <span class="badge badge-info">${escHtml(s.name || '')}</span>
          </div>
          <div class="card-subtitle">${t('profile.chatSessions.lastSeen')}: ${s.last_seen ? timeAgo(s.last_seen) : '-'}</div>
        </div>
      `)
    }`;
}
