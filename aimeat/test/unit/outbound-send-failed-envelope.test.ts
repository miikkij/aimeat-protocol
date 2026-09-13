/**
 * @file test/unit/outbound-send-failed-envelope.test.ts
 * @description POST /v1/outbound/send answers a send that did not go out as an ERROR envelope.
 *
 *   Until 2026-09-13 the route answered 200 for every attempt that reached channel selection and put
 *   the outcome in `data.status`, so a REST caller that read the HTTP status or `ok` took a refused
 *   send for a sent one. The developer decided on 2026-09-13: code SEND_FAILED, 502 when the channel
 *   refused or failed the message, 503 when this node had nothing to send through, and the send-log
 *   id plus the reason in `error.details` so the attempt can still be found. A send that went out
 *   keeps 200 and its body.
 *
 *   The decision lives in sendOutbound, so the service is asserted directly as well: a door added
 *   later cannot receive a failed outcome as a result and forget to refuse it.
 *
 *   Drives the real outboundRouter over real in-memory SQLite; only the mail transport is faked,
 *   because its answer is the thing under test.
 * @usage cd aimeat && pnpm exec vitest run test/unit/outbound-send-failed-envelope.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { outboundRouter } from '../../src/routes/outbound.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { setActiveEmailService, type EmailService } from '../../src/services/email.js';
import {
    ensureContact, recordBounce, sendOutbound, OutboundError,
} from '../../src/services/outbound/outbound-service.js';

const NODE_ID = 'test-node';
const ALICE = `alice@${NODE_ID}`;
const BOB = `bob@${NODE_ID}`;

function cfg(): AimeatConfig {
    return {
        nodeId: NODE_ID,
        baseUrl: 'http://localhost:40050',
        outboundDailyLimit: 50,
        connectionsEnabled: false,
    } as unknown as AimeatConfig;
}

/** An SMTP transport whose answer the test decides. */
const smtp = (accepts: boolean): EmailService =>
    ({ enabled: true, sendWithAttachments: async () => accepts }) as unknown as EmailService;

/** No transport at all: the node's shared sender is switched off. */
const noTransport = (): EmailService => ({ enabled: false }) as unknown as EmailService;

let storage: Storage;
let server: http.Server;
let base = '';

beforeEach(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    const app = express();
    app.use(express.json());
    // The session is chosen by header so a cross-owner call can be made against the same node. Both
    // are plain owner sessions, which is what requireAuth leaves on req.auth after a real login.
    app.use((req, _res, next) => {
        const owner = req.header('x-test-owner') === 'bob' ? 'bob' : 'alice';
        req.auth = { sub: owner, owner, node: NODE_ID, roles: ['owner'], scopes: [], exp: Date.now() / 1000 + 3600 };
        next();
    });
    app.use(outboundRouter(cfg(), storage));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
});

async function send(contactId: string, as: 'alice' | 'bob' = 'alice'): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}/v1/outbound/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-owner': as },
        body: JSON.stringify({ contact_id: contactId, kind: 'transactional', subject: 'Hei', body: 'Viesti.' }),
    });
    return { status: res.status, body: await res.json() };
}

/** A plain address with no AIMEAT identity, so the email channel is the one chosen. */
async function plainContact(owner = ALICE): Promise<string> {
    return (await ensureContact(storage, owner, { name: 'Asiakas', email: 'asiakas@example.com' })).id;
}

async function logRows(owner = ALICE) {
    return storage.listOutboundMessages({ ownerGhii: owner, limit: 50, offset: 0 });
}

describe('POST /v1/outbound/send, a send that did not go out', () => {
    it('the provider refused it: 502 SEND_FAILED, with the send-log id and the reason in details', async () => {
        setActiveEmailService(smtp(false));
        const contactId = await plainContact();
        const r = await send(contactId);
        expect(r.status, `a refused send answered ${r.status}: ${JSON.stringify(r.body)}`).toBe(502);
        expect(r.body.ok).toBe(false);
        expect(r.body.data).toBeUndefined();
        expect(r.body.error.code).toBe('SEND_FAILED');
        const rows = await logRows();
        expect(rows).toHaveLength(1);
        expect(r.body.error.details).toEqual({
            message_id: rows[0].id, status: 'failed', channel: 'email', reason: 'SMTP_SEND_FAILED',
        });
        expect(rows[0].status).toBe('failed');
        expect(rows[0].error).toBe('SMTP_SEND_FAILED');
        // The sentence names the reason and the row, so a caller reading only the message can act.
        expect(r.body.error.message).toContain('SMTP_SEND_FAILED');
        expect(r.body.error.message).toContain(rows[0].id);
    });

    it('the node had nothing to send through: 503 SEND_FAILED, reason EMAIL_DISABLED', async () => {
        setActiveEmailService(noTransport());
        const contactId = await plainContact();
        const r = await send(contactId);
        expect(r.status, `a send with no transport answered ${r.status}: ${JSON.stringify(r.body)}`).toBe(503);
        expect(r.body.ok).toBe(false);
        expect(r.body.error.code).toBe('SEND_FAILED');
        const rows = await logRows();
        expect(rows).toHaveLength(1);
        expect(r.body.error.details).toEqual({
            message_id: rows[0].id, status: 'failed', channel: 'email', reason: 'EMAIL_DISABLED',
        });
    });

    it('a suppressed recipient keeps 422 SUPPRESSED and names the logged attempt the same way', async () => {
        setActiveEmailService(smtp(true));
        const contactId = await plainContact();
        let contact = (await storage.getOutboundContact(contactId))!;
        for (let i = 0; i < 3; i++) contact = await recordBounce(storage, contact);
        const r = await send(contactId);
        expect(r.status).toBe(422);
        expect(r.body.error.code).toBe('SUPPRESSED');
        const rows = await logRows();
        expect(rows).toHaveLength(1);
        expect(r.body.error.details?.message_id).toBe(rows[0].id);
        expect(r.body.error.details?.status).toBe('suppressed');
    });

    it("another owner naming this owner's contact gets 404 and no send-log id", async () => {
        setActiveEmailService(smtp(false));
        const contactId = await plainContact(ALICE);
        const r = await send(contactId, 'bob');
        expect(r.status).toBe(404);
        expect(r.body.error.code).toBe('NOT_FOUND');
        expect(r.body.error.details).toBeUndefined();
        expect(await logRows(ALICE)).toHaveLength(0);
        expect(await logRows(BOB)).toHaveLength(0);
    });
});

describe('POST /v1/outbound/send, a send that went out', () => {
    it('keeps 200 and its body: status, channel and the send-log row', async () => {
        setActiveEmailService(smtp(true));
        const contactId = await plainContact();
        const r = await send(contactId);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(r.body.ok).toBe(true);
        expect(r.body.data.status).toBe('sent');
        expect(r.body.data.channel).toBe('email');
        const rows = await logRows();
        expect(r.body.data.message.id).toBe(rows[0].id);
        expect(r.body.data.message.status).toBe('sent');
    });
});

describe('sendOutbound, the one place the decision lives', () => {
    it('rejects a send that did not go out rather than returning it as a result', async () => {
        setActiveEmailService(smtp(false));
        const contactId = await plainContact();
        const outcome = await sendOutbound(cfg(), storage, ALICE, {
            contactId, kind: 'transactional', subject: 'Hei', body: 'Viesti.',
        }).then(() => null, (e: unknown) => e);
        expect(outcome, 'a refused send came back as a result').toBeInstanceOf(OutboundError);
        const err = outcome as OutboundError;
        expect(err.code).toBe('SEND_FAILED');
        expect(err.statusCode).toBe(502);
        expect(err.details?.reason).toBe('SMTP_SEND_FAILED');
    });

    it('returns a send that went out', async () => {
        setActiveEmailService(smtp(true));
        const contactId = await plainContact();
        const result = await sendOutbound(cfg(), storage, ALICE, {
            contactId, kind: 'transactional', subject: 'Hei', body: 'Viesti.',
        });
        expect(result.status).toBe('sent');
    });
});
