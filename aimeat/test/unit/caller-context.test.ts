/**
 * @file test/unit/caller-context.test.ts
 * @description The caller object (services/caller-context.ts) answers each identity question the way
 *   the one function written for it does, and is built once: per request on REST (callerOf), per
 *   session on MCP (agentSessionCaller). Secaudit 2026-10, C9.
 * @usage pnpm exec vitest run test/unit/caller-context.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C9).
 */
import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import type { Storage } from '../../src/storage/interface.js';
import { callerFromAuth, agentSessionCaller, type CallerAuth } from '../../src/services/caller-context.js';
import { callerOf } from '../../src/middleware/caller.js';
import { isOwnerInPerson, isForeignPrincipal, resolveIdentity } from '../../src/utils/gaii.js';
import { scopeIsCovered } from '../../src/utils/scope-coverage.js';

const NODE = 'node-1';

/** A store that answers nothing and counts every call, so "asked once" is visible. */
function countingStorage(): { storage: Storage; calls: () => number } {
    let n = 0;
    const storage = new Proxy({}, { get: () => async () => { n++; return undefined; } }) as unknown as Storage;
    return { storage, calls: () => n };
}

const AUTHS: Record<string, CallerAuth> = {
    owner: { sub: 'alice', owner: 'alice', roles: ['owner'], scopes: [] },
    operator: { sub: 'root', owner: 'root', roles: ['owner', 'operator'], scopes: [] },
    agent: { sub: 'helper#alice@node-1', owner: 'alice', roles: ['agent'], scopes: ['memory:*'] },
    agentWithOwnerRole: { sub: 'helper#alice@node-1', owner: 'alice', roles: ['owner', 'agent'], scopes: [] },
    app: { sub: 'alice', owner: 'alice', roles: ['app'], scopes: ['memory:read'] },
    ecosystem: { sub: 'eco:shop#alice@node-1', owner: 'alice', roles: ['owner', 'ecosystem'], scopes: ['*'] },
    visitor: { sub: 'bob@node-2', owner: 'bob@node-2', roles: ['federated'], scopes: ['memory:read'], federated: true },
    anonymous: { sub: 'anon', owner: 'anon', roles: [], scopes: [], anonymous: true },
};

describe('callerFromAuth answers as the one function for each question', () => {
    const { storage } = countingStorage();
    it.each(Object.entries(AUTHS))('%s', (_label, auth) => {
        const c = callerFromAuth(auth, NODE, storage);
        expect(c.inPerson).toBe(isOwnerInPerson(auth));
        expect(c.visitor).toBe(isForeignPrincipal(auth));
        expect(c.principal).toBe(resolveIdentity({ sub: auth.sub, owner: auth.owner, roles: [...auth.roles], ...(auth.federated ? { federated: true } : {}) }, NODE));
        for (const word of ['memory:write', 'memory:read', 'memory:write-reserved', 'company:write']) {
            expect(c.has(word), word).toBe(isOwnerInPerson(auth) || scopeIsCovered([...auth.scopes], word));
        }
    });

    it('names the kind of each caller', () => {
        const kind = (k: string) => callerFromAuth(AUTHS[k]!, NODE, storage).kind;
        expect([kind('owner'), kind('agent'), kind('agentWithOwnerRole'), kind('app'), kind('ecosystem'), kind('visitor'), kind('anonymous')])
            .toEqual(['owner', 'agent', 'agent', 'app', 'ecosystem', 'visitor', 'anonymous']);
    });

    it('gives the owner as a name and as a GHII, and the two views services take', () => {
        const c = callerFromAuth(AUTHS.agent!, NODE, storage);
        expect([c.owner, c.ownerGhii]).toEqual(['alice', 'alice@node-1']);
        expect(c.auth).toEqual({ sub: 'helper#alice@node-1', owner: 'alice', roles: ['agent'], scopes: ['memory:*'] });
        expect(c.principalView).toEqual({ principal: 'helper#alice@node-1', owner: 'alice', roles: ['agent'], scopes: ['memory:*'] });
    });
});

describe('built once', () => {
    it('asks the operator question once per word', async () => {
        const { storage, calls } = countingStorage();
        const c = callerFromAuth(AUTHS.agent!, NODE, storage);
        await c.operator();
        const once = calls();
        expect(once, 'the operator question reads the store').toBeGreaterThan(0);
        await c.operator();
        expect(calls()).toBe(once);
    });

    it('callerOf gives one object per request, and refuses a request without auth', () => {
        const { storage } = countingStorage();
        const req = { auth: { ...AUTHS.owner, node: NODE, exp: 0 } } as unknown as Request;
        expect(callerOf(req, NODE, storage)).toBe(callerOf(req, NODE, storage));
        expect(() => callerOf({} as Request, NODE, storage)).toThrow(/requireAuth/);
    });

    it('an MCP session caller is the agent, in its owner account, with the session scopes', () => {
        const { storage } = countingStorage();
        const c = agentSessionCaller('helper#alice@node-1', '', ['company:read'], NODE, storage);
        expect([c.kind, c.principal, c.owner, c.has('company:read'), c.has('company:write')])
            .toEqual(['agent', 'helper#alice@node-1', 'alice', true, false]);
    });
});
