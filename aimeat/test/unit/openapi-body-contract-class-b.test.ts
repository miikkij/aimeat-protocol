/**
 * @file openapi-body-contract-class-b.test.ts
 * @description Request-body contracts corrected to what working clients send (structure programme
 *   2026-11, unit 1, class B: the body guard saw the route accept a body the contract refused). Each
 *   route reads the real openapi.yaml, as the guard does, and holds two things: a body of the shape a
 *   production client sends matches the contract, and a body the handler refuses does not. Where the
 *   handler validates with Zod, every body is also put to that schema, so the contract is shown to
 *   be neither looser nor stricter than the route.
 * @usage cd aimeat && pnpm exec vitest run test/unit/openapi-body-contract-class-b.test.ts
 * @version-history
 *   v1.2.0 — 2026-11-14 — POST /v1/federation/message.
 *   v1.1.0 — 2026-11-14 — POST /v1/federation/catalogue-sync.
 *   v1.0.0 — 2026-11-14 — Initial: POST /v1/agents/{name}/tasks/{id}/event.
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { loadBodyContract, firstIssue } from '../../src/services/openapi-body-contract.js';
import { AgentTaskEventSchema } from '../../src/models/agent-task-schemas.js';

const contract = loadBodyContract();
/** What verdict() answers for a body the contract matches. */
const MATCH = 'match';

/** The compiled validator of the operation a request to `path` reaches. */
function validatorFor(method: string, path: string) {
    assert.ok(contract, 'openapi.yaml was not found');
    const op = contract.match(method, path);
    assert.ok(op, `no body contract for ${method} ${path}`);
    const v = op.validator();
    assert.ok(v, `the body schema of ${op.route} does not compile`);
    return v;
}

/** MATCH, or the first issue the contract finds in the body (field and reason). */
function verdict(v: ReturnType<typeof validatorFor>, body: unknown): string {
    return v(body) ? MATCH : JSON.stringify(firstIssue(v.errors));
}

describe('POST /v1/agents/{name}/tasks/{id}/event', () => {
    const v = validatorFor('POST', '/v1/agents/bot/tasks/7b0c9f2e-1d1a-4a43-9a51-0f3b5f6d2c11/event');
    // recordTaskEvent (services/agent/task-write.ts) parses the body with AgentTaskEventSchema.
    const taken = [
        { type: 'started', message: 'Starting the scheduled run' },
        { type: 'message', message: 'Read 12 records', details: { telemetry: { ai_calls: 1, tokens_in: 900, tokens_out: 120, duration_seconds: 4 } } },
        { type: 'verification', message: 'Checked the output' },
        { type: 'revision_requested', message: 'Owner asked for changes' },
        { type: 'progress', message: 'x'.repeat(4096), extra: 'kept by neither side' },
    ];
    const refused = [
        { type: 'log', message: 'not an event type the route takes' },
        { type: 'stalled', message: 'not an event type the route takes' },
        { type: 'progress' },
        { type: 'progress', message: '' },
        { type: 'progress', message: 'x'.repeat(4097) },
        { type: 'progress', message: 'm', details: 'text' },
        { message: 'no type' },
    ];

    it('matches the bodies the route takes', () => {
        for (const b of taken) {
            assert.ok(AgentTaskEventSchema.safeParse(b).success, `route schema refuses ${JSON.stringify(b).slice(0, 80)}`);
            assert.equal(verdict(v, b), MATCH);
        }
    });

    it('refuses the bodies the route refuses', () => {
        for (const b of refused) {
            assert.equal(AgentTaskEventSchema.safeParse(b).success, false, `route schema takes ${JSON.stringify(b)}`);
            assert.notEqual(verdict(v, b), MATCH, `contract accepts ${JSON.stringify(b).slice(0, 80)}`);
        }
    });
});

/** The delivery proof a sending node adds to its signed federation bodies. */
const PROOF = { signature: 'sig', audience: 'node-b', sent_at: '2026-11-14T06:21:07.000Z', audience_signature: 'asig' };

describe('POST /v1/federation/catalogue-sync', () => {
    const v = validatorFor('POST', '/v1/federation/catalogue-sync');
    // The body services/catalogue-sync.ts sends: since_timestamp is the sender's lastSyncAt, null
    // until the first sync to that peer has succeeded.
    const actions = [{
        id: 'a1', provider_gaii: 'bot#alice@node-a', display_name: 'Summarise', description: 'd', category: 'text',
        input_schema: {}, output_schema: {}, pricing: { toll_morsels: 1, base_morsels: 1 }, tags: ['federate:x'],
        created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-02T10:00:00.000Z',
    }];

    it('matches a first sync (since_timestamp null) and an incremental one', () => {
        assert.equal(verdict(v, { source_node: 'node-a', actions, since_timestamp: null, catalogue_hash: 'h', ...PROOF }), MATCH);
        assert.equal(verdict(v, { source_node: 'node-a', actions: [], since_timestamp: '2026-11-13T06:21:07.000Z', catalogue_hash: 'h', ...PROOF }), MATCH);
    });

    it('refuses the bodies the route answers 400', () => {
        // routes/federation-sync/catalogue-trust.ts: "source_node and actions array required".
        for (const b of [{ actions, ...PROOF }, { source_node: 'node-a', ...PROOF }, { source_node: 'node-a', actions: {}, ...PROOF }]) {
            assert.notEqual(verdict(v, b), MATCH, `contract accepts ${JSON.stringify(b).slice(0, 80)}`);
        }
    });
});

describe('POST /v1/federation/message', () => {
    const v = validatorFor('POST', '/v1/federation/message');
    // buildMessagePayload (services/message-delivery.ts) sends every optional field the record lacks
    // as null: a message without attachments carries `attachments: null`.
    const wire = {
        id: '5f1d3a52-7c1e-4bb3-9d0a-6a3d2b1c0e9f', conversationId: 'c1', subject: null,
        senderGhii: 'alice@node-a', recipientGhii: 'bob@node-b', deliveryGhii: 'bob@node-b', body: 'hi',
        attachments: null, interactive: null, broadcastId: null, respondable: null, replyToId: null,
        sentByAgent: null, sentByAgentName: null, createdAt: '2026-11-13T07:28:14.000Z',
    };
    const signedBy = { timestamp: '2026-11-13T07:28:14.000Z', signature: 'sig', audience: 'node-b', audience_signature: 'asig' };
    const base = { source_node: 'node-a', ...signedBy };

    it('matches a message with its optional fields sent as null', () => {
        assert.equal(verdict(v, { ...base, message: wire }), MATCH);
    });

    it('matches a message that carries attachments, a question form and an agent label', () => {
        assert.equal(verdict(v, {
            ...base,
            message: {
                ...wire, subject: 's', respondable: true, replyToId: '0b6c2c9e-3f4a-4d7e-8b1a-2c3d4e5f6a7b',
                sentByAgent: 'bot#alice@node-a', sentByAgentName: 'Bot',
                attachments: [{ id: 'f1', storageKey: 'k', mime: 'image/png', size: 10, kind: 'image', name: 'a.png', inline: false }],
                interactive: { role: 'questions', v: 1, questions: [] },
            },
        }), MATCH);
    });

    it('refuses the bodies the route answers 400', () => {
        // routes/federation-sync/messaging.ts: "source_node and message{id,senderGhii,recipientGhii} are required".
        const refused: unknown[] = [base, { ...signedBy, message: wire }];
        for (const field of ['id', 'senderGhii', 'recipientGhii'] as const) {
            const message: Record<string, unknown> = { ...wire };
            delete message[field];
            refused.push({ ...base, message });
        }
        for (const b of refused) {
            assert.notEqual(verdict(v, b), MATCH, `contract accepts ${JSON.stringify(b).slice(0, 80)}`);
        }
    });
});
