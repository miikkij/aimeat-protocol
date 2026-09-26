/**
 * @file test/unit/package-install-request-policy.test.ts
 * @description Who may decide a package install request, and when a request stops being decidable.
 *
 *   The rule is device authorization's same-owner rule: an approver cannot grant beyond its own
 *   scopes. The owner in person decides anything. An agent of the owner may decline anything it did
 *   not ask for itself, and may approve only when it holds packages:write and every word the install
 *   needs of an agent writing the owner's memory. An app, an ecosystem app and a visitor from another
 *   node decide nothing. A request is decidable for seven days, and a record whose expiry cannot be
 *   read counts as expired. The E2E half is e2e-package-install-requests.
 * @usage pnpm exec vitest run test/unit/package-install-request-policy.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial, written before the module existed.
 */
import { describe, it, expect } from 'vitest';
import { decisionRefusal, requestExpired, INSTALL_REQUEST_DAYS } from '../../src/services/package-install-request-policy.js';

const OWNER = 'alice@node-1';
const NARROW = `narrow#${OWNER}`;
const agentRequest = { requested_by: { principal: NARROW, kind: 'agent' as const, sub: NARROW }, missing: ['memory:write', 'memory:write-as-owner'] };
const appRequest = { requested_by: { principal: `eco:shop-html#${OWNER}`, kind: 'app' as const, sub: OWNER, app: 'alice/shop.html' }, missing: ['memory:write'] };

const agent = (name: string, scopes: string[]) => ({ sub: `${name}#${OWNER}`, owner: 'alice', roles: ['agent'], scopes });

describe('decisionRefusal', () => {
    it('the owner in person decides anything, with no scope at all', () => {
        const owner = { sub: 'alice', owner: 'alice', roles: ['owner'], scopes: [] };
        expect(decisionRefusal(owner, agentRequest, 'approve')).toBeNull();
        expect(decisionRefusal(owner, agentRequest, 'decline')).toBeNull();
    });

    it('an app grant, an ecosystem app and a visitor from another node decide nothing', () => {
        const app = { sub: OWNER, owner: 'alice', roles: ['app'], scopes: ['*'] };
        const eco = { sub: `eco:shop#${OWNER}`, owner: 'alice', roles: ['owner', 'ecosystem'], scopes: ['*'] };
        const visitor = { sub: 'alice@node-2', owner: 'alice@node-2', roles: ['federated'], scopes: ['*'], federated: true };
        for (const who of [app, eco, visitor]) {
            expect(decisionRefusal(who, agentRequest, 'approve')?.code).toBe('ACCESS_DENIED');
            expect(decisionRefusal(who, agentRequest, 'decline')?.code).toBe('ACCESS_DENIED');
        }
    });

    it('the requester decides neither way, whatever it holds', () => {
        const self = { sub: NARROW, owner: 'alice', roles: ['agent'], scopes: ['*'] };
        expect(decisionRefusal(self, agentRequest, 'approve')?.code).toBe('OWN_REQUEST');
        expect(decisionRefusal(self, agentRequest, 'decline')?.code).toBe('OWN_REQUEST');
    });

    it('another agent of the owner may decline with no memory word at all', () => {
        expect(decisionRefusal(agent('helper', ['packages:write']), agentRequest, 'decline')).toBeNull();
    });

    it('another agent approves only when it holds every word, and the refusal names the ones it lacks', () => {
        expect(decisionRefusal(agent('helper', ['packages:write', 'memory:write', 'memory:write-as-owner']), agentRequest, 'approve')).toBeNull();
        expect(decisionRefusal(agent('helper', ['*']), agentRequest, 'approve')).toBeNull();
        const weak = decisionRefusal(agent('weak', ['packages:write', 'memory:write']), agentRequest, 'approve');
        expect(weak?.code).toBe('SCOPE_DENIED');
        expect(weak?.message).toContain('memory:write-as-owner');
        expect(weak?.message).not.toContain('"memory:write" and');
        expect(weak?.message).toContain('Notifications');
    });

    it('approving an install is installing it, so packages:write is asked too', () => {
        const out = decisionRefusal(agent('reader', ['memory:write', 'memory:write-as-owner']), agentRequest, 'approve');
        expect(out?.code).toBe('SCOPE_DENIED');
        expect(out?.message).toContain('packages:write');
    });

    it('an app asked for memory:write alone, but an agent approving it writes as the owner, so it needs both', () => {
        const out = decisionRefusal(agent('helper', ['packages:write', 'memory:write']), appRequest, 'approve');
        expect(out?.code).toBe('SCOPE_DENIED');
        expect(out?.message).toContain('memory:write-as-owner');
    });
});

describe('requestExpired', () => {
    const now = Date.parse('2026-09-25T12:00:00.000Z');
    it('a request is decidable for seven days', () => {
        expect(INSTALL_REQUEST_DAYS).toBe(7);
        expect(requestExpired({ expires_at: '2026-10-02T11:59:59.000Z' }, now)).toBe(false);
        expect(requestExpired({ expires_at: '2026-09-25T12:00:00.000Z' }, now)).toBe(true);
        expect(requestExpired({ expires_at: '2026-09-20T00:00:00.000Z' }, now)).toBe(true);
    });

    it('fails closed: an expiry that cannot be read counts as passed', () => {
        expect(requestExpired({ expires_at: '' }, now)).toBe(true);
        expect(requestExpired({ expires_at: 'next week' }, now)).toBe(true);
        expect(requestExpired({} as { expires_at: string }, now)).toBe(true);
    });
});
