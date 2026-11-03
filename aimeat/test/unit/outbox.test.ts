/**
 * @file test/unit/outbox.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The stored outbox (services/outbox.ts) for webhook and mail retries. A delivery whose
 *   first attempt fails is kept in storage; a restart inside the retry window resumes it and it is
 *   delivered once; two processes sweeping at once send it once; a claim a live process holds is not
 *   taken; a delivery that succeeds the first time writes nothing; a stored mail is ciphertext only
 *   and is sent after a restart with the fields it was given (services/email-outbox.ts).
 * @usage cd aimeat && pnpm exec vitest run test/unit/outbox.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, HA stage 1 item 1.5).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Transporter } from 'nodemailer';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import {
    deliverWithRetries, registerOutboxHandler, resumeOutbox, releaseOutbox, resetOutboxForTests, outboxOwner, OUTBOX_PREFIX,
} from '../../src/services/outbox.js';
import { createMailSender, type MailPayload } from '../../src/services/email-outbox.js';

const NODE = 'outbox-test-node';
const OWNER = outboxOwner(NODE);

/** Memory rows in a map, with the two conditional writes the outbox claims with. */
function memoryStorage(): { storage: Storage; rows: Map<string, MemoryRecord>; writes: () => number } {
    const rows = new Map<string, MemoryRecord>();
    let writes = 0;
    const id = (o: string, k: string) => `${o}::${k}`;
    const storage = {
        getMemory: async (o: string, k: string) => rows.get(id(o, k)) ?? null,
        deleteMemory: async (o: string, k: string) => rows.delete(id(o, k)),
        listMemory: async (o: string, opts: { prefix?: string } = {}) => [...rows.values()]
            .filter(r => r.ownerGaii === o && r.key.startsWith(opts.prefix ?? '')).map(r => ({ ...r })),
        createMemoryIfAbsent: async (r: MemoryRecord) => {
            if (rows.has(id(r.ownerGaii, r.key))) return null;
            writes++; rows.set(id(r.ownerGaii, r.key), r); return r;
        },
        setMemoryIfVersion: async (r: MemoryRecord, expected: number) => {
            if (rows.get(id(r.ownerGaii, r.key))?.version !== expected) return null;
            writes++; rows.set(id(r.ownerGaii, r.key), r); return r;
        },
    } as unknown as Storage;
    return { storage, rows, writes: () => writes };
}

const entries = (rows: Map<string, MemoryRecord>) => [...rows.values()].filter(r => r.ownerGaii === OWNER && r.key.startsWith(OUTBOX_PREFIX));
const until = async (cond: () => boolean, ms = 2000) => {
    const began = Date.now();
    while (!cond()) { if (Date.now() - began > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 5)); }
};
/** Make a stored entry due now, as the clock would after a restart. */
function makeDue(rows: Map<string, MemoryRecord>): void {
    for (const r of entries(rows)) {
        rows.set(`${r.ownerGaii}::${r.key}`, { ...r, version: r.version + 1, value: { ...(r.value as object), nextAt: new Date(Date.now() - 1000).toISOString() } });
    }
}

interface Probe { id: string }
const sent: string[] = [];
let failUntil = 0;
let attempts = 0;

beforeEach(() => {
    resetOutboxForTests();
    sent.length = 0; failUntil = 0; attempts = 0;
    registerOutboxHandler<Probe>('webhook', {
        delays: [60_000, 60_000],
        leaseMs: 30_000,
        attempt: async (p) => { attempts++; if (attempts <= failUntil) return false; sent.push(p.id); return true; },
        seal: (p) => ({ id: p.id }),
        open: (s) => ({ id: (s as Probe).id }),
    });
});

describe('the stored outbox', () => {
    it('writes nothing for a delivery that succeeds the first time', async () => {
        const { storage, writes } = memoryStorage();
        expect(await deliverWithRetries<Probe>(storage, NODE, 'webhook', { id: 'a' })).toBe(true);
        expect(writes()).toBe(0);
        expect(sent).toEqual(['a']);
    });

    it('resumes a retry after a restart inside the window, and delivers it once', async () => {
        const { storage, rows } = memoryStorage();
        failUntil = 1;
        void deliverWithRetries<Probe>(storage, NODE, 'webhook', { id: 'b' });
        await until(() => entries(rows).length === 1);
        expect((entries(rows)[0].value as { attempts: number }).attempts).toBe(1);

        // The process stops: its claim is freed. The next process starts and the entry is due.
        await releaseOutbox();
        expect((entries(rows)[0].value as { claim: unknown }).claim).toBeNull();
        resetOutboxForTests();
        makeDue(rows);
        expect(await resumeOutbox(storage, NODE)).toBe(1);
        await until(() => sent.length === 1);
        await until(() => entries(rows).length === 0);
        expect(sent).toEqual(['b']);
    });

    it('sends once when two processes sweep the same entry at once', async () => {
        const { storage, rows } = memoryStorage();
        failUntil = 1;
        void deliverWithRetries<Probe>(storage, NODE, 'webhook', { id: 'c' });
        await until(() => entries(rows).length === 1);
        await releaseOutbox();
        resetOutboxForTests();
        makeDue(rows);
        await Promise.all([resumeOutbox(storage, NODE), resumeOutbox(storage, NODE)]);
        await until(() => entries(rows).length === 0);
        await new Promise(r => setTimeout(r, 30));
        expect(sent).toEqual(['c']);
    });

    it('leaves an entry alone while the process that holds it is alive', async () => {
        const { storage, rows } = memoryStorage();
        failUntil = 1;
        void deliverWithRetries<Probe>(storage, NODE, 'webhook', { id: 'd' });
        await until(() => entries(rows).length === 1);
        expect(await resumeOutbox(storage, NODE)).toBe(0);
        expect(sent).toEqual([]);
        await releaseOutbox();
    });
});

describe('a mail kept in the outbox', () => {
    const config = {
        nodeId: NODE, encryptionKey: 'a'.repeat(64), totpSecretEncryptionKey: null,
    } as unknown as AimeatConfig;

    it('is stored only as ciphertext and is sent after a restart with the fields it was given', async () => {
        const { storage, rows } = memoryStorage();
        const delivered: Array<Record<string, unknown>> = [];
        let fail = true;
        const transporter = {
            sendMail: async (m: Record<string, unknown>) => { if (fail) throw new Error('smtp down'); delivered.push(m); return {}; },
        } as unknown as Transporter;
        const send = createMailSender(transporter, { config, storage });
        const mail: MailPayload = {
            from: 'node@example.test', to: 'person@example.test', subject: 'Your sign-in link', html: '<p>https://x/login?t=SECRET</p>',
            text: 'https://x/login?t=SECRET', type: 'magic_link',
            attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.from('pdf bytes') }],
        };
        void send(mail);
        await until(() => entries(rows).length === 1);
        const stored = JSON.stringify(entries(rows)[0].value);
        expect(stored).not.toContain('SECRET');
        expect(stored).not.toContain('person@example.test');
        expect(stored).toContain('"sealed":"v2:');

        await releaseOutbox();
        resetOutboxForTests();
        createMailSender(transporter, { config, storage });   // the next process registers its sender
        fail = false;
        makeDue(rows);
        expect(await resumeOutbox(storage, NODE)).toBe(1);
        await until(() => delivered.length === 1);
        expect(delivered[0]).toMatchObject({ from: mail.from, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
        const att = (delivered[0].attachments as Array<{ content: Buffer }>)[0];
        expect(att.content.toString()).toBe('pdf bytes');
        await until(() => entries(rows).length === 0);
    });

    it('retries in memory, as before, when the node has no encryption key', async () => {
        const { storage, writes } = memoryStorage();
        let calls = 0;
        const transporter = { sendMail: async () => { calls++; if (calls === 1) throw new Error('smtp down'); return {}; } } as unknown as Transporter;
        const send = createMailSender(transporter, { config: { nodeId: NODE, encryptionKey: null, totpSecretEncryptionKey: null } as unknown as AimeatConfig, storage });
        expect(await send({ from: 'a@x', to: 'b@x', subject: 's', html: 'h', text: 't', type: 'notification' })).toBe(true);
        expect(calls).toBe(2);
        expect(writes()).toBe(0);
    });
});
