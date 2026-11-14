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
 *   v1.0.0 — 2026-11-14 — Initial: POST /v1/agents/{name}/tasks/{id}/event.
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { loadBodyContract, firstIssue } from '../../src/services/openapi-body-contract.js';
import { AgentTaskEventSchema } from '../../src/models/agent-task-schemas.js';

const contract = loadBodyContract();

/** The compiled validator of the operation a request to `path` reaches. */
function validatorFor(method: string, path: string) {
    assert.ok(contract, 'openapi.yaml was not found');
    const op = contract.match(method, path);
    assert.ok(op, `no body contract for ${method} ${path}`);
    const v = op.validator();
    assert.ok(v, `the body schema of ${op.route} does not compile`);
    return v;
}

function accepts(v: ReturnType<typeof validatorFor>, body: unknown): void {
    assert.ok(v(body), `contract refuses ${JSON.stringify(body)}: ${JSON.stringify(firstIssue(v.errors))}`);
}

function refuses(v: ReturnType<typeof validatorFor>, body: unknown): void {
    assert.equal(v(body), false, `contract accepts ${JSON.stringify(body)}`);
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
            accepts(v, b);
        }
    });

    it('refuses the bodies the route refuses', () => {
        for (const b of refused) {
            assert.equal(AgentTaskEventSchema.safeParse(b).success, false, `route schema takes ${JSON.stringify(b)}`);
            refuses(v, b);
        }
    });
});
