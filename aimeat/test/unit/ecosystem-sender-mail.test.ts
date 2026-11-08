/**
 * @file test/unit/ecosystem-sender-mail.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An outside app (GEAI, role `ecosystem`) as the sender of what reaches its owner
 *   (secaudit2026nov08 round 14):
 *   - notification-create:ecosystem-sender-labelled-as-owner: the app's notification and mail name
 *     the app (source kind `ecosystem`, the app's name before the title, its own sender key), so the
 *     owner tells it apart and mutes it on its own; the owner's own notice stays the owner's.
 *   - ecosystem-automation-notify:automation-report-mail-uncounted-unmuted: the automation report
 *     mail goes through mailOwnerFrom under the app's sender key: the per-sender daily limit
 *     (email.reports_per_sender_day), the Email page's mail log, and the owner's mute of that app.
 *   The uses that stay: the app's notification still lands and is mailed; one report mail per
 *   completion under the limit, and the in-app automation.reports record on every completion.
 * @usage pnpm exec vitest run test/unit/ecosystem-sender-mail.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, AgentTaskRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { createPrincipalNotification } from '../../src/services/notification-create.js';
import { notifyAutomationTaskComplete } from '../../src/services/ecosystem-automation-notify.js';
import { updateNotificationSettings, readMailLog } from '../../src/services/notification-settings.js';
import { setActiveEmailService } from '../../src/services/email.js';

const NODE = 'aimeat-test-001';
const OWNER = `alice@${NODE}`;
const ADDRESS = 'alice@example.test';
let storage: Storage;
let sendNotification: ReturnType<typeof vi.fn>;
let n = 0;

const cfg = (perDay?: number) => ({ nodeId: NODE, baseUrl: 'https://node.test', smtpReplyTo: null, ...(perDay !== undefined ? { emailReportsPerSenderDay: perDay } : {}) }) as unknown as AimeatConfig;

async function owner(): Promise<void> {
    const at = new Date().toISOString();
    await storage.createOwner({ name: 'alice', displayName: 'alice', publicKey: 'pk', roles: ['owner'], createdAt: at } as never);
    await storage.createGHII({
        username: 'alice', nodeId: NODE, ghii: OWNER, displayName: 'alice', verificationLevel: 1, ownerName: 'alice',
        totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: at, updatedAt: at,
        notificationEmail: ADDRESS, emailVerifiedAt: at, locale: 'en',
    } as never);
}

/** A connected outside app with a fresh name per case, so one case's daily count never reaches another. */
async function outsideApp(scopes: string[] = ['notifications:send']): Promise<{ app: string; geai: string }> {
    n++;
    const app = `helpdesk${n}x${Math.random().toString(36).slice(2, 6)}`;
    const geai = `eco:${app}#alice@${NODE}`;
    const at = new Date().toISOString();
    await storage.createEcosystemApp({
        app, owner: 'alice', geai, displayName: `Help Desk ${n}`, publicKey: 'pk', scopes, status: 'active',
        morselBalance: 0, createdAt: at, lastSeen: at,
    } as never);
    return { app, geai };
}

function automationTask(app: string): AgentTaskRecord {
    const at = new Date().toISOString();
    return {
        id: `task-${Math.random().toString(36).slice(2, 10)}`, agentGaii: `triage#alice@${NODE}`, ownerGaii: OWNER, title: 'Triage',
        description: '', rules: [], verification: { userExpects: '', technicalChecks: [] }, todos: [], scope: [],
        status: 'done', createdAt: at, updatedAt: at, completedAt: at,
        automation: { app, recipeId: `r-${app}`, email: true },
    } as unknown as AgentTaskRecord;
}

async function bell(): Promise<Array<{ title: string; type: string; source?: { kind: string; id?: string; name?: string } }>> {
    const { items } = await storage.listAllMemory({ prefix: 'notif.' });
    return items.filter(i => i.ownerGaii === OWNER).map(i => i.value as { title: string; type: string; source?: { kind: string; id?: string; name?: string } });
}

async function reports(app: string): Promise<Array<{ emailed: boolean; emailSkipped?: string }>> {
    const { items } = await storage.listAllMemory({ prefix: `automation.reports.r-${app}.` });
    return items.map(i => i.value as { emailed: boolean; emailSkipped?: string });
}

beforeEach(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    sendNotification = vi.fn(async () => true);
    setActiveEmailService({ enabled: true, sendNotification, sendRaw: vi.fn(async () => true), sendWithAttachments: vi.fn(async () => true) } as never);
    await owner();
});

afterEach(() => { setActiveEmailService({ enabled: false } as never); vi.restoreAllMocks(); });

describe('an outside app notifying its owner is named as the sender', () => {
    it('the notification names the app, not the owner, and the mail counts under the app', async () => {
        const { geai } = await outsideApp();
        const auth = { owner: 'alice', sub: geai, roles: ['ecosystem'] };
        const r = await createPrincipalNotification(storage, cfg(), auth, { title: 'Ticket closed', email: true });
        expect(r.created).toBe(true);
        expect(r.emailed).toBe('sent');
        const [row] = await bell();
        expect(row.source?.kind).toBe('ecosystem');
        expect(row.source?.id).toBe(geai);
        expect(row.title.startsWith('Help Desk')).toBe(true);
        expect(row.title.endsWith(': Ticket closed')).toBe(true);
    });

    it('the owner mutes the app on its own; their own notices still reach them', async () => {
        const { geai } = await outsideApp();
        await updateNotificationSettings(storage, OWNER, cur => ({ ...cur, senders: { ...cur.senders, [`ecosystem:${geai}`]: { muted: true } } }));
        const r = await createPrincipalNotification(storage, cfg(), { owner: 'alice', sub: geai, roles: ['ecosystem'] }, { title: 'Ticket closed', email: true });
        expect(r.muted).toBe(true);
        expect(r.emailed).toBe('muted');
        expect(sendNotification).not.toHaveBeenCalled();
        const mine = await createPrincipalNotification(storage, cfg(), { owner: 'alice', sub: 'alice', roles: ['owner'] }, { title: 'Note to self' });
        expect(mine.created).toBe(true);
        const rows = await bell();
        expect(rows).toHaveLength(1);
        expect(rows[0].source?.kind).toBe('owner');
        expect(rows[0].title).toBe('Note to self');
    });
});

describe('the automation report mail goes through the per-sender gate', () => {
    it('five completions under perDay 2 send two mails, log two, and every completion keeps its record', async () => {
        const { app } = await outsideApp([]);
        for (let i = 0; i < 5; i++) await notifyAutomationTaskComplete(storage, cfg(2), automationTask(app), `Done ${i}.`);
        expect(sendNotification).toHaveBeenCalledTimes(2);
        const log = await readMailLog(storage, OWNER);
        expect(log).toHaveLength(2);
        const recs = await reports(app);
        expect(recs).toHaveLength(5);
        expect(recs.filter(r => r.emailed)).toHaveLength(2);
        expect(recs.filter(r => r.emailSkipped === 'limit')).toHaveLength(3);
    });

    it('the owner\'s mute of the outside app stops the report mail, and the record says so', async () => {
        const { app, geai } = await outsideApp([]);
        await updateNotificationSettings(storage, OWNER, cur => ({ ...cur, senders: { ...cur.senders, [`ecosystem:${geai}`]: { muted: true } } }));
        await notifyAutomationTaskComplete(storage, cfg(), automationTask(app), 'Done.');
        expect(sendNotification).not.toHaveBeenCalled();
        const [rec] = await reports(app);
        expect(rec.emailed).toBe(false);
        expect(rec.emailSkipped).toBe('muted');
    });

    it('usage: one completion sends one report mail to the proven address and marks its record', async () => {
        const { app } = await outsideApp([]);
        await notifyAutomationTaskComplete(storage, cfg(), automationTask(app), 'Done.');
        expect(sendNotification).toHaveBeenCalledTimes(1);
        expect(sendNotification.mock.calls[0][0]).toBe(ADDRESS);
        expect(String(sendNotification.mock.calls[0][1])).toContain(app);
        const [rec] = await reports(app);
        expect(rec.emailed).toBe(true);
    });
});
