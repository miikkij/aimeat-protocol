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
 * @usage cd aimeat && pnpm exec vitest run test/unit/fenced-space.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import {
    callerIsFenced, fenceOf, fencesOf, fencesMet, fencedSpaceMessage, fencedSpaceRefusal, fencedKeysRefusal,
    extensionMarker, archiveFenceTarget, fencedFormRefusal,
} from '../../src/services/fenced-space.js';

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

describe('fencedSpaceMessage: one sentence, in plain words', () => {
    it('names the extensions and says what to do', () => {
        expect(fencedSpaceMessage(['alice/muistio'])).toBe("This space takes an agent's write only through the app's own tool. Use an action of the extension alice/muistio to add, change or remove a record here.");
        expect(fencedSpaceMessage(['alice/muistio', 'bob/other'])).toContain('one of the extensions alice/muistio, bob/other');
        expect(fencedSpaceMessage([])).toContain("only through the app's own tool");
        expect(fencedSpaceMessage([])).toContain('Ask');
    });
});
