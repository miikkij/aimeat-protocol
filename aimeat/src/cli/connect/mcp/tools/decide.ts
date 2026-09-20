/**
 * @file decide.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for the decision tools (TARGET-080): parity with the
 *   server MCP (src/mcp/decide.ts), as thin REST wrappers over /v1/ai/decide, /v1/ai/decisions and
 *   /v1/ai/decide/runs. The node does the scrubbing, the metering and the record; this door only
 *   carries every parameter across, and `check:mcp-schemas` compares it with the node's surface.
 * @structure registerDecideTools(mcp, registry)
 * @usage imported by mcp/tools/index.ts
 * @version-history
 *   v1.1.0 -- 2026-09-20 -- Decision rules: `rule` on aimeat_decide, aimeat_decide_run and
 *     aimeat_decision_list; aimeat_decide_rules; aimeat_decide_rule_propose.
 *   v1.0.0 -- 2026-09-19 -- Initial (TARGET-080).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerDecideTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  const questionsSchema = z.record(z.string(), z.object({
    type: z.enum(['noul', 'choice', 'score']),
    instructions: z.unknown(),
    criteria: z.unknown().optional(),
  })).describe('Your ids to questions. Instructions and criteria in English.');

  mcp.tool('aimeat_decide', descriptionFor('aimeat_decide'), {
    state: z.unknown().describe('What is being judged: a string, an object with named fields, or an array.'),
    rule: z.string().optional().describe('The id of one of the owner\'s decision rules. It holds the questions, thresholds and bands: send only the state beside it.'),
    questions: questionsSchema.optional().describe('Required unless `rule` is given. Your ids to questions, in English.'),
    subject: z.string().optional().describe('What the decision is about: a memory key or record id.'),
    gates: z.string().optional().describe('What the answer decides, in plain words.'),
    thresholds: z.record(z.string(), z.unknown()).optional().describe('The thresholds you will apply.'),
    names: z.array(z.string()).optional().describe('Extra person names to remove before sending.'),
    public_content: z.boolean().optional().describe('The content is already public. Honoured only when the owner\'s policy allows it.'),
    cache: z.boolean().optional().describe('Reuse an identical earlier decision (default true).'),
    app_id: z.string().optional().describe('App attribution for the per-app quota.'),
  }, annotationsFor('aimeat_decide'), async (a) => {
    return out(await client.post('/v1/ai/decide', {
      state: a.state as never,
      ...(a.rule !== undefined ? { rule: a.rule } : {}),
      ...(a.questions !== undefined ? { questions: a.questions as never } : {}),
      ...(a.subject !== undefined ? { subject: a.subject } : {}),
      ...(a.gates !== undefined ? { gates: a.gates } : {}),
      ...(a.thresholds ? { thresholds: a.thresholds as never } : {}),
      ...(a.names ? { names: a.names } : {}),
      ...(a.public_content !== undefined ? { public_content: a.public_content } : {}),
      ...(a.cache !== undefined ? { cache: a.cache } : {}),
      ...(a.app_id !== undefined ? { app_id: a.app_id } : {}),
    }));
  });

  mcp.tool('aimeat_decision_list', descriptionFor('aimeat_decision_list'), {
    decision_id: z.string().optional().describe('Read one decision.'),
    subject: z.string().optional().describe('Only decisions about this subject.'),
    rule: z.string().optional().describe('Only decisions one decision rule made (its id).'),
    principal: z.string().optional().describe('Only decisions one principal asked for (an agent\'s full identity).'),
    stats_by: z.enum(['rule', 'principal']).optional().describe('Return the quality numbers instead, one group per rule or per principal.'),
    app_id: z.string().optional().describe('Only decisions made for this app.'),
    limit: z.number().optional().describe('How many (1-200, default 50).'),
    before: z.string().optional().describe('Only decisions made before this ISO time.'),
  }, annotationsFor('aimeat_decision_list'), async (a) => {
    if (a.decision_id) return out(await client.get(`/v1/ai/decisions/${encodeURIComponent(a.decision_id)}`));
    const q = new URLSearchParams();
    if (a.rule !== undefined) q.set('rule', a.rule);
    if (a.principal !== undefined) q.set('principal', a.principal);
    if (a.stats_by !== undefined) {
      q.set('group_by', a.stats_by);
      return out(await client.get(`/v1/ai/decisions/stats?${q.toString()}`));
    }
    if (a.subject !== undefined) q.set('subject', a.subject);
    if (a.app_id !== undefined) q.set('app_id', a.app_id);
    if (a.limit !== undefined) q.set('limit', String(a.limit));
    if (a.before !== undefined) q.set('before', a.before);
    const qs = q.toString();
    return out(await client.get(`/v1/ai/decisions${qs ? `?${qs}` : ''}`));
  });

  mcp.tool('aimeat_decision_review', descriptionFor('aimeat_decision_review'), {
    decision_id: z.string().describe('The decision.'),
    outcome: z.enum(['confirmed', 'overridden']).describe('confirmed | overridden'),
    note: z.string().optional().describe('Why, in the person\'s words.'),
    override: z.record(z.string(), z.unknown()).optional().describe('What the person decided instead.'),
  }, annotationsFor('aimeat_decision_review'), async (a) => {
    return out(await client.post(`/v1/ai/decisions/${encodeURIComponent(a.decision_id)}/review`, {
      outcome: a.outcome,
      ...(a.note !== undefined ? { note: a.note } : {}),
      ...(a.override !== undefined ? { override: a.override as never } : {}),
    }));
  });

  mcp.tool('aimeat_decide_run', descriptionFor('aimeat_decide_run'), {
    action: z.enum(['start', 'get', 'list', 'resume', 'stop']).describe('start | get | list | resume | stop'),
    run_id: z.string().optional().describe('The run, for get, resume and stop.'),
    rule: z.string().optional().describe('For start: one of the owner\'s decision rules, in place of questions, thresholds and gates.'),
    questions: questionsSchema.optional(),
    items: z.array(z.object({ subject: z.string(), state: z.unknown().optional() })).optional().describe('For start: [{ subject, state }].'),
    keys: z.array(z.string()).optional().describe('For start: owner memory keys.'),
    prefix: z.string().optional().describe('For start: every owner record under this key prefix.'),
    fields: z.array(z.string()).optional().describe('For start: keep only these top-level fields of each state.'),
    gates: z.string().optional().describe('What the answers decide.'),
    thresholds: z.record(z.string(), z.unknown()).optional().describe('The thresholds you will apply.'),
    names: z.array(z.string()).optional().describe('Extra person names to remove before sending.'),
    app_id: z.string().optional().describe('App attribution for the per-app quota.'),
  }, annotationsFor('aimeat_decide_run'), async (a) => {
    if (a.action === 'list') return out(await client.get('/v1/ai/decide/runs'));
    if (a.action === 'start') {
      return out(await client.post('/v1/ai/decide/runs', {
        ...(a.rule !== undefined ? { rule: a.rule } : {}),
        ...(a.questions ? { questions: a.questions as never } : {}),
        ...(a.items ? { items: a.items as never } : {}),
        ...(a.keys ? { keys: a.keys } : {}),
        ...(a.prefix !== undefined ? { prefix: a.prefix } : {}),
        ...(a.fields ? { fields: a.fields } : {}),
        ...(a.gates !== undefined ? { gates: a.gates } : {}),
        ...(a.thresholds ? { thresholds: a.thresholds as never } : {}),
        ...(a.names ? { names: a.names } : {}),
        ...(a.app_id !== undefined ? { app_id: a.app_id } : {}),
      }));
    }
    const id = encodeURIComponent(a.run_id ?? '');
    if (a.action === 'get') return out(await client.get(`/v1/ai/decide/runs/${id}`));
    return out(await client.post(`/v1/ai/decide/runs/${id}/${a.action}`, {}));
  });

  mcp.tool('aimeat_decide_settings', descriptionFor('aimeat_decide_settings'), {},
    annotationsFor('aimeat_decide_settings'), async () => out(await client.get('/v1/ai/decide/settings')));

  mcp.tool('aimeat_decide_rules', descriptionFor('aimeat_decide_rules'), {
    rule_id: z.string().optional().describe('Read one rule in full, with its questions, thresholds and bands.'),
  }, annotationsFor('aimeat_decide_rules'), async (a) => {
    if (a.rule_id !== undefined) return out(await client.get(`/v1/ai/decide/rules/${encodeURIComponent(a.rule_id)}`));
    return out(await client.get('/v1/ai/decide/rules'));
  });

  mcp.tool('aimeat_decide_rule_propose', descriptionFor('aimeat_decide_rule_propose'), {
    rule: z.record(z.string(), z.unknown()).describe('The proposed rule: { id, title, decides, sends, questions, thresholds, bands, use, gate, sample }. Questions in English.'),
    reason: z.string().describe('Why this rule should exist, in a sentence the owner can decide from.'),
  }, annotationsFor('aimeat_decide_rule_propose'), async (a) => {
    return out(await client.post('/v1/ai/decide/rule-proposals', { rule: a.rule as never, reason: a.reason }));
  });
}
