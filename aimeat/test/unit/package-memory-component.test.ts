/**
 * @file test/unit/package-memory-component.test.ts
 * @description What a package's memory component costs the principal that installs it.
 *
 *   A package installs under the OWNER whoever presses install, so its memory component writes into
 *   the owner's namespace. The memory door asks memory:write for any write, and memory:write-as-owner
 *   of an agent writing into the owner's namespace from outside it; an app grant's own namespace is
 *   the owner's. The owner in person passes, as at every door. A translation component writes one
 *   record under a name only that install carries, so it costs nothing beyond packages:write. The
 *   E2E half is e2e-package-components Part H.
 * @usage pnpm exec vitest run test/unit/package-memory-component.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-25 — A translation component costs nothing extra; the refusal carries the words
 *     it names as `missing`, which an install request records. Both failed on the old code: the
 *     translation was refused, and the refusal had no `missing`.
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { memoryComponentWriteRefusal, memoryWordsFor } from '../../src/services/package-memory-component.js';
import { ownerBypassesScopes } from '../../src/utils/scope-coverage.js';

const OWNER = 'alice@node-1';
const MEMORY = [{ id: 'seed', type: 'memory' as const }];
const APP_ONLY = [{ id: 'page', type: 'app' as const }];

const agent = (scopes: string[]) => ({ roles: ['agent'], scopes, sub: `helper#${OWNER}` });
const appGrant = (scopes: string[]) => ({ roles: ['app'], scopes, sub: OWNER });

describe('memoryComponentWriteRefusal', () => {
    it('a package with no memory component costs nothing extra', () => {
        expect(memoryComponentWriteRefusal(APP_ONLY, agent([]), OWNER)).toBeNull();
    });

    it('the owner in person passes with no scope at all', () => {
        expect(memoryComponentWriteRefusal(MEMORY, { roles: ['owner'], scopes: [], sub: 'alice' }, OWNER)).toBeNull();
    });

    it('an agent needs memory:write and memory:write-as-owner, and the refusal names both', () => {
        const out = memoryComponentWriteRefusal(MEMORY, agent(['packages:write']), OWNER);
        expect(out?.status).toBe(403);
        expect(out?.code).toBe('SCOPE_DENIED');
        expect(out?.message).toContain('"memory:write" and "memory:write-as-owner"');
        expect(out?.message).toContain('Component "seed"');
        expect(out?.missing).toEqual(['memory:write', 'memory:write-as-owner']);
    });

    it('an agent with memory:write alone is still refused, for memory:write-as-owner', () => {
        const out = memoryComponentWriteRefusal(MEMORY, agent(['packages:write', 'memory:write']), OWNER);
        expect(out?.code).toBe('SCOPE_DENIED');
        expect(out?.message).toContain('"memory:write-as-owner"');
        expect(out?.message).not.toContain('"memory:write" and');
        expect(out?.missing).toEqual(['memory:write-as-owner']);
    });

    it('an agent with both words passes, and so does a wildcard, as the memory door reads it', () => {
        expect(memoryComponentWriteRefusal(MEMORY, agent(['memory:write', 'memory:write-as-owner']), OWNER)).toBeNull();
        expect(memoryComponentWriteRefusal(MEMORY, agent(['memory:*']), OWNER)).toBeNull();
        expect(memoryComponentWriteRefusal(MEMORY, agent(['*']), OWNER)).toBeNull();
    });

    it('an app grant writes as the owner already, so memory:write is its word', () => {
        expect(memoryComponentWriteRefusal(MEMORY, appGrant(['packages:write']), OWNER)?.message).toContain('"memory:write"');
        expect(memoryComponentWriteRefusal(MEMORY, appGrant(['packages:write']), OWNER)?.missing).toEqual(['memory:write']);
        expect(memoryComponentWriteRefusal(MEMORY, appGrant(['packages:write', 'memory:write']), OWNER)).toBeNull();
    });

    it('a translation component costs nothing extra: its one record is the install\'s own key', () => {
        // `i18n.<registered name>`, and the registered name carries the install's random short id, so
        // no other install writes it and nothing on the node reads the `i18n.` prefix.
        expect(memoryComponentWriteRefusal([{ id: 'fi', type: 'translation' }], agent(['packages:write']), OWNER)).toBeNull();
        expect(memoryComponentWriteRefusal([{ id: 'fi', type: 'translation' }], appGrant(['packages:write']), OWNER)).toBeNull();
        // Beside a memory component, the memory component still decides.
        const both = memoryComponentWriteRefusal([{ id: 'fi', type: 'translation' }, ...MEMORY], agent(['packages:write']), OWNER);
        expect(both?.code).toBe('SCOPE_DENIED');
        expect(both?.message).toContain('Component "seed"');
    });

    it('memoryWordsFor: what writing the owner\'s memory costs each kind of caller', () => {
        expect(memoryWordsFor(agent([]), OWNER)).toEqual(['memory:write', 'memory:write-as-owner']);
        expect(memoryWordsFor(appGrant([]), OWNER)).toEqual(['memory:write']);
        expect(memoryWordsFor({ roles: ['owner'], scopes: [], sub: 'alice' }, OWNER)).toEqual([]);
    });

    it('an ecosystem app is refused whatever it holds, since it writes only into its own namespace', () => {
        const eco = { roles: ['owner', 'ecosystem'], scopes: ['*'], sub: `eco:shop#${OWNER}` };
        expect(memoryComponentWriteRefusal(MEMORY, eco, OWNER)?.code).toBe('FORBIDDEN');
        // No word would change that, so there is nothing to ask the owner for.
        expect(memoryComponentWriteRefusal(MEMORY, eco, OWNER)?.missing).toEqual([]);
    });

    it('an owner role that is also an agent, or a visitor from another node, answers for its words', () => {
        expect(memoryComponentWriteRefusal(MEMORY, { roles: ['owner', 'agent'], scopes: [], sub: `helper#${OWNER}` }, OWNER)?.code).toBe('SCOPE_DENIED');
        expect(memoryComponentWriteRefusal(MEMORY, { roles: ['owner'], scopes: ['memory:read'], federated: true, sub: 'bob@node-2' }, OWNER)?.code).toBe('SCOPE_DENIED');
    });
});

describe('ownerBypassesScopes', () => {
    it('is requireScope\'s rule: an owner role and nothing that makes it a scoped principal', () => {
        expect(ownerBypassesScopes({ roles: ['owner'] })).toBe(true);
        expect(ownerBypassesScopes({ roles: ['owner', 'agent'] })).toBe(false);
        expect(ownerBypassesScopes({ roles: ['owner', 'ecosystem'] })).toBe(false);
        expect(ownerBypassesScopes({ roles: ['owner'], federated: true })).toBe(false);
        expect(ownerBypassesScopes({ roles: ['app'] })).toBe(false);
    });
});
