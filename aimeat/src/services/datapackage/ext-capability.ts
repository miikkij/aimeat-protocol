/**
 * @file src/services/datapackage/ext-capability.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `ctx.datapackage` — the data-package contract as a HOST capability, because a
 *   sandboxed extension cannot load a shared library and the deterministic producers live there.
 *
 *   WHY A HOST CAPABILITY AND NOT A LIBRARY. Extension actions run in QuickJS with no module
 *   loader: the guest sees `ctx` and nothing else, and `ctx.fetch` answers with `text`, so even
 *   pulling the library over HTTP and eval'ing it is not a road. That was the open question in the
 *   spec, and this is the decided answer — the library's WORK (schema inference, validation, the
 *   content hash, canonical CSV, the storage writes, the catalogue entry) happens on the host, and
 *   the guest calls it. The browser binding and the MCP tools reach the SAME functions in
 *   ./store.js, so a package built by an extension, an app and an agent is byte-identical.
 *
 *   PUBLISH THROWS WHEN THE GATE REFUSES. It does not return `{ ok: false }`, and that is not an
 *   ergonomic preference: the scheduler and the workflow engine both record a normal return as a
 *   successful run, so a producer whose data failed validation would show green having published
 *   nothing. A throw is the only shape that reaches the owner on every road. `validate()` is the
 *   separate, non-throwing call for a producer that wants to look before it leaps.
 *
 *   THE SIZE CEILING IS THE BRIDGE, not the file limit. Rows cross as one JSON string through
 *   `vm.getString`, inside a sandbox whose memory ceiling is tens of megabytes, so the payload is
 *   capped at the same 8 MB as `ctx.files` — one number for "what may cross in one call", refused
 *   with a message naming the alternative rather than left to exhaust the VM.
 * @structure makeExtensionDataPackage — the ctx.datapackage factory
 * @usage
 *   const datapackage = makeExtensionDataPackage({ storage, config, ownerGhii, producedBy });
 *   const ctx = buildExtensionCtx({ …, datapackage });
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1, A4).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { PublishInput, TableSchema } from './contract.js';
import { inferSchema, validateRows, type ValidationIssue } from './table.js';
import { openPackage, publishPackage, readRows, recordFailure, type ProducedBy } from './store.js';

/** What may cross the sandbox bridge in one call, as serialised JSON. Same number as ctx.files. */
export const MAX_DATAPACKAGE_PAYLOAD_BYTES = 8 * 1024 * 1024;

export interface ExtensionDataPackage {
    publish(input: PublishInput): Promise<{
        packageId: string; contentHash: string; descriptorUrl: string; unchanged: boolean;
        resources: Array<{ name: string; url: string; rowCount: number; bytes: number }>;
    }>;
    validate(resources: Array<{ name: string; rows: Array<Record<string, unknown>>; schema: 'infer' | TableSchema }>):
        Promise<{ ok: boolean; issues: ValidationIssue[]; schemas: Record<string, TableSchema> }>;
    inferSchema(rows: Array<Record<string, unknown>>): Promise<TableSchema>;
    open(ref: string): Promise<unknown | null>;
    rows(ref: string, resource: string, opts?: { offset?: number; limit?: number; select?: string[] }):
        Promise<{ rows: Array<Record<string, unknown>>; total: number; schema: TableSchema } | null>;
    fail(name: string, message: string): Promise<void>;
}

/** Refuse an oversized payload at the boundary, naming what to do instead. */
function guardSize(what: string, value: unknown): void {
    const bytes = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
    if (bytes > MAX_DATAPACKAGE_PAYLOAD_BYTES) {
        throw new Error(
            `${what} is ${Math.round(bytes / 1024)} kB, over the ${MAX_DATAPACKAGE_PAYLOAD_BYTES / 1024 / 1024} MB sandbox `
            + 'bridge limit. Publish the table in periods (one package version per window) rather than one '
            + 'unbounded version, or produce it from a road with no sandbox between it and the data.');
    }
}

export function makeExtensionDataPackage(deps: {
    config: AimeatConfig;
    storage: Storage;
    /**
     * WHOSE package this is. Always the owner's GHII, on every road — never the agent GAII and never
     * `scheduler@node`. A package produced from the app, on a clock, by a workflow step or by an
     * agent must land at ONE permanent address, or the producer is not interchangeable.
     */
    ownerGhii: string;
    /** Who actually produced it, for the provenance block. The exact principal, not the owner. */
    producedBy: ProducedBy;
}): ExtensionDataPackage {
    const { config, storage, ownerGhii, producedBy } = deps;
    const store = { storage, config };

    return {
        async publish(input) {
            guardSize('the package payload', input);
            const out = await publishPackage(store, ownerGhii, input, producedBy);
            if (!out.ok) {
                // THROW, do not return a verdict. See the file header: an unattended road records a
                // normal return as success, so a returned refusal is a green run that published
                // nothing. The first coordinates travel in the message because a producer reading a
                // log needs the row and the column, not a count.
                const head = out.issues.slice(0, 5)
                    .map(i => `${i.resource} row ${i.row}, ${i.field}: ${i.message}`)
                    .join('; ');
                throw new Error(`${out.code}: ${out.message}${head ? ` — ${head}` : ''}`);
            }
            return {
                packageId: out.descriptor.aimeat.packageId,
                contentHash: out.contentHash,
                descriptorUrl: out.descriptorUrl,
                unchanged: out.unchanged,
                resources: out.resources,
            };
        },

        async validate(resources) {
            guardSize('the resources to validate', resources);
            const issues: ValidationIssue[] = [];
            const schemas: Record<string, TableSchema> = {};
            for (const r of Array.isArray(resources) ? resources : []) {
                const schema = r.schema === 'infer' ? inferSchema(r.rows ?? []) : (r.schema as TableSchema);
                schemas[r.name] = schema;
                issues.push(...validateRows(r.name, r.rows ?? [], schema));
            }
            return { ok: issues.length === 0, issues, schemas };
        },

        async inferSchema(rows) {
            guardSize('the rows to infer from', rows);
            // A PROPOSAL. It is returned so the producer can look at it, adjust it and declare it;
            // publishing with `schema: 'infer'` records `schemaSource: 'inferred'` in the descriptor
            // so a consumer can see that nobody confirmed the types.
            return inferSchema(Array.isArray(rows) ? rows : []);
        },

        async open(ref) {
            const opened = await openPackage(store, String(ref || ''), config.nodeId);
            return opened ? { ...opened.descriptor, descriptorUrl: opened.descriptorUrl } : null;
        },

        async rows(ref, resource, opts) {
            return readRows(store, String(ref || ''), config.nodeId, String(resource || ''), opts ?? {});
        },

        async fail(name, message) {
            // The producer saying so itself, for the case it can detect and the road cannot: an
            // upstream that answered with an empty body, a source that returned yesterday's file.
            // The run should ALSO throw; this is what leaves the reason on the package.
            await recordFailure(store, ownerGhii, String(name || ''), String(message || 'the run failed'));
        },
    };
}
