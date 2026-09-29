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
 * @structure registerClassificationTools(mcp, storage, config, getAgentGaii, scopes)
 * @usage registerClassificationTools(mcp, storage, config, agentGaii, scopes);
 * @version-history
 *   v1.2.0 — 2026-09-29 — V3: the scan action runs the Content Classifier on keys or a prefix.
 *   v1.1.0 — 2026-09-29 — V4: the audit action reads the audit log of a level.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V2. Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { toolError } from './tool-error.js';
import {
  ClassificationError, labelActorOf, readContentLabel, reviewLabel, setLabel, targetOf,
} from '../services/classification/labels.js';
import { readAuditLog, readPolicy, writePolicy } from '../services/classification/policy-admin.js';
import { scanContent } from '../services/classification/scan.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });

const WRITES = new Set(['set', 'review', 'policy_set', 'scan']);

export function registerClassificationTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  scopes: string[],
): void {
  const deps = { storage, config };

  mcp.tool(
    'aimeat_classification',
    descriptionFor('aimeat_classification'),
    {
      action: z.enum(['get', 'set', 'review', 'policy_get', 'policy_set', 'audit', 'scan']).describe('What to do.'),
      keys: z.array(z.string()).max(500).optional().describe('scan: memory keys to classify.'),
      prefix: z.string().optional().describe('scan: classify every memory key under this prefix (queued).'),
      since: z.string().optional().describe('audit: only rows from this ISO time on.'),
      audit_action: z.enum(['shown', 'used', 'refused', 'changed']).optional().describe('audit: only this kind of row.'),
      limit: z.number().int().min(1).max(1000).optional().describe('audit: at most this many rows, default 200.'),
      kind: z.enum(['memory', 'file', 'row']).optional().describe('get, set, review: what the content is. Default memory.'),
      key: z.string().optional().describe('get, set, review: the memory key (an organism workspace key included) or the stored file key.'),
      organism_id: z.string().optional().describe('A row: its organism. policy_get, policy_set at level organism: the organism.'),
      ws: z.string().optional().describe('A row: its workspace id.'),
      space: z.string().optional().describe('A row: its row space.'),
      row_id: z.string().optional().describe('A row: its id.'),
      label: z.string().optional().describe('set: the label id, from policy_get.'),
      justification: z.string().optional().describe('set: why the content is less sensitive, when lowering from a label that needs a reason.'),
      human_said: z.string().optional().describe("The person's own words, verbatim, when you relay their instruction. Never your own summary."),
      confidence: z.number().min(0).max(1).optional().describe('set: how sure you are, 0 to 1, when the label is your own judgement.'),
      reason: z.string().optional().describe('set: why you chose the label, when it is your own judgement.'),
      decision: z.enum(['accept', 'reject']).optional().describe("review: the person's decision on the waiting suggestion."),
      level: z.enum(['node', 'owner', 'organism']).optional().describe('policy_get, policy_set: which level. Default owner.'),
      policy: z.record(z.string(), z.unknown()).optional().describe('policy_set: the WHOLE level as policy_get returned it in `stored`, changed. It replaces the level.'),
    },
    annotationsFor('aimeat_classification'),
    async (args) => {
      if (WRITES.has(args.action) && !scopeIsCovered(scopes, 'memory:write')) {
        return toolError('SCOPE_DENIED', `action "${args.action}" needs the "memory:write" permission, which the owner grants this agent in its settings.`);
      }
      try {
        const principal = getAgentGaii();
        const actor = labelActorOf({ sub: principal, owner: localAccountName(principal), roles: ['agent'] }, config.nodeId);
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
              ? { ...out, next: 'This gives something away, so it waits. Ask the person to accept or reject it signed in themselves (POST /v1/classification/policy/review); an AI cannot accept it.' }
              : out);
          }
        }
      } catch (err) {
        if (err instanceof ClassificationError) return toolError(err.code, err.message);
        throw err;
      }
    },
  );
}
