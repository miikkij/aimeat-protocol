/**
 * @file public/views/profile/mcp/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the MCP page's views share: the words (m), relative time, the tool a client id
 *   stands for, the permission word an agent's scopes add up to, the rows the page lists (one per
 *   AI that has spoken over MCP, plus the older per-tool rows until their agent connects again),
 *   the crumb and the cross-page rail links.
 * @structure m · rel · day · toolLabel · initials · mayWord · buildRows · crumb · pageLinks · goTab
 * @usage import { m, buildRows, crumb, pageLinks } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial (design canvas "AIMEAT MCP-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { detectTemplate, expandScopes } from '/views/profile/agents/scope-model.js';

export const m = (key, vars) => t('mcppage.' + key, vars);
export const locale = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-CO' : 'en-GB');
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString(locale()) : '');
export const rel = (iso) => { if (!iso) return ''; const d = new Date(iso); return Date.now() - d.getTime() > 30 * 864e5 ? day(iso) : formatRelativeTime(iso); };

/** The tool an MCP client id stands for, as a person names it. */
const TOOL_LABELS = {
  claude: 'Claude', 'claude-code': 'Claude Code', 'claude-desktop': 'Claude Desktop', 'claude-web': 'claude.ai',
  chatgpt: 'ChatGPT', copilot: 'GitHub Copilot', cursor: 'Cursor', gemini: 'Gemini', grok: 'Grok',
  codex: 'Codex CLI', vscode: 'VS Code', goose: 'goose', dify: 'Dify', 'aimeat-chat': 'AIMEAT-chat',
};
export function toolLabel(id) {
  const raw = String(id || '').replace(/^mcp-/, '');
  if (!raw || raw === 'unknown') return m('toolUnknown');
  if (TOOL_LABELS[raw]) return TOOL_LABELS[raw];
  const lower = raw.toLowerCase();
  for (const [k, v] of Object.entries(TOOL_LABELS)) if (lower.includes(k)) return v;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** The one- or two-letter mark a row wears. */
export function initials(name) {
  const words = String(name || '').trim().split(/[\s-]+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 1) : words[0][0] + words[1][0]).toUpperCase();
}

/**
 * What an agent may do, in the same word the Agents page uses, plus the line under it. The scope
 * list is read the way that page reads it: a missing list is the legacy "everything" default.
 */
export function mayWord(agent) {
  const scopes = agent?.default_scopes ?? ['*'];
  const tpl = detectTemplate(scopes);
  const labelKey = { readonly: 'readOnly', standard: 'standard', full: 'fullAccess', custom: 'custom' }[tpl] || 'custom';
  const word = t('profile.agents.scopeUi.' + labelKey);
  if (tpl === 'full') return { word, full: true, note: m('mayFullNote') };
  const n = expandScopes(scopes).size;
  return { word, full: false, note: m('mayCountNote', { n }) };
}

/**
 * The rows the page lists. One per agent that has spoken over MCP (`mcp_last_seen` is set by the
 * MCP door alone), newest first; then the older per-tool session rows whose agent has not yet
 * earned its own row — either it has not connected since the per-agent mark shipped, or it has
 * been deleted. A tool row for an agent that IS in the first group is the same connection seen
 * twice, and is dropped.
 */
export function buildRows(agents, instances) {
  const byGaii = new Map((agents || []).map((a) => [a.gaii, a]));
  const agentRows = (agents || [])
    .filter((a) => a.mcp_last_seen)
    .map((a) => ({ kind: 'agent', id: a.gaii, agent: a, name: a.name, tool: toolLabel(a.mcp_client), when: a.mcp_last_seen, since: a.created_at }));
  const covered = new Set(agentRows.map((r) => r.id));
  const toolRows = (instances || [])
    .filter((ci) => String(ci.id || '').startsWith('mcp-') || String(ci.app_name || '').startsWith('mcp-'))
    .filter((ci) => !ci.agent_gaii || !covered.has(ci.agent_gaii))
    .map((ci) => {
      const agent = ci.agent_gaii ? byGaii.get(ci.agent_gaii) || null : null;
      return { kind: 'tool', id: ci.id, agent, name: agent ? agent.name : (ci.agent_gaii ? ci.agent_gaii.split('#')[0] : ''), tool: toolLabel(ci.platform), when: ci.last_seen, since: ci.created_at, gone: !!ci.agent_gaii && !agent };
    });
  return [...agentRows, ...toolRows].sort((a, b) => Date.parse(b.when || 0) - Date.parse(a.when || 0));
}

export function crumb() {
  return html`<div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuAutomation')}</span><span>/</span><span class="og-crumb-here">${t('profile.tabs.mcp')}</span></div>`;
}

const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export const goTab = openTab;
export function pageLinks() {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => openTab('agents')}><i>→</i>${t('profile.tabs.agents')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('organisms')}><i>→</i>${t('profile.tabs.organisms')}<em>→</em></button>
    <a class="og-rail-link" href="/v1/chat"><i>→</i>${t('nav.chat')}<em>→</em></a>`;
}
