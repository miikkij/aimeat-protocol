/**
 * @file src/services/organism-read/workspace-access-requests.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The access request records of one organism workspace. GET
 *   /v1/organisms/:id/workspace-access (both branches) and aimeat_workspace_access (action 'list') read
 *   them here (CLAUDE.md, Backend: one capability, one implementation). The lookup only: who may see
 *   the requests and how a status reads (services/workspace/access-decision.ts requestStatus) stay
 *   with each surface.
 * @structure listWorkspaceAccessRequests
 * @usage const items = await listWorkspaceAccessRequests(storage, orgId, ws);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial (structure programme unit 2).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';

/** Every access request record filed on the workspace, up to 1000. */
export async function listWorkspaceAccessRequests(storage: Storage, orgId: string, ws: string): Promise<MemoryRecord[]> {
    const { items } = await storage.listAllMemory({ prefix: `organism.${orgId}.w.${ws}.access.request.`, limit: 1000 });
    return items;
}
