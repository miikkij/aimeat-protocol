/**
 * @file mcp-install.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one place that turns this node's MCP endpoint into something a client can accept
 *   without being walked through a menu: the config file it reads, and the link that installs the
 *   server in one click.
 *
 *   NOTHING HERE CARRIES A SECRET, and that is what makes the whole shortcut possible. This node
 *   speaks OAuth 2.1 with dynamic client registration (src/mcp/oauth.ts), so a client needs the URL
 *   and nothing else: it registers itself, opens a browser, and the person signs in as themselves.
 *   A config file with a token in it would have to be generated per person, kept out of version
 *   control and rotated. This one is the same four lines for everybody and can be handed out
 *   publicly.
 *
 *   THE SHAPES DIFFER PER CLIENT AND THE DIFFERENCES ARE NOT COSMETIC. Claude Code and Cursor key
 *   on `mcpServers`, VS Code on `servers`. VS Code requires `type`, Cursor infers it from `url`.
 *   Getting one of those wrong produces a file the client loads and silently ignores, which is the
 *   failure this whole path exists to remove, so each shape is written out rather than derived.
 *
 *   THE SERVER NAME IS SANITIZED, not trusted. It arrives from a query parameter and lands inside
 *   JSON and inside a URL, so it is reduced to [a-z0-9-] before either.
 * @structure MCP_INSTALL_CLIENTS · normalizeServerName · mcpConfigFile · mcpInstallLink
 * @usage
 *   import { mcpConfigFile, mcpInstallLink } from '../services/mcp-install.js';
 *   const file = mcpConfigFile('vscode', `${config.baseUrl}/v1/mcp`, 'aimeat');
 * @version-history
 *   v1.0.1 — 2026-08-26 — SECURITY (CodeQL js/polynomial-redos): normalizeServerName trimmed edge
 *     dashes with `/^-+|-+$/g` and `/-+$/g`, which backtrack quadratically on a long caller-supplied
 *     name. Replaced with single-character trims, linear and equivalent after the run-collapse.
 *   v1.0.0 — 2026-08-27 — Initial: the config files and one-click links behind GET
 *     /v1/connect/mcp.json and the install row on the setup guide.
 */

/** The clients whose configuration this node can write out. Others are attached through a form. */
export const MCP_INSTALL_CLIENTS = ['claude-code', 'vscode', 'cursor'] as const;
export type McpInstallClientId = typeof MCP_INSTALL_CLIENTS[number];

/** The name the server appears under in the client's own list. Overridable, hence sanitized. */
export const DEFAULT_SERVER_NAME = 'aimeat';

export interface McpConfigFile {
    /** What the saved file is called. Claude Code's is a dotfile; the other two are not. */
    filename: string;
    /** The JSON the client reads. Safe to serve publicly: it holds no credential. */
    config: Record<string, unknown>;
}

export function isMcpInstallClient(value: unknown): value is McpInstallClientId {
    return typeof value === 'string' && (MCP_INSTALL_CLIENTS as readonly string[]).includes(value);
}

/**
 * A server name that is safe to put in JSON and in a URL, and that a client will accept.
 *
 * Anything outside [a-z0-9-] becomes a hyphen rather than being dropped, so two different names
 * cannot collapse into the same one. An empty or all-punctuation input falls back to the default.
 */
export function normalizeServerName(raw: unknown): string {
    if (typeof raw !== 'string') return DEFAULT_SERVER_NAME;
    const cleaned = raw
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-{2,}/g, '-')
        // The run-collapse above leaves single dashes only, so a one-character edge trim finishes
        // it. Written without `-+` before/after an anchor: `/^-+|-+$/g` backtracks quadratically on
        // a long run and `raw` is caller-supplied (js/polynomial-redos).
        .replace(/^-/, '').replace(/-$/, '')
        .slice(0, 32)
        .replace(/-$/, '');
    return cleaned || DEFAULT_SERVER_NAME;
}

/**
 * The client's MCP configuration file, ready to save.
 *
 * @param clientId  one of MCP_INSTALL_CLIENTS
 * @param mcpUrl    this node's MCP endpoint, absolute
 * @param serverName the name the server appears under; sanitized here, so callers may pass raw input
 */
export function mcpConfigFile(clientId: McpInstallClientId, mcpUrl: string, serverName?: unknown): McpConfigFile {
    const name = normalizeServerName(serverName);
    switch (clientId) {
        case 'claude-code':
            // Committed at the project root, where Claude Code offers it to whoever opens the repo.
            return { filename: '.mcp.json', config: { mcpServers: { [name]: { type: 'http', url: mcpUrl } } } };
        case 'vscode':
            // `servers`, not `mcpServers`, and `type` is required. Both differ from the other two.
            return { filename: 'mcp.json', config: { servers: { [name]: { type: 'http', url: mcpUrl } } } };
        case 'cursor':
            // Cursor reads the transport off the url and rejects an SSE or mcp-remote entry.
            return { filename: 'mcp.json', config: { mcpServers: { [name]: { url: mcpUrl } } } };
    }
}

/**
 * A link that installs the server in one click, or null for a client that has no such link.
 *
 * VS Code's is the https redirect rather than the `vscode:` scheme on purpose: this link is put on
 * a web page, and a plain https link opens without the browser's "allow this site to open an
 * application?" step in front of it. The host is `insiders.vscode.dev` for stable VS Code too —
 * adding `quality=insiders` is what selects Insiders — which reads wrong and is correct, and is the
 * form GitHub ships on its own MCP server's badge.
 */
export function mcpInstallLink(clientId: McpInstallClientId, mcpUrl: string, serverName?: unknown): string | null {
    const name = normalizeServerName(serverName);
    switch (clientId) {
        case 'vscode': {
            const config = encodeURIComponent(JSON.stringify({ type: 'http', url: mcpUrl }));
            return `https://insiders.vscode.dev/redirect/mcp/install?name=${encodeURIComponent(name)}&config=${config}`;
        }
        case 'cursor': {
            // Cursor takes base64 of the server object alone; the name travels beside it.
            const config = Buffer.from(JSON.stringify({ url: mcpUrl })).toString('base64');
            return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`;
        }
        case 'claude-code':
            // No install link exists. `claude mcp add` is the one-liner, and it is on the tool table.
            return null;
    }
}
