import { describe, it, expect, vi, afterEach } from 'vitest';
import { startMatchNotificationJob } from '../../src/services/match-notification.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { EmailService } from '../../src/services/email.js';
import type { DirectoryService } from '../../src/services/directory.js';

// Minimal mock config
function makeConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
    return {
        matchNotificationEnabled: true,
        matchNotificationIntervalHours: 24,
        ...overrides,
    } as AimeatConfig;
}

function makeEmailService(enabled: boolean): EmailService {
    return {
        enabled,
        sendVerificationCode: vi.fn().mockResolvedValue(true),
        sendMagicLink: vi.fn().mockResolvedValue(true),
        sendNotification: vi.fn().mockResolvedValue(true),
        sendMatchSuggestion: vi.fn().mockResolvedValue(true),
    };
}

function makeMockStorage(): Storage {
    return {} as unknown as Storage;
}

function makeMockDirectory(): DirectoryService {
    return {
        rebuildIndex: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue({ entries: [], total: 0, facets: { cities: [], interests: [] } }),
        getStats: vi.fn().mockReturnValue({ totalPeople: 0, topInterests: [], topCities: [], updatedAt: new Date().toISOString() }),
    } as unknown as DirectoryService;
}

describe('startMatchNotificationJob', () => {
    const timers: (NodeJS.Timeout | null)[] = [];

    afterEach(() => {
        // Clean up any active timers
        for (const timer of timers) {
            if (timer) clearInterval(timer);
        }
        timers.length = 0;
        vi.restoreAllMocks();
    });

    it('returns null when matchNotificationEnabled is false', () => {
        const config = makeConfig({ matchNotificationEnabled: false });
        const result = startMatchNotificationJob(
            config,
            makeMockStorage(),
            makeEmailService(true),
            makeMockDirectory(),
        );
        timers.push(result);
        expect(result).toBeNull();
    });

    it('returns null when email service is disabled', () => {
        const config = makeConfig({ matchNotificationEnabled: true });
        const result = startMatchNotificationJob(
            config,
            makeMockStorage(),
            makeEmailService(false),
            makeMockDirectory(),
        );
        timers.push(result);
        expect(result).toBeNull();
    });

    it('returns a timer when both notification and email are enabled', () => {
        // Use fake timers to prevent actual setTimeout/setInterval execution
        vi.useFakeTimers();

        const config = makeConfig({
            matchNotificationEnabled: true,
            matchNotificationIntervalHours: 1,
        });
        const result = startMatchNotificationJob(
            config,
            makeMockStorage(),
            makeEmailService(true),
            makeMockDirectory(),
        );
        timers.push(result);

        expect(result).not.toBeNull();

        vi.useRealTimers();
    });

    it('returns null when disabled even if email is enabled', () => {
        const config = makeConfig({ matchNotificationEnabled: false });
        const result = startMatchNotificationJob(
            config,
            makeMockStorage(),
            makeEmailService(true),
            makeMockDirectory(),
        );
        timers.push(result);
        expect(result).toBeNull();
    });

    it('returns null when enabled but email is disabled', () => {
        const config = makeConfig({ matchNotificationEnabled: true });
        const result = startMatchNotificationJob(
            config,
            makeMockStorage(),
            makeEmailService(false),
            makeMockDirectory(),
        );
        timers.push(result);
        expect(result).toBeNull();
    });

    it('schedules initial run via setTimeout when enabled', () => {
        vi.useFakeTimers();
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

        const config = makeConfig({
            matchNotificationEnabled: true,
            matchNotificationIntervalHours: 12,
        });
        const result = startMatchNotificationJob(
            config,
            makeMockStorage(),
            makeEmailService(true),
            makeMockDirectory(),
        );
        timers.push(result);

        // Should have scheduled a setTimeout for the initial delayed run (30s)
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);

        vi.useRealTimers();
    });
});
