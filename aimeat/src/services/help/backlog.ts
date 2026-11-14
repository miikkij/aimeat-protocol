/**
 * @file src/services/help/backlog.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Add to the development queue" for a suggestion in the report of Ask someone who knows:
 *   the suggestion becomes a document in the workspace the operator named (`helpBacklogWorkspace`,
 *   `<organism id>/<workspace id>[/<space>]`, the space `notes` when none is named). It is written and
 *   published in the operator's own name through the same workspace operations aimeat_workspace_write
 *   and aimeat_workspace_publish use, so the workspace's roles and rules decide, not this file.
 * @structure writeWorkspaceDocument
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import type { CallerContext } from '../caller-context.js';
import { writeWorkspaceDraftsOp, publishWorkspaceOp } from '../workspace/tool-ops.js';
import { workspaceCallerOf } from '../workspace/ops-caller.js';
import { refuse, type HelpDeps, type HelpResult } from './rules.js';

export async function writeWorkspaceDocument(deps: HelpDeps, caller: CallerContext, organismId: string, wsAndSpace: string,
  doc: { title: string; markdown: string }): Promise<HelpResult<{ ref: string }>> {
  const [ws, space = 'notes'] = wsAndSpace.split('/');
  const wsCaller = workspaceCallerOf({ principal: caller.principal, ownerName: caller.owner, roles: [...caller.roles], scopes: caller.scopes }, deps.config);
  const written = await writeWorkspaceDraftsOp(deps, wsCaller, {
    organismId, ws, space, value: doc, pipeline: 'help.report.suggestion',
  });
  if (!written.ok) return refuse(written.status, written.code, `The development queue did not take the suggestion: ${written.message}`);
  const id = String((written.data as { id?: unknown }).id ?? '');
  if (!id) return refuse(500, 'NOT_WRITTEN', 'The development queue answered without a document id.');
  const published = await publishWorkspaceOp(deps, wsCaller, { organismId, ws, namespace: space, id, expectedVersion: null });
  if (!published.ok) return refuse(published.status, published.code, `The suggestion was written as a draft but not published: ${published.message}`);
  return { ok: true, data: { ref: `${organismId}/${ws}/${space}/${id}` } };
}
