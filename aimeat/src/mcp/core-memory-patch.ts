/**
 * @file mcp/core-memory-patch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_memory_write with `patch` on the node MCP: a JSON Merge Patch of an existing
 *   object record, through services/memory-patch/patch.ts, the one implementation PATCH /v1/memory/:key
 *   runs. This door renders; every gate is the service's. The organism namespace rule runs inside the
 *   service here (organismChecked: false), since this door has no route middleware in front of it.
 *   The answer names the version, the bytes and the top-level fields patched, never the merged value.
 * @structure patchFromWriteTool(deps, caller, agentGaii, args)
 * @usage if (mode.mode === 'patch') return patchFromWriteTool({ storage, config, peers }, caller(), agentGaii, args);
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import type { CallerContext } from '../services/caller-context.js';
import { patchMemoryRecord } from '../services/memory-patch/patch.js';
import { readerForAgent } from '../services/classification/reader.js';
import { toolError } from './tool-error.js';

export interface WriteToolPatchArgs {
    key: string;
    patch: unknown;
    visibility?: string;
    tags?: string[];
    ttl_hours?: number;
    owner_scope?: boolean;
    expected_version?: number;
}

/** Run the patch and render the tool result. */
export async function patchFromWriteTool(
    deps: { storage: Storage; config: AimeatConfig; peers?: Map<string, PeerInfo> },
    caller: CallerContext,
    agentGaii: string,
    args: WriteToolPatchArgs,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
    const out = await patchMemoryRecord(deps, {
        auth: caller.auth, caller, reader: readerForAgent(deps, agentGaii, caller.scopes), organismChecked: false,
    }, {
        key: args.key, patch: args.patch, ifVersion: args.expected_version,
        visibility: args.visibility, tags: args.tags, ttlHours: args.ttl_hours, ownerScope: args.owner_scope === true,
    });
    if (!out.ok) {
        const details = out.details !== undefined ? ` ${JSON.stringify(out.details)}` : '';
        return { ...toolError(out.code, out.message + details) };
    }
    // The merged value is NOT echoed: a patch exists so a large record does not travel whole, and an
    // answer carrying it back would put the whole record into the AI's context on every edit.
    const { value: _merged, ...rest } = out.data;
    void _merged;
    return { content: [{ type: 'text', text: JSON.stringify({
        patched: true, ...rest,
        fields: Object.keys(args.patch as Record<string, unknown>),
        read_whole: 'aimeat_memory_read with this key, when you need the whole record',
    }, null, 2) }] };
}
