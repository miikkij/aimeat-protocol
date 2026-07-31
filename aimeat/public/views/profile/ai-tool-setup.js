/**
 * @file ai-tool-setup.js
 * @description The per-tool setup table: for each AI tool, how to attach this node over MCP, and
 *   where that tool keeps its persistent instructions field. One source for both, because the two
 *   answers are always needed by the same person in the same sitting.
 *
 *   Every step is written as something to CLICK or TYPE, with the literal UI label, and every
 *   parameter a form asks for is listed with the value to put in it. "Add the MCP server" is not
 *   an instruction; "click Add custom connector, paste this URL into the only field" is.
 *
 *   Sources are the vendors' own docs, linked per tool so a reader can check rather than trust:
 *   Claude connectors support.claude.com/en/articles/11175166, Claude personalization
 *   support.claude.com/en/articles/10185728, Claude Code code.claude.com/docs/en/mcp, ChatGPT
 *   developer mode help.openai.com/en/articles/12584461, Codex developers.openai.com/codex/mcp,
 *   Cursor cursor.com/docs/mcp, VS Code code.visualstudio.com/docs/agent-customization/mcp-servers,
 *   Grok docs.x.ai/grok/connectors. Verified 2026-07-31; vendor UIs move, so the doc link is part
 *   of the answer, not decoration.
 * @structure AI_TOOLS[] — { id, label, mcp: { docs, steps[], params[] }, instructions: { where } }
 *   Steps/labels are {k,f} pairs (i18n key + English fallback), resolved by the caller.
 * @usage import { AI_TOOLS, toolById } from '/views/profile/ai-tool-setup.js';
 * @version-history
 *   v1.0.0 — 2026-07-31 — Initial, from vendor documentation.
 */

/** @typedef {{k: string, f: string}} Txt */

const p = (k, f) => ({ k, f });

/**
 * mcp.params: what the tool's form asks for and what to put in it. `value` is a function of the
 * node URL so a self-hosted node shows its own address, never aimeat.io.
 * mcp.command: a literal command line, when the tool is attached from a terminal instead of a form.
 */
export const AI_TOOLS = [
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    mcp: {
      docs: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp',
      steps: [
        p('tool.claudeDesktop.mcp.s1', 'Open Claude Desktop, click your initials in the bottom left, and choose Settings.'),
        p('tool.claudeDesktop.mcp.s2', 'Open Connectors.'),
        p('tool.claudeDesktop.mcp.s3', 'Click Add custom connector.'),
        p('tool.claudeDesktop.mcp.s4', 'Fill the fields with the values below and click Add.'),
        p('tool.claudeDesktop.mcp.s5', 'A browser tab opens for sign-in. Sign in to this node with your own account and approve the access it asks for.'),
        p('tool.claudeDesktop.mcp.s6', 'Start a NEW conversation. A chat that was already open does not get the tools.'),
      ],
      params: [
        { label: p('tool.param.name', 'Name'), value: () => 'AIMEAT', note: p('tool.param.nameNote', 'Free text. It is only the label you will see in the connector list.') },
        { label: p('tool.param.url', 'Remote MCP server URL'), value: (n) => `${n}/v1/mcp` },
        { label: p('tool.param.oauth', 'Advanced settings: OAuth Client ID / Client Secret'), value: () => '', note: p('tool.param.oauthNote', 'Leave both empty. This node registers the client automatically (RFC 7591), so there is nothing to paste.') },
      ],
      plans: p('tool.claude.plans', 'Free, Pro, Max, Team and Enterprise. A free account can hold exactly one custom connector, which is enough for this.'),
    },
    instructions: {
      where: p('tool.claudeDesktop.instr', 'Settings > General > Instructions for Claude. Applies to every new conversation on the account.'),
      docs: 'https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features',
    },
  },
  {
    id: 'claude-web',
    label: 'claude.ai',
    mcp: {
      docs: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp',
      steps: [
        p('tool.claudeWeb.mcp.s1', 'Open claude.ai and go to Settings, then Connectors. On Pro and Max the path is Customize > Connectors.'),
        p('tool.claudeWeb.mcp.s2', 'Click + and then Add custom connector.'),
        p('tool.claudeWeb.mcp.s3', 'Fill the fields with the values below and click Add.'),
        p('tool.claudeWeb.mcp.s4', 'Sign in to this node in the tab that opens, with your own account.'),
        p('tool.claudeWeb.mcp.s5', 'Start a NEW conversation.'),
      ],
      params: [
        { label: p('tool.param.name', 'Name'), value: () => 'AIMEAT', note: p('tool.param.nameNote', 'Free text. It is only the label you will see in the connector list.') },
        { label: p('tool.param.url', 'Remote MCP server URL'), value: (n) => `${n}/v1/mcp` },
        { label: p('tool.param.oauth', 'Advanced settings: OAuth Client ID / Client Secret'), value: () => '', note: p('tool.param.oauthNote', 'Leave both empty. This node registers the client automatically (RFC 7591), so there is nothing to paste.') },
      ],
      plans: p('tool.claudeWeb.plans', 'Free, Pro, Max, Team and Enterprise. On Team and Enterprise an owner adds it under Organization settings > Connectors > Add > Custom > Web, and until they do, you cannot.'),
    },
    instructions: {
      where: p('tool.claudeWeb.instr', 'Settings > General > Instructions for Claude (shown under Profile in some versions). Applies to every new conversation on the account.'),
      docs: 'https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features',
    },
  },
  {
    id: 'claude-code',
    label: 'Claude Code (CLI)',
    mcp: {
      docs: 'https://code.claude.com/docs/en/mcp',
      steps: [
        p('tool.claudeCode.mcp.s1', 'Run the command below in a terminal. Add -s user to make it available in all your projects; without it the server is added for the current project only.'),
        p('tool.claudeCode.mcp.s2', 'Run claude mcp list. The node should show as Connected. Needs authentication means the sign-in has not been completed yet.'),
        p('tool.claudeCode.mcp.s3', 'Inside Claude Code, type /mcp to see the server and its tool count.'),
      ],
      command: (n) => `claude mcp add --transport http aimeat ${n}/v1/mcp`,
      params: [
        { label: p('tool.param.transport', '--transport'), value: () => 'http', note: p('tool.param.transportNote', 'Streamable HTTP. In JSON config the same transport is also spelled streamable-http.') },
        { label: p('tool.param.serverName', 'Server name'), value: () => 'aimeat', note: p('tool.param.serverNameNote', 'Your own choice. It is the name you will see in /mcp.') },
        { label: p('tool.param.urlPlain', 'URL'), value: (n) => `${n}/v1/mcp` },
        { label: p('tool.param.scope', '-s / --scope'), value: () => 'local | project | user', note: p('tool.param.scopeNote', 'local is the default (this project, only you). user makes it available in all your projects. project writes it into .mcp.json and shares it with the team.') },
      ],
    },
    instructions: {
      where: p('tool.claudeCode.instr', 'CLAUDE.md at the root of the project. Claude Code reads it at the start of every session. For all your projects at once, ~/.claude/CLAUDE.md.'),
      docs: 'https://code.claude.com/docs/en/memory',
    },
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    mcp: {
      docs: 'https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt',
      steps: [
        p('tool.chatgpt.mcp.s1', 'Open ChatGPT in a browser. The desktop and mobile apps cannot do this.'),
        p('tool.chatgpt.mcp.s2', 'Settings > Security and login: turn Developer mode on. In a workspace the switch is under Workspace settings > Permissions & Roles.'),
        p('tool.chatgpt.mcp.s3', 'Open the connector list and create a new developer-mode app.'),
        p('tool.chatgpt.mcp.s4', 'Fill the fields with the values below. The URL must end in /v1/mcp; without the path it will not connect.'),
        p('tool.chatgpt.mcp.s5', 'Complete the sign-in, then start a new conversation and enable the connector in it.'),
      ],
      params: [
        { label: p('tool.param.name', 'Name'), value: () => 'AIMEAT' },
        { label: p('tool.param.description', 'Description'), value: () => 'My AIMEAT node: memory, organisms, tasks' },
        { label: p('tool.param.url', 'MCP server URL'), value: (n) => `${n}/v1/mcp` },
      ],
      plans: p('tool.chatgpt.plans', 'Plus, Pro, Business, Enterprise and Education. Not on the free tier, and not in the apps: browser only.'),
      warn: p('tool.chatgpt.warn', 'OpenAI marks developer mode as being for people who understand the risk: it grants both read and write tools. Their own warning is worth reading before you switch it on.'),
    },
    instructions: {
      where: p('tool.chatgpt.instr', 'Settings > Personalization > Custom instructions, in the field for what ChatGPT should know about you.'),
    },
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    mcp: {
      docs: 'https://developers.openai.com/codex/mcp',
      steps: [
        p('tool.codex.mcp.s1', 'Run the command below in a terminal. It writes the server into ~/.codex/config.toml.'),
        p('tool.codex.mcp.s2', 'Run codex mcp list and check that the node is listed.'),
      ],
      command: (n) => `codex mcp add aimeat --url ${n}/v1/mcp`,
      params: [
        { label: p('tool.param.serverName', 'Server name'), value: () => 'aimeat' },
        { label: p('tool.param.urlPlain', 'URL'), value: (n) => `${n}/v1/mcp` },
        { label: p('tool.param.configFile', 'Config file'), value: () => '~/.codex/config.toml', note: p('tool.param.configFileNote', 'For one project only, .codex/config.toml in the project (trusted projects only).') },
      ],
      note: p('tool.codex.note', 'Codex versions differ in how remote servers are given on the command line. If the command is rejected, run codex mcp --help and check the flag name, or write the server straight into config.toml.'),
    },
    instructions: {
      where: p('tool.codex.instr', 'AGENTS.md at the root of the project. Codex reads it before it starts working, and it travels with the repository.'),
      docs: 'https://developers.openai.com/codex/concepts/customization',
    },
  },
  {
    id: 'cursor',
    label: 'Cursor',
    mcp: {
      docs: 'https://cursor.com/docs/mcp',
      steps: [
        p('tool.cursor.mcp.s1', 'Use the one-click install button on this node’s connect page: it opens Cursor and pre-fills everything.'),
        p('tool.cursor.mcp.s2', 'Cursor asks for confirmation. Accept it, and complete the sign-in in the browser.'),
        p('tool.cursor.mcp.s3', 'By hand instead: Settings > MCP > Add new MCP server, transport HTTP, with the values below.'),
      ],
      params: [
        { label: p('tool.param.serverName', 'Server name'), value: () => 'aimeat' },
        { label: p('tool.param.transport', 'Transport'), value: () => 'HTTP', note: p('tool.param.cursorTransportNote', 'Cursor supports HTTP and stdio. SSE and mcp-remote do not work.') },
        { label: p('tool.param.urlPlain', 'URL'), value: (n) => `${n}/v1/mcp` },
      ],
    },
    instructions: {
      where: p('tool.cursor.instr', 'AGENTS.md at the root of the project, or Cursor Settings > Rules for a rule that applies to every project.'),
    },
  },
  {
    id: 'vscode',
    label: 'VS Code (Copilot)',
    mcp: {
      docs: 'https://code.visualstudio.com/docs/agent-customization/mcp-servers',
      steps: [
        p('tool.vscode.mcp.s1', 'Open the Command Palette (Ctrl+Shift+P, on a Mac Cmd+Shift+P) and run MCP: Add Server.'),
        p('tool.vscode.mcp.s2', 'Choose HTTP as the type, then give the values below.'),
        p('tool.vscode.mcp.s3', 'Choose Global to make it available everywhere, or Workspace to write it into .vscode/mcp.json in this project.'),
        p('tool.vscode.mcp.s4', 'Complete the sign-in in the browser, then open Agent mode and check the node is in the tool list.'),
      ],
      command: (n) => `code --add-mcp '{"name":"aimeat","url":"${n}/v1/mcp"}'`,
      params: [
        { label: p('tool.param.serverName', 'Server name'), value: () => 'aimeat' },
        { label: p('tool.param.urlPlain', 'URL'), value: (n) => `${n}/v1/mcp` },
        { label: p('tool.param.configFile', 'Config file'), value: () => '.vscode/mcp.json', note: p('tool.param.vscodeConfigNote', 'Workspace scope. For your user profile, run MCP: Open User Configuration.') },
      ],
    },
    instructions: {
      where: p('tool.vscode.instr', 'AGENTS.md at the root of the project, or .github/copilot-instructions.md, which Copilot reads in every chat in that repository.'),
    },
  },
  {
    id: 'grok',
    label: 'Grok',
    mcp: {
      docs: 'https://docs.x.ai/grok/connectors',
      steps: [
        p('tool.grok.mcp.s1', 'Open grok.com/connectors.'),
        p('tool.grok.mcp.s2', 'Click New Connector and choose Custom.'),
        p('tool.grok.mcp.s3', 'Give the MCP server URL below and complete the sign-in it asks for.'),
      ],
      params: [
        { label: p('tool.param.name', 'Name'), value: () => 'AIMEAT' },
        { label: p('tool.param.url', 'MCP server URL'), value: (n) => `${n}/v1/mcp` },
      ],
      plans: p('tool.grok.plans', 'Paid tiers only. The node also has to be reachable from the public internet, so a node on localhost will not work here.'),
    },
    instructions: {
      where: p('tool.grok.instr', 'Open the mode menu next to the chat box, find Custom Instructions and click Customize. Applies to all your conversations.'),
    },
  },
];

/** @param {string} id */
export function toolById(id) {
  return AI_TOOLS.find(t => t.id === id) || AI_TOOLS[0];
}
