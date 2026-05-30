/**
 * @file mcp-scopes.test.ts
 * @description Unit tests for MCP tool scope gating (src/mcp/catalog/scopes.ts). Locks the
 *   wildcard-matching semantics (exact / domain:* / global *) that decide which tools the
 *   /v1/mcp surface registers per agent (F1), and the role->scope profile bundles.
 * @version-history
 *   v1.0.0 -- 2026-05-30 -- MCP audit Phase 3 (F1)
 */
import { describe, it, expect } from 'vitest';
import { scopeAllowsTool, requiredScopeForTool, scopesForProfile, MCP_SCOPE_PROFILES } from '../../src/mcp/catalog/scopes.js';

describe('scopeAllowsTool', () => {
    it('always allows ungated tools regardless of scopes', () => {
        expect(scopeAllowsTool([], 'aimeat_task_list')).toBe(true);
        expect(scopeAllowsTool(['memory:read'], 'aimeat_catalogue_search')).toBe(true);
        expect(scopeAllowsTool([], 'aimeat_board_read')).toBe(true); // REST-public read stays ungated
    });

    it('enforces exact scope match for gated tools', () => {
        expect(scopeAllowsTool(['memory:read'], 'aimeat_memory_read')).toBe(true);
        expect(scopeAllowsTool(['memory:read'], 'aimeat_memory_write')).toBe(false);
        expect(scopeAllowsTool(['memory:write'], 'aimeat_memory_write')).toBe(true);
        expect(scopeAllowsTool(['memory:read'], 'aimeat_wallet_balance')).toBe(false);
    });

    it('honours the global wildcard *', () => {
        expect(scopeAllowsTool(['*'], 'aimeat_memory_write')).toBe(true);
        expect(scopeAllowsTool(['*'], 'aimeat_consent_grant')).toBe(true);
    });

    it('honours domain wildcards (memory:* covers memory:read and memory:write)', () => {
        expect(scopeAllowsTool(['memory:*'], 'aimeat_memory_read')).toBe(true);
        expect(scopeAllowsTool(['memory:*'], 'aimeat_memory_write')).toBe(true);
        expect(scopeAllowsTool(['memory:*'], 'aimeat_wallet_balance')).toBe(false);
    });

    it('maps board/work/consent tools to their REST scopes', () => {
        expect(scopeAllowsTool(['social:write'], 'aimeat_board_post')).toBe(true);
        expect(scopeAllowsTool(['social:read'], 'aimeat_board_post')).toBe(false);
        expect(scopeAllowsTool(['work:accept'], 'aimeat_work_deliver')).toBe(true);
        expect(scopeAllowsTool(['work:read'], 'aimeat_work_deliver')).toBe(false);
        expect(scopeAllowsTool(['consent:manage'], 'aimeat_consent_revoke')).toBe(true);
    });

    it('requiredScopeForTool returns the gate or undefined', () => {
        expect(requiredScopeForTool('aimeat_memory_write')).toBe('memory:write');
        expect(requiredScopeForTool('aimeat_task_list')).toBeUndefined();
    });
});

describe('scope profiles', () => {
    it('task-runner is minimal (no social/wallet/consent)', () => {
        const s = scopesForProfile('task-runner');
        expect(s).toContain('memory:write');
        expect(s).toContain('work:accept');
        expect(s).not.toContain('social:write');
        expect(s).not.toContain('consent:manage');
    });

    it('interactive/autonomous are broad (*)', () => {
        expect(scopesForProfile('interactive')).toEqual(['*']);
        expect(MCP_SCOPE_PROFILES.autonomous).toEqual(['*']);
    });

    it('unknown mode falls back to a conservative memory set', () => {
        expect(scopesForProfile('nonsense')).toEqual(['memory:read', 'memory:write']);
        expect(scopesForProfile(undefined)).toEqual(['memory:read', 'memory:write']);
    });
});
