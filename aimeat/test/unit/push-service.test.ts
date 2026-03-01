import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPushService } from '../../src/services/push.js';
import type { PushService, PushPayload } from '../../src/services/push.js';
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

function makeMockStorage() {
    const subscriptions = new Map<string, PushSubscriptionRecord>();
    const organisms = new Map<string, OrganismRecord>();

    return {
        subscriptions,
        organisms,
        createPushSubscription: vi.fn(async (record: PushSubscriptionRecord) => {
            subscriptions.set(record.ownerName, record);
            return record;
        }),
        getPushSubscription: vi.fn(async (ownerName: string) => subscriptions.get(ownerName) ?? null),
        deletePushSubscription: vi.fn(async (ownerName: string) => subscriptions.delete(ownerName)),
        listPushSubscriptions: vi.fn(async () => [...subscriptions.values()]),
        getOrganism: vi.fn(async (id: string) => organisms.get(id) ?? null),
    } as unknown as Storage & {
        subscriptions: Map<string, PushSubscriptionRecord>;
        organisms: Map<string, OrganismRecord>;
    };
}

function makeSubscription(ownerName: string): PushSubscriptionRecord {
    return {
        ownerName,
        endpoint: `https://push.example.com/${ownerName}`,
        keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
    };
}

const testPayload: PushPayload = {
    title: 'Test Notification',
    body: 'This is a test notification',
};

// ── Tests ────────────────────────────────────────────────────

describe('Push Service', () => {
    let storage: ReturnType<typeof makeMockStorage>;

    beforeEach(() => {
        storage = makeMockStorage();
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
            const config = makeConfig();
            const service = createPushService(config, storage);
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
    });

    describe('unsubscribe', () => {
        it('removes subscription from storage', async () => {
            const config = makeConfig();
            const service = createPushService(config, storage);
            // First subscribe
            await service.subscribe('alice', {
                endpoint: 'https://push.example.com/alice',
                keys: { p256dh: 'key', auth: 'auth' },
            });
            // Then unsubscribe
            await service.unsubscribe('alice');
            expect(storage.deletePushSubscription).toHaveBeenCalledWith('alice');
        });
    });

    describe('sendNotification', () => {
        it('returns false when no subscription exists', async () => {
            // Service is disabled (no VAPID keys), so sendNotification returns false
            const config = makeConfig();
            const service = createPushService(config, storage);
            const result = await service.sendNotification('nonexistent', testPayload);
            expect(result).toBe(false);
        });

        it('returns false when service is disabled (no webpush)', async () => {
            const config = makeConfig();
            const service = createPushService(config, storage);
            // Even if subscription exists in storage, webpush is null so returns false
            storage.subscriptions.set('alice', makeSubscription('alice'));
            const result = await service.sendNotification('alice', testPayload);
            expect(result).toBe(false);
        });
    });

    describe('broadcastToOrganism', () => {
        it('returns 0 when organism does not exist', async () => {
            const config = makeConfig();
            const service = createPushService(config, storage);
            const result = await service.broadcastToOrganism('nonexistent', testPayload);
            expect(result).toBe(0);
            expect(storage.getOrganism).toHaveBeenCalledWith('nonexistent');
        });

        it('attempts to send to all organism members', async () => {
            const config = makeConfig();
            const service = createPushService(config, storage);
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
