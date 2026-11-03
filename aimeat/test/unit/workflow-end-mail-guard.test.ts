/**
 * @file test/unit/workflow-end-mail-guard.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The workflow-end mail (services/workflow/engine-steps.ts onRunFinished) goes through the
 *   one path for a mail that carries a principal's words to the owner (notification-create.ts
 *   mailOwnerFrom): only to a proven address (services/owner-mail-address.ts provenOwnerAddress), and
 *   within the per-sender daily limit (email.reports_per_sender_day). The workflow's name, the stop
 *   reason and the step ids are text an agent with workflow:write wrote, so before this an agent that
 *   changed the owner's notification address could have the report mailed to that address
 *   (codebase analysis 2026-11-03, item A2).
 *   The use that stays: an owner with a proven address who ticked "notify on finish" gets the mail
 *   once, with the same subject and body, and the Email page's mail log names it workflow_end; the
 *   owner who switched the workflow mail off gets none; the bell entry arrives in every case.
 * @usage pnpm exec vitest run test/unit/workflow-end-mail-guard.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item A2).
 */
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { WorkflowRun } from '../../src/models/workflow-schemas.js';
import { onRunFinished } from '../../src/services/workflow/engine-steps.js';
import { readMailLog, updateNotificationSettings } from '../../src/services/notification-settings.js';
import { setActiveEmailService } from '../../src/services/email.js';

const NODE = 'aimeat-test-001';
const OWNER = `alice@${NODE}`;
const ADDRESS = 'alice@example.test';
const config = { nodeId: NODE, baseUrl: 'https://node.test', smtpReplyTo: null } as unknown as AimeatConfig;
let storage: Storage;
let sendNotification: ReturnType<typeof vi.fn>;
let n = 0;

const hashOf = (a: string) => createHash('sha256').update(a.toLowerCase().trim()).digest('hex');

/** The account as the code-confirm paths write it: the address, its hash and the flag together. */
async function owner(proof: { verified: boolean; hashOf?: string }): Promise<void> {
    const at = new Date().toISOString();
    await storage.createOwner({ name: 'alice', displayName: 'alice', publicKey: 'pk', roles: ['owner'], createdAt: at } as never);
    await storage.createGHII({
        username: 'alice', nodeId: NODE, ghii: OWNER, displayName: 'alice', verificationLevel: 1, ownerName: 'alice',
        totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: at, updatedAt: at,
        notificationEmail: ADDRESS, emailVerifiedAt: proof.verified ? at : null,
        emailHash: hashOf(proof.hashOf ?? ADDRESS), locale: 'en',
    } as never);
}

/** A finished full-live run of a fresh workflow (a fresh id per case keeps the daily counts apart). */
function finishedRun(over: Partial<WorkflowRun> = {}, workflowId = `wf-${++n}`): WorkflowRun {
    const at = new Date().toISOString();
    return {
        runId: `run-${Math.random().toString(36).slice(2, 10)}`, workflowId, resolved: [], vars: {}, mode: 'full-live',
        defSnapshot: { id: workflowId, title: 'Morning report', notify_on_finish: true, steps: [{ id: 'fetch' }, { id: 'write' }] },
        status: 'done', steps: { fetch: { state: 'green' }, write: { state: 'green' } }, startedAt: at, endedAt: at,
        ...over,
    } as unknown as WorkflowRun;
}

function deps() {
    return { storage, config, emailService: { enabled: true, sendNotification } as never };
}

beforeEach(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    sendNotification = vi.fn(async () => true);
    setActiveEmailService({ enabled: true, sendNotification, sendRaw: vi.fn(async () => true) } as never);
});

afterEach(() => { setActiveEmailService({ enabled: false } as never); vi.restoreAllMocks(); });

describe('the workflow-end mail goes only to a proven address', () => {
    it('an address nobody confirmed gets no mail, and the bell entry still arrives', async () => {
        await owner({ verified: false });
        expect(await onRunFinished(deps(), OWNER, finishedRun())).toBe(true);
        expect(sendNotification).not.toHaveBeenCalled();
        const { items } = await storage.listAllMemory({ prefix: 'notif.' });
        expect(items.filter(i => i.ownerGaii === OWNER)).toHaveLength(1);
    });

    it('a flag left from an earlier address does not prove the address the account names now', async () => {
        await owner({ verified: true, hashOf: 'earlier@example.test' });
        await onRunFinished(deps(), OWNER, finishedRun());
        expect(sendNotification).not.toHaveBeenCalled();
    });

    it('usage: a proven address gets the report once, with the same subject and body, logged as workflow_end', async () => {
        await owner({ verified: true });
        await onRunFinished(deps(), OWNER, finishedRun());
        expect(sendNotification).toHaveBeenCalledTimes(1);
        const [to, subject, body] = sendNotification.mock.calls[0];
        expect(to).toBe(ADDRESS);
        expect(subject).toBe('Workflow "Morning report" succeeded');
        expect(body).toContain('Workflow "Morning report" succeeded.');
        expect(body).toContain('Run log:\n• fetch: green\n• write: green');
        expect((await readMailLog(storage, OWNER)).map(e => e.kind)).toEqual(['workflow_end']);
    });

    it('usage: the owner who switched the workflow mail off gets none', async () => {
        await owner({ verified: true });
        await updateNotificationSettings(storage, OWNER, cur => ({ ...cur, email: { ...cur.email, workflowEnd: false } }));
        await onRunFinished(deps(), OWNER, finishedRun());
        expect(sendNotification).not.toHaveBeenCalled();
    });

    it('usage: a node with no mail service sends nothing and the run still finishes', async () => {
        await owner({ verified: true });
        expect(await onRunFinished({ storage, config }, OWNER, finishedRun())).toBe(true);
        expect(sendNotification).not.toHaveBeenCalled();
    });
});

describe('the workflow-end mail counts against the per-sender daily limit', () => {
    it('one workflow mails at most email.reports_per_sender_day times a day; another workflow still mails', async () => {
        await owner({ verified: true });
        const limited = { ...config, emailReportsPerSenderDay: 3 } as AimeatConfig;
        const d = { storage, config: limited, emailService: { enabled: true, sendNotification } as never };
        for (let i = 0; i < 5; i++) await onRunFinished(d, OWNER, finishedRun({}, 'wf-daily'));
        expect(sendNotification).toHaveBeenCalledTimes(3);
        await onRunFinished(d, OWNER, finishedRun({}, 'wf-other'));
        expect(sendNotification).toHaveBeenCalledTimes(4);
    });

    it('usage: 0 means no limit', async () => {
        await owner({ verified: true });
        const open = { ...config, emailReportsPerSenderDay: 0 } as AimeatConfig;
        const d = { storage, config: open, emailService: { enabled: true, sendNotification } as never };
        for (let i = 0; i < 12; i++) await onRunFinished(d, OWNER, finishedRun({}, 'wf-unlimited'));
        expect(sendNotification).toHaveBeenCalledTimes(12);
    });
});
