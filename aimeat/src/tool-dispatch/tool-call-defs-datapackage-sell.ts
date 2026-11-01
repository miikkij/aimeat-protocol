/**
 * @file tool-dispatch/tool-call-defs-datapackage-sell.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_datapackage_sell on the CLI dispatch (`/local/call/<tool>`) and so on the connector
 *   MCP: a proxy over PUT /v1/datapackages/{owner}/{name}/exchange, which decides everything.
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D5.1, D5.2).
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { requiredString } from './tool-call-helpers.js';

const FIELDS = ['exchange', 'model', 'prices_money', 'toll_morsels', 'usage_terms', 'reads_per_minute', 'delivers_data', 'title', 'description', 'tags', 'odps'] as const;

export const datapackageSellCliTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_datapackage_sell',
        handler: ({ client }, input) => {
            const m = /^pkg:([^/@]+)\/([^@]+)(?:@sha256:[a-f0-9]{64})?$/.exec(requiredString(input, 'ref'));
            if (!m) throw new Error('ref must look like "pkg:owner/name"');
            const body = Object.fromEntries(FIELDS.filter(f => input[f] !== undefined).map(f => [f, input[f]])) as JsonObject;
            return client.put(`/v1/datapackages/${encodeURIComponent(m[1]!)}/${encodeURIComponent(m[2]!)}/exchange`, body);
        },
    },
];
