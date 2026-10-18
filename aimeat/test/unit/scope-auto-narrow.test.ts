/**
 * @file test/unit/scope-auto-narrow.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node narrows an agent holding `*` itself when its record is ready, and tells the
 *   owner once (Jouni, 2026-10-18, superseding the hold half of ruling C); and a refusal one press
 *   cannot answer still reaches the owner's bell, without an Allow button. Against a real in-memory
 *   SQLite storage.
 * @usage pnpm test -- scope-auto-narrow
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, AgentRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { SCOPE_USE_KEY, OBSERVE_DAYS, readScopeUse } from '../../src/services/scope-use.js';
import { startFactsOf, mailOwnerNarrowed, AGENT_NARROWED_TYPE } from '../../src/services/scope-auto-narrow.js';
import { decideTaskStart } from '../../src/services/agent-task-rules.js';
import { sendPermissionAsk, PERMISSION_ASK_TYPE } from '../../src/services/permission-ask-notice.js';
import { setActiveEmailService } from '../../src/services/email.js';
import { readMailLog, updateNotificationSettings } from '../../src/services/notification-settings.js';

const NODE = 'aimeat-test-001';
const OWNER = `alice@${NODE}`;
const config = { nodeId: NODE, baseUrl: 'https://node.test' } as AimeatConfig;
let storage: Storage;

function agent(name: string, extra: Partial<AgentRecord> = {}): AgentRecord {
    const now = new Date().toISOString();
    return {
        gaii: `${name}#${OWNER}`, name, owner: 'alice', capabilities: [], publicKey: '', trustScore: 50, morselBalance: 0,
        createdAt: now, lastSeen: now, mode: 'task-runner', defaultScopes: ['*'], ...extra,
    } as AgentRecord;
}

/** The usage record of `name`, `days` old, naming `words`. */
async function seedUse(name: string, words: string[], days = OBSERVE_DAYS + 1): Promise<void> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const record = await readScopeUse(storage, OWNER);
    record.agents[name] = { since, words: Object.fromEntries(words.map(w => [w, since])) };
    await storage.setMemory({ key: SCOPE_USE_KEY, ownerGaii: OWNER, value: record, visibility: 'private',
        tags: [], ttlHours: null, version: 1, createdAt: since, updatedAt: since });
}

async function notices(type: string): Promise<Array<{ type: string; link?: string; actions?: Array<{ kind: string }>; i18n?: { key: string; vars?: Record<string, unknown> } }>> {
    return (await storage.listMemory(OWNER, { prefix: 'notif.' })).map(m => m.value as never).filter((n: { type: string }) => n.type === type);
}

beforeEach(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    const at = new Date().toISOString();
    await storage.createOwner({ name: 'alice', displayName: 'alice', publicKey: 'pk', roles: ['owner'], createdAt: at } as never);
    await storage.createGHII({
        username: 'alice', nodeId: NODE, ghii: OWNER, displayName: 'alice', verificationLevel: 1, ownerName: 'alice',
        totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: at, updatedAt: at,
        notificationEmail: 'alice@example.test', emailVerifiedAt: at, locale: 'fi',
    } as never);
});

afterEach(() => { setActiveEmailService({ enabled: false } as never); vi.restoreAllMocks(); });

describe('startFactsOf: the node narrows a ready `*` agent before the start decision', () => {
    it('leaves an agent without `*`, and a `*` agent still being observed, as they are', async () => {
        await storage.createAgent(agent('named', { defaultScopes: ['memory:read'] }));
        await storage.createAgent(agent('young'));
        await seedUse('young', ['memory:read'], 3);
        const named = await storage.getAgent(`named#${OWNER}`);
        expect(await startFactsOf({ storage, config }, named)).toBe(named);
        const young = await startFactsOf({ storage, config }, await storage.getAgent(`young#${OWNER}`));
        expect(young).toMatchObject({ defaultScopes: ['*'], wildcardReady: false });
        expect(decideTaskStart(young).startsNow).toBe(true);
        expect((await storage.getAgent(`young#${OWNER}`))?.defaultScopes).toEqual(['*']);
        expect(await notices(AGENT_NARROWED_TYPE)).toHaveLength(0);
    });

    it('narrows a ready agent to what it used, its task starts on its own, and the owner is told once', async () => {
        await storage.createAgent(agent('star'));
        await seedUse('star', ['memory:read', 'memory:write', 'memory:write-reserved']);
        const facts = await startFactsOf({ storage, config }, await storage.getAgent(`star#${OWNER}`));
        // A word outside every wildcard was never given by `*`, so the narrowing does not hand it out.
        expect(facts?.defaultScopes).toEqual(['memory:read', 'memory:write']);
        expect(facts?.wildcardReady).toBeUndefined();
        expect(decideTaskStart(facts)).toMatchObject({ startsNow: true, waitsBecause: null });
        expect((await storage.getAgent(`star#${OWNER}`))?.defaultScopes).toEqual(['memory:read', 'memory:write']);
        expect((await readScopeUse(storage, OWNER)).agents.star).toBeUndefined();

        const told = await notices(AGENT_NARROWED_TYPE);
        expect(told).toHaveLength(1);
        expect(told[0].link).toBe('/v1/profile?tab=agents&agent=star');
        // The areas in the owner's language (their account says fi).
        expect(told[0].i18n).toMatchObject({ key: AGENT_NARROWED_TYPE, vars: { agent: 'star', what: 'tallentamasi tiedot' } });

        // A caller still holding the copy from before the narrowing reads the narrowed agent, and nobody is told twice.
        const stale = await startFactsOf({ storage, config }, agent('star'));
        expect(stale?.defaultScopes).toEqual(['memory:read', 'memory:write']);
        expect(await notices(AGENT_NARROWED_TYPE)).toHaveLength(1);
    });

    it('two decisions at once narrow once and tell the owner once', async () => {
        await storage.createAgent(agent('pair'));
        await seedUse('pair', ['task:read']);
        const copy = await storage.getAgent(`pair#${OWNER}`);
        const [a, b] = await Promise.all([startFactsOf({ storage, config }, copy), startFactsOf({ storage, config }, copy)]);
        expect(a?.defaultScopes).toEqual(['task:read']);
        expect(b?.defaultScopes).toEqual(['task:read']);
        expect(await notices(AGENT_NARROWED_TYPE)).toHaveLength(1);
    });

    it('a floor word it used still holds the task after the narrowing', async () => {
        await storage.createAgent(agent('trader'));
        await seedUse('trader', ['exchange:write', 'memory:read']);
        const facts = await startFactsOf({ storage, config }, await storage.getAgent(`trader#${OWNER}`));
        expect(facts?.defaultScopes).toEqual(['exchange:write', 'memory:read']);
        expect(decideTaskStart(facts)).toMatchObject({ startsNow: false, waitsBecause: 'floor', floorScopes: ['exchange:write'] });
    });

    it('a narrowing that fails holds the task on `*` and tells nobody (fail closed)', async () => {
        await storage.createAgent(agent('broken'));
        await seedUse('broken', ['memory:read']);
        vi.spyOn(storage, 'updateAgent').mockRejectedValueOnce(new Error('disk full'));
        const facts = await startFactsOf({ storage, config }, await storage.getAgent(`broken#${OWNER}`));
        expect(facts).toMatchObject({ defaultScopes: ['*'], wildcardReady: true });
        expect(decideTaskStart(facts)).toMatchObject({ startsNow: false, waitsBecause: 'floor', floorScopes: ['*'] });
        expect(await notices(AGENT_NARROWED_TYPE)).toHaveLength(0);
        // The next decision tries again.
        const again = await startFactsOf({ storage, config }, await storage.getAgent(`broken#${OWNER}`));
        expect(again?.defaultScopes).toEqual(['memory:read']);
    });

    it('the email goes to a verified address, is logged, and stops when the owner switches it off', async () => {
        const sendRaw = vi.fn(async () => true);
        setActiveEmailService({ enabled: true, sendRaw } as never);
        const narrowed = agent('mailed', { defaultScopes: ['memory:read'] });
        await mailOwnerNarrowed({ storage, config }, OWNER, narrowed);
        expect(sendRaw).toHaveBeenCalledTimes(1);
        const [to, subject, , text] = sendRaw.mock.calls[0] as unknown as string[];
        expect(to).toBe('alice@example.test');
        expect(subject).toBe('AIMEAT rajasi agentin mailed oikeudet');
        expect(text).toContain('https://node.test/v1/profile?tab=agents&agent=mailed');
        expect((await readMailLog(storage, OWNER)).map(e => e.kind)).toEqual(['agent_narrowed']);

        await updateNotificationSettings(storage, OWNER, cur => ({ ...cur, email: { ...cur.email, agentNarrowed: false } }));
        await mailOwnerNarrowed({ storage, config }, OWNER, narrowed);
        expect(sendRaw).toHaveBeenCalledTimes(1);
    });
});

describe('sendPermissionAsk: a refusal one press cannot answer reaches the bell too', () => {
    it('a powerful word: a notice with the agent page and no Allow button', async () => {
        const worker = agent('worker', { defaultScopes: ['memory:read'] });
        await sendPermissionAsk({ storage, config }, OWNER, worker, ['ai:use']);
        const told = await notices(PERMISSION_ASK_TYPE);
        expect(told).toHaveLength(1);
        expect(told[0].i18n?.key).toBe('agent_permission_ask_page');
        expect(told[0].link).toBe('/v1/profile?tab=agents&agent=worker');
        expect((told[0].actions ?? []).some(a => a.kind === 'api')).toBe(false);
    });

    it('an operator word is not told to an account that does not run the node, and is told to one that does', async () => {
        const worker = agent('worker', { defaultScopes: ['memory:read'] });
        await sendPermissionAsk({ storage, config }, OWNER, worker, ['operator:admin']);
        expect(await notices(PERMISSION_ASK_TYPE)).toHaveLength(0);
        // With another word beside it, only that word is told.
        await sendPermissionAsk({ storage, config }, OWNER, worker, ['operator:admin', 'memory:purge']);
        expect(await notices(PERMISSION_ASK_TYPE)).toHaveLength(1);

        await storage.updateOwner('alice', { roles: ['owner', 'operator'] } as never);
        await sendPermissionAsk({ storage, config }, OWNER, worker, ['operator:admin']);
        expect(await notices(PERMISSION_ASK_TYPE)).toHaveLength(2);
    });

    it('a one-press word keeps its Allow button', async () => {
        await sendPermissionAsk({ storage, config }, OWNER, agent('worker'), ['messages:send']);
        const told = await notices(PERMISSION_ASK_TYPE);
        expect(told[0].i18n?.key).toBe(PERMISSION_ASK_TYPE);
        expect((told[0].actions ?? []).some(a => a.kind === 'api')).toBe(true);
    });
});
