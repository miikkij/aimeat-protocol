/**
 * @file McpInstall.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The short way in: the links and files that attach this node to an AI tool without
 *   the person walking that tool's settings menu.
 *
 *   IT SITS BESIDE THE STEPS, NEVER INSTEAD OF THEM. A one-click link is blocked on a managed
 *   machine, does nothing when the client is not installed, and tells the person nothing about what
 *   is being written. The steps answer all three. So McpInstallRow renders above a tool's steps and
 *   removes none of them.
 *
 *   THE FILES CARRY NOTHING PRIVATE. This node authenticates MCP over OAuth, so the config is the
 *   endpoint address and a name. That is why these can be plain links: no token to leak, no
 *   per-person file to generate, and a `.mcp.json` a team can commit.
 *
 *   WHAT IT SHOWS COMES FROM THE NODE, not from a list here. GET /v1/ai-tools says which tools have
 *   an install link and which have a file, and a tool with neither simply does not appear in the
 *   quick row. A second list in the browser would be the drift the served table exists to prevent.
 * @structure McpInstallRow({ tool, serverName }) · McpQuickConnect({ serverName, guideHref, title, lead })
 * @usage
 *   import { McpQuickConnect } from '/components/McpInstall.js';
 *   html`<${McpQuickConnect} serverName=${agentName} />`
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { useAiTools } from '/views/profile/ai-tool-setup.js';

const html = htm.bind(h);
// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * The download address for one tool's config file, with the server name the caller wants.
 *
 * The name is what the server appears under in the client's own list. On an agent's page it is that
 * agent's name, so a person running several of them can tell the entries apart. The node sanitizes
 * it either way; this only has to encode it.
 */
function fileUrl(file, serverName) {
  if (!file?.url) return '';
  if (!serverName) return file.url;
  const sep = file.url.includes('?') ? '&' : '?';
  return `${file.url}${sep}name=${encodeURIComponent(serverName)}`;
}

/** Every tool the node says can be attached by a link or a file, in the table's own order. */
function withInstall(tools) {
  return (tools ?? []).filter((tool) => tool?.mcp?.install?.link || tool?.mcp?.install?.file);
}

/**
 * One tool's short way in, for the setup guide. Renders nothing for a tool that has neither, which
 * is most of them: a chat app is attached through its own connector form and there is no file.
 */
export function McpInstallRow({ tool, serverName }) {
  const install = tool?.mcp?.install;
  if (!install || (!install.link && !install.file)) return null;

  return html`
    <div class="mcpi mcpi--tool">
      <div class="mcpi-head">${tr('mcpInstall.title', 'The short way in')}</div>
      ${install.link ? html`
        <div class="mcpi-oneclick">
          <a class="btn-primary btn-sm" href=${install.link.href}>${install.link.label}</a>
          <span class="mcpi-note">${install.link.note}</span>
        </div>` : null}
      ${install.file ? html`
        <div class="mcpi-file">
          <a class="btn-outline btn-sm" href=${fileUrl(install.file, serverName)} download=${install.file.filename}>
            ${install.file.label}
          </a>
          <span class="mcpi-note">${install.file.where}</span>
        </div>` : null}
    </div>`;
}

/**
 * The whole short way in, for a surface that is not the setup guide: the home when nothing is
 * connected, and an agent that has not been attached to anything yet.
 *
 * It draws the one-click links first, then the terminal one-liners, then the files, because that is
 * the order of how little the person has to do. Renders nothing until the table arrives.
 *
 * A TITLE MEANS THIS IS THE PAGE'S MAIN ASK, and the buttons are drawn as primary. Without one it
 * is an aside beside work that is already done — the same agent on a second machine — and two solid
 * primary buttons there shout over the connection status they sit under. Same component, one rule.
 *
 * @param {{ serverName?: string, guideHref?: string, title?: string, lead?: string }} props
 */
export function McpQuickConnect({ serverName, guideHref = '/v1/profile?tab=mcp', title, lead }) {
  const tools = useAiTools();
  const installable = withInstall(tools);
  if (!installable.length) return null;

  const links = installable.filter((tool) => tool.mcp.install.link);
  const files = installable.filter((tool) => tool.mcp.install.file);
  const commands = installable.filter((tool) => tool.mcp.command && !tool.mcp.install.link);
  const emphasis = title ? 'btn-primary btn-sm' : 'btn-outline btn-sm';

  return html`
    <div class="mcpi mcpi--quick">
      ${title ? html`<div class="mcpi-title">${title}</div>` : null}
      ${lead ? html`<p class="mcpi-lead">${lead}</p>` : null}

      ${links.length ? html`
        <div class="mcpi-oneclick">
          ${links.map(tool => html`
            <a key=${tool.id} class=${emphasis} href=${tool.mcp.install.link.href}>
              ${tool.mcp.install.link.label}
            </a>`)}
        </div>` : null}

      ${commands.map(tool => html`
        <div class="mcpi-cmd" key=${tool.id}>
          <span class="mcpi-cmd-label">${tool.label}</span>
          <code class="mcpi-cmd-text">${tool.mcp.command}</code>
          <${CopyButton} text=${tool.mcp.command} className="btn-ghost btn-sm"
            label=${tr('common.copy', 'Copy')} copiedLabel=${tr('common.copied', 'Copied')} />
        </div>`)}

      ${files.length ? html`
        <div class="mcpi-files">
          <span class="mcpi-files-label">${tr('mcpInstall.filesLabel', 'Or save the configuration file:')}</span>
          ${files.map(tool => html`
            <a key=${tool.id} class="mcpi-file-link" href=${fileUrl(tool.mcp.install.file, serverName)}
              download=${tool.mcp.install.file.filename}
              title=${tool.mcp.install.file.where}>
              ${tool.label} <code>${tool.mcp.install.file.filename}</code>
            </a>`)}
        </div>` : null}

      <a class="mcpi-more" href=${guideHref}>
        ${tr('mcpInstall.more', 'Another tool, or the steps in full')} →
      </a>
    </div>`;
}

export default McpQuickConnect;
