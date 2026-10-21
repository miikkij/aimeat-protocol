/**
 * @file test/unit/mcp-oauth-redirect.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description redirectUriRegistered (src/mcp/oauth-redirect.ts) against the two redirect_uris
 *   Claude Code's Client ID Metadata Document lists, as published at
 *   https://claude.ai/oauth/claude-code-client-metadata on 2026-10-22. The E2E suite
 *   e2e-mcp-oauth-loopback runs the same rule through a registered client; this file covers the
 *   metadata-document path, which an E2E node cannot reach because the document must be fetched
 *   over https from the client's own address.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-oauth-redirect.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial: Claude Code could not sign in to aimeat.io.
 */
import { describe, it, expect } from 'vitest';
import { redirectUriRegistered } from '../../src/mcp/oauth-redirect.js';

const CLAUDE_CODE = ['http://localhost/callback', 'http://127.0.0.1/callback'];

describe('redirectUriRegistered', () => {
    it('accepts the address Claude Code sends: a registered loopback address on a run-time port', () => {
        expect(redirectUriRegistered(CLAUDE_CODE, 'http://localhost:62067/callback')).toBe(true);
        expect(redirectUriRegistered(CLAUDE_CODE, 'http://127.0.0.1:64919/callback')).toBe(true);
        expect(redirectUriRegistered(CLAUDE_CODE, 'http://localhost/callback')).toBe(true);
    });

    it('accepts any port when the registration itself named one', () => {
        expect(redirectUriRegistered(['http://127.0.0.1:3000/cb'], 'http://127.0.0.1:41000/cb')).toBe(true);
        expect(redirectUriRegistered(['http://[::1]/cb'], 'http://[::1]:41000/cb')).toBe(true);
    });

    it('keeps the host, path, query and scheme exact', () => {
        expect(redirectUriRegistered(CLAUDE_CODE, 'http://localhost:62067/other')).toBe(false);
        expect(redirectUriRegistered(CLAUDE_CODE, 'http://localhost:62067/callback?x=1')).toBe(false);
        expect(redirectUriRegistered(CLAUDE_CODE, 'http://[::1]:62067/callback')).toBe(false);
        expect(redirectUriRegistered(CLAUDE_CODE, 'https://localhost:62067/callback')).toBe(false);
        expect(redirectUriRegistered(['http://localhost/callback'], 'http://127.0.0.1:62067/callback')).toBe(false);
    });

    it('never takes the exception for a host that is not loopback, or a request with userinfo or a fragment', () => {
        expect(redirectUriRegistered(['https://app.example.com/cb'], 'https://app.example.com:8443/cb')).toBe(false);
        expect(redirectUriRegistered(['http://app.example.com/cb'], 'http://app.example.com:8080/cb')).toBe(false);
        expect(redirectUriRegistered(CLAUDE_CODE, 'http://localhost.attacker.example:62067/callback')).toBe(false);
        expect(redirectUriRegistered(CLAUDE_CODE, 'http://evil@localhost:62067/callback')).toBe(false);
        expect(redirectUriRegistered(CLAUDE_CODE, 'http://localhost:62067/callback#x')).toBe(false);
        expect(redirectUriRegistered(CLAUDE_CODE, 'not a url')).toBe(false);
    });

    it('accepts an exact match of any registered address, and nothing from an empty list', () => {
        expect(redirectUriRegistered(['https://app.example.com/cb'], 'https://app.example.com/cb')).toBe(true);
        expect(redirectUriRegistered([], 'http://localhost:62067/callback')).toBe(false);
    });
});
