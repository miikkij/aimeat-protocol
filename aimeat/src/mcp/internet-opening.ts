/**
 * @file src/mcp/internet-opening.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tools of an app opened to the internet on a closed node, on the node's MCP
 *   endpoint. They do not do the work: each calls the service function the REST route calls
 *   (services/internet-opening/), so a chat and a screen read and change one record the same way. The
 *   scope words are applied where every tool is registered (TOOL_SCOPES, from the catalog entries in
 *   tool-catalog/definitions/internet-opening.ts); the operator test is the caller object's.
 * @structure registerInternetOpeningTools(mcp, storage, config, caller)
 * @usage import { registerInternetOpeningTools } from './internet-opening.js';
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
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
import { openingDoor, actorOf } from '../services/internet-opening/opening-door.js';
import { closeOpening, decideOpening, setTrustedOpener } from '../services/internet-opening/opening-service.js';
import { operatorOpeningsList, ownerOpeningView, openingToApi } from '../services/internet-opening/opening-view.js';
import { OPERATOR_AGENT_REFUSAL } from '../services/owner-lifecycle.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerInternetOpeningTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  caller: () => CallerContext,
): void {
  const ctx = { storage, config };
  const reg = (name: string) => ({ description: descriptionFor(name), inputSchema: zodShapeFor(name), annotations: annotationsFor(name) });

  mcp.registerTool('aimeat_app_internet_opening_get', reg('aimeat_app_internet_opening_get'), async ({ app }) => {
    const c = caller();
    if (c.visitor) return toolError('FORBIDDEN', 'A session from another node has no app here.');
    const view = await ownerOpeningView(ctx, c.owner, String(app), await c.operator());
    if (!view) return toolError('NOT_FOUND', 'App not found');
    return text(view);
  });

  mcp.registerTool('aimeat_app_internet_open', reg('aimeat_app_internet_open'), async ({ app, reason, days }) => {
    const r = await openingDoor(ctx, caller(), { filename: String(app), reason, days });
    if (!r.ok) return toolError(r.code, r.message);
    if (r.data.outcome === 'owner_asked') return text(r.data);
    return text({ outcome: r.data.outcome, opening: openingToApi(r.data.opening) });
  });

  mcp.registerTool('aimeat_app_internet_close', reg('aimeat_app_internet_close'), async ({ app, owner, reason }) => {
    const c = caller();
    if (c.visitor) return toolError('FORBIDDEN', 'A session from another node closes nothing here.');
    const r = await closeOpening(ctx, await actorOf(c), {
      owner: owner ? localAccountName(String(owner)) : c.owner, filename: String(app), reason,
    });
    if (!r.ok) return toolError(r.code, r.message);
    return text({ opening: openingToApi(r.data.opening) });
  });

  mcp.registerTool('aimeat_admin_internet_openings', reg('aimeat_admin_internet_openings'), async ({ state }) => {
    if (!(await caller().operator())) return toolError('FORBIDDEN', OPERATOR_AGENT_REFUSAL);
    return text(await operatorOpeningsList(ctx, { state }));
  });

  mcp.registerTool('aimeat_admin_internet_opening_decide', reg('aimeat_admin_internet_opening_decide'), async ({ owner, app, decision, note, which }) => {
    const c = caller();
    if (!(await c.operator())) return toolError('FORBIDDEN', OPERATOR_AGENT_REFUSAL);
    const r = await decideOpening(ctx, await actorOf(c), { owner: localAccountName(String(owner)), filename: String(app), decision, note, which });
    if (!r.ok) return toolError(r.code, r.message);
    return text({ decided: r.data.decided, opening: openingToApi(r.data.opening) });
  });

  mcp.registerTool('aimeat_admin_internet_opener_set', reg('aimeat_admin_internet_opener_set'), async ({ owner, allowed, reason, until }) => {
    const c = caller();
    if (!(await c.operator())) return toolError('FORBIDDEN', OPERATOR_AGENT_REFUSAL);
    const r = await setTrustedOpener(ctx, await actorOf(c), { owner: localAccountName(String(owner)), allowed, reason, until });
    if (!r.ok) return toolError(r.code, r.message);
    return text(r.data);
  });
}
