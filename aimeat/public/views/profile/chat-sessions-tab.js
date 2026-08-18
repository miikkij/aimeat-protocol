/**
 * @file chat-sessions-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for managing AI chat sessions connected via agents.
 *   Shows active sessions, allows creating new ones via prompt copy, and
 *   removing existing sessions.
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial chat sessions tab
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes; fix fallback strings
 *   v1.2.0 — 2026-06-02 — Component unification (#1): "Copy GAII" uses canonical
 *     <CopyButton> (toast preserved); prompt-copy routed through shared copyToClipboard
 *     (insecure-context fallback) instead of raw navigator.clipboard.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo, copyToClipboard } from '/js/utils.js';
import { Spinner } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
import { useConfirm } from '/components/Modal.js';
import { listAgents, deleteAgent } from '/js/services/agents.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

export default function ChatSessionsTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [chatSessions, setChatSessions] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [copying, setCopying] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const agents = await listAgents(session.owner);
      const sessions = agents.filter(a => a.owner === session.owner && a.name?.startsWith('session-'));
      setChatSessions(sessions);
      onStats?.({ chatSessions: sessions.length });
    } catch (err) { swallowed('chat-sessions-tab', err); setChatSessions([]); }
  }, [session?.owner, onStats]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  // Live update listener
  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => onLiveUpdate(['agents'], () => loadRef.current()), []);

  const handleDelete = useCallback(async (s) => {
    confirm(t('profile.chatSessions.confirmDelete'), async () => {
      setDeleting(s.name);
      try {
        await deleteAgent(s.name);
        showToast(t('profile.chatSessions.deleted'));
        setExpanded(null);
        loadData();
      } catch (err) {
        swallowed('chat-sessions-tab: ChatSessionsTab', err);
        showToast(t('profile.chatSessions.deleteError'));
      } finally { setDeleting(null); }
    }, { danger: true });
  }, [confirm, showToast, loadData]);

  const toggleExpand = useCallback((name) => {
    setExpanded(prev => prev === name ? null : name);
  }, []);

  const copyPrompt = useCallback(async (type) => {
    setCopying(type);
    try {
      const endpoint = type === 'quick'
        ? '/v1/templates/chat-session-quick'
        : '/v1/templates/chat-session-human';
      const resp = await apiGet(endpoint);
      const text = resp?.data?.prompt;
      if (text) {
        await copyToClipboard(text);
        showToast(t('profile.chatSessions.promptCopied'));
      } else {
        showToast(t('profile.chatSessions.promptError'));
      }
    } catch (err) {
      swallowed('chat-sessions-tab: ChatSessionsTab', err);
      showToast(t('profile.chatSessions.promptError'));
    } finally { setCopying(null); }
  }, [showToast]);

  if (!chatSessions) return html`<${Spinner} text=${t('profile.chatSessions.loading')} />`;
  return html`
    <div class="section-title">${t('profile.chatSessions.title')}</div>
    <div class="section-desc">${t('profile.chatSessions.desc')}</div>

    <div class="card mb-1">
      <div class="card-header">
        <div class="card-title">${t('profile.chatSessions.createTitle')}</div>
      </div>
      <div class="cs-create-body">
        <p class="cs-create-desc">
          ${t('profile.chatSessions.createDesc')}
        </p>
        <div class="flex-row-wrap mb-half">
          <button class="btn-primary" onClick=${() => copyPrompt('quick')}
            disabled=${copying === 'quick'}>
            ${copying === 'quick' ? '...' : t('profile.chatSessions.copyQuickPrompt')}
          </button>
          <button class="btn-outline" onClick=${() => copyPrompt('detailed')}
            disabled=${copying === 'detailed'}>
            ${copying === 'detailed' ? '...' : t('profile.chatSessions.copyDetailedPrompt')}
          </button>
        </div>
        <p class="cs-create-hint">
          ${t('profile.chatSessions.createHint')}
        </p>
      </div>
    </div>

    ${chatSessions.length === 0
      ? html`<div class="empty">${t('profile.chatSessions.empty')}</div>`
      : html`
        <div class="section-title cs-section-sub">${t('profile.chatSessions.activeSessions')}</div>
        ${chatSessions.map(s => {
          const isExpanded = expanded === s.name;
          return html`
            <div class="card ${isExpanded ? 'card-expanded' : ''}" key=${s.name}>
              <div class="card-header card-clickable" onClick=${() => toggleExpand(s.name)}>
                <span class="expand-icon">${isExpanded ? '\u25BC' : '\u25B6'}</span>
                <div class="card-title">${escHtml(s.display_name || s.name || '-')}</div>
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
                        <span class="detail-label">${t('profile.chatSessions.description')}</span>
                        <span class="detail-value">${escHtml(s.description)}</span>
                      </div>
                    ` : null}
                    <div class="detail-item">
                      <span class="detail-label">${t('profile.chatSessions.trust')}</span>
                      <span class="detail-value">${s.trust_score ?? '-'}</span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">${t('profile.chatSessions.balance')}</span>
                      <span class="detail-value">${s.morsel_balance ?? '-'} morsels</span>
                    </div>
                    ${s.roles ? html`
                      <div class="detail-item">
                        <span class="detail-label">${t('profile.chatSessions.roles')}</span>
                        <span class="detail-value">${(s.roles || []).join(', ')}</span>
                      </div>
                    ` : null}
                    ${s.created_at ? html`
                      <div class="detail-item">
                        <span class="detail-label">${t('profile.chatSessions.created')}</span>
                        <span class="detail-value">${new Date(s.created_at).toLocaleString()}</span>
                      </div>
                    ` : null}
                  </div>

                  <div class="card-actions flex-actions">
                    <span onClick=${(e) => e.stopPropagation()}>
                      <${CopyButton} text=${s.gaii || s.name} label=${t('profile.agents.copyGaii')} className="btn-outline btn-sm" onCopied=${() => showToast('GAII copied')} />
                    </span>
                    <button class="btn-danger-solid btn-sm" onClick=${(e) => { e.stopPropagation(); handleDelete(s); }}
                      disabled=${deleting === s.name}>
                      ${deleting === s.name ? '...' : t('profile.chatSessions.remove')}
                    </button>
                  </div>
                </div>
              `}
            </div>
          `;
        })}
      `
    }
    <${ConfirmUI} />`;
}
