/**
 * @file src/mcp/file-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tools of where stored files keep their bytes, on the node's MCP endpoint. They do
 *   not do the work: each calls the service function the REST route calls (services/file-store/), so
 *   a chat and a screen read and change the same records the same way. The scope words are applied
 *   where every tool is registered (TOOL_SCOPES, from tool-catalog/definitions/file-store.ts); the
 *   operator test is the caller object's.
 * @structure registerFileStoreTools(mcp, storage, config, caller)
 * @usage import { registerFileStoreTools } from './file-store.js';
 * @version-history
 *   v1.1.0 — 2026-10-30 — Named stores: name and make_default on set, name on remove, to and from on
 *     move; aimeat_admin_file_store_set and aimeat_admin_file_store_remove; a test by name and a move
 *     with from and to (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { localAccountName } from '../utils/gaii.js';
import { OPERATOR_AGENT_REFUSAL } from '../services/owner-lifecycle.js';
import { moveFilesToNodeStore, nodeFileStoreStatus, testNodeFileStore, type FileStoreResult } from '../services/file-store/file-store-admin.js';
import {
  connectOwnerFileStore, decideOwnerFileStore, moveOwnerFiles, ownerFileStoreView, removeOwnerFileStore,
} from '../services/file-store/owner-file-store-actions.js';
import { removeNodeFileStore, setNodeFileStore } from '../services/file-store/node-file-store-actions.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const answer = <T>(r: FileStoreResult<T>) => (r.ok ? text(r.data) : toolError(r.code, r.message));

export function registerFileStoreTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  caller: () => CallerContext,
): void {
  const ctx = { storage, config };
  const reg = (name: string) => ({ description: descriptionFor(name), inputSchema: zodShapeFor(name), annotations: annotationsFor(name) });
  const VISITOR = 'A session from another node has no storage here.';

  mcp.registerTool('aimeat_file_store_get', reg('aimeat_file_store_get'), async () => {
    const c = caller();
    if (c.visitor) return toolError('FORBIDDEN', VISITOR);
    return text(await ownerFileStoreView(ctx, c.owner, { operator: await c.operator() }));
  });

  mcp.registerTool('aimeat_file_store_set', reg('aimeat_file_store_set'), async (input) => {
    const c = caller();
    if (c.visitor) return toolError('FORBIDDEN', VISITOR);
    return answer(await connectOwnerFileStore(ctx, { account: c.owner, actor: c.principal, operator: await c.operator() }, input as Record<string, unknown>));
  });

  mcp.registerTool('aimeat_file_store_remove', reg('aimeat_file_store_remove'), async ({ name }) => {
    const c = caller();
    if (c.visitor) return toolError('FORBIDDEN', VISITOR);
    return answer(await removeOwnerFileStore(ctx, c.owner, name));
  });

  mcp.registerTool('aimeat_file_store_move', reg('aimeat_file_store_move'), async ({ to, from, direction, limit }) => {
    const c = caller();
    if (c.visitor) return toolError('FORBIDDEN', VISITOR);
    return answer(await moveOwnerFiles(ctx, { account: c.owner, operator: await c.operator() }, { to, from, direction, limit }));
  });

  mcp.registerTool('aimeat_admin_file_store', reg('aimeat_admin_file_store'), async () => {
    if (!(await caller().operator())) return toolError('FORBIDDEN', OPERATOR_AGENT_REFUSAL);
    return text(await nodeFileStoreStatus(ctx));
  });

  mcp.registerTool('aimeat_admin_file_store_set', reg('aimeat_admin_file_store_set'), async (input) => {
    const c = caller();
    if (!(await c.operator())) return toolError('FORBIDDEN', OPERATOR_AGENT_REFUSAL);
    return answer(await setNodeFileStore(ctx, c.principal, input as Record<string, unknown>));
  });

  mcp.registerTool('aimeat_admin_file_store_remove', reg('aimeat_admin_file_store_remove'), async ({ name }) => {
    if (!(await caller().operator())) return toolError('FORBIDDEN', OPERATOR_AGENT_REFUSAL);
    return answer(await removeNodeFileStore(ctx, name));
  });

  mcp.registerTool('aimeat_admin_file_store_test', reg('aimeat_admin_file_store_test'), async ({ name }) => {
    if (!(await caller().operator())) return toolError('FORBIDDEN', OPERATOR_AGENT_REFUSAL);
    return answer(await testNodeFileStore(ctx, name));
  });

  mcp.registerTool('aimeat_admin_file_store_move', reg('aimeat_admin_file_store_move'), async ({ limit, after, from, to }) => {
    if (!(await caller().operator())) return toolError('FORBIDDEN', OPERATOR_AGENT_REFUSAL);
    return answer(await moveFilesToNodeStore(ctx, { limit, after, from, to }));
  });

  mcp.registerTool('aimeat_admin_file_store_decide', reg('aimeat_admin_file_store_decide'), async ({ owner, decision, note }) => {
    const c = caller();
    if (!(await c.operator())) return toolError('FORBIDDEN', OPERATOR_AGENT_REFUSAL);
    return answer(await decideOwnerFileStore(ctx, c.principal, { owner: localAccountName(String(owner)), decision, note }));
  });
}
