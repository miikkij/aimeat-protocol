/**
 * @file mcp-tab.js
 * @description Profile tab for managing MCP (Model Context Protocol) connections.
 *   Shows AI assistants connected to the node, their platform, and allows removal.
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial MCP tab
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes; fix fallback strings
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { listChatInstances, deleteChatInstance } from '/js/services/agents.js';

export default function McpTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [connections, setConnections] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const instances = await listChatInstances();
      const mcp = instances.filter(ci => ci.app_name?.startsWith('mcp-') || ci.id?.startsWith('mcp-'));
      setConnections(mcp);
      onStats?.({ mcpConnections: mcp.length });
    } catch { setConnections([]); }
  }, [onStats]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  // Live update listener
  const liveRef = useRef(loadData);
  liveRef.current = loadData;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const handleDelete = useCallback(async (ci) => {
    confirm(t('profile.mcp.confirmDelete'), async () => {
      setDeleting(ci.id);
      try {
        await deleteChatInstance(ci.id);
        showToast(t('profile.mcp.deleted'));
        setExpanded(null);
        loadData();
      } catch {
        showToast(t('profile.mcp.deleteError'), true);
      } finally { setDeleting(null); }
    }, { danger: true });
  }, [confirm, showToast, loadData]);

  const platformLabel = (p) => {
    const labels = {
      claude: 'Claude', 'claude-code': 'Claude Code', 'claude-desktop': 'Claude Desktop',
      chatgpt: 'ChatGPT', copilot: 'GitHub Copilot', cursor: 'Cursor', gemini: 'Gemini',
    };
    return labels[p] || p || 'Unknown';
  };

  if (!connections) return html`<${Spinner} text=${t('profile.mcp.loading')} />`;

  return html`
    <div class="section-title">${t('profile.mcp.title')}</div>
    <div class="section-desc">${t('profile.mcp.desc')}</div>

    <div class="mcp-hint-box">
      <span>${t('profile.mcp.setupHint')}</span>
      ${' '}
      <a href="/v1/portal?view=dev#mcp" class="mcp-hint-link">
        ${t('profile.mcp.setupLink')}
      </a>
    </div>

    ${connections.length === 0
      ? html`
        <div class="card">
          <div class="mcp-empty-body">
            <p class="mb-half">${t('profile.mcp.empty')}</p>
            <p class="mcp-empty-sub">${t('profile.mcp.emptyDesc')}</p>
          </div>
        </div>`
      : html`
        ${connections.map(ci => {
          const isExpanded = expanded === ci.id;
          return html`
            <div class="card ${isExpanded ? 'card-expanded' : ''} mb-half" key=${ci.id}>
              <div class="card-header card-clickable" onClick=${() => setExpanded(isExpanded ? null : ci.id)}>
                <span class="expand-icon">${isExpanded ? '\u25BC' : '\u25B6'}</span>
                <div class="card-title">${platformLabel(ci.platform)}</div>
                <span class="badge badge-info mcp-badge-sm">${escHtml(ci.app_name || '')}</span>
                ${ci.agent_gaii ? html`<span class="badge badge-muted mcp-badge-xs">${escHtml(ci.agent_gaii.split('#')[0] || '')}</span>` : null}
              </div>
              <div class="card-subtitle">${t('profile.mcp.lastSeen')}: ${ci.last_seen ? timeAgo(ci.last_seen) : '-'}</div>

              ${isExpanded && html`
                <div class="card-detail">
                  <div class="detail-grid">
                    ${ci.agent_gaii ? html`
                      <div class="detail-item">
                        <span class="detail-label">${t('profile.mcp.agent')}</span>
                        <span class="detail-value mono">${escHtml(ci.agent_gaii)}</span>
                      </div>
                    ` : null}
                    <div class="detail-item">
                      <span class="detail-label">${t('profile.mcp.platform')}</span>
                      <span class="detail-value">${platformLabel(ci.platform)}</span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">${t('profile.mcp.created')}</span>
                      <span class="detail-value">${ci.created_at ? new Date(ci.created_at).toLocaleString() : '-'}</span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">ID</span>
                      <span class="detail-value mono mcp-id-small">${escHtml(ci.id)}</span>
                    </div>
                  </div>
                  <div class="card-actions flex-actions">
                    <button class="btn-danger-solid btn-sm" onClick=${(e) => { e.stopPropagation(); handleDelete(ci); }}
                      disabled=${deleting === ci.id}>
                      ${deleting === ci.id ? '...' : t('profile.mcp.remove')}
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
