/**
 * @file src/services/extension-workspace-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `ctx.workspace.appendRows` and `readRows`: the two calls an extension makes on an
 *   organism ROW space, and the capability a schedule or a workflow step gets, which is those two
 *   and nothing else.
 *
 *   THE ROW CALLS DO NOT ACT AS THE CALLER. They take the row service's extension code path
 *   (workspace-rows/row-service.ts, authorizeExtension): the space names the extension as
 *   `installer/name` in `objectTypes[].extensions`, the manifest declares `workspace.rows`, and the
 *   installer is an active member. The organism's naming is the grant and opens one space. Because
 *   the caller is not consulted, the calls work the same on a request, a schedule and a workflow
 *   step, and an extension whose action is public decides itself, from ctx.caller, whose calls may
 *   append. A row records `ext:<name>` as its writer.
 *
 *   ITS OWN MODULE because the unattended code path (extension-system-run.ts) imports it, and the
 *   full sandbox binding (extension-workspace.ts) reaches workspace-tool-ops.ts → memory-write.ts →
 *   the scheduler and the workflow engine, which import extension-system-run.ts: the cycle
 *   dependency-cruiser refuses. This module imports only the row service.
 * @structure RowCalls · buildRowCalls() · buildUnattendedExtensionWorkspace()
 * @usage
 *   workspace: buildUnattendedExtensionWorkspace({ config, storage, ext, ownerGhii }).workspace
 * @version-history
 *   v1.0.1 — 2026-10-09 — archiveRecords is refused here like the other record calls: it needs a caller.
 *   v1.0.0 — 2026-10-08 — Initial (aimeat-soc core), split from extension-workspace.ts at the cycle.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import type { ExtensionCtx } from './extension-runtime.js';
import { systemReader, type ContentReader } from './classification/reader.js';
import { workspaceDeclarationOf, type WorkspaceDeclaration } from './extension-workspace-declaration.js';
import { appendRows, readRows, WorkspaceRowError, type RowCaller } from './workspace-rows/row-service.js';

/** A refusal a capability made, kept so the code path can answer with the service's status. */
export interface ExtensionWorkspaceRefusal { status: number; code: string; message: string }

/** The two row calls, the same on every code path that runs the extension. */
export type RowCalls = Pick<NonNullable<ExtensionCtx['workspace']>, 'appendRows' | 'readRows'>;

/** appendRows and readRows through the row service's extension path. See the file header. */
export function buildRowCalls(args: {
    config: AimeatConfig; storage: Storage; extName: string; installer: string;
    declaration: WorkspaceDeclaration; reader: ContentReader;
    refuse: (status: number, code: string, message: string) => never;
}): RowCalls {
    const { config, storage, extName, installer, declaration, reader, refuse } = args;
    const deps = { storage, config };
    const rowCaller: RowCaller = {
        principal: `ext:${extName}`, identity: `ext:${extName}`, owner: installer,
        roles: ['extension'], extension: extName,
    };
    const allowRows = (): void => {
        if (!declaration.rows) {
            refuse(403, 'PERMISSION', `Extension "${extName}" does not declare row access (manifest workspace.rows).`);
        }
    };
    const rowCall = async <T>(fn: () => Promise<T>): Promise<T> => {
        try { return await fn(); } catch (err) {
            if (err instanceof WorkspaceRowError) return refuse(err.statusCode, err.code, err.message);
            throw err;
        }
    };
    return {
        appendRows: async (organismId, ws, space, rows) => {
            allowRows();
            if (!Array.isArray(rows) || rows.length === 0) refuse(400, 'NO_ROWS', 'appendRows() needs a non-empty array of { body, rowId?, occurredAt? }');
            return rowCall(() => appendRows(deps, rowCaller, { organismId, wsId: ws, space, rows }));
        },
        readRows: async (organismId, ws, space, opts) => {
            allowRows();
            const o = opts ?? {};
            return rowCall(() => readRows(deps, rowCaller, {
                organismId, wsId: ws, space, reader,
                ...(o.where ? { where: o.where } : {}),
                ...(o.since ? { since: o.since } : {}),
                ...(o.until ? { until: o.until } : {}),
                ...(o.changedSince ? { changedSince: o.changedSince } : {}),
                ...(o.limit ? { limit: o.limit } : {}),
                ...(o.cursor ? { cursor: o.cursor } : {}),
                ...(o.order ? { order: o.order } : {}),
            }));
        },
    };
}

export interface UnattendedExtensionWorkspaceDeps {
    config: AimeatConfig;
    storage: Storage;
    ext: Pick<ExtensionRecord, 'name' | 'config' | 'installedBy'>;
    /** The installer's GHII: whose data space the classification reader reads in. */
    ownerGhii: string;
}

/**
 * The capability a schedule or a workflow step gets: ONLY the two row calls, and only when the
 * manifest declares `workspace.rows`. Nobody is present, so nothing here acts as a caller: the
 * record and document calls throw PERMISSION.
 */
export function buildUnattendedExtensionWorkspace(deps: UnattendedExtensionWorkspaceDeps): {
    workspace?: NonNullable<ExtensionCtx['workspace']>; lastRefusal?: () => ExtensionWorkspaceRefusal | null;
} {
    const declaration = workspaceDeclarationOf(deps.ext);
    if (!declaration?.rows) return {};
    const extName = deps.ext.name;
    let last: ExtensionWorkspaceRefusal | null = null;
    const refuse = (status: number, code: string, message: string): never => {
        last = { status, code, message };
        throw new Error(`${code}: ${message}`);
    };
    const unattended = (): never => refuse(403, 'PERMISSION',
        `Extension "${extName}" runs with nobody present here (a schedule or a workflow step), so it may only append to and read row spaces that name it. Records and documents need a caller.`);
    const rows = buildRowCalls({
        config: deps.config, storage: deps.storage, extName, installer: deps.ext.installedBy,
        declaration, reader: systemReader({ storage: deps.storage, config: deps.config }, deps.ownerGhii), refuse,
    });
    const workspace: NonNullable<ExtensionCtx['workspace']> = {
        index: async () => unattended(),
        get: async () => unattended(),
        write: async () => unattended(),
        writeDoc: async () => unattended(),
        publish: async () => unattended(),
        publishRecords: async () => unattended(),
        deleteRecords: async () => unattended(),
        archiveRecords: async () => unattended(),
        ...rows,
    };
    return { workspace, lastRefusal: () => last };
}
