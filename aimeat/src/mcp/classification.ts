/**
 * @file src/mcp/classification.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Classification over MCP (TARGET-082 V2): read and set the classification of a piece
 *   of content, review an AI's suggestion, and read and change the policy at the node, owner or
 *   organism level. One tool with actions (ruling 2026-09-27: new capabilities of one kind are
 *   actions of one tool).
 *
 *   ONE CAPABILITY, ONE IMPLEMENTATION. Every decision is in services/classification/ (labels.ts,
 *   policy-admin.ts), which the REST route calls too. This file names the caller and turns an answer
 *   into text. The caller here is always an AI: what it sets as its own judgement stays a suggestion
 *   where the policy says so, a person's words relayed in `human_said` make the label theirs, and a
 *   change that loosens a policy waits for the person to accept it in their own session.
 * @structure registerClassificationTools(mcp, storage, config, getAgentGaii, scopes, caller)
 * @usage registerClassificationTools(mcp, storage, config, agentGaii, scopes, caller);
 * @version-history
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.5.0 — 2026-09-30 — exception_list (the exceptions list of a level) and exception_set, which
 *     the service refuses for an AI with PERSON_REQUIRED (decided 2026-09-30); audit_action takes
 *     exception. The new fields' descriptions come from the catalog.
 *   v1.4.0 — 2026-09-29 — explorer (services/classification/explorer.ts) and switch_set
 *     (services/classification/switch.ts): the operator's agent sets the node's switch, holding
 *     operator:admin, and an AI's loosening of it is refused. get, set and review take `owner`.
 *   v1.3.0 — 2026-09-29 — V5: the same field check and pending hint as the connector and the CLI.
 *   v1.2.0 — 2026-09-29 — V3: the scan action runs the Content Classifier on keys or a prefix.
 *   v1.1.0 — 2026-09-29 — V4: the audit action reads the audit log of a level.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V2. Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { toolError } from './tool-error.js';
import {
  ClassificationError, labelActorOf, readContentLabel, reviewLabel, setLabel, targetOf,
} from '../services/classification/labels.js';
import { readAuditLog, readPolicy, writePolicy } from '../services/classification/policy-admin.js';
import { checkClassificationInput, POLICY_PENDING_NEXT } from '../tool-catalog/definitions/classification.js';
import { scanContent } from '../services/classification/scan.js';
import { explorerQueryOf, listLabels } from '../services/classification/explorer.js';
import { setClassificationSwitch } from '../services/classification/switch.js';
import { makeException, readExceptions } from '../services/classification/exception-admin.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });

const WRITES = new Set(['set', 'review', 'policy_set', 'scan', 'switch_set', 'exception_set']);

export function registerClassificationTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  _getAgentGaii: () => string,
  scopes: string[],
  /** The session's caller (services/caller-context.ts): the AI the labels and policy changes name. */
  caller: () => CallerContext,
): void {
  const deps = { storage, config };

  mcp.tool(
    'aimeat_classification',
    descriptionFor('aimeat_classification'),
    zodShapeFor('aimeat_classification'),
    annotationsFor('aimeat_classification'),
    async (args) => {
      // The same field check the connector and the CLI make (catalog/definitions/classification.ts).
      const checked = checkClassificationInput(args as Record<string, unknown>);
      if (!checked.ok) return toolError('INVALID_INPUT', checked.message);
      if (WRITES.has(args.action) && !scopeIsCovered(scopes, 'memory:write')) {
        return toolError('SCOPE_DENIED', `action "${args.action}" needs the "memory:write" permission, which the owner grants this agent in its settings.`);
      }
      try {
        const session = caller();
        const actor = labelActorOf(session.auth, config.nodeId);
        switch (args.action) {
          case 'get':
            return text(await readContentLabel(deps, actor, targetOf(actor, args)));
          case 'set': {
            if (!args.label) return toolError('INVALID_INPUT', 'label is required: a label id from policy_get.');
            return text(await setLabel(deps, actor, targetOf(actor, args), {
              label: args.label, justification: args.justification, humanSaid: args.human_said,
              confidence: args.confidence, reason: args.reason,
            }));
          }
          case 'review': {
            if (!args.decision) return toolError('INVALID_INPUT', 'decision is accept or reject.');
            return text(await reviewLabel(deps, actor, targetOf(actor, args), {
              decision: args.decision, justification: args.justification, humanSaid: args.human_said,
            }));
          }
          case 'policy_get':
            return text(await readPolicy(deps, actor, args.level ?? 'owner', args.organism_id));
          case 'scan':
            return text(await scanContent(deps, actor, { keys: args.keys ?? (args.key ? [args.key] : undefined), prefix: args.prefix }));
          case 'audit':
            return text(await readAuditLog(deps, actor, args.level ?? 'owner', args.organism_id,
              { since: args.since, action: args.audit_action, limit: args.limit }));
          case 'policy_set': {
            if (!args.policy) return toolError('INVALID_INPUT', 'policy is the whole level: read it with policy_get and send `stored` back changed.');
            const out = await writePolicy(deps, actor, args.level ?? 'owner', args.organism_id, args.policy, { humanSaid: args.human_said });
            return text(out.pending
              ? { ...out, next: POLICY_PENDING_NEXT }
              : out);
          }
          case 'explorer':
            return text(await listLabels(deps, actor, explorerQueryOf({
              level: args.level, organism_id: args.organism_id, label: args.label, pending: args.pending,
              kind: args.kind, limit: args.limit, cursor: args.cursor,
            })));
          case 'switch_set': {
            if (args.level && args.level !== 'node') return toolError('INVALID_INPUT', 'switch_set is at level node, the only one.');
            if (!args.mode) return toolError('INVALID_INPUT', 'mode is off, owner or all.');
            return text(await setClassificationSwitch({ storage, config }, session.auth, args.mode));
          }
          case 'exception_list':
            return text(await readExceptions(deps, actor, args.level ?? 'owner', args.organism_id,
              { action: args.exception_action, since: args.since, limit: args.limit }));
          case 'exception_set':
            // The same service as POST /v1/classification/exceptions, which refuses an AI with
            // PERSON_REQUIRED: the exception is the person's to make, in their Data Wallet.
            return text(await makeException(deps, actor, {
              kind: args.kind, key: args.key, owner: args.owner, organism_id: args.organism_id, ws: args.ws,
              space: args.space, row_id: args.row_id, action: args.exception_action, reason: args.reason, until: args.until,
            }));
        }
      } catch (err) {
        if (err instanceof ClassificationError) return toolError(err.code, err.message);
        throw err;
      }
    },
  );
}
