/**
 * @file src/services/extension-workspace.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `ctx.workspace`: an organism workspace, reachable from inside the extension sandbox
 *   AS THE CALLER. Before this, a sandboxed script could reach its own `ext:` namespace and the
 *   outside internet, and nothing in between: an app tool that resolved to an extension ran as the
 *   caller (the caller's token travels to POST /v1/ext/:name/:action) and still could not read or
 *   write one workspace record on that caller's behalf, because `ctx.memory` is fenced to `ext:`
 *   and `ctx.fetch` cannot reach the node. A claims board, an incident log or a hand-off document
 *   the members share could therefore not be kept by the extension that gates it.
 *
 *   ONE IMPLEMENTATION. Every call here runs the same function the MCP tool runs
 *   (services/workspace-tool-ops.ts: aimeat_workspace_read, _write, _publish), with the caller
 *   resolved the way those tools resolve it. Membership, the organism namespace rule, schema
 *   validation, the archive flags, the memory ceilings, provenance, the publish gate: none of it is
 *   restated here, and a refusal reaches the script as a thrown `CODE: message` with the service's
 *   own words. There is no loopback HTTP call and no `storage.*` access in this file.
 *
 *   THE GUARDS, all of them, in the order they apply:
 *     1. The manifest declares it (`workspace: { read, write }`), validated on install and stored
 *        as `config.__workspace`, a key a manifest's own `config:` cannot set. Undeclared means
 *        `ctx.workspace` is undefined; read-only means the writers throw PERMISSION.
 *     2. There is a real caller. A scheduled run and a workflow step have nobody present, so those
 *        code paths attach only the two row calls (extension-workspace-rows.ts), and only
 *        when the manifest declares `workspace.rows`.
 *
 *   THE ROW CALLS ARE THE EXCEPTION TO "AS THE CALLER". appendRows and readRows take the row
 *   service's extension path on every code path: the space names the extension
 *   (`objectTypes[].extensions`, as installer/name), the manifest declares `workspace.rows`, and the INSTALLER is an
 *   active member. The organism's naming is the grant, it opens one space and nothing else, and the
 *   caller of the action is not consulted, so an extension whose action is public decides itself
 *   (from ctx.caller) whose calls may append.
 *     3. The caller's own authority. An owner session may. An agent, app-grant or ecosystem token
 *        holds `memory:write` to write or publish, `memory:purge` to remove records for good
 *        (deleteRecords) and `organism:read` to read — the words the
 *        REST routes and aimeat_workspace_write enforce for the same acts — and the test is the
 *        same scopeIsCovered() requireScope asks, so a wildcard is read the same way on this door.
 *     4. Every call counts against the sandbox's maxApiCalls, like a fetch (extension-runtime.ts).
 *     5. A written record carries provenance: level 'ai-generated', method 'fully-generated', the
 *        pipeline `ext.<name>.<action>` naming the extension, stamped by the NODE (it ran the
 *        script) rather than declared by the caller, so no provenance:write is asked of a token
 *        that only holds memory:write. The bytes were produced by a script, not typed by the
 *        person whose name is on the record.
 * @structure
 *   - workspaceDeclarationOf() — the manifest's declaration, read from the record
 *   - buildExtensionWorkspace() — the capability plus a recorder of the last refusal
 *   - attachExtensionWorkspace() — what a road passes to buildExtensionCtx, or nothing
 *   - workspaceRefusalFor() — turn a script's thrown refusal back into the service's status and code
 * @usage
 *   const wsCap = attachExtensionWorkspace({ config, storage, ext, actionId, caller: { gaii, owner, roles, scopes } });
 *   const ctx = buildExtensionCtx({ …, workspace: wsCap.workspace });
 *   … catch (err) { const r = workspaceRefusalFor(err, wsCap); if (r) res.status(r.status).json(error(…, r.code, r.message)); }
 * @version-history
 *   v1.4.0 — 2026-10-09 — archiveRecords: up to 500 records of one space archived in one host call,
 *     through services/archive.ts archiveRecordsBatchOp, under the archive route's rule (organism:write
 *     of a token, creator or admin of the organism). For Lifecycle Central's closed claims.
 *   v1.3.0 — 2026-10-08 — appendRows and readRows (manifest workspace.rows), through the row
 *     service's extension path, built in extension-workspace-rows.ts, which also gives a schedule or
 *     a workflow step those two calls and nothing else (its own module, at the import cycle
 *     extension-system-run.ts would otherwise close). For the aimeat-soc alert ingest.
 *   v1.2.0 — 2026-10-06 — publishRecords and deleteRecords: a batch in ONE host call, through
 *     services/workspace-tool-ops.ts, the functions the two batch routes run. 500 records were 1000
 *     calls through write() + publish() and could not fit the 500-call ceiling. A token needs
 *     memory:write to publish the batch and memory:purge to delete it, as on the routes.
 *   v1.1.1 — 2026-10-05 — The account holder in person is asked with isOwnerInPerson (utils/gaii.ts;
 *     secaudit 2026-10, C4).
 *   v1.1.0 — 2026-09-29 — index and get pass the caller's classification reader to readWorkspaceOp
 *     (TARGET-082).
 *   v1.0.0 — 2026-09-05 — Initial: the gap the Coding Central app tools (claim_open, claim_release,
 *     incident_open, board_read, …) could not be built across.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import type { ExtensionCtx } from './extension-runtime.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { isOwnerInPerson } from '../utils/gaii.js';
import { readerForCaller } from './classification/reader.js';
import { workspaceDeclarationOf, type WorkspaceDeclaration } from './extension-workspace-declaration.js';
import {
    workspaceCallerOf, readWorkspaceOp, writeWorkspaceDraftsOp, publishWorkspaceOp,
    publishRecordsBatchOp, deleteRecordsBatchOp,
    type WorkspaceOpRefusal, type WorkspaceOpsCaller,
} from './workspace-tool-ops.js';
import { buildRowCalls, type ExtensionWorkspaceRefusal } from './extension-workspace-rows.js';
import { archiveRecordsBatchOp } from './archive.js';
import { emitChange } from './event-bus.js';

// The declaration itself (WorkspaceDeclaration, WORKSPACE_DECLARATION_KEY, workspaceDeclarationOf)
// is the leaf module extension-workspace-declaration.ts, so the manifest builder and the CRUD
// routes can read it without importing the whole sandbox binding. Re-exported for callers here.
export { WORKSPACE_DECLARATION_KEY, workspaceDeclarationOf, type WorkspaceDeclaration } from './extension-workspace-declaration.js';

/** The scope an agent, app-grant or ecosystem token needs to WRITE or PUBLISH a workspace record:
 *  the word aimeat_workspace_write, aimeat_workspace_publish and the REST draft routes enforce. */
export const WORKSPACE_WRITE_SCOPE = 'memory:write';
/** The scope such a token needs to READ a workspace: what GET /v1/organisms/:id/workspace asks. */
export const WORKSPACE_READ_SCOPE = 'organism:read';
/** The scope such a token needs to REMOVE records for good (deleteRecords): what
 *  POST /v1/organisms/:id/workspace/records/delete asks since 2026-10-02. */
export const WORKSPACE_PURGE_SCOPE = 'memory:purge';
/** The scope such a token needs to ARCHIVE records (archiveRecords): what
 *  POST /v1/organisms/:id/archive asks. */
export const WORKSPACE_ARCHIVE_SCOPE = 'organism:write';

/** A refusal the capability made, kept so the road can answer with the service's status and code
 *  rather than a generic EXTENSION_ERROR 500. Declared in extension-workspace-rows.ts. */
export type { ExtensionWorkspaceRefusal } from './extension-workspace-rows.js';

export interface ExtensionWorkspaceDeps {
    config: AimeatConfig;
    storage: Storage;
    extName: string;
    actionId: string;
    declaration: WorkspaceDeclaration;
    /** The extension's installer (bare name): whose membership the row calls stand on. */
    installer: string;
    /** Who invoked the action: the resolved principal, the bare owner name, the session's roles
     *  and scopes. The scopes decide the authority question for anything that is not an owner. */
    caller: { gaii: string; owner: string; roles: string[]; scopes: string[] };
}

export interface ExtensionWorkspaceCapability {
    workspace: NonNullable<ExtensionCtx['workspace']>;
    /** The most recent refusal this capability threw, or null. */
    lastRefusal: () => ExtensionWorkspaceRefusal | null;
}

/**
 * Build the capability. Everything the guest can call goes through `run`, which turns a refusal
 * into a thrown `CODE: message` and remembers it, so the script sees the service's words and the
 * road can still answer with the service's status.
 */
export function buildExtensionWorkspace(deps: ExtensionWorkspaceDeps): ExtensionWorkspaceCapability {
    const { config, storage, extName, actionId, declaration, caller } = deps;
    // The ws ops below act AS the caller; the row calls stand on the installer (buildRowCalls).
    const ops = { storage, config };
    const opsCaller: WorkspaceOpsCaller = workspaceCallerOf({ principal: caller.gaii, ownerName: caller.owner, roles: caller.roles }, config);
    // The classification reader of the caller who invoked the action (TARGET-082).
    const reader = readerForCaller({ storage, config }, caller);
    let last: ExtensionWorkspaceRefusal | null = null;

    const refuse = (status: number, code: string, message: string): never => {
        last = { status, code, message };
        throw new Error(`${code}: ${message}`);
    };
    const settle = <T>(r: { ok: true; data: T } | WorkspaceOpRefusal): T => {
        if (r.ok) return r.data;
        return refuse(r.status, r.code, r.message);
    };

    /** Guard 1 and 3 for a call of the given kind. A purge or an archive is a write the manifest declares as write. */
    const allow = (kind: 'read' | 'write' | 'purge' | 'archive'): void => {
        if (kind === 'read' && !declaration.read) {
            refuse(403, 'PERMISSION', `Extension "${extName}" does not declare workspace read access (manifest workspace.read).`);
        }
        if (kind !== 'read' && !declaration.write) {
            refuse(403, 'PERMISSION', `Extension "${extName}" does not declare workspace write access (manifest workspace.write).`);
        }
        // The test requireScope makes before it asks for a word: an owner in person bypasses scopes;
        // an agent, an app grant or an ecosystem app does not.
        if (isOwnerInPerson(caller)) return;
        const scope = kind === 'write' ? WORKSPACE_WRITE_SCOPE : kind === 'purge' ? WORKSPACE_PURGE_SCOPE
            : kind === 'archive' ? WORKSPACE_ARCHIVE_SCOPE : WORKSPACE_READ_SCOPE;
        if (!scopeIsCovered(caller.scopes, scope)) {
            const act = kind === 'purge' ? 'remove records from' : kind === 'archive' ? 'archive records in' : kind;
            refuse(403, 'SCOPE_DENIED', `Scope "${scope}" required to ${act} a workspace through extension "${extName}". Caller scopes: [${caller.scopes.join(', ')}]`);
        }
    };

    // Guard 5: what an extension-written record says about itself. A script produced the bytes;
    // the person on the record did not type them. This is the NODE's stamp (it ran the script), not
    // a declaration by the caller, which is why it needs no provenance:write on the caller's token:
    // an agent holding only memory:write could otherwise never write through an extension at all.
    // The pipeline names the extension and the action, and lands in the record's notes.
    const provenance = { level: 'ai-generated' as const, method: 'fully-generated' as const };
    const pipeline = `ext.${extName}.${actionId}`;

    const workspace: NonNullable<ExtensionCtx['workspace']> = {
        index: async (organismId, ws) => {
            allow('read');
            return settle(await readWorkspaceOp(ops, opsCaller, { organismId, ws, reader }));
        },
        get: async (organismId, ws, ids, opts) => {
            allow('read');
            if (!Array.isArray(ids) || ids.length === 0) refuse(400, 'INVALID_INPUT', 'get() needs a non-empty array of instance ids');
            return settle(await readWorkspaceOp(ops, opsCaller, { organismId, ws, ids: ids.map(String), space: opts?.space, reader }));
        },
        write: async (organismId, ws, space, id, value, opts) => {
            allow('write');
            // `ifVersion: 0` is "only if there is no draft yet", the same meaning ctx.memory.set
            // gives it; the service spells that `null`.
            const ifVersion = opts?.ifVersion === undefined ? undefined : (opts.ifVersion === 0 ? null : opts.ifVersion);
            return settle(await writeWorkspaceDraftsOp(ops, opsCaller, {
                organismId, ws, space, id, value, pipeline, nodeStamp: provenance,
                ...(ifVersion !== undefined ? { ifVersion } : {}),
            }));
        },
        writeDoc: async (organismId, ws, space, doc, opts) => {
            allow('write');
            if (!doc || typeof doc !== 'object' || typeof doc.markdown !== 'string') {
                refuse(400, 'INVALID_INPUT', 'writeDoc() needs { title, markdown }');
            }
            return settle(await writeWorkspaceDraftsOp(ops, opsCaller, {
                organismId, ws, space, id: opts?.id, section: opts?.section,
                value: { title: doc.title, markdown: doc.markdown }, pipeline, nodeStamp: provenance,
            }));
        },
        publish: async (organismId, ws, namespace, id, opts) => {
            allow('write');
            return settle(await publishWorkspaceOp(ops, opsCaller, { organismId, ws, namespace, id, expectedVersion: opts?.expectedVersion ?? null }));
        },
        // The batch: ONE host call, one bulk write, the function POST .../workspace/records/publish
        // runs. Every direct value gets the node's provenance stamp, as write() gives a draft.
        publishRecords: async (organismId, ws, namespace, records, opts) => {
            allow('write');
            if (!Array.isArray(records) || records.length === 0) refuse(400, 'INVALID_INPUT', 'publishRecords() needs a non-empty array of { id, value, visibility? }');
            return settle(await publishRecordsBatchOp(ops, opsCaller, {
                organismId, ws, namespace, records,
                expectedVersions: opts?.expectedVersions, createOnly: opts?.createOnly === true, dryRun: opts?.dryRun === true,
                nodeStamp: { pipeline, level: provenance.level, method: provenance.method },
            }));
        },
        // Removing records for good asks memory:purge of a token, as POST .../workspace/records/delete does.
        deleteRecords: async (organismId, ws, namespace, ids) => {
            allow('purge');
            if (!Array.isArray(ids) || ids.length === 0) refuse(400, 'INVALID_INPUT', 'deleteRecords() needs a non-empty array of instance ids');
            return settle(await deleteRecordsBatchOp(ops, opsCaller, { organismId, ws, namespace, ids }));
        },
        // Archiving is undoable and asks what POST /v1/organisms/:id/archive asks: organism:write of a
        // token, and the creator or an admin of the organism (services/archive.ts archiveRoleOf).
        archiveRecords: async (organismId, ws, namespace, ids) => {
            allow('archive');
            const r = await archiveRecordsBatchOp(storage, { principal: caller.gaii, ownerName: caller.owner }, { organismId, ws, namespace, ids });
            if (r.ok) emitChange('organisms');
            return settle(r);
        },
        ...buildRowCalls({ config, storage, extName, installer: deps.installer, declaration, reader, refuse }),
    };

    return { workspace, lastRefusal: () => last };
}

export interface AttachExtensionWorkspaceArgs {
    config: AimeatConfig;
    storage: Storage;
    ext: Pick<ExtensionRecord, 'name' | 'config' | 'installedBy'>;
    actionId: string;
    caller: { gaii: string; owner: string; roles: string[]; scopes: string[] };
}

/** What a road hands to buildExtensionCtx: the capability when the manifest declares it, and
 *  otherwise an absent one, so the guest sees `undefined` exactly as it does for ctx.files. */
export function attachExtensionWorkspace(args: AttachExtensionWorkspaceArgs): Partial<ExtensionWorkspaceCapability> {
    const declaration = workspaceDeclarationOf(args.ext);
    if (!declaration) return {};
    return buildExtensionWorkspace({
        config: args.config, storage: args.storage, extName: args.ext.name, actionId: args.actionId,
        declaration, installer: args.ext.installedBy, caller: args.caller,
    });
}

/**
 * Was this thrown error the capability's own refusal? The bridge carries a string across the VM
 * boundary, so the code survives only as the message's prefix; the recorder is what makes the
 * status recoverable. A script that caught the refusal and threw something else is answered as an
 * ordinary script failure, which is what it made itself into.
 */
export function workspaceRefusalFor(err: unknown, cap: Partial<ExtensionWorkspaceCapability>): ExtensionWorkspaceRefusal | null {
    const last = cap.lastRefusal?.();
    if (!last) return null;
    const message = err instanceof Error ? err.message : String(err);
    return message.includes(last.message) ? last : null;
}
