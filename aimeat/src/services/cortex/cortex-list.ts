/**
 * @file src/services/cortex/cortex-list.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The cortexes a caller may see, read with the fence every cortex list applies:
 *   public ones, the node's own bundled ones, the caller's own, and everything for an operator
 *   (services/cortex-lifecycle.ts visibleCortexes). GET /v1/cortex, GET /v1/portal/prompts/:promptId,
 *   aimeat_cortex_list and the MCP prompt variable `cortex_extensions` read here (CLAUDE.md, Backend:
 *   one capability, one implementation). The filters narrow the query; the fence decides what they
 *   may narrow over. Each surface builds its own caller.
 * @structure listVisibleCortexes
 * @usage const exts = await listVisibleCortexes(storage, caller, config.nodeId, { status: 'active' });
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial (structure programme unit 2).
 */
import type { Storage, CortexExtensionRecord } from '../../storage/interface.js';
import { visibleCortexes, type CortexCaller } from '../cortex-lifecycle.js';

export type CortexListFilter = NonNullable<Parameters<Storage['listCortexExtensions']>[0]>;

/** The cortexes matching `filter` that `caller` may see. */
export async function listVisibleCortexes(
    storage: Storage, caller: Pick<CortexCaller, 'ownerName' | 'isOperator'>, nodeId: string, filter: CortexListFilter,
): Promise<CortexExtensionRecord[]> {
    return visibleCortexes(caller, await storage.listCortexExtensions(filter), nodeId);
}
