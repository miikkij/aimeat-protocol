/**
 * @file sse-domain-scopes.test.ts
 * @description Unit tests for the SSE change-domain authorization gate. This is the security
 *   logic behind the live-update stream: an owner session sees every domain, every other
 *   principal sees only the domains its granted scopes cover, and an unmapped domain is denied
 *   so a newly added domain elsewhere in the node cannot silently start leaking to apps.
 * @usage cd aimeat && pnpm test -- sse-domain-scopes
 * @version-history
 *   v1.0.0 — 2026-07-25 — Initial, with the SSE scope gate.
 */
import { describe, it, expect } from 'vitest';
import { DOMAIN_SCOPE, allowedDomains, filterDomains, isOwnerPrincipal } from '../../src/auth/sse-domain-scopes.js';

describe('isOwnerPrincipal', () => {
    it('accepts a human owner session', () => {
        expect(isOwnerPrincipal({ roles: ['owner'] })).toBe(true);
    });

    it('rejects an app grant even though it acts for the owner', () => {
        // An app-grant token carries roles ['app'] and resolves to the owner's GHII; it must
        // still be treated as restricted, or H-2 isolation ends at the SSE boundary.
        expect(isOwnerPrincipal({ roles: ['app'] })).toBe(false);
        expect(isOwnerPrincipal({ roles: ['owner', 'app'] })).toBe(false);
    });

    it('rejects agents and ecosystem apps', () => {
        expect(isOwnerPrincipal({ roles: ['agent'] })).toBe(false);
        expect(isOwnerPrincipal({ roles: ['ecosystem'] })).toBe(false);
    });

    it('rejects a principal with no roles at all', () => {
        expect(isOwnerPrincipal({})).toBe(false);
        expect(isOwnerPrincipal({ roles: [] })).toBe(false);
    });
});

describe('allowedDomains', () => {
    it('returns the domains a default app grant can see', () => {
        // The default grant is memory + storage read/write.
        const allow = allowedDomains(['memory:read', 'memory:write', 'storage:read', 'storage:write']);
        expect(allow).not.toBeNull();
        expect(allow!.has('memory')).toBe(true);
        expect(allow!.has('personal')).toBe(true);
        expect(allow!.has('files')).toBe(true);
    });

    it('hides the owner areas a default app grant was never given', () => {
        const allow = allowedDomains(['memory:read', 'storage:read'])!;
        for (const domain of ['messages', 'wallet', 'agent-tasks', 'agents', 'workflows', 'organisms', 'knowledge', 'boards']) {
            expect(allow.has(domain), `${domain} must stay hidden`).toBe(false);
        }
    });

    it('opens exactly the mapped domains when the matching scope is granted', () => {
        expect(allowedDomains(['task:read'])!.has('agent-tasks')).toBe(true);
        expect(allowedDomains(['task:read'])!.has('agents')).toBe(true);
        expect(allowedDomains(['messages:read'])!.has('messages')).toBe(true);
        expect(allowedDomains(['wallet:read'])!.has('wallet')).toBe(true);
        expect(allowedDomains(['organism:read'])!.has('organisms')).toBe(true);
        expect(allowedDomains(['workflow:read'])!.has('workflows')).toBe(true);
        expect(allowedDomains(['notifications:send'])!.has('notifications')).toBe(true);
        expect(allowedDomains(['catalogue:read'])!.has('catalogue')).toBe(true);
        expect(allowedDomains(['social:read'])!.has('boards')).toBe(true);
        expect(allowedDomains(['knowledge:read'])!.has('packages')).toBe(true);
    });

    it('grants nothing for an empty or missing scope list', () => {
        expect(allowedDomains([])!.size).toBe(0);
        expect(allowedDomains(undefined)!.size).toBe(0);
    });

    it('disables filtering for the wildcard scope', () => {
        expect(allowedDomains(['*'])).toBeNull();
    });

    it('never maps an operator or infra domain to an app scope', () => {
        // Deny-by-default: these are absent from the map, so no scope combination reveals them.
        const everyScope = Object.values(DOMAIN_SCOPE);
        const allow = allowedDomains(everyScope)!;
        for (const domain of ['config', 'features', 'federation', 'disputes', 'appeals', 'verification',
            'totp', 'ghii', 'owners', 'consent', 'flags', 'instances', 'extensions', 'cortex',
            'skills', 'portfolio', 'ecosystem-apps', 'presence', 'realtime', 'admin-extensions']) {
            expect(allow.has(domain), `${domain} must never be grantable to an app`).toBe(false);
        }
    });
});

describe('filterDomains', () => {
    it('passes everything through for an owner session (null allow-set)', () => {
        expect(filterDomains(['memory', 'wallet', 'config'], null)).toEqual(['memory', 'wallet', 'config']);
    });

    it('keeps only the allowed domains for a restricted principal', () => {
        const allow = allowedDomains(['memory:read'])!;
        expect(filterDomains(['memory', 'wallet', 'messages'], allow)).toEqual(['memory']);
    });

    it('drops an unmapped domain even when the principal is broadly scoped', () => {
        const allow = allowedDomains(['memory:read', 'task:read', 'organism:read'])!;
        expect(filterDomains(['brand-new-domain'], allow)).toEqual([]);
    });

    it('returns an empty list rather than throwing on no input', () => {
        expect(filterDomains([], allowedDomains(['memory:read'])!)).toEqual([]);
    });
});
