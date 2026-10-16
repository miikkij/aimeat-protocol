/**
 * @file test/unit/mcp-session.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The platform label of an MCP session (mcp/session-platform.ts), which names the
 *   session's chat-instance row `mcp-<platform>#<owner>@<node>`: the client name approved at OAuth
 *   consent wins over the User-Agent, and each known platform is recognised from either.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-session.test.ts
 * @version-history
 *   v2.0.0 — 2026-10-16 — Rewritten to run production code (QA audit F01a-01). Every case before
 *     asserted on values the test itself wrote: a record literal (deleted, it tested no code), a
 *     local `ownerExists = false` standing in for the -32003 owner check in mcp/index.ts (deleted; that
 *     branch needs an agent whose owner record is gone, which no route can produce), and a copy of the
 *     platform detection written inside the test, which had already drifted from the real one (it
 *     knew no claude-code, claude-desktop or client-name branch). The detection moved to
 *     mcp/session-platform.ts so these cases call it.
 */
import { describe, it, expect } from 'vitest';
import { mcpSessionPlatform } from '../../src/mcp/session-platform.js';

describe('mcpSessionPlatform', () => {
    it('reads the approved client name first, whatever the User-Agent says', () => {
        expect(mcpSessionPlatform('Claude Code', 'ChatGPT-Plugin/1.0')).toBe('claude-code');
        expect(mcpSessionPlatform('claude-desktop', undefined)).toBe('claude-desktop');
        expect(mcpSessionPlatform('Claude Desktop', undefined)).toBe('claude-desktop');
        expect(mcpSessionPlatform('Claude', undefined)).toBe('claude');
        expect(mcpSessionPlatform('ChatGPT', undefined)).toBe('chatgpt');
        expect(mcpSessionPlatform('OpenAI Codex', undefined)).toBe('chatgpt');
        expect(mcpSessionPlatform('GitHub Copilot', undefined)).toBe('copilot');
        expect(mcpSessionPlatform('Cursor', undefined)).toBe('cursor');
        expect(mcpSessionPlatform('Gemini CLI', undefined)).toBe('gemini');
    });

    it('keeps an unknown client name as its first 32 characters', () => {
        expect(mcpSessionPlatform('My Own Agent', 'Claude-AI/1.0')).toBe('My Own Agent');
        expect(mcpSessionPlatform('x'.repeat(40), undefined)).toBe('x'.repeat(32));
    });

    it('falls back to the User-Agent without a client name', () => {
        expect(mcpSessionPlatform(undefined, 'Claude-AI/1.0')).toBe('claude');
        expect(mcpSessionPlatform('', 'Mozilla/5.0 claude-desktop')).toBe('claude');
        expect(mcpSessionPlatform(undefined, 'OpenAI-Client/2.0')).toBe('chatgpt');
        expect(mcpSessionPlatform(undefined, 'Copilot/1.0')).toBe('copilot');
        expect(mcpSessionPlatform(undefined, 'Cursor-IDE/0.5')).toBe('cursor');
        expect(mcpSessionPlatform(undefined, 'Google-Gemini/1.0')).toBe('gemini');
    });

    it('answers unknown for a User-Agent that names no platform, or none at all', () => {
        expect(mcpSessionPlatform(undefined, 'RandomBot/2.0')).toBe('unknown');
        expect(mcpSessionPlatform(undefined, '')).toBe('unknown');
        expect(mcpSessionPlatform(undefined, undefined)).toBe('unknown');
    });
});
