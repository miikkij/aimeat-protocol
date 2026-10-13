/**
 * @file test/unit/fenced-space.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fenced-space rule (services/fenced-space.ts): a memory-backed record space that
 *   names extensions takes a write-mode operation from a caller that is not a person only through
 *   one of them. The E2E suite (test/e2e-workspace-fenced-space.ts) proves the rule on every code
 *   path; this file proves the decisions the code paths share, which a route test cannot isolate:
 *     - who is allowed directly, by roles first and by the identity's shape only without a session
 *     - what counts as a fence, and that a list of invalid entries closes the space
 *     - the match by namespace prefix, for a key in any form and for an archived subtree
 *     - that a caller the rule allows directly costs no manifest read
 *   The second part (ruled 2026-10-13): the permission `organism:direct` is read from the session's
 *   scopes with the node's one cover test and fails closed without them; a change to a fenced
 *   space's list, object type, namespace or backing is protected and every other change is not; and
 *   the manifest record is a target of the rule, compared by value where a code path hands the value
 *   over and read as a removal where it does not.
 * @usage cd aimeat && pnpm exec vitest run test/unit/fenced-space.test.ts
 * @version-history
 *   v1.1.0 — 2026-10-13 — organism:direct, mayChangeFence, protectedFenceChanges and
 *     fenceChangeRefusal, and the manifest record as a target of the rule.
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import {
    callerIsFenced, fenceOf, fencesOf, fencesMet, fencedSpaceMessage, fencedSpaceRefusal, fencedKeysRefusal,
    extensionMarker, archiveFenceTarget, fencedFormRefusal,
    DIRECT_WRITE_SCOPE, mayChangeFence, protectedFenceChanges, fenceChangeRefusal, fenceChangeMessage,
} from '../../src/services/fenced-space.js';
import { isOutsideWildcard } from '../../src/utils/scope-coverage.js';

const NODE = 'test-node';
const ORG = 'org1';
const WS = 'ws1';
const ROOT = `organism.${ORG}.w.${WS}`;
const AGENT = `helper#alice@${NODE}`;

const person = { principal: `alice@${NODE}`, roles: ['owner'] };
const agent = { principal: AGENT, roles: ['agent'] };

/** A store holding one workspace alice created and its manifest, counting the manifest reads. */
function store(objectTypes: unknown[] | null, opts: { archived?: boolean } = {}) {
    const reads = { manifest: 0 };
    const at = '2026-10-13T00:00:00.000Z';
    const row = (key: string, value: unknown) => ({ key, ownerGaii: `alice@${NODE}`, value, visibility: 'private', tags: [], version: 1, createdAt: at, updatedAt: at });
    const registry = row(`organism.${ORG}.meta.workspaces`, { workspaces: [{ id: WS, createdBy: 'alice' }] });
    const manifest = objectTypes ? row(`${ROOT}.meta.manifest`, { objectTypes }) : null;
    const storage = {
        listAllMemory: async (q: { prefix: string; archived?: string }) => {
            if (q.prefix === `${ROOT}.meta.manifest`) {
                reads.manifest++;
                // An archived manifest is returned only to a read that asks for archived copies.
                if (opts.archived && q.archived !== 'include') return { items: [] };
            }
            return { items: [registry, manifest].filter((r): r is NonNullable<typeof r> => !!r && r.key.startsWith(q.prefix)) };
        },
        getMembership: async () => ({ status: 'active', role: 'creator' }),
    } as unknown as Storage;
    return { deps: { storage, config: { nodeId: NODE } }, reads };
}

const DECISIONS = { name: 'decision', namespace: 'app.decisions', backing: 'memory', extensions: ['Alice/Muistio'] };
const NOTES = { name: 'note', namespace: 'shared.notes', backing: 'memory' };

describe('callerIsFenced: roles first, then the identity\'s shape', () => {
    it('lets the account holder in person write directly, whatever identity the write lands under', () => {
        expect(callerIsFenced(person, NODE)).toBe(false);
        // An owner's import that names one of their agents: the agent's identity, the owner's roles.
        expect(callerIsFenced({ principal: AGENT, roles: ['owner'] }, NODE)).toBe(false);
        expect(callerIsFenced({ principal: `alice@${NODE}`, roles: ['owner', 'operator'] }, NODE)).toBe(false);
    });

    it('lets a hosted app\'s grant write directly', () => {
        expect(callerIsFenced({ principal: `alice@${NODE}`, roles: ['app'] }, NODE)).toBe(false);
    });

    it('fences an agent, an ecosystem app, a visitor and a session with no role', () => {
        expect(callerIsFenced(agent, NODE)).toBe(true);
        expect(callerIsFenced({ principal: `eco:news#alice@${NODE}`, roles: ['ecosystem'] }, NODE)).toBe(true);
        expect(callerIsFenced({ principal: 'alice@other-node', roles: ['federated'] }, NODE)).toBe(true);
        expect(callerIsFenced({ principal: `alice@${NODE}`, roles: [] }, NODE)).toBe(true);
        // A role granted beside the owner role is the session's, never the person's.
        expect(callerIsFenced({ principal: AGENT, roles: ['owner', 'agent'] }, NODE)).toBe(true);
        expect(callerIsFenced({ principal: `eco:news#alice@${NODE}`, roles: ['app', 'ecosystem'] }, NODE)).toBe(true);
    });

    it('decides on the identity\'s shape only when there is no session', () => {
        expect(callerIsFenced({ principal: `alice@${NODE}` }, NODE)).toBe(false);
        expect(callerIsFenced({ principal: AGENT }, NODE)).toBe(true);
        expect(callerIsFenced({ principal: `eco:news#alice@${NODE}` }, NODE)).toBe(true);
        expect(callerIsFenced({ principal: 'alice@other-node' }, NODE)).toBe(true);
        expect(callerIsFenced({ principal: `alice@other-node@${NODE}` }, NODE)).toBe(true);
        expect(callerIsFenced({ principal: 'alice' }, NODE)).toBe(true);
        expect(callerIsFenced({ principal: '' }, NODE)).toBe(true);
    });
});

describe('fenceOf: what counts as a fence', () => {
    it('reads the valid entries, trimmed and lower-cased, once each', () => {
        expect(fenceOf({ ...DECISIONS, extensions: [' Alice/Muistio ', 'alice/muistio', 'bob/other'] }))
            .toEqual({ space: 'decision', namespace: 'app.decisions', extensions: ['alice/muistio', 'bob/other'] });
    });

    it('declares no fence when the field is absent or the list is empty', () => {
        expect(fenceOf(NOTES)).toBeNull();
        expect(fenceOf({ ...NOTES, extensions: [] })).toBeNull();
        expect(fenceOf({ ...NOTES, extensions: null })).toBeNull();
    });

    it('FAILS CLOSED: a list whose entries are all invalid is a fence that opens to no extension', () => {
        for (const extensions of [['muistio'], ['alice muistio/x y'], ['alice/'], ['/muistio'], ['a/b/c'], [42], [null], 'alice/muistio', { 0: 'alice/muistio' }]) {
            expect(fenceOf({ ...DECISIONS, extensions })?.extensions, JSON.stringify(extensions)).toEqual([]);
        }
        // One valid entry beside invalid ones opens the space to that one and to nothing else.
        expect(fenceOf({ ...DECISIONS, extensions: ['not valid', 'alice/muistio'] })?.extensions).toEqual(['alice/muistio']);
    });

    it('applies to a memory-backed space only: a row space reads the field under its own rule', () => {
        expect(fenceOf({ ...DECISIONS, backing: 'rows' })).toBeNull();
        expect(fenceOf({ ...DECISIONS, backing: 'tasks' })).toBeNull();
        // A missing backing is memory, as on every read path.
        expect(fenceOf({ name: 'decision', namespace: 'app.decisions', extensions: ['alice/muistio'] })?.extensions).toEqual(['alice/muistio']);
        expect(fenceOf({ name: 'no namespace', extensions: ['alice/muistio'] })).toBeNull();
        expect(fencesOf({ objectTypes: [DECISIONS, NOTES, { ...DECISIONS, namespace: 'q.rows', backing: 'rows' }] }).map(f => f.namespace)).toEqual(['app.decisions']);
    });
});

describe('fencesMet: the match by namespace prefix', () => {
    const fences = fencesOf({ objectTypes: [DECISIONS, NOTES] });

    it('matches a record key in every form, the bare key included', () => {
        for (const key of [`${ROOT}.app.decisions.d1.draft`, `${ROOT}.app.decisions.d1.latest`, `${ROOT}.app.decisions.d1.version.3`, `${ROOT}.app.decisions.d1`]) {
            expect(fencesMet(fences, ROOT, { key }).length, key).toBe(1);
        }
    });

    it('does not match another space, a sibling namespace, the namespace itself or the stand-in key', () => {
        for (const key of [`${ROOT}.shared.notes.n1.draft`, `${ROOT}.app.decisionsx.d1`, `${ROOT}.app.decisions`, `${ROOT}.probe`, `${ROOT}.meta.manifest`, `organism.${ORG}.w.other.app.decisions.d1`]) {
            expect(fencesMet(fences, ROOT, { key }).length, key).toBe(0);
        }
    });

    it('matches when one key of a list lies in the space', () => {
        expect(fencesMet(fences, ROOT, { keys: [`${ROOT}.shared.notes.n1`, `${ROOT}.app.decisions.d1`] }).length).toBe(1);
        expect(fencesMet(fences, ROOT, { keys: [`${ROOT}.shared.notes.n1`] }).length).toBe(0);
        expect(fencesMet(fences, ROOT, { keys: [] }).length).toBe(0);
    });

    it('matches a subtree that is a record, the space itself, or a subtree that holds the space', () => {
        for (const subtree of [`${ROOT}.app.decisions.d1`, `${ROOT}.app.decisions`, `${ROOT}.app.decisions.`, `${ROOT}.app`]) {
            expect(fencesMet(fences, ROOT, { subtree }).length, subtree).toBe(1);
        }
        for (const subtree of [`${ROOT}.shared.notes`, `${ROOT}.app.decisionsx`, `${ROOT}.ap`]) {
            expect(fencesMet(fences, ROOT, { subtree }).length, subtree).toBe(0);
        }
    });

    it('names what an archive touches: a record or a space, never a whole workspace or organism', () => {
        expect(archiveFenceTarget({ level: 'record', orgId: ORG, ws: WS, key: `${ROOT}.app.decisions.d1` })).toEqual({ subtree: `${ROOT}.app.decisions.d1` });
        expect(archiveFenceTarget({ level: 'space', orgId: ORG, ws: WS, namespace: 'app.decisions' })).toEqual({ subtree: `${ROOT}.app.decisions` });
        expect(archiveFenceTarget({ level: 'workspace', orgId: ORG, ws: WS })).toBeNull();
        expect(archiveFenceTarget({ level: 'organism', orgId: ORG })).toBeNull();
    });
});

describe('fencedSpaceRefusal: the rule', () => {
    const key = `${ROOT}.app.decisions.d1.draft`;

    it('refuses an agent\'s direct write with 403 ACCESS_DENIED, the one sentence and the extensions', async () => {
        const { deps } = store([DECISIONS, NOTES]);
        const refusal = await fencedSpaceRefusal(deps, agent, ORG, WS, { key });
        expect(refusal).toEqual({
            status: 403, code: 'ACCESS_DENIED', message: fencedSpaceMessage(['alice/muistio']),
            details: { reason: 'FENCED_SPACE', space: 'decision', extensions: ['alice/muistio'] },
        });
        expect(refusal?.message).toContain('alice/muistio');
    });

    it('lets the same agent through a named extension, compared lower-cased, and through no other', async () => {
        const { deps } = store([DECISIONS, NOTES]);
        expect(await fencedSpaceRefusal(deps, { ...agent, extension: extensionMarker('Alice', 'Muistio') }, ORG, WS, { key })).toBeNull();
        expect(await fencedSpaceRefusal(deps, { ...agent, extension: 'ALICE/MUISTIO ' }, ORG, WS, { key })).toBeNull();
        expect((await fencedSpaceRefusal(deps, { ...agent, extension: 'alice/other' }, ORG, WS, { key }))?.code).toBe('ACCESS_DENIED');
        // The installer is half of the name: another member's extension of the same name is not it.
        expect((await fencedSpaceRefusal(deps, { ...agent, extension: 'bob/muistio' }, ORG, WS, { key }))?.code).toBe('ACCESS_DENIED');
        expect((await fencedSpaceRefusal(deps, { ...agent, extension: '' }, ORG, WS, { key }))?.code).toBe('ACCESS_DENIED');
    });

    it('lets the agent write the space that names no extension, and a workspace with no manifest', async () => {
        const { deps } = store([DECISIONS, NOTES]);
        expect(await fencedSpaceRefusal(deps, agent, ORG, WS, { key: `${ROOT}.shared.notes.n1.draft` })).toBeNull();
        expect(await fencedSpaceRefusal(store(null).deps, agent, ORG, WS, { key })).toBeNull();
    });

    it('FAILS CLOSED: a space whose list holds only an invalid entry refuses the extension too', async () => {
        const { deps } = store([{ ...DECISIONS, extensions: ['alice x/muistio'] }]);
        const refusal = await fencedSpaceRefusal(deps, { ...agent, extension: 'alice/muistio' }, ORG, WS, { key });
        expect(refusal?.status).toBe(403);
        expect(refusal?.details.extensions).toEqual([]);
        expect(refusal?.message).toBe(fencedSpaceMessage([]));
        // The account holder in person still writes it.
        expect(await fencedSpaceRefusal(deps, person, ORG, WS, { key })).toBeNull();
    });

    it('reads no manifest for a caller the rule allows directly, and one for a fenced caller', async () => {
        const allowed = store([DECISIONS]);
        expect(await fencedSpaceRefusal(allowed.deps, person, ORG, WS, { key })).toBeNull();
        expect(await fencedSpaceRefusal(allowed.deps, { principal: `alice@${NODE}`, roles: ['app'] }, ORG, WS, { key })).toBeNull();
        expect(await fencedSpaceRefusal(allowed.deps, { principal: `alice@${NODE}` }, ORG, WS, { key })).toBeNull();
        expect(allowed.reads.manifest).toBe(0);
        const fenced = store([DECISIONS]);
        await fencedSpaceRefusal(fenced.deps, agent, ORG, WS, { key });
        expect(fenced.reads.manifest).toBe(1);
    });

    it('holds for an archived workspace, whose records are unarchived one by one', async () => {
        const { deps } = store([DECISIONS], { archived: true });
        expect((await fencedSpaceRefusal(deps, agent, ORG, WS, { subtree: `${ROOT}.app.decisions.d1` }))?.code).toBe('ACCESS_DENIED');
    });

    it('asks every fence an archived subtree holds: one extension does not open a second space', async () => {
        const { deps } = store([DECISIONS, { name: 'action', namespace: 'app.actions', extensions: ['alice/tasks'] }]);
        const through = { ...agent, extension: 'alice/muistio' };
        expect(await fencedSpaceRefusal(deps, through, ORG, WS, { subtree: `${ROOT}.app.decisions` })).toBeNull();
        expect((await fencedSpaceRefusal(deps, through, ORG, WS, { subtree: `${ROOT}.app` }))?.details.space).toBe('action');
    });

    it('asks a public form\'s rule for the identity the form writes under', async () => {
        const { deps, reads } = store([DECISIONS, NOTES]);
        // A submission has no session: the stored identity's shape decides.
        expect(await fencedFormRefusal(deps, `alice@${NODE}`, undefined, ORG, WS, 'app.decisions')).toBeNull();
        expect(reads.manifest).toBe(0);
        expect((await fencedFormRefusal(deps, AGENT, undefined, ORG, WS, 'app.decisions'))?.code).toBe('ACCESS_DENIED');
        expect(await fencedFormRefusal(deps, AGENT, undefined, ORG, WS, 'shared.notes')).toBeNull();
        // A definition has one: an agent's is refused, a person's and a hosted app's are not.
        expect((await fencedFormRefusal(deps, AGENT, ['agent'], ORG, WS, 'app.decisions'))?.code).toBe('ACCESS_DENIED');
        expect(await fencedFormRefusal(deps, `alice@${NODE}`, ['owner'], ORG, WS, 'app.decisions')).toBeNull();
        expect(await fencedFormRefusal(deps, `alice@${NODE}`, ['app'], ORG, WS, 'app.decisions')).toBeNull();
    });
});

describe('fencedKeysRefusal: keys of several workspaces', () => {
    it('refuses when one key lies in a fenced space, and reads one manifest per workspace named', async () => {
        const { deps, reads } = store([DECISIONS, NOTES]);
        const keys = [`${ROOT}.shared.notes.n1.latest`, `${ROOT}.shared.notes.n2.latest`, 'notes.private', `organism.${ORG}.shared.flat`, `${ROOT}.app.decisions.d1.version.1`];
        expect((await fencedKeysRefusal(deps, agent, keys))?.details.space).toBe('decision');
        expect(reads.manifest).toBe(1);
        expect(await fencedKeysRefusal(deps, agent, keys.slice(0, 4))).toBeNull();
        expect(await fencedKeysRefusal(deps, person, keys)).toBeNull();
        expect(reads.manifest).toBe(2);
    });
});

// ── The permission organism:direct, and the protected list (ruled 2026-10-13, second part). ──

const withScopes = (scopes: string[] | undefined) => ({ ...agent, ...(scopes ? { scopes } : {}) });

describe('organism:direct: a session that covers the word writes a fenced space directly', () => {
    it('reads the session\'s scopes with the node\'s one cover test: the word, `*` and the family wildcard', () => {
        expect(DIRECT_WRITE_SCOPE).toBe('organism:direct');
        expect(callerIsFenced(withScopes(['memory:write', 'organism:direct']), NODE)).toBe(false);
        expect(callerIsFenced(withScopes(['*']), NODE)).toBe(false);
        expect(callerIsFenced(withScopes(['organism:*']), NODE)).toBe(false);
        // An ordinary word: no list keeps it out of the wildcard.
        expect(isOutsideWildcard('organism:direct')).toBe(false);
    });

    it('FAILS CLOSED: a list without the word, an empty list and no list at all stay fenced', () => {
        expect(callerIsFenced(withScopes(['memory:read', 'memory:write', 'organism:read', 'organism:write', 'organism:rows']), NODE)).toBe(true);
        expect(callerIsFenced(withScopes(['memory:*']), NODE)).toBe(true);
        expect(callerIsFenced(withScopes([]), NODE)).toBe(true);
        expect(callerIsFenced(withScopes(undefined), NODE)).toBe(true);
    });

    it('is a session\'s word: an identity with no session is decided by its shape, whatever list is beside it', () => {
        expect(callerIsFenced({ principal: AGENT, scopes: ['*'] }, NODE)).toBe(true);
        expect(callerIsFenced({ principal: `alice@${NODE}`, scopes: [] }, NODE)).toBe(false);
    });

    it('changes nothing for the callers the rule already allowed', () => {
        expect(callerIsFenced({ ...person, scopes: [] }, NODE)).toBe(false);
        expect(callerIsFenced({ principal: `alice@${NODE}`, roles: ['app'], scopes: ['memory:read'] }, NODE)).toBe(false);
    });

    it('lets the rule return before the manifest is read, and refuses the narrowed session of the same agent', async () => {
        const key = `${ROOT}.app.decisions.d1.draft`;
        const { deps, reads } = store([DECISIONS, NOTES]);
        expect(await fencedSpaceRefusal(deps, withScopes(['organism:direct']), ORG, WS, { key })).toBeNull();
        expect(await fencedSpaceRefusal(deps, withScopes(['*']), ORG, WS, { key })).toBeNull();
        expect(reads.manifest).toBe(0);
        expect((await fencedSpaceRefusal(deps, withScopes(['memory:write', 'organism:write']), ORG, WS, { key }))?.details.reason).toBe('FENCED_SPACE');
        expect((await fencedKeysRefusal(deps, withScopes(['memory:delete']), [key]))?.code).toBe('ACCESS_DENIED');
        expect(await fencedKeysRefusal(deps, withScopes(['organism:direct']), [key])).toBeNull();
    });
});

describe('mayChangeFence: who changes the list of a fenced space', () => {
    it('admits the account holder in person and a session that covers organism:direct', () => {
        expect(mayChangeFence(person)).toBe(true);
        expect(mayChangeFence(withScopes(['organism:direct']))).toBe(true);
        expect(mayChangeFence(withScopes(['*']))).toBe(true);
    });

    it('refuses an agent without the word, a hosted app whatever its words, and a caller with no session', () => {
        expect(mayChangeFence(withScopes(['organism:write', 'memory:write']))).toBe(false);
        expect(mayChangeFence(withScopes(undefined))).toBe(false);
        // A hosted app writes records directly; its way to a list is the add-only route.
        expect(mayChangeFence({ principal: `alice@${NODE}`, roles: ['app'], scopes: ['organism:write'] })).toBe(false);
        expect(mayChangeFence({ principal: `alice@${NODE}`, roles: ['app'], scopes: ['*', 'organism:direct'] })).toBe(false);
        expect(mayChangeFence({ principal: `alice@${NODE}` })).toBe(false);
    });
});

describe('fenceChangeRefusal: the protected change', () => {
    const ROWS = { name: 'log', namespace: 'app.log', backing: 'rows', extensions: ['alice/ingest'] };
    const before = { name: 'WS', objectTypes: [DECISIONS, NOTES, ROWS] };
    const replace = (name: string, change: (o: Record<string, unknown>) => Record<string, unknown> | null) =>
        ({ ...before, objectTypes: before.objectTypes.map(o => (o.name === name ? change(o) : o)).filter(o => o !== null) });
    const touched = (after: unknown) => protectedFenceChanges(before, after);

    it('protects the list of a fenced space: removed, emptied, widened, replaced, reordered, respelled', () => {
        const changes: Array<[string, unknown]> = [
            ['removed', { name: DECISIONS.name, namespace: DECISIONS.namespace, backing: DECISIONS.backing }],
            ['emptied', { ...DECISIONS, extensions: [] }],
            ['null', { ...DECISIONS, extensions: null }],
            ['widened', { ...DECISIONS, extensions: ['Alice/Muistio', 'alice/other'] }],
            ['replaced', { ...DECISIONS, extensions: ['bob/muistio'] }],
            ['respelled', { ...DECISIONS, extensions: ['alice/muistio'] }],
        ];
        for (const [what, ot] of changes) {
            expect(touched(replace('decision', () => ot as Record<string, unknown>)), what).toEqual([{ space: 'decision', change: 'extensions' }]);
        }
        const two = { objectTypes: [{ ...DECISIONS, extensions: ['alice/a', 'alice/b'] }] };
        expect(protectedFenceChanges(two, { objectTypes: [{ ...DECISIONS, extensions: ['alice/b', 'alice/a'] }] })).toEqual([{ space: 'decision', change: 'extensions' }]);
    });

    it('protects the object type itself: removed, its namespace moved, its backing changed', () => {
        expect(touched(replace('decision', () => null))).toEqual([{ space: 'decision', change: 'removed' }]);
        expect(touched(replace('decision', o => ({ ...o, namespace: 'app.elsewhere' })))).toEqual([{ space: 'decision', change: 'namespace' }]);
        expect(touched(replace('decision', o => ({ ...o, backing: 'rows' })))).toEqual([{ space: 'decision', change: 'backing' }]);
        expect(touched(replace('decision', o => ({ ...o, backing: 'tasks' })))).toEqual([{ space: 'decision', change: 'backing' }]);
    });

    it('reads a manifest that is gone or unreadable as every fence removed', () => {
        for (const after of [null, undefined, 'manifest', [], {}, { objectTypes: 'none' }, { objectTypes: [] }]) {
            expect(touched(after), JSON.stringify(after)).toEqual([{ space: 'decision', change: 'removed' }]);
        }
    });

    it('protects a fence that opens to nobody too: correcting its one invalid entry is a change of the list', () => {
        const closed = { objectTypes: [{ ...DECISIONS, extensions: ['alice x/muistio'] }] };
        expect(protectedFenceChanges(closed, { objectTypes: [DECISIONS] })).toEqual([{ space: 'decision', change: 'extensions' }]);
        expect(protectedFenceChanges(closed, closed)).toEqual([]);
    });

    it('leaves every other change as it is', () => {
        const unprotected: Array<[string, unknown]> = [
            ['the same manifest', before],
            ['a copy of it', JSON.parse(JSON.stringify(before))],
            ['another field of the fenced space', replace('decision', o => ({ ...o, writeRole: 'admin', schemaRef: 'schema:decision@2' }))],
            ['the fenced space under a new name', replace('decision', o => ({ ...o, name: 'ruling' }))],
            ['a space with no fence, changed', replace('note', o => ({ ...o, namespace: 'shared.other', backing: 'tasks' }))],
            ['a space with no fence, removed', replace('note', () => null)],
            ['a space with no fence that now names an extension', replace('note', o => ({ ...o, extensions: ['alice/muistio'] }))],
            ['a row space\'s list, which is the row service\'s', replace('log', o => ({ ...o, extensions: [] }))],
            ['a row space removed', replace('log', () => null)],
            ['a new object type that names extensions', { ...before, objectTypes: [...before.objectTypes, { name: 'action', namespace: 'app.actions', extensions: ['alice/tasks'] }] }],
            ['the order of the object types', { ...before, objectTypes: [...before.objectTypes].reverse() }],
            ['the name of the workspace', { ...before, name: 'Renamed' }],
        ];
        for (const [what, after] of unprotected) expect(touched(after), what).toEqual([]);
        // A manifest that declares no fence has nothing to protect.
        expect(protectedFenceChanges({ objectTypes: [NOTES, ROWS] }, null)).toEqual([]);
        expect(protectedFenceChanges(null, { objectTypes: [DECISIONS] })).toEqual([]);
    });

    it('refuses a protected change with 403 ACCESS_DENIED, the spaces it touches and the permission by name', () => {
        const after = replace('decision', () => null);
        const refusal = fenceChangeRefusal(before, after, withScopes(['organism:write', 'memory:write']));
        expect(refusal).toEqual({
            status: 403, code: 'ACCESS_DENIED', message: fenceChangeMessage(['decision']),
            details: { reason: 'FENCE_CHANGE', spaces: [{ space: 'decision', change: 'removed' }] },
        });
        expect(refusal?.message).toContain('organism:direct');
        expect(refusal?.message).toContain('decision');
    });

    it('accepts it from the account holder in person and from a session that covers organism:direct, and from nobody else', () => {
        const after = replace('decision', () => null);
        expect(fenceChangeRefusal(before, after, person)).toBeNull();
        expect(fenceChangeRefusal(before, after, withScopes(['organism:direct']))).toBeNull();
        expect(fenceChangeRefusal(before, after, withScopes(['*']))).toBeNull();
        expect(fenceChangeRefusal(before, after, withScopes(undefined))?.code).toBe('ACCESS_DENIED');
        expect(fenceChangeRefusal(before, after, { principal: `alice@${NODE}`, roles: ['app'], scopes: ['organism:write'] })?.code).toBe('ACCESS_DENIED');
        expect(fenceChangeRefusal(before, after, { principal: `alice@${NODE}` })?.code).toBe('ACCESS_DENIED');
        // A change that is not protected is nobody's refusal.
        expect(fenceChangeRefusal(before, replace('note', () => null), withScopes(undefined))).toBeNull();
    });
});

describe('the manifest record as a target of the rule', () => {
    const manifestKey = `${ROOT}.meta.manifest`;
    const noWord = withScopes(['memory:write', 'memory:delete', 'organism:write']);

    it('reads a write whose value the code path does not hand over as the removal of every fence', async () => {
        const { deps } = store([DECISIONS, NOTES]);
        const refusal = await fencedSpaceRefusal(deps, noWord, ORG, WS, { key: manifestKey });
        expect(refusal?.details).toEqual({ reason: 'FENCE_CHANGE', spaces: [{ space: 'decision', change: 'removed' }] });
        expect((await fencedSpaceRefusal(deps, noWord, ORG, WS, { keys: [`${ROOT}.shared.notes.n1`, manifestKey] }))?.details.reason).toBe('FENCE_CHANGE');
        expect((await fencedKeysRefusal(deps, noWord, [manifestKey]))?.details.reason).toBe('FENCE_CHANGE');
    });

    it('compares the value a code path hands over, and takes a write that keeps every fence', async () => {
        const { deps } = store([DECISIONS, NOTES]);
        expect(await fencedSpaceRefusal(deps, noWord, ORG, WS, { key: manifestKey }, { after: { objectTypes: [DECISIONS, NOTES], name: 'renamed' } })).toBeNull();
        expect(await fencedSpaceRefusal(deps, noWord, ORG, WS, { key: manifestKey }, { after: { objectTypes: [DECISIONS] } })).toBeNull();
        expect((await fencedSpaceRefusal(deps, noWord, ORG, WS, { key: manifestKey }, { after: { objectTypes: [NOTES] } }))?.details.reason).toBe('FENCE_CHANGE');
        // A code path that joins object types and changes none says so, and makes its own comparison.
        expect(await fencedSpaceRefusal(deps, noWord, ORG, WS, { key: manifestKey }, { keepsFences: true })).toBeNull();
    });

    it('asks nothing of the account holder in person or of a session with the word, and reads no manifest for them', async () => {
        const { deps, reads } = store([DECISIONS, NOTES]);
        expect(await fencedSpaceRefusal(deps, person, ORG, WS, { key: manifestKey })).toBeNull();
        expect(await fencedSpaceRefusal(deps, withScopes(['organism:direct']), ORG, WS, { key: manifestKey })).toBeNull();
        expect(reads.manifest).toBe(0);
    });

    it('refuses a hosted app, which the fence itself lets write records', async () => {
        const { deps } = store([DECISIONS, NOTES]);
        const app = { principal: `alice@${NODE}`, roles: ['app'], scopes: ['memory:write'] };
        expect((await fencedSpaceRefusal(deps, app, ORG, WS, { key: manifestKey }))?.details.reason).toBe('FENCE_CHANGE');
        expect(await fencedSpaceRefusal(deps, app, ORG, WS, { key: `${ROOT}.app.decisions.d1.draft` })).toBeNull();
    });

    it('is the record itself and nothing beside it, and nothing at all where no fence is declared', async () => {
        const { deps } = store([DECISIONS, NOTES]);
        for (const key of [`${manifestKey}.draft`, `${manifestKey}.latest`, `${ROOT}.meta.readme`, `${ROOT}.meta.manifestx`, `organism.${ORG}.meta.manifest`]) {
            expect(await fencedSpaceRefusal(deps, noWord, ORG, WS, { key }), key).toBeNull();
        }
        // An archive of the record changes no value, and the rule reads an archived manifest too.
        expect(await fencedSpaceRefusal(deps, noWord, ORG, WS, { subtree: manifestKey })).toBeNull();
        expect(await fencedSpaceRefusal(store([NOTES]).deps, noWord, ORG, WS, { key: manifestKey })).toBeNull();
        expect(await fencedSpaceRefusal(store(null).deps, noWord, ORG, WS, { key: manifestKey })).toBeNull();
    });
});

describe('fencedSpaceMessage: one sentence, in plain words', () => {
    it('names the extensions and says what to do', () => {
        expect(fencedSpaceMessage(['alice/muistio'])).toBe("This space takes an agent's write only through the app's own tool. Use an action of the extension alice/muistio to add, change or remove a record here.");
        expect(fencedSpaceMessage(['alice/muistio', 'bob/other'])).toContain('one of the extensions alice/muistio, bob/other');
        expect(fencedSpaceMessage([])).toContain("only through the app's own tool");
        expect(fencedSpaceMessage([])).toContain('Ask');
    });
});
