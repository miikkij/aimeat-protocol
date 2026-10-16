/**
 * @file src/mcp/session-platform.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which AI platform an MCP session comes from, as the session's chat-instance id names
 *   it (`mcp-<platform>#<owner>@<node>`). The client name the owner approved at OAuth consent (the
 *   token's `mcp_client` claim) wins; without one, the User-Agent header is read.
 *
 *   Moved out of mcp/index.ts unchanged, so the rule runs under a unit test instead of a copy of it
 *   written inside the test (QA audit F01a-01, test/unit/mcp-session.test.ts).
 * @structure mcpSessionPlatform(clientName, userAgent) → platform
 * @usage const platform = mcpSessionPlatform(verified?.mcp_client, req.headers['user-agent']);
 * @version-history
 *   v1.0.0 — 2026-10-16 — Pure extraction from mcp/index.ts, no change in behaviour.
 */

/**
 * The platform label for a session. Every production session row is addressed by the id this feeds,
 * so the labels and their order are fixed: a client name that names no known platform is kept as
 * its first 32 characters, and a User-Agent that names none gives 'unknown'.
 */
export function mcpSessionPlatform(clientName: string | undefined, userAgent: string | undefined): string {
    if (clientName) {
        const cn = clientName.toLowerCase();
        if (cn.includes('claude code') || cn.includes('claude-code')) return 'claude-code';
        if (cn.includes('claude desktop') || cn.includes('claude-desktop')) return 'claude-desktop';
        if (cn.includes('claude')) return 'claude';
        if (cn.includes('chatgpt') || cn.includes('openai')) return 'chatgpt';
        if (cn.includes('copilot')) return 'copilot';
        if (cn.includes('cursor')) return 'cursor';
        if (cn.includes('gemini')) return 'gemini';
        return clientName.slice(0, 32);
    }
    const ua = (userAgent || '').toLowerCase();
    if (ua.includes('claude')) return 'claude';
    if (ua.includes('chatgpt') || ua.includes('openai')) return 'chatgpt';
    if (ua.includes('copilot')) return 'copilot';
    if (ua.includes('cursor')) return 'cursor';
    if (ua.includes('gemini')) return 'gemini';
    return 'unknown';
}
