/**
 * @file test/unit/proactive-mode-readers.test.ts
 * @description Which kinds of caller GET /v1/settings/proactive serves at all
 *   (services/proactive-mode.ts servesProactiveRead). The route asks for memory:read first, as the
 *   memory read of the setting's own key does; this is the part a scope cannot decide: a session
 *   from another node and an ecosystem app are never served, whatever words they hold, because the
 *   memory read gives neither of them the owner's own records either (routes/memory/key.ts).
 *
 *   Each caller is built by callerFromAuth from the shapes test/unit/caller-context.test.ts uses, so
 *   `kind` and `visitor` are the real answers and not values written by hand.
 * @usage pnpm exec vitest run test/unit/proactive-mode-readers.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import { callerFromAuth, type CallerAuth } from '../../src/services/caller-context.js';
import { servesProactiveRead } from '../../src/services/proactive-mode.js';

const NODE = 'node-1';
const NO_STORAGE = {} as Storage;

/** [the caller, whether the route serves that kind]. The scope word is the route's own check, not this one's. */
const CALLERS: Record<string, [CallerAuth, boolean]> = {
    'the owner in person': [{ sub: 'alice', owner: 'alice', roles: ['owner'], scopes: [] }, true],
    'an operator in person': [{ sub: 'root', owner: 'root', roles: ['owner', 'operator'], scopes: [] }, true],
    'the owner\'s agent': [{ sub: 'helper#alice@node-1', owner: 'alice', roles: ['agent'], scopes: ['memory:read'] }, true],
    'an agent whose token also names the owner role': [{ sub: 'helper#alice@node-1', owner: 'alice', roles: ['owner', 'agent'], scopes: ['memory:read'] }, true],
    'an app the owner signed into': [{ sub: 'alice', owner: 'alice', roles: ['app'], scopes: ['memory:read'] }, true],
    // Holds every word and the owner role, and still reads none of the owner's own records.
    'an ecosystem app with the wildcard': [{ sub: 'eco:shop#alice@node-1', owner: 'alice', roles: ['owner', 'ecosystem'], scopes: ['*'] }, false],
    // Holds the very word the route asks for; its account is on another node.
    'a session from another node holding memory:read': [{ sub: 'bob@node-2', owner: 'bob@node-2', roles: ['federated'], scopes: ['memory:read'], federated: true }, false],
    // The local part of its name equals a local account's. It is still a visitor.
    'a visitor named like a local account': [{ sub: 'alice@node-2', owner: 'alice@node-2', roles: ['federated'], scopes: ['memory:read'], federated: true }, false],
};

describe('servesProactiveRead: the kinds of caller the proactive setting answers', () => {
    it.each(Object.entries(CALLERS))('%s', (_label, [auth, served]) => {
        expect(servesProactiveRead(callerFromAuth(auth, NODE, NO_STORAGE))).toBe(served);
    });
});
