/**
 * @file test/unit/agent-default-workspace-scopes.test.ts
 * @description What a newly approved agent may do in its owner's organisms. Since 2026-10-06 the
 *   workspace read tools ask organism:read and publishing asks organism:write (pitfalls §119), and
 *   neither list an agent is approved with carried either word, so an agent approved from that day
 *   on could not read a workspace. Jouni 2026-10-06 (secaudit 2026-10 last items, D4): organism:read
 *   goes into the node's default list and the "standard" consent preset; organism:write into the
 *   standard preset only, where the owner sees it when approving.
 * @usage pnpm test -- agent-default-workspace-scopes
 * @version-history
 *   v1.0.0 — 2026-10-06 — Initial (secaudit 2026-10 last items, D4).
 */
import { describe, it, expect } from 'vitest';
import { SHIPPED_DEFAULT_AGENT_SCOPES } from '../../src/config.js';
import { SCOPE_TEMPLATES } from '../../public/views/profile/agents/scope-model.js';

describe('a new agent and the workspaces of its owner', () => {
    const shipped = SHIPPED_DEFAULT_AGENT_SCOPES.split(',');

    it('the node default lets it read workspaces, and not publish in them', () => {
        expect(shipped).toContain('organism:read');
        expect(shipped).not.toContain('organism:write');
        expect(shipped).toEqual(expect.arrayContaining(['memory:read', 'memory:write', 'memory:delete', 'catalogue:read']));
    });

    it('the standard consent preset lets it read and publish', () => {
        expect(SCOPE_TEMPLATES.standard).toEqual(expect.arrayContaining(['organism:read', 'organism:write']));
    });

    it('the read-only preset stays as it was', () => {
        expect(SCOPE_TEMPLATES.readonly).not.toContain('organism:write');
    });
});
