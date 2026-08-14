/**
 * @file push-service.test.ts
 * @description The push service's contract, and since 2026-08-11 the part of audit H-8 that lives
 *   here: a subscription belongs to a DEVICE. The service used to read one subscription per owner
 *   and write over it, so a person's second browser silenced their first and one dead endpoint took
 *   the account's push down with it. These tests hold the fan-out and the per-endpoint pruning.
 * @structure
 *   - makeMockStorage(): subscriptions keyed (ownerName, endpoint), like both real providers
 *   - webpush: the shared web-push module, spied on so delivery is observed without a network
 *   - describes: disabled state · subscribe · unsubscribe · sendNotification · broadcastToOrganism
 * @usage cd aimeat && pnpm exec vitest run test/unit/push-service.test.ts
 * @version-history
 *   v1.1.0 — 2026-08-11 — Per-device subscriptions (audit H-8): fan-out, per-endpoint pruning on
 *     410, and the two-device case that used to collapse into one.
 *   v1.0.0 — 2026-04-15 — Initial push service tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { createPushService } from '../../src/services/push.js';
import type { PushPayload } from '../../src/services/push.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, PushSubscriptionRecord, OrganismRecord } from '../../src/storage/interface.js';

// ── Helpers ──────────────────────────────────────────────────

function makeConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
    return {
        nodeId: 'test-node-001',
        pushEnabled: true,
        vapidPublicKey: null,
        vapidPrivateKey: null,
        vapidSubject: 'mailto:admin@test.example',
        ...overrides,
    } as AimeatConfig;
}

/** The row key both real providers use. One person, many devices. */
const rowKey = (ownerName: string, endpoint: string) => `${ownerName} ${endpoint}`;

function makeMockStorage() {
    const subscriptions = new Map<string, PushSubscriptionRecord>();
    const organisms = new Map<string, OrganismRecord>();

    return {
        subscriptions,
        organisms,
        createPushSubscription: vi.fn(async (record: PushSubscriptionRecord) => {
            subscriptions.set(rowKey(record.ownerName, record.endpoint), record);
            return record;
        }),
        getPushSubscription: vi.fn(async (ownerName: string) =>
            [...subscriptions.values()].find(s => s.ownerName === ownerName) ?? null),
        listPushSubscriptionsByOwner: vi.fn(async (ownerName: string) =>
            [...subscriptions.values()].filter(s => s.ownerName === ownerName)),
        deletePushSubscription: vi.fn(async (ownerName: string, endpoint?: string) => {
            const doomed = [...subscriptions.values()]
                .filter(s => s.ownerName === ownerName && (endpoint === undefined || s.endpoint === endpoint));
            for (const s of doomed) subscriptions.delete(rowKey(s.ownerName, s.endpoint));
            return doomed.length > 0;
        }),
        listPushSubscriptions: vi.fn(async () => [...subscriptions.values()]),
        getOrganism: vi.fn(async (id: string) => organisms.get(id) ?? null),
    } as unknown as Storage & {
        subscriptions: Map<string, PushSubscriptionRecord>;
        organisms: Map<string, OrganismRecord>;
    };
}

function makeSubscription(ownerName: string, endpoint = `https://push.example.com/${ownerName}`): PushSubscriptionRecord {
    return {
        ownerName,
        endpoint,
        keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
    };
}

/**
 * The service loads web-push through createRequire, so it holds the same CJS module object this test
 * resolves. Spying on the module's exports is therefore the seam: no network, no VAPID key material,
 * and the real call path (including the statusCode branch) is exercised.
 */
const webpush = createRequire(import.meta.url)('web-push') as {
    setVapidDetails: (subject: string, pub: string, priv: string) => void;
    sendNotification: (sub: unknown, payload: string, opts: unknown) => Promise<unknown>;
};

/** A config whose VAPID keys are accepted because setVapidDetails is stubbed for the test. */
const ENABLED_CONFIG = makeConfig({ vapidPublicKey: 'test-public', vapidPrivateKey: 'test-private' });

const testPayload: PushPayload = {
    title: 'Test Notification',
    body: 'This is a test notification',
};

// ── Tests ────────────────────────────────────────────────────

describe('Push Service', () => {
    let storage: ReturnType<typeof makeMockStorage>;

    beforeEach(() => {
        storage = makeMockStorage();
        vi.spyOn(webpush, 'setVapidDetails').mockImplementation(() => { /* no key material in a unit test */ });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('createPushService — disabled state', () => {
        it('returns disabled when VAPID keys are not set', () => {
            const config = makeConfig({ pushEnabled: true, vapidPublicKey: null, vapidPrivateKey: null });
            const service = createPushService(config, storage);
            expect(service.enabled).toBe(false);
        });

        it('returns disabled when pushEnabled is false', () => {
            const config = makeConfig({ pushEnabled: false, vapidPublicKey: 'pk', vapidPrivateKey: 'sk' });
            const service = createPushService(config, storage);
            expect(service.enabled).toBe(false);
        });
    });

    describe('subscribe', () => {
        it('creates a PushSubscriptionRecord', async () => {
            const service = createPushService(makeConfig(), storage);
            const result = await service.subscribe('alice', {
                endpoint: 'https://push.example.com/alice',
                keys: { p256dh: 'test-key', auth: 'test-auth' },
            });
            expect(result.ownerName).toBe('alice');
            expect(result.endpoint).toBe('https://push.example.com/alice');
            expect(result.keys.p256dh).toBe('test-key');
            expect(result.createdAt).toBeTruthy();
            expect(storage.createPushSubscription).toHaveBeenCalledOnce();
        });

        it('a second device is added beside the first, not over it (H-8)', async () => {
            const service = createPushService(makeConfig(), storage);
            await service.subscribe('alice', { endpoint: 'https://push.example.com/laptop', keys: { p256dh: 'k1', auth: 'a1' } });
            await service.subscribe('alice', { endpoint: 'https://push.example.com/phone', keys: { p256dh: 'k2', auth: 'a2' } });

            const mine = await storage.listPushSubscriptionsByOwner('alice');
            expect(mine.map(s => s.endpoint).sort()).toEqual([
                'https://push.example.com/laptop',
                'https://push.example.com/phone',
            ]);
        });
    });

    describe('unsubscribe', () => {
        it('removes every device when no endpoint is named', async () => {
            const service = createPushService(makeConfig(), storage);
            await service.subscribe('alice', { endpoint: 'https://push.example.com/laptop', keys: { p256dh: 'k', auth: 'a' } });
            await service.subscribe('alice', { endpoint: 'https://push.example.com/phone', keys: { p256dh: 'k', auth: 'a' } });

            expect(await service.unsubscribe('alice')).toBe(true);
            expect(storage.deletePushSubscription).toHaveBeenCalledWith('alice', undefined);
            expect(await storage.listPushSubscriptionsByOwner('alice')).toHaveLength(0);
        });

        it('removes only the named device when one is given', async () => {
            const service = createPushService(makeConfig(), storage);
            await service.subscribe('alice', { endpoint: 'https://push.example.com/laptop', keys: { p256dh: 'k', auth: 'a' } });
            await service.subscribe('alice', { endpoint: 'https://push.example.com/phone', keys: { p256dh: 'k', auth: 'a' } });

            expect(await service.unsubscribe('alice', 'https://push.example.com/phone')).toBe(true);
            const left = await storage.listPushSubscriptionsByOwner('alice');
            expect(left.map(s => s.endpoint)).toEqual(['https://push.example.com/laptop']);
        });
    });

    describe('sendNotification', () => {
        it('returns false when no subscription exists', async () => {
            const service = createPushService(ENABLED_CONFIG, storage);
            const sent = vi.spyOn(webpush, 'sendNotification');
            expect(await service.sendNotification('nonexistent', testPayload)).toBe(false);
            expect(sent).not.toHaveBeenCalled();
        });

        it('returns false when the service is disabled (no webpush)', async () => {
            const service = createPushService(makeConfig(), storage);
            storage.subscriptions.set(rowKey('alice', 'https://push.example.com/alice'), makeSubscription('alice'));
            expect(await service.sendNotification('alice', testPayload)).toBe(false);
        });

        it('delivers to EVERY device the owner registered (H-8)', async () => {
            const endpoints = ['https://push.example.com/a', 'https://push.example.com/b', 'https://push.example.com/c'];
            for (const e of endpoints) storage.subscriptions.set(rowKey('alice', e), makeSubscription('alice', e));
            const sent = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({});

            const service = createPushService(ENABLED_CONFIG, storage);
            expect(await service.sendNotification('alice', testPayload)).toBe(true);

            expect(sent).toHaveBeenCalledTimes(3);
            const reached = sent.mock.calls.map(c => (c[0] as { endpoint: string }).endpoint);
            expect(reached.sort()).toEqual([...endpoints].sort());
        });

        it('a 410 prunes that one endpoint and leaves the working devices alone (H-8)', async () => {
            const dead = 'https://push.example.com/dead';
            const alive = 'https://push.example.com/alive';
            storage.subscriptions.set(rowKey('alice', dead), makeSubscription('alice', dead));
            storage.subscriptions.set(rowKey('alice', alive), makeSubscription('alice', alive));
            vi.spyOn(webpush, 'sendNotification').mockImplementation(async (sub) => {
                if ((sub as { endpoint: string }).endpoint === dead) throw Object.assign(new Error('gone'), { statusCode: 410 });
                return {};
            });

            const service = createPushService(ENABLED_CONFIG, storage);
            // One device took it, so the send counts as delivered.
            expect(await service.sendNotification('alice', testPayload)).toBe(true);

            const left = await storage.listPushSubscriptionsByOwner('alice');
            expect(left.map(s => s.endpoint)).toEqual([alive]);
        });

        it('an ordinary failure keeps the subscription and reports no delivery', async () => {
            const endpoint = 'https://push.example.com/flaky';
            storage.subscriptions.set(rowKey('alice', endpoint), makeSubscription('alice', endpoint));
            vi.spyOn(webpush, 'sendNotification').mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));

            const service = createPushService(ENABLED_CONFIG, storage);
            expect(await service.sendNotification('alice', testPayload)).toBe(false);
            expect(await storage.listPushSubscriptionsByOwner('alice')).toHaveLength(1);
        });

        it('one owner\'s devices are never reached by another owner\'s notification', async () => {
            storage.subscriptions.set(rowKey('alice', 'https://push.example.com/alice'), makeSubscription('alice'));
            storage.subscriptions.set(rowKey('bob', 'https://push.example.com/bob'), makeSubscription('bob'));
            const sent = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({});

            const service = createPushService(ENABLED_CONFIG, storage);
            await service.sendNotification('alice', testPayload);

            expect(sent).toHaveBeenCalledTimes(1);
            expect((sent.mock.calls[0][0] as { endpoint: string }).endpoint).toBe('https://push.example.com/alice');
        });
    });

    describe('broadcastToOrganism', () => {
        it('returns 0 when organism does not exist', async () => {
            const service = createPushService(makeConfig(), storage);
            const result = await service.broadcastToOrganism('nonexistent', testPayload);
            expect(result).toBe(0);
            expect(storage.getOrganism).toHaveBeenCalledWith('nonexistent');
        });

        it('attempts to send to all organism members', async () => {
            const service = createPushService(makeConfig(), storage);
            // Create a mock organism with members
            storage.organisms.set('org-1', {
                id: 'org-1',
                name: 'Test Org',
                description: 'A test org',
                type: 'community',
                interests: [],
                creatorGhii: 'alice@test-node-001',
                admins: ['alice@test-node-001'],
                members: ['alice@test-node-001', 'bob@test-node-001'],
                agentGaiis: [],
                boardId: 'board-1',
                joinPolicy: 'open',
                maxMembers: 100,
                visibility: 'public',
                moderationConfig: { flagsEnabled: true, autoHideThreshold: 5, appealsEnabled: false },
                memoryNamespace: 'organism.test',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            // Service is disabled, so all sendNotification calls return false -> sent = 0
            const result = await service.broadcastToOrganism('org-1', testPayload);
            expect(result).toBe(0);
        });
    });
});
