/**
 * @file src/tool-dispatch/tool-call-defs-content.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The content class tools on the CLI dispatch (`/local/call/<tool>`, and the connector
 *   MCP through dispatch-tools.ts): thin REST proxies over /v1/content/*, so the permission words,
 *   the input checks and the node's switch are the node's answer here too (routes/content.ts calls
 *   services/content/service.ts, as the node MCP does). Nothing in this file decides anything; a
 *   field the call's mode does not read is refused by checkContentInput(), the same check the node
 *   MCP makes.
 *
 *   A `switch` with literal client calls, not a lookup table: check:field-reach pairs a tool with a
 *   route by the REST calls it can see, and it does not follow a table.
 * @structure contentCliTools
 * @usage import { contentCliTools } from './tool-call-defs-content.js';
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial: aimeat_content_facts, _inspect, _scan, _classes and _settings
 *     (wish-sis-ll-n-purku-luokittelu-ja-owl).
 */
import type { ApiResponse } from './api-client.js';
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { query, optionalString, optionalNumber, optionalBoolean, optionalArray, optionalRecord, requiredString } from './tool-call-helpers.js';
import { checkContentInput } from '../tool-catalog/definitions/content.js';

/** The refusal checkContentInput() wrote, in the envelope's shape, or null when the call may go. */
function refused(tool: string, input: JsonObject): ApiResponse | null {
    const checked = checkContentInput(tool, input);
    return checked.ok ? null : { ok: false, error: { code: 'INVALID_INPUT', message: checked.message } };
}

/** One item, as the facts and text routes read it from the query. */
const itemQuery = (input: JsonObject) => query({
    kind: optionalString(input, 'kind'), key: optionalString(input, 'key'), owner: optionalString(input, 'owner'),
});

export const contentCliTools: ConnectCliToolDefinition[] = [
    {
        // → GET /v1/content/facts?kind&key&owner (and GET /v1/content/text with with_text), or
        //   GET /v1/content/facts?kind&class&stale&limit&after, plus GET /v1/content without a filter.
        name: 'aimeat_content_facts',
        handler: async ({ client }, input) => {
            const refusal = refused('aimeat_content_facts', input);
            if (refusal) return refusal;
            if (optionalString(input, 'key')) {
                const facts = await client.get(`/v1/content/facts${itemQuery(input)}`);
                if (!facts.ok || optionalBoolean(input, 'with_text') !== true) return facts;
                const text = await client.get(`/v1/content/text${itemQuery(input)}`);
                // No kept text is an answer here, not a failure: the facts were found.
                if (!text.ok && text.error?.code !== 'NOT_FOUND') return text;
                const kept = text.ok ? (text.data as { text?: string; from?: string } | undefined) : undefined;
                return { ...facts, data: { ...(facts.data as JsonObject), text: kept?.text ?? null, text_from: kept?.from ?? null } };
            }
            const filter = {
                kind: optionalString(input, 'of_kind'), class: optionalString(input, 'class'),
                stale: optionalBoolean(input, 'stale'), limit: optionalNumber(input, 'limit'), after: optionalString(input, 'after'),
            };
            const page = await client.get(`/v1/content/facts${query(filter)}`);
            if (!page.ok || Object.values(filter).some((v) => v !== undefined)) return page.ok ? { ...page, data: { page: page.data } } : page;
            // No filter at all: the overview rides along, as the node MCP answers it.
            const overview = await client.get('/v1/content');
            if (!overview.ok) return overview;
            return { ...page, data: { overview: overview.data, page: page.data } };
        },
    },
    {
        // → POST /v1/content/inspect { source: { kind, key, owner }, stages?, force? }
        name: 'aimeat_content_inspect',
        handler: ({ client }, input) => {
            const stages = optionalArray(input, 'stages');
            const force = optionalBoolean(input, 'force');
            return client.post('/v1/content/inspect', {
                source: {
                    key: requiredString(input, 'key'),
                    ...(optionalString(input, 'kind') ? { kind: optionalString(input, 'kind') } : {}),
                    ...(optionalString(input, 'owner') ? { owner: optionalString(input, 'owner') } : {}),
                },
                ...(stages ? { stages } : {}),
                ...(force !== undefined ? { force } : {}),
            });
        },
    },
    {
        // → GET /v1/content/scans/:id with scan_id; otherwise POST /v1/content/scans, answered at once.
        name: 'aimeat_content_scan',
        handler: async ({ client }, input) => {
            const refusal = refused('aimeat_content_scan', input);
            if (refusal) return refusal;
            const scanId = optionalString(input, 'scan_id');
            if (scanId) return client.get(`/v1/content/scans/${encodeURIComponent(scanId)}`);
            const body: JsonObject = {};
            for (const f of ['keys', 'kinds', 'stages']) { const v = optionalArray(input, f); if (v) body[f] = v; }
            for (const f of ['missing_only', 'force', 'prune']) { const v = optionalBoolean(input, f); if (v !== undefined) body[f] = v; }
            const prefix = optionalString(input, 'memory_prefix');
            if (prefix) body.memory_prefix = prefix;
            const limit = optionalNumber(input, 'limit');
            if (limit !== undefined) body.limit = limit;
            const started = await client.post('/v1/content/scans', body);
            const scan = (started.data as { scan?: { id?: string } } | undefined)?.scan;
            return started.ok && scan?.id
                ? { ...started, data: { ...(started.data as JsonObject), next: `Follow it with aimeat_content_scan { scan_id: "${scan.id}" }.` } }
                : started;
        },
    },
    {
        // → the /v1/content/classes, /v1/content/proposals or /v1/content/ontology route of the action.
        name: 'aimeat_content_classes',
        handler: ({ client }, input) => {
            const refusal = refused('aimeat_content_classes', input);
            if (refusal) return Promise.resolve(refusal);
            const id = optionalString(input, 'id') ?? '';
            switch (input.action) {
                case 'list':
                    return client.get('/v1/content/classes');
                case 'set': {
                    const cls = optionalRecord(input, 'class') ?? {};
                    return client.put(`/v1/content/classes/${encodeURIComponent(String(cls.id ?? ''))}`, cls);
                }
                case 'remove':
                    return client.delete(`/v1/content/classes/${encodeURIComponent(id)}`);
                case 'proposals':
                    return client.get(`/v1/content/proposals${query({ status: optionalString(input, 'status') })}`);
                case 'approve':
                case 'reject':
                    return client.post(`/v1/content/proposals/${encodeURIComponent(id)}`, { decision: input.action });
                case 'ontology':
                    return client.get('/v1/content/ontology');
                default:
                    return Promise.resolve({ ok: false, error: { code: 'INVALID_INPUT', message: 'action is list, set, remove, proposals, approve, reject or ontology.' } });
            }
        },
    },
    {
        // → GET /v1/content/settings, or PUT /v1/content/settings with the patch.
        name: 'aimeat_content_settings',
        handler: ({ client }, input) => {
            const patch = optionalRecord(input, 'patch');
            return patch ? client.put('/v1/content/settings', patch) : client.get('/v1/content/settings');
        },
    },
];
