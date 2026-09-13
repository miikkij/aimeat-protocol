/**
 * @file test/unit/mail-send-failed-outcome.test.ts
 * @description aimeat_mail_send answers a send that did not go out as an ERROR, on all three doors.
 *
 *   An agent takes a non-error tool result as "done", so a send the provider refused, or one this node
 *   had no transport for, was reported to the person as sent (appdev pitfall
 *   send-200-is-not-a-delivery). The node MCP said "Not sent" in a note inside a success result; both
 *   connector doors passed the route's 200 envelope through untouched.
 *
 *   Since 2026-09-13 the route itself answers such a send with SEND_FAILED (502 or 503, the send-log
 *   id and the reason in error.details), so the connector doors meet two shapes: that error from a
 *   current node, and the 200 with data.status 'failed' from a node older than the connector. Both
 *   come out as the same error, carrying the same fields.
 *
 *   Each door is exercised with a sent outcome as well, so "everything is an error now" cannot pass.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mail-send-failed-outcome.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-13 — The connector doors are fed the SEND_FAILED error a current node answers,
 *     beside the 200 'failed' envelope an older node still answers, and a refusal that is not about
 *     delivery passes through untouched.
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerConnectionTools as registerNodeConnectionTools } from '../../src/mcp/connections.js';
import { registerConnectionTools as registerConnectorConnectionTools } from '../../src/cli/connect/mcp/tools/connections.js';
import { connectionCliTools } from '../../src/cli/connect/tool-call-defs-connections.js';
import { getAimeatToolDefinition } from '../../src/mcp/catalog/definitions.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { AgentRegistry } from '../../src/cli/connect/agent-registry.js';
import type { ApiResponse } from '../../src/cli/connect/api-client.js';
import { setActiveEmailService, type EmailService } from '../../src/services/email.js';
import { ensureContact } from '../../src/services/outbound/outbound-service.js';

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

/** Records every registration and keeps the handler, which is the last argument in every form. */
function capturingMcp(): { mcp: McpServer; handlers: Map<string, Handler> } {
    const handlers = new Map<string, Handler>();
    const mcp = {
        tool: (name: string, ...rest: unknown[]) => { handlers.set(name, rest[rest.length - 1] as Handler); },
    } as unknown as McpServer;
    return { mcp, handlers };
}

/** An SMTP transport whose answer the test decides. */
function fakeSmtp(accepts: boolean): EmailService {
    return {
        enabled: true,
        sendWithAttachments: async () => accepts,
    } as unknown as EmailService;
}

const PRINCIPAL = 'claude#alice@test-node';

function cfg(): AimeatConfig {
    return {
        nodeId: 'test-node',
        baseUrl: 'http://localhost:40050',
        outboundDailyLimit: 50,
        connectionsEnabled: true,
        connectGoogleClientId: '', connectGoogleClientSecret: '',
        connectMicrosoftClientId: '', connectMicrosoftClientSecret: '', connectMicrosoftTenant: 'common',
        connectLinkedinClientId: '', connectLinkedinClientSecret: '',
        connectXClientId: '', connectXClientSecret: '',
        connectRedirectUri: '', connectFakeBaseUrl: '',
    } as unknown as AimeatConfig;
}

describe('node MCP aimeat_mail_send', () => {
    let storage: Storage;
    let send: Handler;
    let contactId: string;

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:') as unknown as Storage;
        const { mcp, handlers } = capturingMcp();
        registerNodeConnectionTools(mcp, storage, cfg(), () => PRINCIPAL, ['outbound:send', 'connections:use']);
        send = handlers.get('aimeat_mail_send')!;
        // A plain address with no AIMEAT identity, so the email channel is the one chosen.
        contactId = (await ensureContact(storage, PRINCIPAL, { name: 'Asiakas', email: 'asiakas@example.com' })).id;
    });

    it('a send the provider refused is an error result carrying the reason', async () => {
        setActiveEmailService(fakeSmtp(false));
        const out = await send({ contact_id: contactId, subject: 'Hei', body: 'Viesti.' });
        expect(out.isError, `a refused send came back as a success: ${out.content[0].text}`).toBe(true);
        expect(out.content[0].text).toContain('SMTP_SEND_FAILED');
        // The attempt is still in the send log, and the answer says where.
        const logged = await storage.listOutboundMessages({ ownerGhii: PRINCIPAL, limit: 10, offset: 0 });
        expect(logged).toHaveLength(1);
        expect(logged[0].status).toBe('failed');
        expect(out.content[0].text).toContain(logged[0].id);
        // The same fields the REST error carries in details and the connector doors lift to the top.
        const parsed = JSON.parse(out.content[0].text);
        expect(parsed).toMatchObject({ code: 'SEND_FAILED', message_id: logged[0].id, reason: 'SMTP_SEND_FAILED', status: 'failed', channel: 'email' });
    });

    it('a send with no transport at all is an error result too', async () => {
        setActiveEmailService({ enabled: false } as unknown as EmailService);
        const out = await send({ contact_id: contactId, subject: 'Hei', body: 'Viesti.' });
        expect(out.isError).toBe(true);
        expect(out.content[0].text).toContain('EMAIL_DISABLED');
        expect(JSON.parse(out.content[0].text).code).toBe('SEND_FAILED');
    });

    it('a send the provider accepted stays a success', async () => {
        setActiveEmailService(fakeSmtp(true));
        const out = await send({ contact_id: contactId, subject: 'Hei', body: 'Viesti.' });
        expect(out.isError ?? false).toBe(false);
        expect(JSON.parse(out.content[0].text).status).toBe('sent');
    });
});

/** The 200 envelope a node from before 2026-09-13 answers, as both connector doors receive it. */
const envelope = (status: 'sent' | 'failed', error: string | null): ApiResponse => ({
    ok: true,
    data: { message: { id: 'msg-1', status, error }, channel: 'email', status },
});

/** The error envelope a current node answers for a send that did not go out (HTTP 502 or 503). */
const sendFailed = (reason: string): ApiResponse => ({
    ok: false,
    error: {
        code: 'SEND_FAILED',
        message: `Not sent (${reason}). Nothing reached the recipient; the attempt is in the send log as msg-2.`,
        details: { message_id: 'msg-2', status: 'failed', channel: 'email', reason },
    } as ApiResponse['error'],
});

describe('CLI dispatch aimeat_mail_send', () => {
    const tool = connectionCliTools.find(t => t.name === 'aimeat_mail_send')!;
    const run = (answer: ApiResponse) => tool.handler(
        { client: { post: async () => answer } as never, config: {} as never, agentPath: 'claude' },
        { contact_id: 'c1', subject: 'Hei', body: 'Viesti.' },
    );

    it('a current node\'s SEND_FAILED is ok:false with the send-log id and the reason at the top of the error', async () => {
        const out = await run(sendFailed('MAILBOX_HTTP_500'));
        expect(out.ok).toBe(false);
        const err = out.error as Record<string, unknown>;
        expect(err.code).toBe('SEND_FAILED');
        expect(err.message).toContain('MAILBOX_HTTP_500');
        expect(err.message_id, `the send-log id stayed buried in details: ${JSON.stringify(err)}`).toBe('msg-2');
        expect(err.reason).toBe('MAILBOX_HTTP_500');
        expect(err.status).toBe('failed');
        expect(err.channel).toBe('email');
    });

    it('an older node\'s 200 failed outcome is ok:false with SEND_FAILED and the provider reason', async () => {
        const out = await run(envelope('failed', 'MAILBOX_SEND_FAILED'));
        expect(out.ok, 'the 200 envelope of a failed send was passed through as success').toBe(false);
        expect(out.error?.code).toBe('SEND_FAILED');
        expect(out.error?.message).toContain('MAILBOX_SEND_FAILED');
        expect((out.error as Record<string, unknown>).message_id).toBe('msg-1');
    });

    it('both node generations come out as the same error shape', async () => {
        const current = (await run(sendFailed('SMTP_SEND_FAILED'))).error as Record<string, unknown>;
        const older = (await run(envelope('failed', 'SMTP_SEND_FAILED'))).error as Record<string, unknown>;
        expect(Object.keys(current).sort()).toEqual(Object.keys(older).sort());
    });

    it('a refusal that is not about delivery is passed through unchanged', async () => {
        const refusal: ApiResponse = { ok: false, error: { code: 'DAILY_LIMIT', message: 'Outbound daily limit reached (50/24h)' } };
        expect(await run(refusal)).toEqual(refusal);
    });

    it('a sent outcome is passed through unchanged', async () => {
        const answer = envelope('sent', null);
        expect(await run(answer)).toEqual(answer);
    });
});

describe('connector MCP aimeat_mail_send', () => {
    const handlerFor = (answer: ApiResponse): Handler => {
        const { mcp, handlers } = capturingMcp();
        const registry = { resolve: () => ({ client: { post: async () => answer } }) } as unknown as AgentRegistry;
        registerConnectorConnectionTools(mcp, registry);
        return handlers.get('aimeat_mail_send')!;
    };

    it('a current node\'s SEND_FAILED is an error result naming the reason and the send-log id', async () => {
        const out = await handlerFor(sendFailed('SMTP_SEND_FAILED'))({ contact_id: 'c1', subject: 'Hei', body: 'Viesti.' });
        expect(out.isError, `a refused send came back as a success: ${out.content[0].text}`).toBe(true);
        const parsed = JSON.parse(out.content[0].text);
        expect(parsed.error.reason).toBe('SMTP_SEND_FAILED');
        expect(parsed.error.message_id).toBe('msg-2');
    });

    it('an older node\'s failed outcome is an error result carrying the provider reason', async () => {
        const out = await handlerFor(envelope('failed', 'SMTP_SEND_FAILED'))({ contact_id: 'c1', subject: 'Hei', body: 'Viesti.' });
        expect(out.isError, `a refused send came back as a success: ${out.content[0].text}`).toBe(true);
        expect(out.content[0].text).toContain('SMTP_SEND_FAILED');
    });

    it('a sent outcome stays a success', async () => {
        const out = await handlerFor(envelope('sent', null))({ contact_id: 'c1', subject: 'Hei', body: 'Viesti.' });
        expect(out.isError ?? false).toBe(false);
    });
});

describe('the catalog description', () => {
    it('no longer says a successful answer means the provider accepted the message', () => {
        const text = getAimeatToolDefinition('aimeat_mail_send')!.description;
        expect(text).not.toMatch(/successful answer[^.]*means the provider accepted/i);
        expect(text).toMatch(/error/i);
    });
});
