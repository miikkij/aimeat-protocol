/**
 * @file src/mcp/datapackage-resource.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP resource template `aimeat://datapackage/{owner}/{name}`: one data package as a
 *   client attaches it to a conversation, its descriptor and the first rows of each resource, so the
 *   model sees the columns and a sample without a tool call.
 *
 *   It reads as this session (the caller's roles and scopes) through the same service the descriptor
 *   route and aimeat_datapackage_export read through (services/datapackage/store.ts openPackage and
 *   readRows), so a package the session may not read answers "Not found", and a withdrawn one too. The
 *   permission is aimeat_datapackage_export's (mcp/resource-gate.ts). The list names the packages of the
 *   session's account and the members and organism packages it may read; a public package of another
 *   account is read by its address and not listed, because a node's public packages can be thousands.
 * @structure registerDatapackageResource(mcp, storage, config, caller) · DATAPACKAGE_RESOURCE_ROWS
 * @usage registerDatapackageResource(mcp, storage, config, caller);   // from registerCoreDataPackageTools
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D1.6).
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { openPackage, readRows } from '../services/datapackage/store.js';
import { allDatasetFacts, datasetLinks } from '../services/datapackage/catalogue-facts.js';
import { datapackageReadable } from '../services/datapackage/audience.js';

/** Rows of each resource the resource carries: a sample, not the table. */
export const DATAPACKAGE_RESOURCE_ROWS = 20;
/** How many packages the list names at most. */
const LIST_CAP = 200;

export function registerDatapackageResource(
    mcp: McpServer, storage: Storage, config: AimeatConfig, caller: () => CallerContext,
): void {
    const store = { storage, config };
    mcp.registerResource(
        'datapackage',
        new ResourceTemplate('aimeat://datapackage/{owner}/{name}', {
            list: async () => {
                const reader = caller().auth;
                const ownGhii = caller().ownerGhii;
                const out: Array<{ uri: string; name: string; mimeType: string; description: string }> = [];
                for (const f of await allDatasetFacts(storage)) {
                    if (out.length >= LIST_CAP) break;
                    const shared = f.audience === 'members' || f.audience.startsWith('organism:');
                    if (f.ownerGhii !== ownGhii && !shared) continue;
                    if (!(await datapackageReadable(storage, f.ownerGhii, f.audience, reader))) continue;
                    out.push({
                        uri: `aimeat://datapackage/${encodeURIComponent(f.owner)}/${encodeURIComponent(f.name)}`,
                        name: f.title,
                        mimeType: 'application/json',
                        description: `Data package ${f.packageId} (${f.audience}): ${f.resources.map(r => `${r.name}, ${r.rowCount} rows`).join('; ')}`,
                    });
                }
                return { resources: out };
            },
        }),
        { mimeType: 'application/json', description: 'A data package: its descriptor (with the Table Schema) and the first rows of each resource' },
        async (uri, variables) => {
            const owner = decodeURIComponent(String(variables.owner ?? ''));
            const name = decodeURIComponent(String(variables.name ?? ''));
            const ref = `pkg:${owner}/${name}`;
            const reader = caller().auth;
            const opened = await openPackage(store, ref, config.nodeId, reader);
            if (!opened) return { contents: [{ uri: uri.toString(), text: 'Not found' }] };
            const samples: Record<string, unknown> = {};
            for (const r of opened.descriptor.resources) {
                const page = await readRows(store, ref, config.nodeId, r.name, { limit: DATAPACKAGE_RESOURCE_ROWS }, reader);
                if (page) samples[r.name] = { rows: page.rows, total: page.total, returned: page.rows.length };
            }
            const links = datasetLinks(config.baseUrl, {
                owner, name, catalogueId: '', descriptorUrl: opened.descriptorUrl, audience: '',
            });
            return {
                contents: [{
                    uri: uri.toString(),
                    mimeType: 'application/json',
                    text: JSON.stringify({
                        descriptor: opened.descriptor,
                        descriptor_url: opened.descriptorUrl,
                        odata_url: links.odata,
                        odps_url: links.odps,
                        ...(opened.latest ? { latest: opened.latest } : {}),
                        rows: samples,
                        note: `The first ${DATAPACKAGE_RESOURCE_ROWS} rows of each resource. The whole table is at its CSV address; aimeat_datapackage_export with format "url" gives it.`,
                    }),
                }],
            };
        },
    );
}
