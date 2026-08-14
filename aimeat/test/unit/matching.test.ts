import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { createMatchingEngine, startMatchingScheduler } from '../../src/services/matching.js';
import type { ProfileData, MatchingEngine } from '../../src/services/matching.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { DirectoryService } from '../../src/services/directory.js';
import type { EmailService } from '../../src/services/email.js';

// ── Helpers ──────────────────────────────────────────────────

function makeConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
    return {
        nodeId: 'test-node-001',
        matchingEnabled: true,
        matchIntervalHours: 24,
        matchThreshold: 0.5,
        matchMaxSuggestions: 5,
        matchMaxDistanceKm: 100,
        matchCooldownDays: 7,
        ...overrides,
    } as AimeatConfig;
}

function makeMockStorage(): Storage {
    return {
        listMatchesByProfile: vi.fn().mockResolvedValue([]),
    } as unknown as Storage;
}

function makeMockDirectory(): DirectoryService {
    return {
        rebuildIndex: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue({ entries: [], total: 0, facets: { cities: [], interests: [] } }),
        getStats: vi.fn().mockReturnValue({ totalPeople: 0, topInterests: [], topCities: [], updatedAt: new Date().toISOString() }),
    } as unknown as DirectoryService;
}

function makeMockEmailService(enabled = false): EmailService {
    return {
        enabled,
        sendVerificationCode: vi.fn().mockResolvedValue(true),
        sendMagicLink: vi.fn().mockResolvedValue(true),
        sendNotification: vi.fn().mockResolvedValue(true),
        sendMatchSuggestion: vi.fn().mockResolvedValue(true),
    };
}

function makeProfile(overrides: Partial<ProfileData> = {}): ProfileData {
    return {
        ghii: 'user@test-node-001',
        displayName: 'Test User',
        interests: [],
        ...overrides,
    };
}

// ── Tests ────────────────────────────────────────────────────

describe('Matching Engine — calculateMatchScore', () => {
    let engine: MatchingEngine;

    const config = makeConfig();
    const storage = makeMockStorage();
    const directory = makeMockDirectory();
    const email = makeMockEmailService();

    beforeAll(() => {
        engine = createMatchingEngine(config, storage, directory, email);
    });

    it('3 shared interests, 2km distance → score > 0.7', () => {
        const profileA = makeProfile({
            ghii: 'alice@node',
            interests: ['TypeScript', 'AI', 'Music'],
            lat: 60.1699,
            lon: 24.9384,
            lastActivityAt: new Date().toISOString(),
        });
        const profileB = makeProfile({
            ghii: 'bob@node',
            interests: ['TypeScript', 'AI', 'Music', 'Art'],
            lat: 60.1750,
            lon: 24.9500,
            lastActivityAt: new Date().toISOString(),
        });

        const result = engine.calculateMatchScore(profileA, profileB, 100);

        expect(result.score).toBeGreaterThan(0.7);
        expect(result.breakdown.sharedInterests).toHaveLength(3);
        expect(result.breakdown.sharedInterestsScore).toBe(1.0);
        expect(result.breakdown.distanceKm).toBeLessThan(5);
    });

    it('0 shared interests → score < 0.3', () => {
        const profileA = makeProfile({
            ghii: 'alice@node',
            interests: ['TypeScript', 'AI'],
            seeking: ['Cooking', 'Dance'],
            lastActivityAt: new Date(Date.now() - 80 * 86_400_000).toISOString(),
        });
        const profileB = makeProfile({
            ghii: 'bob@node',
            interests: ['Music', 'Art'],
            lastActivityAt: new Date(Date.now() - 80 * 86_400_000).toISOString(),
        });

        const result = engine.calculateMatchScore(profileA, profileB, 100);

        // sharedInterests=0, seeking no overlap=0, 80 days inactive ≈ 0.111, distance default 0.5
        // total ≈ 0.40*0 + 0.25*0.5 + 0.20*0.111 + 0.15*0 = 0.147
        expect(result.score).toBeLessThan(0.3);
        expect(result.breakdown.sharedInterests).toHaveLength(0);
        expect(result.breakdown.sharedInterestsScore).toBe(0);
    });

    it('distance > maxDistanceKm → distanceScore = 0', () => {
        // Helsinki to Tampere ≈ 180km
        const profileA = makeProfile({
            ghii: 'alice@node',
            interests: ['AI'],
            lat: 60.1699,
            lon: 24.9384,
        });
        const profileB = makeProfile({
            ghii: 'bob@node',
            interests: ['AI'],
            lat: 61.4978,
            lon: 23.7610,
        });

        // maxDistanceKm = 50 → distance ≈ 180km → score = max(1 - 180/50, 0) = 0
        const result = engine.calculateMatchScore(profileA, profileB, 50);

        expect(result.breakdown.distanceScore).toBe(0);
        expect(result.breakdown.distanceKm).toBeGreaterThan(50);
    });

    it('active user (1 day) vs inactive (100 days) → activity score difference', () => {
        const baseProfile = makeProfile({
            ghii: 'alice@node',
            interests: ['AI'],
        });

        const activeProfile = makeProfile({
            ghii: 'bob-active@node',
            interests: ['AI'],
            lastActivityAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
        });

        const inactiveProfile = makeProfile({
            ghii: 'bob-inactive@node',
            interests: ['AI'],
            lastActivityAt: new Date(Date.now() - 100 * 86_400_000).toISOString(),
        });

        const activeResult = engine.calculateMatchScore(baseProfile, activeProfile, 100);
        const inactiveResult = engine.calculateMatchScore(baseProfile, inactiveProfile, 100);

        expect(activeResult.breakdown.activityScore).toBeGreaterThan(inactiveResult.breakdown.activityScore);
        // Active: max(1.0 - 1/90, 0) ≈ 0.989
        expect(activeResult.breakdown.activityScore).toBeGreaterThan(0.9);
        // Inactive: max(1.0 - 100/90, 0) = 0
        expect(inactiveResult.breakdown.activityScore).toBe(0);
    });

    it('seeking match: perfect match → compatibilityScore = 1.0', () => {
        const profileA = makeProfile({
            ghii: 'alice@node',
            interests: ['AI', 'Music'],
            seeking: ['AI', 'Music'],
        });
        const profileB = makeProfile({
            ghii: 'bob@node',
            interests: ['AI', 'Music', 'Art'],
        });

        const result = engine.calculateMatchScore(profileA, profileB, 100);

        // seeking: ['AI', 'Music'], profileB interests include both → 2/2 = 1.0
        expect(result.breakdown.compatibilityScore).toBe(1.0);
    });

    it('seeking match: no overlap → compatibilityScore = 0', () => {
        const profileA = makeProfile({
            ghii: 'alice@node',
            interests: ['AI'],
            seeking: ['Cooking', 'Dance'],
        });
        const profileB = makeProfile({
            ghii: 'bob@node',
            interests: ['Music', 'Art'],
        });

        const result = engine.calculateMatchScore(profileA, profileB, 100);

        expect(result.breakdown.compatibilityScore).toBe(0);
    });

    it('no seeking data → compatibilityScore defaults to 0.5', () => {
        const profileA = makeProfile({
            ghii: 'alice@node',
            interests: ['AI'],
            // No seeking field
        });
        const profileB = makeProfile({
            ghii: 'bob@node',
            interests: ['AI'],
        });

        const result = engine.calculateMatchScore(profileA, profileB, 100);

        expect(result.breakdown.compatibilityScore).toBe(0.5);
    });

    it('no location data → distanceScore defaults to 0.5', () => {
        const profileA = makeProfile({
            ghii: 'alice@node',
            interests: ['AI'],
            // No lat/lon
        });
        const profileB = makeProfile({
            ghii: 'bob@node',
            interests: ['AI'],
            // No lat/lon
        });

        const result = engine.calculateMatchScore(profileA, profileB, 100);

        expect(result.breakdown.distanceScore).toBe(0.5);
        expect(result.breakdown.distanceKm).toBeNull();
    });

    it('known inputs → verify exact score breakdown', () => {
        // 2 shared interests → sharedInterestsScore = min(2/3, 1.0) = 0.667
        // 10km distance, maxDistance=100 → distanceScore = max(1.0 - 10/100, 0) = 0.9
        // 10 days active → activityScore = max(1.0 - 10/90, 0) ≈ 0.889
        // no seeking → compatibilityScore = 0.5
        // total = 0.40*0.667 + 0.25*0.9 + 0.20*0.889 + 0.15*0.5
        //       = 0.2668 + 0.225 + 0.1778 + 0.075
        //       = 0.7446 → rounded to 0.745
        const profileA = makeProfile({
            ghii: 'alice@node',
            interests: ['TypeScript', 'AI', 'Art'],
            lat: 60.1699,
            lon: 24.9384,
        });
        const profileB = makeProfile({
            ghii: 'bob@node',
            interests: ['TypeScript', 'AI', 'Music'],
            lat: 60.2055,
            lon: 24.8100,
            lastActivityAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
        });

        const result = engine.calculateMatchScore(profileA, profileB, 100);

        // Verify breakdown fields exist and are reasonable
        expect(result.breakdown.sharedInterests).toEqual(['TypeScript', 'AI']);
        expect(result.breakdown.sharedInterestsScore).toBeCloseTo(0.667, 2);
        expect(result.breakdown.distanceScore).toBeGreaterThan(0.8);
        expect(result.breakdown.activityScore).toBeCloseTo(0.889, 1);
        expect(result.breakdown.compatibilityScore).toBe(0.5);

        // Overall score should match weighted sum
        const expected =
            0.40 * result.breakdown.sharedInterestsScore +
            0.25 * result.breakdown.distanceScore +
            0.20 * result.breakdown.activityScore +
            0.15 * result.breakdown.compatibilityScore;
        expect(result.score).toBeCloseTo(expected, 2);
    });

    it('case-insensitive interest matching', () => {
        const profileA = makeProfile({
            ghii: 'alice@node',
            interests: ['typescript', 'AI'],
        });
        const profileB = makeProfile({
            ghii: 'bob@node',
            interests: ['TypeScript', 'ai'],
        });

        const result = engine.calculateMatchScore(profileA, profileB, 100);

        expect(result.breakdown.sharedInterests).toHaveLength(2);
    });

    it('threshold filtering: score < 0.5 should be below default threshold', () => {
        // Create profiles with no shared interests, no location, inactive
        const profileA = makeProfile({
            ghii: 'alice@node',
            interests: ['TypeScript'],
            seeking: ['Music'],
        });
        const profileB = makeProfile({
            ghii: 'bob@node',
            interests: ['Art'],
            lastActivityAt: new Date(Date.now() - 100 * 86_400_000).toISOString(),
        });

        const result = engine.calculateMatchScore(profileA, profileB, 100);

        // With 0 shared interests, 0 activity, 0 compatibility, 0.5 distance default:
        // 0.40*0 + 0.25*0.5 + 0.20*0 + 0.15*0 = 0.125
        expect(result.score).toBeLessThan(0.5);
    });
});

describe('startMatchingScheduler', () => {
    const timers: (NodeJS.Timeout | null)[] = [];

    afterEach(() => {
        for (const timer of timers) {
            if (timer) clearInterval(timer);
        }
        timers.length = 0;
        vi.restoreAllMocks();
    });

    it('returns null when matchingEnabled is false', () => {
        const config = makeConfig({ matchingEnabled: false });
        const engine: MatchingEngine = {
            runMatchingRound: vi.fn().mockResolvedValue({
                profilesScanned: 0,
                matchesCreated: 0,
                durationMs: 0,
                timestamp: new Date().toISOString(),
            }),
            calculateMatchScore: vi.fn(),
            getSuggestionsForProfile: vi.fn(),
        };

        const result = startMatchingScheduler(config, engine);
        timers.push(result);

        expect(result).toBeNull();
    });

    it('returns timer when enabled', () => {
        vi.useFakeTimers();

        const config = makeConfig({
            matchingEnabled: true,
            matchIntervalHours: 1,
        });
        const engine: MatchingEngine = {
            runMatchingRound: vi.fn().mockResolvedValue({
                profilesScanned: 0,
                matchesCreated: 0,
                durationMs: 0,
                timestamp: new Date().toISOString(),
            }),
            calculateMatchScore: vi.fn(),
            getSuggestionsForProfile: vi.fn(),
        };

        const result = startMatchingScheduler(config, engine);
        timers.push(result);

        expect(result).not.toBeNull();

        vi.useRealTimers();
    });
});
