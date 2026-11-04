/**
 * @file onboarding-funnel-rescue.test.ts
 * @description Unit tests for the MCP onboarding rescue pass (UX-remake v3, P3). The job's whole
 *   contract is WHO it emails: only accounts created after the feature epoch, older than a day and
 *   younger than a week, with a VERIFIED email, no MCP session marker and no prior rescue — and it
 *   marks even a failed send so a bouncing address never becomes a retry loop. Storage and the
 *   email service are stubbed; the E2E suites cover the marker-writing half of the funnel.
 * @version-history
 *   v1.1.0 — 2026-11-04 — The verified fixture carries the flag and the hash the code-confirm paths
 *     write with level 1; an address that changed, an unproven address at level 3 and an address the
 *     hash does not name get no mail (codebase analysis 2026-11-03, item A9).
 *   v1.0.0 — 2026-08-07 — Initial.
 */
import { createHash } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import {
    runMcpOnboardingRescueJob,
    FIRST_MCP_CALL_KEY,
    MCP_RESCUE_SENT_KEY,
} from '../../src/services/onboarding-funnel.js';
import { setActiveEmailService, type EmailService } from '../../src/services/email.js';

const NODE = 'aimeat-test-node';
const config = { nodeId: NODE, baseUrl: 'https://test.example' } as any;

// Frozen clock: the job takes { now, epoch } as a test seam, so nothing here depends on when
// the suite runs (the real epoch is a ship-date constant that would make young accounts
// ineligible on the very day the feature lands).
const NOW = Date.parse('2026-09-01T12:00:00Z');
const EPOCH = Date.parse('2026-08-07T00:00:00Z');
const runJob = (storage: any) => runMcpOnboardingRescueJob(config, storage, { now: NOW, epoch: EPOCH });

const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const hashOf = (a: string) => createHash('sha256').update(a.toLowerCase().trim()).digest('hex');

function ghii(username: string, over: Record<string, unknown> = {}) {
    const rec = {
        username,
        ownerName: username,
        ghii: `${username}@${NODE}`,
        nodeId: NODE,
        displayName: username,
        verificationLevel: 1,
        notificationEmail: `${username}@example.com`,
        locale: 'en',
        totpEnabled: false,
        createdAt: hoursAgo(30), // inside the 24h..7d window
        updatedAt: hoursAgo(30),
        ...over,
    } as any;
    // A verified account as the code-confirm paths write it (routes/ghii/web-verify.ts, recovery.ts,
    // services/owner-provisioning.ts): level 1, the flag and the address's hash land together. A case
    // that names the flag itself describes a record those paths did not write whole.
    if (rec.verificationLevel >= 1 && typeof rec.notificationEmail === 'string' && !('emailVerifiedAt' in over)) {
        rec.emailVerifiedAt = hoursAgo(30);
        rec.emailHash = hashOf(rec.notificationEmail);
    }
    return rec;
}

function makeStorage(ghiis: any[], memory: Record<string, Record<string, unknown>> = {}) {
    const mem: Record<string, Record<string, any>> = {};
    for (const [gaii, keys] of Object.entries(memory)) {
        mem[gaii] = {};
        for (const [k, v] of Object.entries(keys)) mem[gaii][k] = { key: k, ownerGaii: gaii, value: v };
    }
    return {
        writes: [] as any[],
        async listGHIIs() { return ghiis; },
        async getMemory(gaii: string, key: string) { return mem[gaii]?.[key] ?? null; },
        async setMemory(rec: any) {
            (mem[rec.ownerGaii] ??= {})[rec.key] = rec;
            this.writes.push(rec);
            return rec;
        },
        // The conditional writes every Storage has (required since 2026-11-04).
        async createMemoryIfAbsent(rec: any) {
            if (mem[rec.ownerGaii]?.[rec.key]) return null;
            return this.setMemory(rec);
        },
        async setMemoryIfVersion(rec: any, v: number) {
            if (mem[rec.ownerGaii]?.[rec.key]?.version !== v) return null;
            return this.setMemory(rec);
        },
    } as any;
}

function makeEmail(results: boolean[] = []): EmailService & { sent: Array<{ to: string; subject: string }> } {
    const sent: Array<{ to: string; subject: string }> = [];
    let i = 0;
    const svc = {
        enabled: true,
        sent,
        sendRaw: async (to: string, subject: string) => { sent.push({ to, subject }); return results[i++] ?? true; },
    } as any;
    // Everything else on the interface is unused by the job; a call would throw, which is the test failing loudly.
    return svc;
}

describe('runMcpOnboardingRescueJob — who gets the one email', () => {
    afterEach(() => setActiveEmailService(null as any));

    it('emails an eligible silent account once, and marks it sent', async () => {
        const email = makeEmail();
        setActiveEmailService(email);
        const storage = makeStorage([ghii('alice')]);
        await runJob(storage);
        expect(email.sent).toHaveLength(1);
        expect(email.sent[0].to).toBe('alice@example.com');
        expect(storage.writes.some((w: any) => w.key === MCP_RESCUE_SENT_KEY)).toBe(true);

        // Second pass: the marker written above must stop a repeat.
        await runJob(storage);
        expect(email.sent).toHaveLength(1);
    });

    it('localizes by the account locale', async () => {
        const email = makeEmail();
        setActiveEmailService(email);
        const storage = makeStorage([ghii('liisa', { locale: 'fi' })]);
        await runJob(storage);
        expect(email.sent[0].subject).toContain('kytketty');
    });

    it('skips: connected accounts, unverified emails, uxtest accounts, pre-epoch and out-of-window ages', async () => {
        const email = makeEmail();
        setActiveEmailService(email);
        const connected = ghii('connected');
        const storage = makeStorage([
            connected,
            ghii('unverified', { verificationLevel: 0 }),
            ghii('noemail', { notificationEmail: undefined }),
            ghii('uxtest-heidi-20260806'),
            ghii('ancient', { createdAt: new Date(EPOCH - 86_400_000).toISOString() }),
            ghii('toofresh', { createdAt: hoursAgo(2) }),
            ghii('toold', { createdAt: hoursAgo(24 * 8) }),
        ], { [connected.ghii]: { [FIRST_MCP_CALL_KEY]: { at: 'x' } } });
        await runJob(storage);
        expect(email.sent).toHaveLength(0);
    });

    // Codebase analysis 2026-11-03, item A9: a change of address clears the flag and leaves the
    // account's level, so the level does not say the address the account names now is proven.
    it('skips: an address that changed after the account was verified, and an address the hash does not name', async () => {
        const email = makeEmail();
        setActiveEmailService(email);
        const storage = makeStorage([
            ghii('changed', { notificationEmail: 'someone-else@example.com', emailVerifiedAt: null }),
            ghii('banked', { verificationLevel: 3, emailVerifiedAt: null }),
            ghii('stale', { notificationEmail: 'someone-else@example.com', emailVerifiedAt: hoursAgo(30), emailHash: hashOf('stale@example.com') }),
        ]);
        await runJob(storage);
        expect(email.sent).toHaveLength(0);
    });

    it('marks a FAILED send as sent too, so a bouncing address never loops', async () => {
        const email = makeEmail([false]);
        setActiveEmailService(email);
        const storage = makeStorage([ghii('bouncy')]);
        await runJob(storage);
        expect(email.sent).toHaveLength(1);
        const marker = storage.writes.find((w: any) => w.key === MCP_RESCUE_SENT_KEY);
        expect(marker.value.delivered).toBe(false);

        await runJob(storage);
        expect(email.sent).toHaveLength(1);
    });

    it('does nothing when the email service is disabled', async () => {
        setActiveEmailService({ enabled: false } as any);
        const storage = makeStorage([ghii('alice')]);
        await runJob(storage);
        expect(storage.writes).toHaveLength(0);
    });
});
