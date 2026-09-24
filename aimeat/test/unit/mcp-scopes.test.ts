/**
 * @file mcp-scopes.test.ts
 * @description Unit tests for MCP tool scope gating (src/mcp/catalog/scopes.ts). Locks the
 *   wildcard-matching semantics (exact / domain:* / global *) that decide which tools the
 *   /v1/mcp surface registers per agent (F1), and the role->scope profile bundles.
 * @version-history
 *   v1.2.0 -- 2026-09-24 -- Reading a connected mailbox is connections:read-through; connections:use,
 *     the publish-and-send word, no longer offers the three mail read tools (security audit A5-1).
 *   v1.1.0 -- 2026-09-24 -- The operator's tools: every tool the catalog names as the operator's is
 *     registered only for a word no wildcard carries, so an operator's agent holding "Full access"
 *     or an ordinary word is offered none of them (security audit A8-1).
 *   v1.0.0 -- 2026-05-30 -- MCP audit Phase 3 (F1)
 */
import { describe, it, expect } from 'vitest';
import { scopeAllowsTool, requiredScopeForTool, scopesForProfile, MCP_SCOPE_PROFILES } from '../../src/mcp/catalog/scopes.js';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../../src/mcp/catalog/definitions.js';
import { isOutsideWildcard } from '../../src/utils/scope-coverage.js';

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

    /**
     * memory:write-reserved is the one scope no wildcard carries (utils/scope-coverage.ts), because
     * '*' is the one-click Full access template and the reserved keys are the ones the server itself
     * trusts: the AI budget cap, the model routing, the profile. This file used to assert only the
     * generic wildcard rule, and the registration filter used to carry its own copy of it — a copy
     * that had lost the exception. The effect was that an agent holding Full access got
     * aimeat_operator_ai_config registered and could raise the owner's daily AI budget, while the
     * same agent posting the same key to /v1/memory was refused RESERVED_KEY.
     */
    it('no wildcard carries memory:write-reserved — only the exact grant does', () => {
        expect(requiredScopeForTool('aimeat_operator_ai_config')).toBe('memory:write-reserved');
        expect(scopeAllowsTool(['*'], 'aimeat_operator_ai_config')).toBe(false);
        expect(scopeAllowsTool(['memory:*'], 'aimeat_operator_ai_config')).toBe(false);
        expect(scopeAllowsTool(['memory:write'], 'aimeat_operator_ai_config')).toBe(false);
        expect(scopeAllowsTool(['memory:write-reserved'], 'aimeat_operator_ai_config')).toBe(true);
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

/**
 * Security audit A8-1. The administration tools checked only that the ACCOUNT behind the session is
 * an operator, and every one of them sat outside the scope table, which scopeAllowsTool() reads as
 * permission. So every agent an operator ever connected was handed node administration: an agent
 * holding nothing but memory:read reset another person's second factor, read every owner's agents
 * and rewrote a CORS list. The list is derived from the catalog's own `caller: 'operator'` rather
 * than written out, so a new operator tool is covered on the day it is added.
 */
/**
 * Security audit A5-1. `connections:use` was described to the owner as publishing to accounts they
 * connected, and it also opened the connected mailbox: search, open a message, fetch an attachment,
 * list the send-as addresses. Reading through an account is its own word now, on every door.
 */
describe('reading a connected mailbox is its own word', () => {
    const READ_TOOLS = ['aimeat_mail_search', 'aimeat_mail_read', 'aimeat_mail_aliases'];

    it('the three read tools ride connections:read-through', () => {
        for (const t of READ_TOOLS) expect(requiredScopeForTool(t)).toBe('connections:read-through');
    });

    it('the publish-and-send word alone is offered none of them', () => {
        expect(READ_TOOLS.filter(t => scopeAllowsTool(['connections:use', 'outbound:send'], t))).toEqual([]);
    });

    it('the read word is offered them, and so is Full access, and neither changes what sends', () => {
        for (const t of READ_TOOLS) {
            expect(scopeAllowsTool(['connections:read-through'], t)).toBe(true);
            expect(scopeAllowsTool(['*'], t)).toBe(true);
        }
        expect(requiredScopeForTool('aimeat_mail_send')).toBe('connections:use');
    });
});

describe("the operator's tools cost their own tick", () => {
    const operatorTools = CLI_FALLBACK_TOOL_DEFINITIONS.filter(d => d.caller === 'operator').map(d => d.name);

    it('every tool the catalog names as the operator\'s rides a word no wildcard carries', () => {
        expect(operatorTools.length).toBeGreaterThan(20);
        const loose = operatorTools.filter((t) => {
            const word = requiredScopeForTool(t);
            return !word || !isOutsideWildcard(word);
        });
        expect(loose).toEqual([]);
    });

    it('an agent holding Full access or an ordinary word is offered none of them', () => {
        const offered = operatorTools.filter(t => scopeAllowsTool(['*'], t) || scopeAllowsTool(['memory:read'], t));
        expect(offered).toEqual([]);
    });

    it('node administration answers to operator:admin, and only the exact word', () => {
        expect(requiredScopeForTool('aimeat_admin_security_overview')).toBe('operator:admin');
        expect(requiredScopeForTool('aimeat_mcp_registry_set')).toBe('operator:admin');
        expect(scopeAllowsTool(['memory:read', 'operator:admin'], 'aimeat_admin_totp_reset')).toBe(true);
        expect(scopeAllowsTool(['operator:*'], 'aimeat_admin_mint')).toBe(false);
        // The repair word is its own tick and does not open the rest of the block.
        expect(scopeAllowsTool(['operator:organism-repair'], 'aimeat_admin_cors_set')).toBe(false);
    });

    it('the three operator-only tools the catalog files under agent ride an operator word too', () => {
        // Each refuses everyone but the operator in its handler, and each was registered for an
        // operator's agent on a word every Full-access agent holds, or on none at all.
        expect(requiredScopeForTool('aimeat_seo_status')).toBe('operator:admin');
        expect(requiredScopeForTool('aimeat_seo_announce')).toBe('operator:admin');
        // The layout read takes the word its write takes: one tick arranges the pages and reads them.
        expect(requiredScopeForTool('aimeat_surface_layout_get')).toBe('site:layout-write');
        for (const t of ['aimeat_seo_status', 'aimeat_seo_announce', 'aimeat_surface_layout_get']) {
            expect(scopeAllowsTool(['*'], t)).toBe(false);
        }
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
