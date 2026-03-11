import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { listAgents, deleteAgent, listChatInstances, deleteChatInstance } from '/js/services/agents.js';
import { apiGet } from '/js/api.js';

export default function ChatSessionsTab({ session, showToast, onStats }) {
  const [chatSessions, setChatSessions] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [copying, setCopying] = useState(null);
  const [mcpConnections, setMcpConnections] = useState(null);
  const [expandedMcp, setExpandedMcp] = useState(null);
  const [deletingMcp, setDeletingMcp] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const agents = await listAgents(session.owner);
      const sessions = agents.filter(a => a.owner === session.owner && a.name?.startsWith('session-'));
      setChatSessions(sessions);
      onStats?.({ chatSessions: sessions.length });
    } catch { setChatSessions([]); }
    // Load MCP connections (ChatInstanceRecords with mcp-* prefix)
    try {
      const instances = await listChatInstances();
      const mcp = instances.filter(ci => ci.app_name?.startsWith('mcp-') || ci.id?.startsWith('mcp-'));
      setMcpConnections(mcp);
      onStats?.({ mcpConnections: mcp.length });
    } catch { setMcpConnections([]); }
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

  const copyPrompt = useCallback(async (type) => {
    setCopying(type);
    try {
      const endpoint = type === 'quick'
        ? '/v1/templates/chat-session-quick'
        : '/v1/templates/chat-session-human';
      const resp = await apiGet(endpoint);
      const text = resp?.data?.prompt;
      if (text) {
        await navigator.clipboard.writeText(text);
        showToast(t('profile.chatSessions.promptCopied') || 'Prompt copied to clipboard');
      } else {
        showToast(t('profile.chatSessions.promptError') || 'Could not load prompt template');
      }
    } catch {
      showToast(t('profile.chatSessions.promptError') || 'Could not load prompt template');
    } finally { setCopying(null); }
  }, [showToast]);

  const handleDeleteMcp = useCallback(async (ci) => {
    if (!confirm(t('profile.mcpConnections.confirmDelete') || `Remove MCP connection "${ci.app_name || ci.id}"?`)) return;
    setDeletingMcp(ci.id);
    try {
      await deleteChatInstance(ci.id);
      showToast(t('profile.mcpConnections.deleted') || 'MCP connection removed');
      setExpandedMcp(null);
      loadData();
    } catch {
      showToast(t('profile.mcpConnections.deleteError') || 'Failed to remove MCP connection', true);
    } finally { setDeletingMcp(null); }
  }, [showToast, loadData]);

  const platformLabel = (p) => {
    const labels = { claude: 'Claude', chatgpt: 'ChatGPT', copilot: 'GitHub Copilot', cursor: 'Cursor', gemini: 'Gemini' };
    return labels[p] || p || 'Unknown';
  };

  if (!chatSessions) return html`<${Spinner} text=${t('profile.chatSessions.loading')} />`;
  return html`
    <div class="section-title">${t('profile.chatSessions.title')}</div>
    <div class="section-desc">${t('profile.chatSessions.desc')}</div>

    <!-- MCP Connections section -->
    <div class="section-title" style="font-size:.95rem;margin-top:.5rem;margin-bottom:.5rem">
      ${t('profile.mcpConnections.title') || 'MCP Connections'}
    </div>
    <p style="font-size:.82rem;color:var(--muted,#c4a6d0);margin:0 0 .75rem">
      ${t('profile.mcpConnections.desc') || 'AI assistants connected via Model Context Protocol (MCP). These can read and write to your memory.'}
    </p>
    ${mcpConnections === null ? html`<${Spinner} text=${t('profile.mcpConnections.loading') || 'Loading MCP connections...'} />`
      : mcpConnections.length === 0
        ? html`
          <div class="card" style="margin-bottom:1rem">
            <div style="padding:.75rem 1rem;font-size:.85rem;color:var(--muted,#c4a6d0)">
              <p style="margin:0 0 .5rem">${t('profile.mcpConnections.empty') || 'No MCP connections yet.'}</p>
              <a href="/v1/portal?view=dev#mcp" style="color:var(--accent,#a78bfa);text-decoration:underline">
                ${t('profile.mcpConnections.setupLink') || 'Set up MCP connection in developer portal'}
              </a>
            </div>
          </div>`
        : html`
          <div style="margin-bottom:1.5rem">
            ${mcpConnections.map(ci => {
              const isExpanded = expandedMcp === ci.id;
              return html`
                <div class="card ${isExpanded ? 'card-expanded' : ''}" key=${ci.id} style="margin-bottom:.5rem">
                  <div class="card-header card-clickable" onClick=${() => setExpandedMcp(isExpanded ? null : ci.id)}>
                    <span class="expand-icon">${isExpanded ? '\u25BC' : '\u25B6'}</span>
                    <div class="card-title">${platformLabel(ci.platform)}</div>
                    <span class="badge badge-info" style="font-size:.7rem">${escHtml(ci.app_name || '')}</span>
                    ${ci.agent_gaii ? html`<span class="badge badge-muted" style="font-size:.65rem">${escHtml(ci.agent_gaii.split('#')[0] || '')}</span>` : null}
                  </div>
                  <div class="card-subtitle">${t('profile.mcpConnections.lastSeen') || 'Last seen'}: ${ci.last_seen ? timeAgo(ci.last_seen) : '-'}</div>

                  ${isExpanded && html`
                    <div class="card-detail">
                      <div class="detail-grid">
                        ${ci.agent_gaii ? html`
                          <div class="detail-item">
                            <span class="detail-label">${t('profile.mcpConnections.agent') || 'Agent'}</span>
                            <span class="detail-value mono">${escHtml(ci.agent_gaii)}</span>
                          </div>
                        ` : null}
                        <div class="detail-item">
                          <span class="detail-label">${t('profile.mcpConnections.platform') || 'Platform'}</span>
                          <span class="detail-value">${platformLabel(ci.platform)}</span>
                        </div>
                        <div class="detail-item">
                          <span class="detail-label">${t('profile.mcpConnections.created') || 'Connected'}</span>
                          <span class="detail-value">${ci.created_at ? new Date(ci.created_at).toLocaleString() : '-'}</span>
                        </div>
                        <div class="detail-item">
                          <span class="detail-label">ID</span>
                          <span class="detail-value mono" style="font-size:.7rem;word-break:break-all">${escHtml(ci.id)}</span>
                        </div>
                      </div>
                      <div class="card-actions" style="margin-top:.75rem">
                        <button class="btn-sm btn-danger" onClick=${(e) => { e.stopPropagation(); handleDeleteMcp(ci); }}
                          disabled=${deletingMcp === ci.id}>
                          ${deletingMcp === ci.id ? '...' : (t('profile.mcpConnections.remove') || 'Remove Connection')}
                        </button>
                      </div>
                    </div>
                  `}
                </div>
              `;
            })}
          </div>
        `
    }

    <div style="margin-bottom:1rem;padding:.5rem .75rem;background:rgba(130,100,255,.06);border:1px solid rgba(130,100,255,.15);border-radius:.25rem;font-size:.82rem">
      <span>${t('profile.chatSessions.mcpHint') || 'You can connect AI assistants via MCP in the developer portal.'}</span>
      ${' '}
      <a href="/v1/portal?view=dev#mcp" style="color:var(--accent,#a78bfa);text-decoration:underline">
        ${t('profile.chatSessions.mcpHintLink') || 'Set up MCP connection'}
      </a>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div class="card-header">
        <div class="card-title">${t('profile.chatSessions.createTitle') || 'Create a Chat Session'}</div>
      </div>
      <div style="padding:.75rem 1rem .5rem">
        <p style="margin:0 0 .5rem;font-size:.85rem;color:var(--muted,#c4a6d0)">
          ${t('profile.chatSessions.createDesc') || 'Copy a prompt below and paste it into your AI chat (Claude, ChatGPT, Grok, etc.) to create a new chat session connected to your AIMEAT node.'}
        </p>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem">
          <button class="btn-sm btn-copy" onClick=${() => copyPrompt('quick')}
            disabled=${copying === 'quick'}>
            ${copying === 'quick' ? '...' : (t('profile.chatSessions.copyQuickPrompt') || 'Copy Quick Prompt')}
          </button>
          <button class="btn-sm btn-copy" onClick=${() => copyPrompt('detailed')}
            disabled=${copying === 'detailed'}>
            ${copying === 'detailed' ? '...' : (t('profile.chatSessions.copyDetailedPrompt') || 'Copy Detailed Prompt')}
          </button>
        </div>
        <p style="margin:0;font-size:.75rem;color:var(--muted,#c4a6d0);font-style:italic">
          ${t('profile.chatSessions.createHint') || 'Quick Prompt works with AIs that can browse the web. Detailed Prompt includes full connection instructions for any AI.'}
        </p>
      </div>
    </div>

    ${chatSessions.length === 0
      ? html`<div class="empty">${t('profile.chatSessions.empty')}</div>`
      : html`
        <div class="section-title" style="font-size:.9rem;margin-top:1rem">${t('profile.chatSessions.activeSessions') || 'Active Sessions'}</div>
        ${chatSessions.map(s => {
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
        })}
      `
    }`;
}
