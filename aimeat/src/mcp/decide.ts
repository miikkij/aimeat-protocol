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
 *   One of three surfaces. See tool-catalog/definitions/decide.ts for the other two.
 * @structure registerDecideTools(mcp, storage, config, getAgentGaii, sessionCaller)
 * @usage registerDecideTools(mcp, storage, config, () => agentGaii, caller);
 * @version-history
 *   2026-10-25 — aimeat_decide_run reads the owner's records as the session's agent (readerAs), so its
 *     clearance applies (secaudit2026oct22).
 *   2026-10-22 — aimeat_decide_run asks the session caller whether it reads as the owner
 *     (readsAsOwner): without memory:read-as-owner its keys and prefix read only what the memory route
 *     shows it, and it lists, reads, resumes and stops only the runs it started (secaudit 2026-10,
 *     v83, v84). Takes the session caller as a fifth parameter.
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-16 — A catch-all failure carries the caught error (withCaughtError, mcp/tool-fault.ts): an internal exception is logged, reported and answered with a sentence instead of its text (QA audit E5-01, D2-01).
 *   2026-10-15 — aimeat_decide_rule_propose refuses an ecosystem app, as the REST route does
 *     (feature-list audit 95).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
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
import { McpServer } from '@modelcontextprotocol/server';
import { withCaughtError } from './tool-fault.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { localAccountName, isGEAI } from '../utils/gaii.js';
import { AiCompletionError } from '../services/ai/completion.js';
import {
  decideForOwner, listDecisions, getDecision, reviewDecision, decisionStats, ruleCallerKind, DecideError, type DecideCaller,
} from '../services/decide/service.js';
import { getRule, useAllows, rulesRunnableBy, listRuleProposals, proposeRule } from '../services/decide/rules.js';
import { agentNameOf } from '../services/agent-ai-keys.js';
import { decideSettingsView } from '../services/decide/settings.js';
import {
  startDecideRun, getDecideRun, listDecideRuns, resumeDecideRun, stopDecideRun, runSummary, runViewerOf, type RunItem,
} from '../services/decide/runs.js';
import type { JevQuestion } from '../services/decide/limits.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { readsAsOwner, READ_AS_OWNER_NOTE } from '../services/owner-scope-read.js';
import type { CallerContext } from '../services/caller-context.js';

export function registerDecideTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  /** The session's caller (services/caller-context.ts), asked per call whether it reads as the owner.
   *  Absent, the session reads as an agent without memory:read-as-owner. */
  sessionCaller?: () => CallerContext,
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
    return withCaughtError(err(String((e as Error).message ?? e)), e);
  };
  const caller = (appId?: string): DecideCaller => ({
    gaii: ownerGhii, principal: agentGaii, isOwner: false, ...(appId ? { appId } : {}),
  });
  // A decision run reads the owner's records and holds what others of the owner sent: it carries
  // whether this session reads as the owner, asked per call so a permission the owner grants or
  // removes takes effect at once (secaudit 2026-10, v83, v84).
  const runCaller = (appId?: string): DecideCaller => {
    const session = sessionCaller?.();
    // The session is this agent's: its run reads the owner's records as the agent, so its clearance
    // applies (secaudit2026oct22). Without a session caller it holds no scopes.
    return { ...caller(appId), readsAll: session ? readsAsOwner(session) : false, readerAs: { roles: ['agent'], scopes: session?.scopes ?? [] } };
  };

  // ── aimeat_decide ──
  mcp.registerTool(
    'aimeat_decide',
    {
        description: descriptionFor('aimeat_decide'),
        inputSchema: zodShapeFor('aimeat_decide'),
        annotations: annotationsFor('aimeat_decide'),
    },
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
  mcp.registerTool(
    'aimeat_decision_list',
    {
        description: descriptionFor('aimeat_decision_list'),
        inputSchema: zodShapeFor('aimeat_decision_list'),
        annotations: annotationsFor('aimeat_decision_list'),
    },
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
  mcp.registerTool(
    'aimeat_decision_review',
    {
        description: descriptionFor('aimeat_decision_review'),
        inputSchema: zodShapeFor('aimeat_decision_review'),
        annotations: annotationsFor('aimeat_decision_review'),
    },
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
  mcp.registerTool(
    'aimeat_decide_run',
    {
        description: descriptionFor('aimeat_decide_run'),
        inputSchema: zodShapeFor('aimeat_decide_run'),
        annotations: annotationsFor('aimeat_decide_run'),
    },
    async (a) => {
      if (!owner) return err('Could not resolve caller owner');
      try {
        const rc = runCaller(a.app_id);
        const viewer = runViewerOf(rc);
        if (a.action === 'list') {
          const { runs, omitted } = await listDecideRuns(storage, ownerGhii, viewer);
          return text({ runs, ...(omitted > 0 ? { omitted, note: READ_AS_OWNER_NOTE } : {}) });
        }
        if (a.action === 'start') {
          if (!a.questions && a.rule === undefined) return err('INVALID_BODY: start needs questions, or a rule.');
          const run = await startDecideRun(storage, config, rc, {
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
        const run = a.action === 'get' ? await getDecideRun(storage, ownerGhii, a.run_id, viewer)
          : a.action === 'resume' ? await resumeDecideRun(storage, config, rc, a.run_id)
            : await stopDecideRun(storage, ownerGhii, a.run_id, viewer);
        // Absent, or started by another of the owner's identities: the same answer, and the reason.
        if (!run) return err(viewer.all ? 'No such run.' : `No such run. ${READ_AS_OWNER_NOTE}`);
        return text(a.action === 'get' ? run : runSummary(run));
      } catch (e) {
        return failed(e);
      }
    },
  );

  // ── aimeat_decide_settings ──
  mcp.registerTool(
    'aimeat_decide_settings',
    {
        description: descriptionFor('aimeat_decide_settings'),
        inputSchema: zodShapeFor('aimeat_decide_settings'),
        annotations: annotationsFor('aimeat_decide_settings'),
    },
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
  mcp.registerTool(
    'aimeat_decide_rules',
    {
        description: descriptionFor('aimeat_decide_rules'),
        inputSchema: zodShapeFor('aimeat_decide_rules'),
        annotations: annotationsFor('aimeat_decide_rules'),
    },
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
  mcp.registerTool(
    'aimeat_decide_rule_propose',
    {
        description: descriptionFor('aimeat_decide_rule_propose'),
        inputSchema: zodShapeFor('aimeat_decide_rule_propose'),
        annotations: annotationsFor('aimeat_decide_rule_propose'),
    },
    async (a) => {
      if (!owner) return err('Could not resolve caller owner');
      // The REST route refuses an app and an ecosystem app (routes/ai-decide-rules.ts); this tool did
      // not (feature-list audit 95). On MCP an ecosystem app's session is named by its GEAI.
      if (isGEAI(agentGaii)) {
        return err('ACCESS_DENIED: This is for the account holder and their own agents. An app cannot propose a decision rule.');
      }
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
