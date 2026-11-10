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
 *   v1.2.0 — 2026-11-10 — What the push says: the recipient's language from `i18n`, the sender's name
 *     from `from`, both taken off the wire, and the buttons translated.
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
        markPushSubscriptionDelivered: vi.fn(async (ownerName: string, endpoint: string, at: string) => {
            const row = subscriptions.get(rowKey(ownerName, endpoint));
            if (row) subscriptions.set(rowKey(ownerName, endpoint), { ...row, lastUsedAt: at });
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
        // The account's language, which display-prefs.ts reads: alice reads Finnish, bob has none.
        getGHIIByOwner: vi.fn(async (owner: string) => (owner === 'alice' ? { locale: 'fi' } : null)),
    } as unknown as Storage & {
        subscriptions: Map<string, PushSubscriptionRecord>;
        organisms: Map<string, OrganismRecord>;
    };
}

function makeSubscription(
    ownerName: string,
    endpoint = `https://push.example.com/${ownerName}`,
    appId: string | null = null,
): PushSubscriptionRecord {
    return {
        ownerName,
        endpoint,
        keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        appId,
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

        it('an app notifies the devices of its own installed copy, and only those', async () => {
            // An installed app is its own origin, so what arrives there wears the app's name and
            // icon rather than the node's. On iOS that is the ONLY way it ever does, because Safari
            // ignores the icon inside the payload. Sending to the node's devices as well would
            // notify the person twice for one event.
            const nodeDevice = 'https://push.example.com/node';
            const appDevice = 'https://push.example.com/kalle-app';
            const otherApp = 'https://push.example.com/someone-else';
            storage.subscriptions.set(rowKey('alice', nodeDevice), makeSubscription('alice', nodeDevice, null));
            storage.subscriptions.set(rowKey('alice', appDevice), makeSubscription('alice', appDevice, 'alice/brain.html'));
            storage.subscriptions.set(rowKey('alice', otherApp), makeSubscription('alice', otherApp, 'alice/other.html'));
            const sent = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({} as never);

            const service = createPushService(ENABLED_CONFIG, storage);
            expect(await service.sendNotification('alice', testPayload, 'alice/brain.html')).toBe(true);

            expect(sent.mock.calls.map(c => (c[0] as { endpoint: string }).endpoint)).toEqual([appDevice]);
        });

        it('an app with no installed copy reaches the node\'s devices instead', async () => {
            // Choosing not to install anything must not cost the person the notification.
            const nodeDevice = 'https://push.example.com/node';
            const otherApp = 'https://push.example.com/someone-else';
            storage.subscriptions.set(rowKey('alice', nodeDevice), makeSubscription('alice', nodeDevice, null));
            storage.subscriptions.set(rowKey('alice', otherApp), makeSubscription('alice', otherApp, 'alice/other.html'));
            const sent = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({} as never);

            const service = createPushService(ENABLED_CONFIG, storage);
            expect(await service.sendNotification('alice', testPayload, 'alice/brain.html')).toBe(true);

            // The node's device, and NOT the other app's: a notification from one app must never
            // arrive wearing a different app's face.
            expect(sent.mock.calls.map(c => (c[0] as { endpoint: string }).endpoint)).toEqual([nodeDevice]);
        });

        it('a notification from the node itself never lands in an app\'s stream', async () => {
            const nodeDevice = 'https://push.example.com/node';
            const appDevice = 'https://push.example.com/kalle-app';
            storage.subscriptions.set(rowKey('alice', nodeDevice), makeSubscription('alice', nodeDevice, null));
            storage.subscriptions.set(rowKey('alice', appDevice), makeSubscription('alice', appDevice, 'alice/brain.html'));
            const sent = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({} as never);

            const service = createPushService(ENABLED_CONFIG, storage);
            expect(await service.sendNotification('alice', testPayload)).toBe(true);

            expect(sent.mock.calls.map(c => (c[0] as { endpoint: string }).endpoint)).toEqual([nodeDevice]);
        });

        it('a delivery that could not be written down is still a delivery', async () => {
            // The notification arrived; stamping when this device last accepted one is bookkeeping.
            // With the write ahead of the count, a storage hiccup threw into the failure branch and a
            // delivered notification was counted and logged as failed, which is the same lie as the
            // one this whole change is fixing, pointing the other way.
            const endpoint = 'https://push.example.com/stamp-fails';
            storage.subscriptions.set(rowKey('alice', endpoint), makeSubscription('alice', endpoint));
            vi.spyOn(webpush, 'sendNotification').mockResolvedValue({} as never);
            (storage.markPushSubscriptionDelivered as unknown as ReturnType<typeof vi.fn>)
                .mockRejectedValueOnce(new Error('the database blinked'));

            const service = createPushService(ENABLED_CONFIG, storage);
            expect(await service.sendNotification('alice', testPayload)).toBe(true);
            // And the device is still registered: a bookkeeping failure is not a dead endpoint.
            expect((await storage.listPushSubscriptionsByOwner('alice')).map(s => s.endpoint)).toEqual([endpoint]);
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

    describe('what the push says (Chrome on Android reads it for spam)', () => {
        /** The JSON the device receives, from the one delivery the spy saw. */
        async function wireFor(owner: string, payload: PushPayload): Promise<Record<string, unknown>> {
            storage.subscriptions.set(rowKey(owner, `https://push.example.com/${owner}`), makeSubscription(owner));
            const sent = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({} as never);
            const service = createPushService(ENABLED_CONFIG, storage);
            expect(await service.sendNotification(owner, payload)).toBe(true);
            // The last delivery: a second call in one test reuses the same spy.
            return JSON.parse(sent.mock.calls.at(-1)![1] as string) as Record<string, unknown>;
        }

        it('is written in the recipient\'s language, its variables filled', async () => {
            const wire = await wireFor('alice', {
                title: 'Workflow "Weekly report" stopped at step fetch', body: 'Open the workflow to see why.',
                i18n: { title: { key: 'workflow_step_failed.title', vars: { name: 'Weekly report', step: 'fetch' } }, body: { key: 'workflow_step_failed.body' } },
            });
            expect(wire.title).toBe('Työnkulku "Weekly report" pysähtyi askeleeseen fetch');
            expect(wire.body).toBe('Avaa työnkulku, niin näet syyn.');
        });

        it('takes the node-only fields off before it leaves', async () => {
            const wire = await wireFor('alice', { title: 't', body: 'b', i18n: { title: { key: 'push_test.title' } }, from: 'Recipes' });
            expect(wire).not.toHaveProperty('i18n');
            expect(wire).not.toHaveProperty('from');
        });

        it('falls back to the English it was given when no language has the key, or the account has no language', async () => {
            expect((await wireFor('alice', { title: 'Plain words', body: 'b', i18n: { title: { key: 'no_such_notice.title' } } })).title).toBe('Plain words');
            expect((await wireFor('bob', { title: 'x', body: 'b', i18n: { title: { key: 'push_test.title' } } })).title).toBe('AIMEAT: test notification');
        });

        it('names its sender before a title that does not say who it is from', async () => {
            expect((await wireFor('bob', { title: 'Your soup is ready', body: '', from: 'Recipes' })).title).toBe('Recipes: Your soup is ready');
        });

        it('does not name the sender twice', async () => {
            expect((await wireFor('bob', { title: 'Recipes: Your soup is ready', body: '', from: 'Recipes' })).title).toBe('Recipes: Your soup is ready');
        });

        it('says its buttons in the recipient\'s language', async () => {
            const wire = await wireFor('alice', {
                title: 't', body: 'b',
                actions: [{ action: 'a1', title: 'Run as me', i18n: { key: 'workflow_run_refused.run_as_me' } }, { action: 'a2', title: 'Keep' }],
            });
            expect(wire.actions).toEqual([{ action: 'a1', title: 'Aja itse' }, { action: 'a2', title: 'Keep' }]);
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
