/**
 * @file test/unit/inbox-organize.test.ts
 * @description Where a row of the Messages list goes, as the owner decided it on 2026-09-13: the
 *   sections, the archive and when a thread comes back out of it, age archiving for the owner's own
 *   agents, the three folds, and the rules. organizeConversations() is pure, so every case here is a
 *   table of rows and a clock; the E2E suite (e2e-inbox-organize) drives the real doors and the
 *   storage fields on both backends. The record's writes are driven over a tiny in-memory storage.
 * @usage cd aimeat && pnpm exec vitest run test/unit/inbox-organize.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { organizeConversations, isOwnAgentRow, SUBJECT_FOLD_WINDOW_MS, type OrganizableRow } from '../../src/services/inbox-organize/organize.js';
import {
    defaultOrganize, normalizeOrganize, archiveConversations, updateInboxOrganize, readInboxOrganize,
    INBOX_ORGANIZE_KEY, type InboxOrganize, type InboxRule,
} from '../../src/services/inbox-organize/record.js';
import type { Storage } from '../../src/storage/interface.js';

const NODE = 'n1';
const OWNER = `alice@${NODE}`;
const agent = (name: string) => `${name}#${OWNER}`;
const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const DAY = 86_400_000;
const HOUR = 3_600_000;

interface Row extends OrganizableRow<Row> { messageCount: number; lastDirection: 'inbound' | 'outbound' }
let seq = 0;
function row(p: Partial<Row>): Row {
    seq++;
    return {
        conversationId: p.conversationId ?? `conv-${seq}-xxxxxxxx`,
        peerGhii: p.peerGhii ?? `bob@${NODE}`,
        lastMessage: 'hello', lastSenderGhii: p.peerGhii ?? `bob@${NODE}`, lastDirection: 'inbound',
        messageCount: 1, unread: 0, updatedAt: at(HOUR),
        ...p,
    };
}
const rec = (p: Partial<InboxOrganize> = {}): InboxOrganize => ({ ...defaultOrganize(), ...p });
const rule = (p: Partial<InboxRule> & Pick<InboxRule, 'action'>): InboxRule => ({
    id: p.id ?? `r${seq++}`, name: p.name ?? 'rule', enabled: p.enabled ?? true, createdAt: p.createdAt ?? at(10 * DAY),
    match: { scope: 'agents', ...(p.match ?? {}) }, action: p.action,
});
const place = (rows: Row[], r: InboxOrganize = rec()) => organizeConversations(rows, r, OWNER, NOW);
const byId = (rows: Row[], id: string) => rows.find(r => r.conversationId === id);

describe('sections', () => {
    it('puts the owner\'s own agents in their own section, everyone else with the people', () => {
        const out = place([
            row({ conversationId: 'with-bob-00', peerGhii: `bob@${NODE}` }),
            row({ conversationId: 'with-bot-00', peerGhii: agent('bot'), lastForeignAt: at(HOUR) }),
            row({ conversationId: 'eco-app-000', peerGhii: `eco:news#${OWNER}` }),
            row({ conversationId: 'bobs-bot-00', peerGhii: `bot#bob@${NODE}` }),
        ]);
        expect(byId(out, 'with-bob-00')?.section).toBe('people');
        expect(byId(out, 'with-bot-00')?.section).toBe('agents');
        expect(byId(out, 'eco-app-000')?.section).toBe('agents');
        expect(byId(out, 'bobs-bot-00')?.section).toBe('people');
    });

    it('never counts a group thread or an agent\'s own thread with an outsider as own-agent traffic', () => {
        expect(isOwnAgentRow({ peerGhii: agent('bot'), groupAlias: 'support@operators' }, OWNER)).toBe(false);
        expect(isOwnAgentRow({ peerGhii: agent('bot'), viaAgent: agent('bot') }, OWNER)).toBe(false);
        // `alice@n1` is not `#alice@n1`: the owner as a peer is not one of her own agents.
        expect(isOwnAgentRow({ peerGhii: OWNER }, OWNER)).toBe(false);
    });
});

describe('the archive', () => {
    it('keeps an archived thread there when only the owner\'s own agents wrote after it was archived', () => {
        const out = place([row({ conversationId: 'ack-thread', peerGhii: agent('bot'), updatedAt: at(HOUR), lastForeignAt: at(3 * DAY) })],
            rec({ archived: { 'ack-thread': at(2 * DAY) } }));
        expect(out[0].section).toBe('archive');
        expect(out[0].archived).toEqual({ reason: 'manual', since: at(2 * DAY) });
    });

    it('lets it back out when somebody other than the owner\'s own agents writes after the archiving', () => {
        const out = place([row({ conversationId: 'bob-wrote', peerGhii: `bob@${NODE}`, lastForeignAt: at(HOUR) })],
            rec({ archived: { 'bob-wrote': at(2 * DAY) } }));
        expect(out[0].section).toBe('people');
        expect(out[0].archived).toBeUndefined();
    });

    it('holds a restored thread out of rule and age archiving, until the owner archives it again', () => {
        const old = row({ conversationId: 'kept-thread', peerGhii: agent('bot'), updatedAt: at(40 * DAY), subject: 'Heartbeat' });
        const archiveRule = rule({ action: 'archive', match: { subject: 'heartbeat', scope: 'agents' } });
        expect(place([old], rec({ rules: [archiveRule], kept: { 'kept-thread': at(DAY) } }))[0].section).toBe('agents');
        const again = place([old], rec({ rules: [archiveRule], kept: { 'kept-thread': at(DAY) }, archived: { 'kept-thread': at(HOUR) } }));
        expect(again[0].archived?.reason).toBe('manual');
    });

    it('archives by rule, and a person writing after the rule was made brings the thread back', () => {
        const archiveRule = rule({ action: 'archive', name: 'Heartbeats', createdAt: at(5 * DAY), match: { subject: 'heartbeat', scope: 'all' } });
        const quiet = row({ conversationId: 'rule-quiet', subject: 'Heartbeat 12', lastForeignAt: at(9 * DAY) });
        const answered = row({ conversationId: 'rule-human', subject: 'Heartbeat 13', lastForeignAt: at(DAY) });
        const out = place([quiet, answered], rec({ rules: [archiveRule] }));
        expect(byId(out, 'rule-quiet')?.archived).toEqual({ reason: 'rule', since: at(5 * DAY), rule: 'Heartbeats' });
        expect(byId(out, 'rule-human')?.section).toBe('people');
    });
});

describe('archiving the owner\'s own agents\' traffic by age', () => {
    const agentRow = (p: Partial<Row>) => row({ peerGhii: agent('bot'), ...p });

    it('archives after the set number of days without a message', () => {
        const out = place([agentRow({ conversationId: 'old-agent', updatedAt: at(15 * DAY) })]);
        expect(out[0].archived).toEqual({ reason: 'age', since: at(DAY) });
    });

    it('archives old traffic between the owner\'s agents even though the owner\'s mailbox counts it unread', () => {
        const out = place([agentRow({ conversationId: 'chatter-00', updatedAt: at(20 * DAY), unread: 3, unreadToOwner: 0 })]);
        expect(out[0].archived?.reason).toBe('age');
    });

    it('leaves a thread with something unread for the owner, a younger one, and a person\'s thread alone', () => {
        const out = place([
            agentRow({ conversationId: 'unread-one', updatedAt: at(30 * DAY), unread: 1, unreadToOwner: 1 }),
            agentRow({ conversationId: 'young-one0', updatedAt: at(13 * DAY) }),
            row({ conversationId: 'bob-old-00', updatedAt: at(90 * DAY) }),
        ]);
        expect(out.every(r => r.section !== 'archive')).toBe(true);
    });

    it('follows the owner\'s own setting: another number of days, or off', () => {
        const r = agentRow({ conversationId: 'thirty-day', updatedAt: at(20 * DAY) });
        expect(place([r], rec({ autoArchive: { enabled: true, days: 30 } }))[0].section).toBe('agents');
        expect(place([r], rec({ autoArchive: { enabled: true, days: 7 } }))[0].section).toBe('archive');
        expect(place([r], rec({ autoArchive: { enabled: false, days: 7 } }))[0].section).toBe('agents');
    });
});

describe('one row for copies of the same message', () => {
    const copy = (to: string, p: Partial<Row>) => row({
        peerGhii: agent('announcer'), subject: 'Lifecycle Central replaces Coding Central', lastSenderGhii: agent('announcer'),
        openedBy: agent('announcer'), openedTo: agent(to), openedAt: at(3 * DAY), updatedAt: at(3 * DAY), ...p,
    });

    it('folds copies a loop sent, with the unread of all of them on the row', () => {
        const out = place([copy('a', { unread: 1 }), copy('b', { unread: 1, openedAt: at(3 * DAY - 10 * 60_000) }), copy('c', {})],
            rec({ autoArchive: { enabled: false, days: 14 } }));
        expect(out).toHaveLength(1);
        expect(out[0].fold).toEqual({ kind: 'subject', count: 3, label: 'Lifecycle Central replaces Coding Central' });
        expect(out[0].folded).toHaveLength(2);
        expect(out[0].unread).toBe(2);
    });

    it('keeps an own agent\'s answer folded, because between the owner\'s agents the answer is the ACK', () => {
        const acked = copy('b', { peerGhii: agent('b'), lastSenderGhii: agent('b'), lastMessage: 'ACK lifecycle-central', updatedAt: at(DAY) });
        const out = place([copy('a', {}), acked], rec({ autoArchive: { enabled: false, days: 14 } }));
        expect(out).toHaveLength(1);
        expect(out[0].fold?.count).toBe(2);
    });

    it('lifts a thread out when a person answered it, the way a broadcast copy does', () => {
        const people = (to: string, p: Partial<Row>) => row({
            peerGhii: `${to}@${NODE}`, subject: 'Founders update', lastSenderGhii: OWNER, openedBy: OWNER,
            openedTo: `${to}@${NODE}`, openedAt: at(2 * HOUR), lastForeignAt: at(2 * HOUR), ...p,
        });
        const out = place([
            people('bob', { conversationId: 'fu-bob-000' }),
            people('carol', { conversationId: 'fu-carol-00' }),
            people('dave', { conversationId: 'fu-dave-000', lastSenderGhii: `dave@${NODE}`, lastForeignAt: at(HOUR) }),
        ]);
        expect(out).toHaveLength(2);
        expect(byId(out, 'fu-dave-000')?.fold).toBeUndefined();
        expect(out.find(r => r.fold)?.fold?.count).toBe(2);
    });

    it('does not fold copies opened more than an hour apart, or when the owner switched folding off', () => {
        const spread = [copy('a', {}), copy('b', { openedAt: new Date(Date.parse(at(3 * DAY)) + SUBJECT_FOLD_WINDOW_MS + 60_000).toISOString() })];
        expect(place(spread, rec({ autoArchive: { enabled: false, days: 14 } }))).toHaveLength(2);
        expect(place([copy('a', {}), copy('b', {})], rec({ foldSameSubject: false, autoArchive: { enabled: false, days: 14 } }))).toHaveLength(2);
    });

    it('folds inside a section and never across two', () => {
        const out = place([copy('a', { updatedAt: at(20 * DAY) }), copy('b', { updatedAt: at(DAY) })]);
        expect(out).toHaveLength(2);
        expect(out.map(r => r.section).sort()).toEqual(['agents', 'archive']);
    });
});

describe('rules', () => {
    it('groups matching threads under the rule\'s name, and the first matching rule decides', () => {
        const hb = row({ conversationId: 'heartbeat-1', peerGhii: agent('crew'), subject: 'Herätys: task waiting' });
        const out = place([hb], rec({
            autoArchive: { enabled: false, days: 14 },
            rules: [rule({ action: 'group', name: 'Coordination', match: { subject: 'herätys', scope: 'agents' } }),
                rule({ action: 'archive', match: { subject: 'herätys', scope: 'agents' } })],
        }));
        expect(out[0]).toMatchObject({ section: 'group', group: 'Coordination' });
    });

    it('scopes a rule to the owner\'s own agents unless it says all, and skips a paused rule', () => {
        const people = row({ conversationId: 'bob-hb-0000', subject: 'Herätys' });
        const agents = row({ conversationId: 'bot-hb-0000', peerGhii: agent('bot'), subject: 'Herätys' });
        const onlyAgents = rec({ rules: [rule({ action: 'group', name: 'H', match: { subject: 'herätys', scope: 'agents' } })] });
        const out = place([people, agents], onlyAgents);
        expect(byId(out, 'bob-hb-0000')?.section).toBe('people');
        expect(byId(out, 'bot-hb-0000')?.section).toBe('group');
        const paused = rec({ rules: [rule({ action: 'group', name: 'H', enabled: false, match: { subject: 'herätys', scope: 'all' } })] });
        expect(place([people], paused)[0].section).toBe('people');
    });

    it('matches on who is in the thread and on the newest message, and folds a fold rule into one row', () => {
        const ack = (id: string) => row({ conversationId: id, peerGhii: agent('worker'), lastSenderGhii: agent('worker'), lastMessage: 'ACK done', openedBy: agent('boss') });
        const r = rec({ autoArchive: { enabled: false, days: 14 }, rules: [rule({ action: 'fold', name: 'Acks', match: { with: 'worker#', body: 'ack', scope: 'agents' } })] });
        const out = place([ack('ack-one-0000'), ack('ack-two-0000'), row({ conversationId: 'other-00000', peerGhii: agent('boss') })], r);
        expect(out).toHaveLength(2);
        expect(out.find(x => x.fold)?.fold).toEqual({ kind: 'rule', count: 2, label: 'Acks' });
    });
});

describe('the record', () => {
    function memoryStorage(): Storage {
        const store = new Map<string, any>();
        return {
            getMemory: async (owner: string, key: string) => store.get(`${owner} ${key}`) ?? null,
            setMemory: async (r: any) => { store.set(`${r.ownerGaii} ${r.key}`, r); return r; },
        } as unknown as Storage;
    }

    it('defaults to age archiving at 14 days and folding on, and drops what it does not understand', () => {
        expect(defaultOrganize()).toMatchObject({ autoArchive: { enabled: true, days: 14 }, foldSameSubject: true, rules: [] });
        const odd = normalizeOrganize({ autoArchive: { days: 9000 }, archived: { good: '2026-09-01T00:00:00.000Z', bad: 42 }, rules: [{ id: 'x' }] });
        expect(odd.autoArchive.days).toBe(365);
        expect(odd.archived).toEqual({ good: '2026-09-01T00:00:00.000Z' });
        expect(odd.rules).toEqual([]);
    });

    it('archives, then restores and keeps, under the reserved key', async () => {
        const storage = memoryStorage();
        await archiveConversations(storage, OWNER, ['conv-a-0000', 'conv-b-0000'], false);
        let r = await readInboxOrganize(storage, OWNER);
        expect(Object.keys(r.archived).sort()).toEqual(['conv-a-0000', 'conv-b-0000']);
        await archiveConversations(storage, OWNER, ['conv-a-0000'], true);
        r = await readInboxOrganize(storage, OWNER);
        expect(Object.keys(r.archived)).toEqual(['conv-b-0000']);
        expect(Object.keys(r.kept)).toEqual(['conv-a-0000']);
        expect(await storage.getMemory(OWNER, INBOX_ORGANIZE_KEY)).not.toBeNull();
    });

    it('never writes the defaults over the owner\'s record when reading it failed', async () => {
        let writes = 0;
        const broken = {
            getMemory: async () => { throw new Error('storage refused: getMemory'); },
            setMemory: async (r: unknown) => { writes++; return r; },
        } as unknown as Storage;
        await expect(archiveConversations(broken, OWNER, ['conv-e-0000'], false)).rejects.toThrow('getMemory');
        await expect(updateInboxOrganize(broken, OWNER, { fold_same_subject: false })).rejects.toThrow('getMemory');
        expect(writes).toBe(0);
        // The list itself still shows, unorganised.
        expect((await readInboxOrganize(broken, OWNER)).autoArchive.enabled).toBe(false);
    });

    it('serialises two quick writes so neither overwrites the other', async () => {
        const storage = memoryStorage();
        await Promise.all([
            archiveConversations(storage, OWNER, ['conv-c-0000'], false),
            archiveConversations(storage, OWNER, ['conv-d-0000'], false),
        ]);
        expect(Object.keys((await readInboxOrganize(storage, OWNER)).archived).sort()).toEqual(['conv-c-0000', 'conv-d-0000']);
    });

    it('refuses a rule over every thread that names nothing to match, and keeps an edited rule\'s birth date', async () => {
        const storage = memoryStorage();
        const bad = await updateInboxOrganize(storage, OWNER, { add_rule: { name: 'Everything', action: 'archive', match: { scope: 'all' } } });
        expect(bad.ok).toBe(false);
        const ok = await updateInboxOrganize(storage, OWNER, { add_rule: { name: 'All my agents', action: 'group', match: {} } });
        expect(ok.ok).toBe(true);
        const first = ok.ok ? ok.organize.rules[0] : undefined;
        const edited = await updateInboxOrganize(storage, OWNER, { add_rule: { id: first!.id, name: 'Agents', action: 'group', match: {} } });
        expect(edited.ok && edited.organize.rules).toEqual([{ ...first, name: 'Agents' }]);
        const removed = await updateInboxOrganize(storage, OWNER, { remove_rule: first!.id, auto_archive: { days: 30 } });
        expect(removed.ok && removed.organize).toMatchObject({ rules: [], autoArchive: { enabled: true, days: 30 } });
    });
});
