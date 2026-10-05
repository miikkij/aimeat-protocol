/**
 * @file src/mcp/refinery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for the mail refinery: the class packs, running one batch, and following it.
 *
 *   THEY HOLD NO LOGIC OF THEIR OWN. The batch is services/refinery (the same runBatch the REST
 *   route and the scheduler start), so an agent's batch reads, decides and files exactly as the
 *   app's does. What this file adds is the caller: the agent, its owner's GHII for the budget and the
 *   definition, and the scopes the session holds.
 *
 *   A BATCH SPENDS FOUR PERMISSIONS, and the catalog gates the tool on one of them
 *   (connections:read-through). The other three are checked here, by name, before the batch starts,
 *   as the REST route's requireScope does, so a batch is never refused halfway through.
 * @structure registerRefineryTools(mcp, storage, config, getAgentGaii, scopes, caller)
 * @usage registerRefineryTools(mcp, storage, config, () => agentGaii, scopes, caller);
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 *   v1.0.1 — 2026-10-05 — The run scopes and the prefix rule are the one copy in
 *     services/refinery/schedule-input.ts (secaudit 2026-10, drift 1).
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { toolError } from './tool-error.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { CLASS_PACKS } from '../data/refinery-classes.js';
import { startRun, getRun } from '../services/refinery/runs.js';
import type { RefineryCaller } from '../services/refinery/pipeline.js';

// The scopes a batch spends and the prefix rule: the one copy the REST route and the scheduler read.
import { REFINERY_RUN_SCOPES as RUN_SCOPES, REFINERY_PREFIX_RE as PREFIX_RE } from '../services/refinery/schedule-input.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';

export function registerRefineryTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  _getAgentGaii: () => string,
  scopes: string[],
  /** The session's caller (services/caller-context.ts): the agent, its owner's GHII and its scopes. */
  caller: () => CallerContext,
): void {
  const ok = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] });

  /** The batch's caller, from the session caller. Never the owner in person: an MCP session is an agent. */
  const refineryCaller = (): RefineryCaller | null => {
    const session = caller();
    if (!session.owner) return null;
    return {
      ownerGhii: session.ownerGhii, owner: session.owner, principal: session.principal,
      roles: [...session.roles], scopes: [...session.scopes], isOwner: session.inPerson,
    };
  };

  mcp.tool('aimeat_refinery_classes', descriptionFor('aimeat_refinery_classes'), zodShapeFor('aimeat_refinery_classes'),
    annotationsFor('aimeat_refinery_classes'),
    async () => ok({ classes: CLASS_PACKS }));

  mcp.tool('aimeat_refinery_run', descriptionFor('aimeat_refinery_run'),
    zodShapeFor('aimeat_refinery_run'),
    annotationsFor('aimeat_refinery_run'),
    async ({ prefix, message_ids }) => {
      const missing = RUN_SCOPES.filter((s) => !scopeIsCovered(scopes, s));
      if (missing.length) return toolError('SCOPE_DENIED', `A batch needs ${missing.join(', ')} as well. Ask the owner to grant ${missing.length === 1 ? 'it' : 'them'}.`);
      const who = refineryCaller();
      if (!who) return toolError('UNAUTHORIZED', 'This session has no owner this node knows, so it cannot run a refinery.');
      const p = String(prefix ?? '').trim();
      if (!PREFIX_RE.test(p)) return toolError('INVALID_INPUT', 'prefix names the definition: lowercase letters, digits, - or _, 2 to 41 characters (the definition is <prefix>.config).');
      const ids = Array.isArray(message_ids)
        ? message_ids.filter((x) => typeof x === 'string' && /^[A-Za-z0-9_=-]{1,200}$/.test(x)).slice(0, 50)
        : undefined;
      const { run, already } = startRun({ storage, config }, who, p, { messageIds: ids });
      return ok({ run, already_running: already, next: `Follow it with aimeat_refinery_status { run_id: "${run.id}" }.` });
    });

  mcp.tool('aimeat_refinery_status', descriptionFor('aimeat_refinery_status'),
    zodShapeFor('aimeat_refinery_status'),
    annotationsFor('aimeat_refinery_status'),
    async ({ run_id }) => {
      const who = refineryCaller();
      const run = who ? getRun(String(run_id ?? ''), who.ownerGhii) : null;
      if (!run) return toolError('NOT_FOUND', 'No such run. A finished run is kept for an hour; the workspace rows and <prefix>.runs keep the rest.');
      return ok({ run });
    });
}
