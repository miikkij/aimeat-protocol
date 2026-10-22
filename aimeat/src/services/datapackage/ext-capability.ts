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
 *
 *   THE PUBLISH GATE IS ASKED HERE TOO. A publish that raises the package to public asks the node's
 *   publish gate about the principals behind the run (`publishers`, services/publish-actors.ts), as
 *   POST /v1/datapackages asks about its caller. One the owner is asked about gets the version
 *   published at the level the package had and a request filed, returned as `publishRequest`.
 * @structure makeExtensionDataPackage — the ctx.datapackage factory
 * @usage
 *   const datapackage = makeExtensionDataPackage({ storage, config, ownerGhii, producedBy, publishers });
 *   const ctx = buildExtensionCtx({ …, datapackage });
 * @version-history
 *   v1.3.0 -- 2026-10-22 -- `reader` and `narrowedNote`: an unattended run the owner set to read as
 *     its installer opens and reads packages as that principal, and a package the owner in person
 *     could open but the narrowed principal may not is refused with the note, as ctx.files refuses a
 *     file. Without `reader` nothing changes (secaudit 2026-10, v74).
 *   v1.2.0 -- 2026-10-22 -- publish() asks the node's publish gate about `publishers` before a raise to
 *     public, publishes at the kept level on an ask and returns `publishRequest` (secaudit 2026-10, v68).
 *     An agent without publish:public published public through an extension it installed, or through
 *     its unattended schedule, with no request to the owner.
 *   v1.1.1 -- 2026-10-20 -- open and rows read as the owner in person (ownerAuthOf names the role), so
 *     the store's storage:read rule for the owner's other principals does not apply to an extension
 *     run, attended or unattended (secaudit 2026-10 v41, standing rulings 1 and 5).
 *   v1.1.0 -- 2026-10-17 -- open and rows read as the owner, so a package published members,
 *     organism:<id> or private is read on its audience (plan doc-mvcn6c7e4e5q, V3.8).
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1, A4).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { PublishInput, TableSchema } from './contract.js';
import { inferSchema, validateRows, type ValidationIssue } from './table.js';
import { openPackage, publishPackage, readRows, recordFailure, type ProducedBy } from './store.js';
import { ownerAuthOf, type DatapackageReader } from './audience.js';
import { datapackageGateOf, fileDatapackageAsk } from './publish-ask.js';
import { askActors, type PublishActor } from '../publish-actors.js';
import { localAccountName } from '../../utils/gaii.js';

/** What may cross the sandbox bridge in one call, as serialised JSON. Same number as ctx.files. */
export const MAX_DATAPACKAGE_PAYLOAD_BYTES = 8 * 1024 * 1024;

export interface ExtensionDataPackage {
    publish(input: PublishInput): Promise<{
        packageId: string; contentHash: string; descriptorUrl: string; unchanged: boolean;
        resources: Array<{ name: string; url: string; rowCount: number; bytes: number }>;
        /** Set when making it public waits for the owner: the version is published at the level the package had. */
        publishRequest?: unknown;
        warnings?: Array<{ code: string; message: string }>;
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
    /**
     * The principals the node's publish gate is asked about before a publish raises the package to
     * public (services/publish-actors.ts): the caller of an attended action, the installer of an
     * unattended one, and a workflow run's principal. Absent asks nothing, as before.
     */
    publishers?: readonly PublishActor[];
    /**
     * Who open() and rows() read AS, when narrower than the owner in person: an unattended run the
     * owner set to read as the principal that wrote the code (extension-system-run.ts). Absent, they
     * read as the owner in person, as they always have. Writes never use it.
     */
    reader?: DatapackageReader;
    /** Said in the refusal when `reader` is what kept a package out, so the owner can change it. */
    narrowedNote?: string;
}): ExtensionDataPackage {
    const { config, storage, ownerGhii, producedBy } = deps;
    const store = { storage, config };
    const readAs = deps.reader ?? ownerAuthOf(ownerGhii);
    /**
     * After a narrowed read found nothing: when the owner in person would have opened the same
     * package, the narrowing kept it out, and the run is told so with the owner's way to change it
     * (ctx.files throws the same way). A package nobody here may read stays an ordinary null.
     */
    const refuseIfNarrowed = async (ref: string): Promise<void> => {
        if (!deps.reader) return;
        if (!(await openPackage(store, ref, config.nodeId, ownerAuthOf(ownerGhii)))) return;
        throw new Error(`Access denied for data package "${ref}".${deps.narrowedNote ? ` ${deps.narrowedNote}` : ''}`);
    };

    return {
        async publish(input) {
            guardSize('the package payload', input);
            // The publish gate, as POST /v1/datapackages asks it (./publish-ask.ts): a raise to public
            // by a principal the owner is asked about publishes at the level the package had (a first
            // version private) and files the request after. A refusal (nobody on this node to ask)
            // throws, as every other refusal here does.
            const gate = deps.publishers
                ? await datapackageGateOf(store, () => askActors(store, deps.publishers!), ownerGhii, String(input?.name ?? ''),
                    input?.visibility !== undefined ? String(input.visibility) : undefined)
                : null;
            if (gate?.kind === 'refused') throw new Error(`${gate.code}: ${gate.message}`);
            const level = gate?.kind === 'go' ? gate.visibility : undefined;
            const out = await publishPackage(store, ownerGhii, level !== undefined ? { ...input, visibility: level } : input, producedBy);
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
            // Published at the level the package had, and making it public waits for the owner: a
            // return, not a throw, because the version did land. `publishRequest` says what to tell them.
            const asked = gate?.kind === 'go' && gate.requester
                ? await fileDatapackageAsk(store, localAccountName(ownerGhii), gate.requester, ownerGhii, input.name, out.contentHash, gate.from)
                : null;
            return {
                packageId: out.descriptor.aimeat.packageId,
                contentHash: out.contentHash,
                descriptorUrl: out.descriptorUrl,
                unchanged: out.unchanged,
                resources: out.resources,
                ...(asked?.publish_request ? { publishRequest: asked.publish_request } : {}),
                ...(asked?.warnings ? { warnings: asked.warnings } : {}),
                ...(gate?.kind === 'go' && gate.warning ? { warnings: [gate.warning] } : {}),
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
            // An extension reads as its owner: their own packages, public ones, and those whose
            // audience admits the owner (./audience.ts). A run the owner narrowed reads as `reader`.
            const opened = await openPackage(store, String(ref || ''), config.nodeId, readAs);
            if (!opened) await refuseIfNarrowed(String(ref || ''));
            return opened ? { ...opened.descriptor, descriptorUrl: opened.descriptorUrl } : null;
        },

        async rows(ref, resource, opts) {
            const out = await readRows(store, String(ref || ''), config.nodeId, String(resource || ''), opts ?? {}, readAs);
            if (!out) await refuseIfNarrowed(String(ref || ''));
            return out;
        },

        async fail(name, message) {
            // The producer saying so itself, for the case it can detect and the road cannot: an
            // upstream that answered with an empty body, a source that returned yesterday's file.
            // The run should ALSO throw; this is what leaves the reason on the package.
            await recordFailure(store, ownerGhii, String(name || ''), String(message || 'the run failed'));
        },
    };
}
