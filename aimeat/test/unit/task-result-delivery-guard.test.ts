/**
 * @file test/unit/task-result-delivery-guard.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's delivery of a scheduled task's result (services/task-result-delivery.ts) and
 *   the other node mails that carry a principal's words to an owner (secaudit2026nov02d round 13,
 *   delivery group):
 *   - the delivery is decided by the schedule's own record, not by a `deliver` entry in the task's
 *     scope, which the task's agent may write (DELIVERY_SCOPE:client-supplied-task-scope);
 *   - the bell entry is the agent's, so the owner's mute of that agent holds, and the mail counts
 *     against the agent's daily limit (email.reports_per_sender_day);
 *   - mail goes only to a verified notification address (deliverTaskResult:unverified-notification-email,
 *     and its siblings in ecosystem-automation-notify.ts, living-pulse.ts notifyStop and
 *     compliance-agreements-notify.ts).
 *   The uses that stay: a delivering schedule's result reaches the bell under the node's heading and
 *   the verified address once; the automation report, the retirement notice and the agreement step
 *   still reach a verified address.
 * @usage pnpm exec vitest run test/unit/task-result-delivery-guard.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (secaudit2026nov02d round 13).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, AgentTaskRecord, ScheduledJobRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { deliverTaskResult } from '../../src/services/task-result-delivery.js';
import { createPrincipalNotification } from '../../src/services/notification-create.js';
import { notifyAutomationTaskComplete } from '../../src/services/ecosystem-automation-notify.js';
import { pulseInstanceServer } from '../../src/services/living-pulse.js';
import { tellAgreement } from '../../src/services/compliance-agreements-notify.js';
import { updateNotificationSettings } from '../../src/services/notification-settings.js';
import { setActiveEmailService } from '../../src/services/email.js';

const NODE = 'aimeat-test-001';
const OWNER = `alice@${NODE}`;
const ADDRESS = 'alice@example.test';
const config = { nodeId: NODE, baseUrl: 'https://node.test', smtpReplyTo: null } as unknown as AimeatConfig;
let storage: Storage;
let sendNotification: ReturnType<typeof vi.fn>;
let n = 0;

async function owner(verified: boolean): Promise<void> {
    const at = new Date().toISOString();
    await storage.createOwner({ name: 'alice', displayName: 'alice', publicKey: 'pk', roles: ['owner'], createdAt: at } as never);
    await storage.createGHII({
        username: 'alice', nodeId: NODE, ghii: OWNER, displayName: 'alice', verificationLevel: 1, ownerName: 'alice',
        totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: at, updatedAt: at,
        notificationEmail: ADDRESS, emailVerifiedAt: verified ? at : null, locale: 'en',
    } as never);
}

/** A fresh agent name per case, so the per-sender daily count of one case never reaches another. */
function agentGaii(): string { n++; return `digest${n}#alice@${NODE}`; }

async function schedule(agent: string, deliver: 'owner' | undefined): Promise<ScheduledJobRecord> {
    const at = new Date().toISOString();
    const job = {
        id: `job-${agent.split('#')[0]}`, name: 'digest', type: 'agent_task', cron: '0 7 * * *', enabled: true,
        input: { taskTemplate: { title: 'Digest', ...(deliver ? { deliver } : {}) } },
        createdBy: OWNER, createdAt: at, updatedAt: at, ownerScope: OWNER, agentGaii: agent, agentName: agent.split('#')[0],
        timezone: 'Europe/Helsinki',
    } as unknown as ScheduledJobRecord;
    return storage.createScheduledJob(job);
}

function task(agent: string, over: Partial<AgentTaskRecord> = {}): AgentTaskRecord {
    const at = new Date().toISOString();
    return {
        id: `task-${Math.random().toString(36).slice(2, 10)}`, agentGaii: agent, ownerGaii: OWNER, title: 'Digest',
        description: '', rules: [], verification: { userExpects: '', technicalChecks: [] }, todos: [],
        scope: [{ name: 'deliver', value: 'owner', type: 'text', description: 'The node sends this task\'s result to its owner when it is done (Europe/Helsinki).' }],
        status: 'done', createdAt: at, updatedAt: at, completedAt: at, ...over,
    } as AgentTaskRecord;
}

async function bell(): Promise<Array<{ title: string; body: string; source?: { kind: string; id?: string } }>> {
    const { items } = await storage.listAllMemory({ prefix: 'notif.' });
    return items.filter(i => i.ownerGaii === OWNER).map(i => i.value as { title: string; body: string; source?: { kind: string; id?: string } });
}

beforeEach(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    sendNotification = vi.fn(async () => true);
    setActiveEmailService({ enabled: true, sendNotification, sendRaw: vi.fn(async () => true), sendWithAttachments: vi.fn(async () => true) } as never);
});

afterEach(() => { setActiveEmailService({ enabled: false } as never); vi.restoreAllMocks(); });

describe('who decides that the node delivers a task result', () => {
    it('a deliver entry in a task the agent made for itself delivers nothing', async () => {
        await owner(true);
        const agent = agentGaii();
        await deliverTaskResult(storage, config, task(agent, { createdBy: agent }), 'Agent-written text');
        expect(await bell()).toHaveLength(0);
        expect(sendNotification).not.toHaveBeenCalled();
    });

    it('a deliver entry the agent put on a scheduled task whose schedule does not deliver delivers nothing', async () => {
        await owner(true);
        const agent = agentGaii();
        const job = await schedule(agent, undefined);
        await deliverTaskResult(storage, config, task(agent, { parentTaskId: job.id }), 'Agent-written text');
        expect(await bell()).toHaveLength(0);
        expect(sendNotification).not.toHaveBeenCalled();
    });

    it('usage: a delivering schedule\'s task reaches the bell under the node\'s heading and the verified address once', async () => {
        await owner(true);
        const agent = agentGaii();
        const job = await schedule(agent, 'owner');
        await deliverTaskResult(storage, config, task(agent, { parentTaskId: job.id }), '**Digest**\n\nFirst item.');
        const rows = await bell();
        expect(rows).toHaveLength(1);
        expect(rows[0].title.startsWith('Digest – ')).toBe(true);
        expect(rows[0].body).toBe('First item.');
        expect(sendNotification).toHaveBeenCalledTimes(1);
        expect(sendNotification.mock.calls[0][0]).toBe(ADDRESS);
    });

    it('the delivered result is filed as the agent\'s, not as the node\'s own', async () => {
        await owner(true);
        const agent = agentGaii();
        const job = await schedule(agent, 'owner');
        await deliverTaskResult(storage, config, task(agent, { parentTaskId: job.id }), 'First item.');
        expect((await bell())[0]?.source).toMatchObject({ kind: 'agent', id: agent });
    });

    it('the owner\'s mute of the agent holds for its delivered result: no bell, no mail', async () => {
        await owner(true);
        const agent = agentGaii();
        const job = await schedule(agent, 'owner');
        await updateNotificationSettings(storage, OWNER, cur => ({ ...cur, senders: { ...cur.senders, [`agent:${agent}`]: { muted: true } } }));
        await deliverTaskResult(storage, config, task(agent, { parentTaskId: job.id }), 'First item.');
        expect(await bell()).toHaveLength(0);
        expect(sendNotification).not.toHaveBeenCalled();
    });

    it('the delivered result counts against the agent\'s daily mail limit, and 0 means no limit', async () => {
        await owner(true);
        const agent = agentGaii();
        const job = await schedule(agent, 'owner');
        const auth = { owner: 'alice', sub: agent, roles: ['agent'] };
        for (let i = 0; i < 10; i++) await createPrincipalNotification(storage, config, auth, { title: `Report ${i}`, email: true });
        expect(sendNotification).toHaveBeenCalledTimes(10);
        await deliverTaskResult(storage, config, task(agent, { parentTaskId: job.id }), 'First item.');
        expect(sendNotification).toHaveBeenCalledTimes(10);
        expect((await bell()).some(r => r.title.startsWith('Digest – '))).toBe(true);
        const open = { ...config, emailReportsPerSenderDay: 0 } as AimeatConfig;
        await deliverTaskResult(storage, open, task(agent, { parentTaskId: job.id }), 'First item.');
        expect(sendNotification).toHaveBeenCalledTimes(11);
    });
});

describe('mail goes only to a verified notification address', () => {
    it('the delivered result is not mailed to an unverified address, and the bell says where to confirm it', async () => {
        await owner(false);
        const agent = agentGaii();
        const job = await schedule(agent, 'owner');
        await deliverTaskResult(storage, config, task(agent, { parentTaskId: job.id }), 'First item.');
        expect(sendNotification).not.toHaveBeenCalled();
        const rows = await bell();
        expect(rows).toHaveLength(1);
        expect(rows[0].body.startsWith('First item.')).toBe(true);
        expect(rows[0].body).toContain('confirm your email address on the Email page');
    });

    const automationTask = () => task(agentGaii(), { scope: [], automation: { app: 'helpdesk', recipeId: 'r1', email: true } as never });

    it('the automation report is not mailed to an unverified address, and its record says so', async () => {
        await owner(false);
        await notifyAutomationTaskComplete(storage, config, automationTask(), 'Done.');
        expect(sendNotification).not.toHaveBeenCalled();
        const { items } = await storage.listAllMemory({ prefix: 'automation.reports.r1.' });
        expect((items[0]?.value as { emailSkipped?: string })?.emailSkipped).toBe('address_not_verified');
    });

    it('usage: the automation report is mailed to a verified address', async () => {
        await owner(true);
        await notifyAutomationTaskComplete(storage, config, automationTask(), 'Done.');
        expect(sendNotification).toHaveBeenCalledTimes(1);
        expect(sendNotification.mock.calls[0][0]).toBe(ADDRESS);
    });

    const retire = async () => {
        const email = { enabled: true, sendNotification: vi.fn(async () => true) };
        const cfg = { type: 'living-config', title: 'Weekly', charter: { stop: [{ max_pulses: 1 }] }, template: [], status: {} };
        const r = await pulseInstanceServer(storage, config, OWNER, { orgId: 'o1', wsId: 'ws-a', docId: 'd1' }, cfg, { email } as never);
        expect(r.retired).toBe(true);
        return email.sendNotification;
    };

    it('the retirement notice of a living document is not mailed to an unverified address', async () => {
        await owner(false);
        expect(await retire()).not.toHaveBeenCalled();
    });

    it('usage: the retirement notice is mailed to a verified address', async () => {
        await owner(true);
        const sent = await retire();
        expect(sent).toHaveBeenCalledTimes(1);
        expect(sent.mock.calls[0][0]).toBe(ADDRESS);
    });

    const agreement = (contactEmail?: string) => ({
        id: 'dpa-1', language: 'en', ourRole: 'processor', history: [],
        counterparty: { name: 'Alice Oy', account: OWNER, ...(contactEmail ? { contactEmail } : {}) },
        versions: [{ n: 1, status: 'sent', sentAt: new Date().toISOString(), annexes: { I: { processor: { name: 'Node Oy' }, controller: { name: 'Alice Oy' } }, IV: { subprocessors: [] } } }],
    }) as never;
    const mailRaw = () => { const sendRaw = vi.fn(async () => true); setActiveEmailService({ enabled: true, sendNotification, sendRaw } as never); return sendRaw; };

    it('an agreement step does not reach a counterparty account\'s unverified address', async () => {
        await owner(false);
        const sendRaw = mailRaw();
        const told = await tellAgreement({ storage, config }, agreement(), 'reminder');
        expect(told.counterpartyEmail).toBe(false);
        expect(sendRaw).not.toHaveBeenCalled();
    });

    it('usage: an agreement step reaches the contactEmail, and a counterparty account\'s verified address', async () => {
        await owner(false);
        const sendRaw = mailRaw();
        const byContact = await tellAgreement({ storage, config }, agreement('kaisa@example.test'), 'reminder');
        expect(byContact.counterpartyEmail).toBe(true);
        expect(sendRaw.mock.calls[0][0]).toBe('kaisa@example.test');
        await storage.updateGHII(OWNER, { emailVerifiedAt: new Date().toISOString() } as never);
        const byAccount = await tellAgreement({ storage, config }, agreement(), 'reminder');
        expect(byAccount.counterpartyEmail).toBe(true);
        expect(sendRaw.mock.calls[1][0]).toBe(ADDRESS);
    });
});
