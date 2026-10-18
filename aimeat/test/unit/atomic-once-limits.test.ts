/**
 * @file test/unit/atomic-once-limits.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two operations at the same moment on the once-only markers, the limits and the logs
 *   that check:atomic-writes listed (group G4 of the atomic-write fixes, 2026-10-18): each test fires
 *   them together (Promise.all) against a real storage of both providers, and asserts what holds when
 *   the write is made on the version that was read.
 *
 *   HOW A TEST CAN FAIL. The storage answers its reads a few milliseconds late (slow-reads.ts), so two
 *   calls in flight both read before either writes, which is what two node processes on one database
 *   do. A module that orders its own calls in-process (a promise chain, serialByKey) is imported twice
 *   with vi.resetModules, so the two calls run through two chains, as in two processes.
 *
 *   Runs on SQLite in memory, and on PostgreSQL too when DATABASE_URL is set (names carry a run tag).
 * @usage cd aimeat && pnpm exec vitest run test/unit/atomic-once-limits.test.ts
 * @version-history
 *   2026-10-18 — Initial (atomic-write fixes, group G4).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { slowReads } from './slow-reads.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig } from '../../src/config.js';
import { mintLinkInvite, consumeLinkInvite } from '../../src/services/link-invites.js';
import { reportPeerIncident } from '../../src/services/peer-incidents.js';
import { NS_PEER_ORIGIN } from '../../src/services/peer-origin.js';
import { SECURITY_INCIDENT_PREFIX, securityOwner } from '../../src/services/security-incident.js';
import { firstNoticeFor } from '../../src/services/packages/compose/package-notices.js';
import { appendInboundEcosystemLog } from '../../src/services/ecosystem-events.js';
import { appendMailLog, readMailLog, MAIL_LOG_KEY } from '../../src/services/notification-settings.js';
import { writeMarkerOnce, recordAiModelDetected, recordWelcomeMatPasted, ONBOARDING_KEYS } from '../../src/services/onboarding-funnel.js';
import { putOwnerProvider, PROVIDER_PREFIX } from '../../src/services/decide/providers.js';
import { pulseInstanceServer } from '../../src/services/living-pulse.js';

requirePostgresWhenAsked('atomic-once-limits');

// The modules that order their own calls in-process, twice: one copy per simulated node process.
const intakeA = await import('../../src/services/intake-daily-count.js');
const notifA = await import('../../src/services/notification-settings.js');
vi.resetModules();
const intakeB = await import('../../src/services/intake-daily-count.js');
const notifB = await import('../../src/services/notification-settings.js');

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])];
const providers = new Map<string, TestStorage>();
beforeAll(async () => {
    for (const name of names) providers.set(name, await createStorage({
        provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely',
        sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
    }) as TestStorage);
}, 60_000);
afterAll(async () => { for (const s of providers.values()) await s.close(); });

const { config: baseConfig } = loadConfig({});

describe.each(names)('%s: two at the same moment', provider => {
    const real = () => providers.get(provider)!;
    const slow = () => slowReads(real()).storage;
    const tag = () => randomUUID().slice(0, 8);

    it('consumeLinkInvite: of two introductions with one token, one is admitted', async () => {
        const { token } = await mintLinkInvite(real(), { tier: 'contact', createdBy: `op-${tag()}@n` });
        const s = slow();
        const out = await Promise.all([consumeLinkInvite(s, token, `node-a-${tag()}`), consumeLinkInvite(s, token, `node-b-${tag()}`)]);
        expect(out.filter(r => r.ok)).toHaveLength(1);
        expect(out.find(r => !r.ok)).toMatchObject({ ok: false, reason: 'consumed' });
    });

    it('takeDailySlot: two processes taking the last slot, one gets it and the count is the limit', async () => {
        const node = `intake-${tag()}`;
        const form = { org: 'o', ws: 'w', formId: 'f' };
        const s = slow();
        const out = await Promise.all([intakeA.takeDailySlot(s, node, form, 1), intakeB.takeDailySlot(s, node, form, 1)]);
        expect(out.filter(Boolean)).toHaveLength(1);
        const rec = await real().getMemory(`system@${node}`, 'intake.count.o.w.f');
        expect((rec?.value as { n: number }).n).toBe(1);
    });

    it('releaseDailySlot: two processes giving back a slot each, both are given back', async () => {
        const node = `intake-${tag()}`;
        const form = { org: 'o', ws: 'w', formId: 'f' };
        await intakeA.takeDailySlot(real(), node, form, 5);
        await intakeA.takeDailySlot(real(), node, form, 5);
        const s = slow();
        await Promise.all([intakeA.releaseDailySlot(s, node, form), intakeB.releaseDailySlot(s, node, form)]);
        const rec = await real().getMemory(`system@${node}`, 'intake.count.o.w.f');
        expect((rec?.value as { n: number }).n).toBe(0);
    });

    it('reportPeerIncident: two identical events record one incident', async () => {
        const here = `here-${tag()}`;
        const peer = `peer-${tag()}`;
        const e = { kind: 'id-held' as const, nodeId: peer, presented: { key: `k-${tag()}` }, other: { key: 'held' }, via: 'introduce', actor: peer };
        const s = slow();
        await Promise.all([reportPeerIncident(s, here, e), reportPeerIncident(s, here, e)]);
        const incidents = await real().listMemory(securityOwner(here), { prefix: SECURITY_INCIDENT_PREFIX });
        expect(incidents).toHaveLength(1);
    });

    it('reportPeerIncident: a burst of new keys for one node id stays within its bound', async () => {
        const here = `here-${tag()}`;
        const peer = `peer-${tag()}`;
        const s = slow();
        await Promise.all(Array.from({ length: 8 }, (_, i) => reportPeerIncident(s, here, {
            kind: 'id-held', nodeId: peer, presented: { key: `k${i}-${tag()}` }, other: { key: 'held' }, via: 'introduce', actor: peer,
        })));
        const incidents = await real().listMemory(securityOwner(here), { prefix: SECURITY_INCIDENT_PREFIX });
        expect(incidents.length).toBeLessThanOrEqual(5);
        const markers = await real().listMemory(NS_PEER_ORIGIN, { prefix: `incident.${peer}.` });
        expect(markers.length).toBe(incidents.length);
        for (const m of markers) await real().deleteMemory(NS_PEER_ORIGIN, m.key);
    });

    it('firstNoticeFor: two callers for one version, one is told first', async () => {
        const id = `inst-${tag()}`;
        const s = slow();
        const out = await Promise.all([firstNoticeFor(s, id, '1.2.0'), firstNoticeFor(s, id, '1.2.0')]);
        expect(out.filter(Boolean)).toHaveLength(1);
    });

    it('appendInboundEcosystemLog: two events at once both stay in the log', async () => {
        const geai = `eco:app-${tag()}#alice@n`;
        const s = slow();
        const at = new Date().toISOString();
        await Promise.all([
            appendInboundEcosystemLog(s, geai, { event: 'a', version: 1, timestamp: at, data: {} }),
            appendInboundEcosystemLog(s, geai, { event: 'b', version: 1, timestamp: at, data: {} }),
        ]);
        const rec = await real().getMemory(geai, 'ecosystem.inbound.log');
        expect((rec?.value as Array<{ event: string }>).map(e => e.event).sort()).toEqual(['a', 'b']);
    });

    it('appendMailLog: two emails at once both stay in the log', async () => {
        const owner = `mail-${tag()}@n`;
        const s = slow();
        await Promise.all([appendMailLog(s, owner, { kind: 'digest', subject: 'one' }), appendMailLog(s, owner, { kind: 'nudge', subject: 'two' })]);
        expect((await readMailLog(real(), owner)).map(e => e.subject).sort()).toEqual(['one', 'two']);
        expect((await real().getMemory(owner, MAIL_LOG_KEY))?.tags).toEqual(['notifications']);
    });

    it('updateNotificationSettings: two processes changing two fields, both changes persist', async () => {
        const owner = `notif-${tag()}@n`;
        const s = slow();
        const digestAt = new Date().toISOString();
        await Promise.all([
            notifA.updateNotificationSettings(s, owner, cur => ({ ...cur, lastDigestAt: digestAt })),
            notifB.updateNotificationSettings(s, owner, cur => ({ ...cur, throttleMinutes: 30 })),
        ]);
        const stored = await notifA.readNotificationSettingsStrict(real(), owner);
        expect(stored.lastDigestAt).toBe(digestAt);
        expect(stored.throttleMinutes).toBe(30);
    });

    it('writeMarkerOnce: of two writers, one is answered true', async () => {
        const owner = `onb-${tag()}@n`;
        const s = slow();
        const out = await Promise.all([writeMarkerOnce(s, owner, 'onboarding.x', { at: 1 }), writeMarkerOnce(s, owner, 'onboarding.x', { at: 2 })]);
        expect(out.filter(Boolean)).toHaveLength(1);
    });

    it("recordAiModelDetected: the person's answer is not replaced by a page reading written at the same moment", async () => {
        const nodeId = `onb-${tag()}`;
        const config = { ...baseConfig, nodeId };
        const s = slow();
        await Promise.all([
            recordAiModelDetected(s, config, 'alice', { model: 'm', vendor: 'v', client: 'claude', mcp: 'yes', source: 'asked' }),
            recordAiModelDetected(s, config, 'alice', { model: 'm', vendor: 'v', client: 'chatgpt', mcp: 'no', source: 'meta' }),
        ]);
        const rec = await real().getMemory(`alice@${nodeId}`, ONBOARDING_KEYS.aiModelDetected);
        expect((rec?.value as { source: string }).source).toBe('asked');
    });

    it('recordWelcomeMatPasted: two pastes at once count two attempts', async () => {
        const nodeId = `onb-${tag()}`;
        const config = { ...baseConfig, nodeId };
        const s = slow();
        const out = await Promise.all([recordWelcomeMatPasted(s, config, 'alice', 'failed'), recordWelcomeMatPasted(s, config, 'alice', 'failed')]);
        expect(out.map(o => o.attempts).sort()).toEqual([1, 2]);
        const rec = await real().getMemory(`alice@${nodeId}`, ONBOARDING_KEYS.welcomeMatPasted);
        expect((rec?.value as { attempts: number }).attempts).toBe(2);
    });

    // The bound is counted after each claim, so two adds that claim at the same moment past the limit
    // can both be refused; what may never happen is more stored than the limit.
    it('putOwnerProvider: new providers added at once past the limit, no more than the limit is stored', async () => {
        const owner = `dec-${tag()}@n`;
        const body = { title: 'Local', kind: 'local', url: 'http://127.0.0.1:9/v1', model: 'tiny', auth: { type: 'none' } };
        for (let i = 0; i < 19; i++) await putOwnerProvider(real(), baseConfig, owner, `p${i}`, body);
        const s = slow();
        const out = await Promise.allSettled(['extra-a', 'extra-b', 'extra-c'].map(id => putOwnerProvider(s, baseConfig, owner, id, body)));
        expect(out.filter(r => r.status === 'fulfilled').length).toBeLessThanOrEqual(1);
        for (const r of out) if (r.status === 'rejected') expect((r.reason as { code?: string }).code).toBe('TOO_MANY_PROVIDERS');
        const stored = await real().listMemoryMeta(owner, { prefix: PROVIDER_PREFIX });
        expect(stored.length).toBe(19 + out.filter(r => r.status === 'fulfilled').length);
        // One add on its own still lands on the last free place.
        if (stored.length === 19) await putOwnerProvider(real(), baseConfig, owner, 'extra-d', body);
        expect(await real().listMemoryMeta(owner, { prefix: PROVIDER_PREFIX })).toHaveLength(20);
    });

    it('pulseInstanceServer: two pulses of one agent section dispatch one task', async () => {
        const nodeId = `pulse-${tag()}`;
        const config = { ...baseConfig, nodeId };
        const { storage: s, counts } = slowReads(real());
        const loc = { orgId: `org-${tag()}`, wsId: 'ws1', docId: 'doc1' };
        const cfg = { title: 'Doc', template: [{ slot: 's1', section: 'News', agent: 'helper/offer1' }] };
        await Promise.all([
            pulseInstanceServer(s, config, `alice@${nodeId}`, loc, cfg),
            pulseInstanceServer(s, config, `alice@${nodeId}`, loc, cfg),
        ]);
        expect(counts.get('createAgentTask') ?? 0).toBe(1);
    });
});
