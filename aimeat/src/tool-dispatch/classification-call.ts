/**
 * @file src/tool-dispatch/classification-call.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_classification for the connector MCP server and the CLI dispatch (TARGET-082
 *   V5): one function both call, which checks the call against its action's field list and sends it
 *   to the node's own REST endpoint under /v1/classification/*. The node MCP server calls the
 *   services those endpoints call (src/mcp/classification.ts), so every decision stays in
 *   services/classification/ and nothing here decides anything.
 *
 *   Names change on the way: `human_said` is `humanSaid` in a request body, `audit_action` is the
 *   `action` query parameter of the audit endpoint, and a single `key` on scan is `keys: [key]`,
 *   as on the node MCP.
 *
 *   A `switch` with literal client calls, not a lookup table: check:field-reach pairs a tool with a
 *   route by the REST calls it can see, and it does not follow a table.
 * @structure classificationCall
 * @usage return envelopeResult(await classificationCall(client, args));
 * @version-history
 *   v1.2.0 — 2026-09-30 — exception_list → GET /v1/classification/exceptions (exception_action as
 *     the `action` query parameter), exception_set → POST /v1/classification/exceptions
 *     (exception_action as `action` in the body).
 *   v1.1.0 — 2026-09-29 — explorer → GET /v1/classification/labels (pending as the query text
 *     "true"), switch_set → PUT /v1/classification/switch; get, set and review pass `owner`.
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 V5).
 */
import type { AimeatClient, ApiResponse } from './api-client.js';
import { query } from './tool-call-helpers.js';
import { checkClassificationInput, POLICY_PENDING_NEXT } from '../mcp/catalog/definitions/classification.js';

type Input = Record<string, unknown>;

/** The named fields that are present, as one object. Absent means "not sent". */
function pick(input: Input, fields: string[]): Input {
    const out: Input = {};
    for (const f of fields) if (input[f] !== undefined && input[f] !== null) out[f] = input[f];
    return out;
}

/** A query value: a string or a number as it is, anything else not sent. */
function q(v: unknown): string | number | undefined {
    return typeof v === 'string' || typeof v === 'number' ? v : undefined;
}

const TARGET = ['kind', 'key', 'organism_id', 'ws', 'space', 'row_id', 'owner'];

/** `human_said` under the name the REST bodies read. */
function humanSaid(input: Input): Input {
    return input.human_said !== undefined && input.human_said !== null ? { humanSaid: input.human_said } : {};
}

/**
 * Run one aimeat_classification call over REST.
 * @param {AimeatClient} client the agent's client
 * @param {Record<string, unknown>} input the tool's arguments, as the catalog publishes them
 * @returns {Promise<ApiResponse>} the node's envelope, or an INVALID_INPUT refusal made before any call
 */
export async function classificationCall(client: Pick<AimeatClient, 'get' | 'post' | 'put'>, input: Input): Promise<ApiResponse> {
    const checked = checkClassificationInput(input);
    if (!checked.ok) return { ok: false, error: { code: 'INVALID_INPUT', message: checked.message } };

    switch (checked.action) {
        case 'get':
            return client.get(`/v1/classification/label${query({
                kind: q(input.kind), key: q(input.key), organism_id: q(input.organism_id),
                ws: q(input.ws), space: q(input.space), row_id: q(input.row_id), owner: q(input.owner),
            })}`);
        case 'set':
            return client.put('/v1/classification/label', {
                ...pick(input, [...TARGET, 'label', 'justification', 'confidence', 'reason']), ...humanSaid(input),
            });
        case 'review':
            return client.post('/v1/classification/label/review', {
                ...pick(input, [...TARGET, 'decision', 'justification']), ...humanSaid(input),
            });
        case 'policy_get':
            return client.get(`/v1/classification/policy${query({ level: q(input.level), organism_id: q(input.organism_id) })}`);
        case 'policy_set': {
            const resp = await client.put('/v1/classification/policy', {
                ...pick(input, ['level', 'organism_id', 'policy']), ...humanSaid(input),
            });
            const data = resp.data as Input | undefined;
            return resp.ok && data && typeof data === 'object' && data.pending
                ? { ...resp, data: { ...data, next: POLICY_PENDING_NEXT } }
                : resp;
        }
        case 'audit':
            return client.get(`/v1/classification/audit${query({
                level: q(input.level), organism_id: q(input.organism_id), since: q(input.since),
                action: q(input.audit_action), limit: q(input.limit),
            })}`);
        case 'scan': {
            const keys = Array.isArray(input.keys) ? input.keys
                : typeof input.key === 'string' && input.key ? [input.key] : undefined;
            return client.post('/v1/classification/scan', {
                ...(keys ? { keys } : {}), ...pick(input, ['prefix']),
            });
        }
        case 'explorer':
            return client.get(`/v1/classification/labels${query({
                level: q(input.level), organism_id: q(input.organism_id), label: q(input.label),
                pending: typeof input.pending === 'boolean' ? String(input.pending) : q(input.pending),
                kind: q(input.kind), limit: q(input.limit), cursor: q(input.cursor),
            })}`);
        case 'switch_set':
            if (input.level !== undefined && input.level !== null && input.level !== 'node') {
                return { ok: false, error: { code: 'INVALID_INPUT', message: 'switch_set is at level node, the only one.' } };
            }
            return client.put('/v1/classification/switch', pick(input, ['mode']));
        case 'exception_list':
            return client.get(`/v1/classification/exceptions${query({
                level: q(input.level), organism_id: q(input.organism_id), since: q(input.since),
                action: q(input.exception_action), limit: q(input.limit),
            })}`);
        case 'exception_set':
            // The node refuses an AI credential with PERSON_REQUIRED; the same answer as the node MCP.
            return client.post('/v1/classification/exceptions', {
                ...pick(input, [...TARGET, 'reason', 'until']),
                ...(input.exception_action !== undefined && input.exception_action !== null ? { action: input.exception_action } : {}),
            });
        default:
            return { ok: false, error: { code: 'INVALID_INPUT', message: `action "${checked.action}" has no endpoint.` } };
    }
}
