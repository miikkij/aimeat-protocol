import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { DirectoryService } from '../../src/services/directory.js';
import type { AimeatConfig } from '../../src/config.js';

// Minimal config sufficient for DirectoryService
const testConfig = {
    nodeId: 'test-node-001',
} as AimeatConfig;

// Helper to seed a complete user with GHII, owner, agent, consent, and memory
async function seedUser(
    storage: SqliteStorage,
    opts: {
        username: string;
        displayName: string;
        interests?: string[];
        city?: string;
        area?: string;
        country?: string;
        lat?: number;
        lon?: number;
        bio?: string;
    },
) {
    const ghii = `${opts.username}@test-node-001`;
    const ownerName = opts.username;
    const agentGaii = `agent-${opts.username}#${ownerName}@test-node-001`;

    await storage.createOwner({
        name: ownerName,
        publicKey: 'dGVzdA==',
        roles: ['owner'],
        createdAt: new Date().toISOString(),
    });

    await storage.createAgent({
        name: `agent-${opts.username}`,
        owner: ownerName,
        gaii: agentGaii,
        capabilities: [],
        publicKey: 'dGVzdA==',
        trustScore: 50,
        morselBalance: 100,
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
    });

    await storage.createGHII({
        username: opts.username,
        nodeId: 'test-node-001',
        ghii,
        displayName: opts.displayName,
        bio: opts.bio,
        verificationLevel: 1,
        ownerName,
        totpEnabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });

    // Grant federation consent
    await storage.createConsent({
        id: `consent-${opts.username}`,
        ownerGaii: agentGaii,
        dataPattern: '*',
        recipient: '*',
        purpose: 'discovery',
        scope: 'federation',
        expires: null,
        status: 'active',
        grantedAt: new Date().toISOString(),
        revokedAt: null,
    });

    // Store interests in memory
    if (opts.interests && opts.interests.length > 0) {
        await storage.setMemory({
            key: `profile.${opts.username}.interests`,
            ownerGaii: agentGaii,
            value: opts.interests,
            visibility: 'public',
            tags: [],
            ttlHours: null,
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
    }

    // Store location in memory
    if (opts.city || opts.country) {
        await storage.setMemory({
            key: `profile.${opts.username}.location`,
            ownerGaii: agentGaii,
            value: {
                city: opts.city,
                area: opts.area,
                country: opts.country,
                lat: opts.lat,
                lon: opts.lon,
            },
            visibility: 'public',
            tags: [],
            ttlHours: null,
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
    }

    return { ghii, agentGaii, ownerName };
}

describe('DirectoryService', () => {
    let storage: SqliteStorage;
    let directory: DirectoryService;

    beforeEach(() => {
        storage = new SqliteStorage(':memory:');
        directory = new DirectoryService(testConfig, storage);
    });

    it('returns empty results when no users exist', async () => {
        await directory.rebuildIndex();
        const result = await directory.search({});
        expect(result.entries).toHaveLength(0);
        expect(result.total).toBe(0);
    });

    it('indexes a user with federation consent', async () => {
        await seedUser(storage, {
            username: 'alice',
            displayName: 'Alice',
            interests: ['TypeScript', 'AI'],
            city: 'Helsinki',
            country: 'FI',
        });

        await directory.rebuildIndex();
        const result = await directory.search({});

        expect(result.total).toBe(1);
        expect(result.entries[0].ghii).toBe('alice@test-node-001');
        expect(result.entries[0].displayName).toBe('Alice');
        expect(result.entries[0].interests).toEqual(['TypeScript', 'AI']);
        expect(result.entries[0].city).toBe('Helsinki');
    });

    it('skips users without federation consent', async () => {
        // Create user without consent
        await storage.createOwner({
            name: 'bob',
            publicKey: 'dGVzdA==',
            roles: ['owner'],
            createdAt: new Date().toISOString(),
        });
        await storage.createAgent({
            name: 'agent-bob',
            owner: 'bob',
            gaii: 'agent-bob#bob@test-node-001',
            capabilities: [],
            publicKey: 'dGVzdA==',
            trustScore: 50,
            morselBalance: 100,
            createdAt: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
        });
        await storage.createGHII({
            username: 'bob',
            nodeId: 'test-node-001',
            ghii: 'bob@test-node-001',
            displayName: 'Bob',
            verificationLevel: 1,
            ownerName: 'bob',
            totpEnabled: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        await directory.rebuildIndex();
        const result = await directory.search({});
        expect(result.total).toBe(0);
    });

    it('filters by city (case-insensitive)', async () => {
        await seedUser(storage, {
            username: 'alice',
            displayName: 'Alice',
            interests: ['AI'],
            city: 'Helsinki',
            country: 'FI',
        });
        await seedUser(storage, {
            username: 'bob',
            displayName: 'Bob',
            interests: ['Music'],
            city: 'Tampere',
            country: 'FI',
        });

        await directory.rebuildIndex();
        const result = await directory.search({ city: 'helsinki' });

        expect(result.total).toBe(1);
        expect(result.entries[0].ghii).toBe('alice@test-node-001');
    });

    it('filters by interest (case-insensitive)', async () => {
        await seedUser(storage, {
            username: 'alice',
            displayName: 'Alice',
            interests: ['TypeScript', 'AI'],
            city: 'Helsinki',
        });
        await seedUser(storage, {
            username: 'bob',
            displayName: 'Bob',
            interests: ['Music', 'Art'],
            city: 'Tampere',
        });

        await directory.rebuildIndex();
        const result = await directory.search({ interest: 'ai' });

        expect(result.total).toBe(1);
        expect(result.entries[0].ghii).toBe('alice@test-node-001');
    });

    it('filters by multiple interests (match ANY)', async () => {
        await seedUser(storage, {
            username: 'alice',
            displayName: 'Alice',
            interests: ['TypeScript', 'AI'],
        });
        await seedUser(storage, {
            username: 'bob',
            displayName: 'Bob',
            interests: ['Music', 'Art'],
        });
        await seedUser(storage, {
            username: 'carol',
            displayName: 'Carol',
            interests: ['AI', 'Music'],
        });

        await directory.rebuildIndex();
        const result = await directory.search({ interests: ['Music', 'TypeScript'] });

        expect(result.total).toBe(3);
    });

    it('filters by country', async () => {
        await seedUser(storage, {
            username: 'alice',
            displayName: 'Alice',
            interests: ['AI'],
            country: 'FI',
        });
        await seedUser(storage, {
            username: 'bob',
            displayName: 'Bob',
            interests: ['AI'],
            country: 'SE',
        });

        await directory.rebuildIndex();
        const result = await directory.search({ country: 'FI' });

        expect(result.total).toBe(1);
        expect(result.entries[0].ghii).toBe('alice@test-node-001');
    });

    it('filters by geo radius', async () => {
        // Helsinki: 60.1699, 24.9384
        // Espoo: 60.2055, 24.6559 (~15km from Helsinki)
        // Tampere: 61.4978, 23.7610 (~180km from Helsinki)
        await seedUser(storage, {
            username: 'alice',
            displayName: 'Alice',
            interests: ['AI'],
            city: 'Helsinki',
            lat: 60.1699,
            lon: 24.9384,
        });
        await seedUser(storage, {
            username: 'bob',
            displayName: 'Bob',
            interests: ['AI'],
            city: 'Espoo',
            lat: 60.2055,
            lon: 24.6559,
        });
        await seedUser(storage, {
            username: 'carol',
            displayName: 'Carol',
            interests: ['AI'],
            city: 'Tampere',
            lat: 61.4978,
            lon: 23.7610,
        });

        await directory.rebuildIndex();
        const result = await directory.search({
            lat: 60.1699,
            lon: 24.9384,
            radiusKm: 50,
        });

        // Helsinki and Espoo should be within 50km; Tampere should not
        expect(result.total).toBe(2);
        const ghiis = result.entries.map(e => e.ghii);
        expect(ghiis).toContain('alice@test-node-001');
        expect(ghiis).toContain('bob@test-node-001');
        expect(ghiis).not.toContain('carol@test-node-001');
    });

    it('paginates results', async () => {
        // Create 5 users
        for (let i = 1; i <= 5; i++) {
            await seedUser(storage, {
                username: `user${i}`,
                displayName: `User ${i}`,
                interests: ['AI'],
            });
        }

        await directory.rebuildIndex();

        const page1 = await directory.search({ page: 1, perPage: 2 });
        expect(page1.entries).toHaveLength(2);
        expect(page1.total).toBe(5);

        const page2 = await directory.search({ page: 2, perPage: 2 });
        expect(page2.entries).toHaveLength(2);

        const page3 = await directory.search({ page: 3, perPage: 2 });
        expect(page3.entries).toHaveLength(1);
    });

    it('builds facets for cities and interests', async () => {
        await seedUser(storage, {
            username: 'alice',
            displayName: 'Alice',
            interests: ['AI', 'TypeScript'],
            city: 'Helsinki',
        });
        await seedUser(storage, {
            username: 'bob',
            displayName: 'Bob',
            interests: ['AI', 'Music'],
            city: 'Helsinki',
        });
        await seedUser(storage, {
            username: 'carol',
            displayName: 'Carol',
            interests: ['Art'],
            city: 'Tampere',
        });

        await directory.rebuildIndex();
        const result = await directory.search({});

        expect(result.facets.cities).toEqual(
            expect.arrayContaining([
                { name: 'Helsinki', count: 2 },
                { name: 'Tampere', count: 1 },
            ]),
        );

        const aiFacet = result.facets.interests.find(i => i.name === 'AI');
        expect(aiFacet).toEqual({ name: 'AI', count: 2 });
    });

    it('adds semantic annotation with schema.org Person type', async () => {
        await seedUser(storage, {
            username: 'alice',
            displayName: 'Alice',
            interests: ['AI'],
            city: 'Helsinki',
            area: 'Uusimaa',
            country: 'FI',
        });

        await directory.rebuildIndex();
        const result = await directory.search({});

        const entry = result.entries[0];
        expect(entry.semantic).toBeDefined();
        expect(entry.semantic!['@type']).toBe('schema:Person');
        expect(entry.semantic!['schema:knowsAbout']).toEqual(['AI']);

        const location = entry.semantic!['schema:homeLocation'] as Record<string, unknown>;
        expect(location['@type']).toBe('schema:Place');
        const address = location['schema:address'] as Record<string, unknown>;
        expect(address['schema:addressLocality']).toBe('Helsinki');
        expect(address['schema:addressRegion']).toBe('Uusimaa');
        expect(address['schema:addressCountry']).toBe('FI');
    });

    it('getStats returns correct statistics', async () => {
        await seedUser(storage, {
            username: 'alice',
            displayName: 'Alice',
            interests: ['AI', 'TypeScript'],
            city: 'Helsinki',
        });
        await seedUser(storage, {
            username: 'bob',
            displayName: 'Bob',
            interests: ['AI'],
            city: 'Tampere',
        });

        await directory.rebuildIndex();
        const stats = directory.getStats();

        expect(stats.totalPeople).toBe(2);
        expect(stats.topInterests[0].name).toBe('AI');
        expect(stats.topInterests[0].count).toBe(2);
        expect(stats.topCities).toHaveLength(2);
        expect(stats.updatedAt).toBeDefined();
    });

    it('geo filter excludes entries without coordinates', async () => {
        await seedUser(storage, {
            username: 'alice',
            displayName: 'Alice',
            interests: ['AI'],
            city: 'Helsinki',
            // No lat/lon
        });

        await directory.rebuildIndex();
        const result = await directory.search({
            lat: 60.1699,
            lon: 24.9384,
            radiusKm: 1000,
        });

        expect(result.total).toBe(0);
    });
});
