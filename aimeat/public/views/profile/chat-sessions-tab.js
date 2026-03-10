import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { listAgents, deleteAgent } from '/js/services/agents.js';

export default function ChatSessionsTab({ session, showToast, onStats }) {
  const [chatSessions, setChatSessions] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const agents = await listAgents(session.owner);
      const sessions = agents.filter(a => a.owner === session.owner && a.name?.startsWith('session-'));
      setChatSessions(sessions);
      onStats?.({ chatSessions: sessions.length });
    } catch { setChatSessions([]); }
  }, [session?.owner, onStats]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  const handleDelete = useCallback(async (s) => {
    const name = s.display_name || s.name || 'session';
    if (!confirm(t('profile.chatSessions.confirmDelete')
        || `Remove chat session "${name}"? The session agent will be deleted.`)) return;
    setDeleting(s.name);
    try {
      await deleteAgent(s.name);
      showToast(t('profile.chatSessions.deleted') || 'Session removed');
      setExpanded(null);
      loadData();
    } catch {
      showToast(t('profile.chatSessions.deleteError') || 'Failed to remove session');
    } finally { setDeleting(null); }
  }, [showToast, loadData]);

  const toggleExpand = useCallback((name) => {
    setExpanded(prev => prev === name ? null : name);
  }, []);

  if (!chatSessions) return html`<${Spinner} text=${t('profile.chatSessions.loading')} />`;
  return html`
    <div class="section-title">${t('profile.chatSessions.title')}</div>
    <div class="section-desc">${t('profile.chatSessions.desc')}</div>
    ${chatSessions.length === 0
      ? html`<div class="empty">${t('profile.chatSessions.empty')}</div>`
      : chatSessions.map(s => {
        const isExpanded = expanded === s.name;
        return html`
          <div class="card ${isExpanded ? 'card-expanded' : ''}" key=${s.name}>
            <div class="card-header card-clickable" onClick=${() => toggleExpand(s.name)}>
              <span class="expand-icon">${isExpanded ? '\u25BC' : '\u25B6'}</span>
              <div class="card-title">${escHtml(s.display_name || s.name || t('profile.chatSessions.anonymous'))}</div>
              <span class="badge badge-info">${escHtml(s.name || '')}</span>
            </div>
            <div class="card-subtitle">${t('profile.chatSessions.lastSeen')}: ${s.last_seen ? timeAgo(s.last_seen) : '-'}</div>

            ${isExpanded && html`
              <div class="card-detail">
                <div class="detail-grid">
                  <div class="detail-item">
                    <span class="detail-label">GAII</span>
                    <span class="detail-value mono">${escHtml(s.gaii || '-')}</span>
                  </div>
                  ${s.description ? html`
                    <div class="detail-item">
                      <span class="detail-label">${t('profile.chatSessions.description') || 'Description'}</span>
                      <span class="detail-value">${escHtml(s.description)}</span>
                    </div>
                  ` : null}
                  <div class="detail-item">
                    <span class="detail-label">${t('profile.chatSessions.trust') || 'Trust'}</span>
                    <span class="detail-value">${s.trust_score ?? '-'}</span>
                  </div>
                  <div class="detail-item">
                    <span class="detail-label">${t('profile.chatSessions.balance') || 'Balance'}</span>
                    <span class="detail-value">${s.morsel_balance ?? '-'} morsels</span>
                  </div>
                  ${s.roles ? html`
                    <div class="detail-item">
                      <span class="detail-label">${t('profile.chatSessions.roles') || 'Roles'}</span>
                      <span class="detail-value">${(s.roles || []).join(', ')}</span>
                    </div>
                  ` : null}
                  ${s.created_at ? html`
                    <div class="detail-item">
                      <span class="detail-label">${t('profile.chatSessions.created') || 'Created'}</span>
                      <span class="detail-value">${new Date(s.created_at).toLocaleString()}</span>
                    </div>
                  ` : null}
                </div>

                <div class="card-actions" style="margin-top:.75rem">
                  <button class="btn-sm btn-copy" onClick=${(e) => { e.stopPropagation(); navigator.clipboard.writeText(s.gaii || s.name); showToast('GAII copied'); }}>
                    Copy GAII
                  </button>
                  <button class="btn-sm btn-danger" onClick=${(e) => { e.stopPropagation(); handleDelete(s); }}
                    disabled=${deleting === s.name}>
                    ${deleting === s.name ? '...' : (t('profile.chatSessions.remove') || 'Remove Session')}
                  </button>
                </div>
              </div>
            `}
          </div>
        `;
      })
    }`;
}
