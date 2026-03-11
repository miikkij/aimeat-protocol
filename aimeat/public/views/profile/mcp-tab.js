import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { listChatInstances, deleteChatInstance } from '/js/services/agents.js';

export default function McpTab({ session, showToast, onStats }) {
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

  const handleDelete = useCallback(async (ci) => {
    if (!confirm(t('profile.mcp.confirmDelete') || `Remove MCP connection "${ci.app_name || ci.id}"?`)) return;
    setDeleting(ci.id);
    try {
      await deleteChatInstance(ci.id);
      showToast(t('profile.mcp.deleted') || 'MCP connection removed');
      setExpanded(null);
      loadData();
    } catch {
      showToast(t('profile.mcp.deleteError') || 'Failed to remove MCP connection', true);
    } finally { setDeleting(null); }
  }, [showToast, loadData]);

  const platformLabel = (p) => {
    const labels = { claude: 'Claude', chatgpt: 'ChatGPT', copilot: 'GitHub Copilot', cursor: 'Cursor', gemini: 'Gemini' };
    return labels[p] || p || 'Unknown';
  };

  if (!connections) return html`<${Spinner} text=${t('profile.mcp.loading') || 'Loading MCP connections...'} />`;

  return html`
    <div class="section-title">${t('profile.mcp.title') || 'MCP Connections'}</div>
    <div class="section-desc">${t('profile.mcp.desc') || 'AI assistants connected to your node via Model Context Protocol (MCP). These can read and write to your memory, use tools, and act on your behalf.'}</div>

    <div style="margin-bottom:1rem;padding:.5rem .75rem;background:rgba(130,100,255,.06);border:1px solid rgba(130,100,255,.15);border-radius:.25rem;font-size:.82rem">
      <span>${t('profile.mcp.setupHint') || 'Connect a new AI assistant via the developer portal.'}</span>
      ${' '}
      <a href="/v1/portal?view=dev#mcp" style="color:var(--accent,#a78bfa);text-decoration:underline">
        ${t('profile.mcp.setupLink') || 'Set up MCP connection'}
      </a>
    </div>

    ${connections.length === 0
      ? html`
        <div class="card">
          <div style="padding:.75rem 1rem;font-size:.85rem;color:var(--muted,#c4a6d0)">
            <p style="margin:0 0 .5rem">${t('profile.mcp.empty') || 'No MCP connections yet.'}</p>
            <p style="margin:0;font-size:.8rem">${t('profile.mcp.emptyDesc') || 'When you connect an AI assistant (Claude, ChatGPT, Cursor, etc.) via MCP, it will appear here. All memory entries written by MCP tools appear in your Memory tab.'}</p>
          </div>
        </div>`
      : html`
        ${connections.map(ci => {
          const isExpanded = expanded === ci.id;
          return html`
            <div class="card ${isExpanded ? 'card-expanded' : ''}" key=${ci.id} style="margin-bottom:.5rem">
              <div class="card-header card-clickable" onClick=${() => setExpanded(isExpanded ? null : ci.id)}>
                <span class="expand-icon">${isExpanded ? '\u25BC' : '\u25B6'}</span>
                <div class="card-title">${platformLabel(ci.platform)}</div>
                <span class="badge badge-info" style="font-size:.7rem">${escHtml(ci.app_name || '')}</span>
                ${ci.agent_gaii ? html`<span class="badge badge-muted" style="font-size:.65rem">${escHtml(ci.agent_gaii.split('#')[0] || '')}</span>` : null}
              </div>
              <div class="card-subtitle">${t('profile.mcp.lastSeen') || 'Last seen'}: ${ci.last_seen ? timeAgo(ci.last_seen) : '-'}</div>

              ${isExpanded && html`
                <div class="card-detail">
                  <div class="detail-grid">
                    ${ci.agent_gaii ? html`
                      <div class="detail-item">
                        <span class="detail-label">${t('profile.mcp.agent') || 'Agent'}</span>
                        <span class="detail-value mono">${escHtml(ci.agent_gaii)}</span>
                      </div>
                    ` : null}
                    <div class="detail-item">
                      <span class="detail-label">${t('profile.mcp.platform') || 'Platform'}</span>
                      <span class="detail-value">${platformLabel(ci.platform)}</span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">${t('profile.mcp.created') || 'Connected'}</span>
                      <span class="detail-value">${ci.created_at ? new Date(ci.created_at).toLocaleString() : '-'}</span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">ID</span>
                      <span class="detail-value mono" style="font-size:.7rem;word-break:break-all">${escHtml(ci.id)}</span>
                    </div>
                  </div>
                  <div class="card-actions" style="margin-top:.75rem">
                    <button class="btn-sm btn-danger" onClick=${(e) => { e.stopPropagation(); handleDelete(ci); }}
                      disabled=${deleting === ci.id}>
                      ${deleting === ci.id ? '...' : (t('profile.mcp.remove') || 'Remove Connection')}
                    </button>
                  </div>
                </div>
              `}
            </div>
          `;
        })}
      `
    }`;
}
