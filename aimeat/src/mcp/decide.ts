/**
 * @file src/mcp/decide.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The decision tools on the node's own MCP surface (TARGET-080). An agent can do what a
 *   person's app can do: ask the decision model, read what it decided, record a review, run it over
 *   many records, and read the settings.
 *
 *   NONE OF THESE DOES THE WORK. Each calls services/decide/, which the REST routes call too, so the
 *   scrubber, the budget and the record happen where they were written once. The caller is the
 *   session's agent acting for its owner: the owner's account pays and holds the record, and the agent
 *   is named as the principal that asked. An agent is never the owner in person, so it cannot skip the
 *   scrubber unless the owner's policy says agents may.
 *
 *   One of three surfaces. See mcp/catalog/definitions/decide.ts for the other two.
 * @structure registerDecideTools(mcp, storage, config, getAgentGaii)
 * @usage registerDecideTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.3.1 — 2026-09-26 — The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 *   v1.3.0 — 2026-09-25 — aimeat_decision_review names the session's agent as the reviewer, never the
 *     owner in person, so the service refuses it a review of a decision it asked for itself.
 *   v1.2.0 — 2026-09-23 — Decision providers: `provider` on aimeat_decide, aimeat_decide_run and
 *     aimeat_decision_list, and stats by provider.
 *   v1.1.0 — 2026-09-20 — Decision rules: `rule` on aimeat_decide, aimeat_decide_run and
 *     aimeat_decision_list; aimeat_decide_rules; aimeat_decide_rule_propose (creates nothing).
 *   v1.0.0 — 2026-09-19 — Initial (TARGET-080).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { localAccountName } from '../utils/gaii.js';
import { AiCompletionError } from '../services/ai-completion.js';
import {
  decideForOwner, listDecisions, getDecision, reviewDecision, decisionStats, ruleCallerKind, DecideError, type DecideCaller,
} from '../services/decide/service.js';
import { getRule, useAllows, rulesRunnableBy, listRuleProposals, proposeRule } from '../services/decide/rules.js';
import { agentNameOf } from '../services/agent-ai-keys.js';
import { decideSettingsView } from '../services/decide/settings.js';
import {
  startDecideRun, getDecideRun, listDecideRuns, resumeDecideRun, stopDecideRun, runSummary, type RunItem,
} from '../services/decide/runs.js';
import type { JevQuestion } from '../services/decide/limits.js';

export function registerDecideTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  const agentGaii = getAgentGaii();
  const owner = localAccountName(agentGaii);
  const ownerGhii = `${owner}@${config.nodeId}`;

  const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
  const err = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });
  const failed = (e: unknown) => {
    if (e instanceof DecideError) {
      return err(`${e.code}: ${e.message}${e.details ? `\n${JSON.stringify(e.details, null, 2)}` : ''}`);
    }
    if (e instanceof AiCompletionError) return err(`${e.code}: ${e.message}`);
    return err(String((e as Error).message ?? e));
  };
  const caller = (appId?: string): DecideCaller => ({
    gaii: ownerGhii, principal: agentGaii, isOwner: false, ...(appId ? { appId } : {}),
  });

  const questionsSchema = z.record(z.string(), z.object({
    type: z.enum(['noul', 'choice', 'score']),
    instructions: z.unknown(),
    criteria: z.unknown().optional(),
  })).describe('Your ids to questions. Instructions and criteria in English.');

  // ── aimeat_decide ──
  mcp.tool(
    'aimeat_decide',
    descriptionFor('aimeat_decide'),
    {
      state: z.unknown().describe('What is being judged: a string, an object with named fields, or an array.'),
      rule: z.string().optional().describe('The id of one of the owner\'s decision rules. It holds the questions, thresholds and bands: send only the state beside it.'),
      provider: z.string().optional().describe('The decision provider to ask (aimeat_decide_settings lists them). Leave out to let the node pick.'),
      questions: questionsSchema.optional().describe('Required unless `rule` is given. Your ids to questions, in English.'),
      subject: z.string().optional().describe('What the decision is about: a memory key or record id.'),
      gates: z.string().optional().describe('What the answer decides, in plain words.'),
      thresholds: z.record(z.string(), z.unknown()).optional().describe('The thresholds you will apply.'),
      names: z.array(z.string()).optional().describe('Extra person names to remove before sending.'),
      public_content: z.boolean().optional().describe('The content is already public. Honoured only when the owner\'s policy allows it.'),
      cache: z.boolean().optional().describe('Reuse an identical earlier decision (default true).'),
      app_id: z.string().optional().describe('App attribution for the per-app quota.'),
    },
    annotationsFor('aimeat_decide'),
    async (a) => {
      if (!owner) return err('Could not resolve caller owner');
      try {
        return text(await decideForOwner(storage, config, caller(a.app_id), {
          state: a.state,
          // Both are passed as given: a caller who sends questions BESIDE a rule is refused by the
          // service, the same as on the REST door, rather than having them dropped here.
          ...(a.rule !== undefined ? { rule: a.rule } : {}),
          ...(a.provider !== undefined ? { provider: a.provider } : {}),
          ...(a.questions !== undefined ? { questions: a.questions as Record<string, JevQuestion> } : {}),
          ...(a.subject !== undefined ? { subject: a.subject } : {}),
          ...(a.gates !== undefined ? { gates: a.gates } : {}),
          ...(a.thresholds ? { thresholds: a.thresholds } : {}),
          ...(a.names ? { names: a.names } : {}),
          ...(a.public_content ? { publicContent: true } : {}),
          ...(a.cache === false ? { cache: false } : {}),
        }));
      } catch (e) {
        return failed(e);
      }
    },
  );

  // ── aimeat_decision_list ──
  mcp.tool(
    'aimeat_decision_list',
    descriptionFor('aimeat_decision_list'),
    {
      decision_id: z.string().optional().describe('Read one decision.'),
      subject: z.string().optional().describe('Only decisions about this subject.'),
      rule: z.string().optional().describe('Only decisions one decision rule made (its id).'),
      principal: z.string().optional().describe('Only decisions one principal asked for (an agent\'s full identity).'),
      provider: z.string().optional().describe('Only decisions one decision provider answered (its id).'),
      stats_by: z.enum(['rule', 'principal', 'provider']).optional().describe('Return the quality numbers instead, one group per rule, per principal or per provider.'),
      app_id: z.string().optional().describe('Only decisions made for this app.'),
      limit: z.number().optional().describe('How many (1-200, default 50).'),
      before: z.string().optional().describe('Only decisions made before this ISO time.'),
    },
    annotationsFor('aimeat_decision_list'),
    async (a) => {
      try {
        if (a.decision_id) {
          const row = await getDecision(storage, ownerGhii, a.decision_id);
          return row ? text(row) : err('No such decision.');
        }
        if (a.stats_by) {
          return text({ groups: await decisionStats(storage, ownerGhii, {
            groupBy: a.stats_by, ...(a.rule ? { rule: a.rule } : {}), ...(a.principal ? { principal: a.principal } : {}),
            ...(a.provider ? { provider: a.provider } : {}),
          }) });
        }
        const r = await listDecisions(storage, ownerGhii, {
          ...(a.subject !== undefined ? { subject: a.subject } : {}),
          ...(a.rule !== undefined ? { rule: a.rule } : {}),
          ...(a.principal !== undefined ? { principal: a.principal } : {}),
          ...(a.provider !== undefined ? { provider: a.provider } : {}),
          ...(a.app_id !== undefined ? { appId: a.app_id } : {}),
          ...(a.limit !== undefined ? { limit: a.limit } : {}),
          ...(a.before !== undefined ? { before: a.before } : {}),
        });
        return text({ decisions: r.items, total: r.total });
      } catch (e) {
        return failed(e);
      }
    },
  );

  // ── aimeat_decision_review ──
  mcp.tool(
    'aimeat_decision_review',
    descriptionFor('aimeat_decision_review'),
    {
      decision_id: z.string().describe('The decision.'),
      outcome: z.enum(['confirmed', 'overridden']).describe('confirmed | overridden'),
      note: z.string().optional().describe('Why, in the person\'s words.'),
      override: z.record(z.string(), z.unknown()).optional().describe('What the person decided instead.'),
    },
    annotationsFor('aimeat_decision_review'),
    async (a) => {
      try {
        // A tool session is always an agent, never the owner in person: the service refuses it a
        // review of a decision it asked for itself.
        const row = await reviewDecision(storage, ownerGhii, { principal: agentGaii, inPerson: false }, a.decision_id, {
          outcome: a.outcome,
          ...(a.note !== undefined ? { note: a.note } : {}),
          ...(a.override !== undefined ? { override: a.override } : {}),
        });
        return row ? text(row) : err('No such decision.');
      } catch (e) {
        return failed(e);
      }
    },
  );

  // ── aimeat_decide_run ──
  mcp.tool(
    'aimeat_decide_run',
    descriptionFor('aimeat_decide_run'),
    {
      action: z.enum(['start', 'get', 'list', 'resume', 'stop']).describe('start | get | list | resume | stop'),
      run_id: z.string().optional().describe('The run, for get, resume and stop.'),
      rule: z.string().optional().describe('For start: one of the owner\'s decision rules, in place of questions, thresholds and gates.'),
      provider: z.string().optional().describe('For start: the decision provider every item is asked on.'),
      questions: questionsSchema.optional(),
      items: z.array(z.object({ subject: z.string(), state: z.unknown().optional() })).optional().describe('For start: [{ subject, state }].'),
      keys: z.array(z.string()).optional().describe('For start: owner memory keys.'),
      prefix: z.string().optional().describe('For start: every owner record under this key prefix.'),
      fields: z.array(z.string()).optional().describe('For start: keep only these top-level fields of each state.'),
      gates: z.string().optional().describe('What the answers decide.'),
      thresholds: z.record(z.string(), z.unknown()).optional().describe('The thresholds you will apply.'),
      names: z.array(z.string()).optional().describe('Extra person names to remove before sending.'),
      app_id: z.string().optional().describe('App attribution for the per-app quota.'),
    },
    annotationsFor('aimeat_decide_run'),
    async (a) => {
      if (!owner) return err('Could not resolve caller owner');
      try {
        if (a.action === 'list') return text({ runs: await listDecideRuns(storage, ownerGhii) });
        if (a.action === 'start') {
          if (!a.questions && a.rule === undefined) return err('INVALID_BODY: start needs questions, or a rule.');
          const run = await startDecideRun(storage, config, caller(a.app_id), {
            ...(a.rule !== undefined ? { rule: a.rule } : {}),
            ...(a.provider !== undefined ? { provider: a.provider } : {}),
            ...(a.questions ? { questions: a.questions as Record<string, JevQuestion> } : {}),
            ...(a.items ? { items: a.items as RunItem[] } : {}),
            ...(a.keys ? { keys: a.keys } : {}),
            ...(a.prefix !== undefined ? { prefix: a.prefix } : {}),
            ...(a.fields ? { fields: a.fields } : {}),
            ...(a.gates !== undefined ? { gates: a.gates } : {}),
            ...(a.thresholds ? { thresholds: a.thresholds } : {}),
            ...(a.names ? { names: a.names } : {}),
          });
          return text(runSummary(run));
        }
        if (!a.run_id) return err(`INVALID_BODY: ${a.action} needs run_id.`);
        const run = a.action === 'get' ? await getDecideRun(storage, ownerGhii, a.run_id)
          : a.action === 'resume' ? await resumeDecideRun(storage, config, caller(a.app_id), a.run_id)
            : await stopDecideRun(storage, ownerGhii, a.run_id);
        if (!run) return err('No such run.');
        return text(a.action === 'get' ? run : runSummary(run));
      } catch (e) {
        return failed(e);
      }
    },
  );

  // ── aimeat_decide_settings ──
  mcp.tool(
    'aimeat_decide_settings',
    descriptionFor('aimeat_decide_settings'),
    {},
    annotationsFor('aimeat_decide_settings'),
    async () => {
      try {
        return text({
          ...(await decideSettingsView(storage, config, ownerGhii, agentNameOf(agentGaii, ownerGhii))),
          change_them: 'The owner changes the key and the data policy on the AI settings page (/v1/profile?tab=ai), an agent\'s own key, cap and gate on that agent\'s page, and the decision providers (their own, their default, the one each agent uses) in person through PUT /v1/ai/decide/providers/{id} and PUT /v1/ai/decide/settings. No tool changes them.',
        });
      } catch (e) {
        return failed(e);
      }
    },
  );

  // ── aimeat_decide_rules ──
  mcp.tool(
    'aimeat_decide_rules',
    descriptionFor('aimeat_decide_rules'),
    { rule_id: z.string().optional().describe('Read one rule in full, with its questions, thresholds and bands.') },
    annotationsFor('aimeat_decide_rules'),
    async (a) => {
      if (!owner) return err('Could not resolve caller owner');
      try {
        const kind = ruleCallerKind(caller());
        if (a.rule_id !== undefined) {
          const rule = await getRule(storage, ownerGhii, a.rule_id);
          // A rule this kind of caller may not run reads as absent, as on the REST door.
          return rule && useAllows(rule, kind) ? text({ rule }) : err('NOT_FOUND: No such decision rule.');
        }
        const [rules, proposals] = await Promise.all([rulesRunnableBy(storage, ownerGhii, kind), listRuleProposals(storage, ownerGhii)]);
        return text({
          rules,
          proposals: proposals.filter(p => p.proposed_by === agentGaii)
            .map(p => ({ proposal_id: p.id, rule_id: p.rule.id, title: p.rule.title, proposed_at: p.proposed_at })),
          run_one: 'aimeat_decide { rule: "<id>", state: { …the fields under sends… } }',
        });
      } catch (e) {
        return failed(e);
      }
    },
  );

  // ── aimeat_decide_rule_propose ──
  mcp.tool(
    'aimeat_decide_rule_propose',
    descriptionFor('aimeat_decide_rule_propose'),
    {
      rule: z.record(z.string(), z.unknown()).describe('The proposed rule: { id, title, decides, sends, questions, thresholds, bands, use, gate, sample }. Questions in English.'),
      reason: z.string().describe('Why this rule should exist, in a sentence the owner can decide from.'),
    },
    annotationsFor('aimeat_decide_rule_propose'),
    async (a) => {
      if (!owner) return err('Could not resolve caller owner');
      try {
        const out = await proposeRule(storage, config, ownerGhii, agentGaii, { rule: a.rule, reason: a.reason });
        return text({
          proposal_id: out.proposal.id,
          rule_id: out.proposal.rule.id,
          already_waiting: out.alreadyWaiting,
          next_step: `Nothing has been created. "${out.proposal.rule.title}" is waiting for the owner to approve it: in their open items, or under Settings, AI, Decision model.`,
        });
      } catch (e) {
        return failed(e);
      }
    },
  );
}
