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
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.2.0 -- 2026-09-23 -- Decision providers: `provider` on aimeat_decide, aimeat_decide_run and
 *     aimeat_decision_list, and stats by provider.
 *   v1.1.0 -- 2026-09-20 -- Decision rules: `rule` on aimeat_decide, aimeat_decide_run and
 *     aimeat_decision_list; aimeat_decide_rules; aimeat_decide_rule_propose.
 *   v1.0.0 -- 2026-09-19 -- Initial (TARGET-080).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerDecideTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_decide', descriptionFor('aimeat_decide'), zodShapeFor('aimeat_decide'), annotationsFor('aimeat_decide'), async (a) => {
    return out(await client.post('/v1/ai/decide', {
      state: a.state as never,
      ...(a.rule !== undefined ? { rule: a.rule } : {}),
      ...(a.provider !== undefined ? { provider: a.provider } : {}),
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

  mcp.tool('aimeat_decision_list', descriptionFor('aimeat_decision_list'), zodShapeFor('aimeat_decision_list'), annotationsFor('aimeat_decision_list'), async (a) => {
    if (a.decision_id) return out(await client.get(`/v1/ai/decisions/${encodeURIComponent(a.decision_id)}`));
    const q = new URLSearchParams();
    if (a.rule !== undefined) q.set('rule', a.rule);
    if (a.principal !== undefined) q.set('principal', a.principal);
    if (a.provider !== undefined) q.set('provider', a.provider);
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

  mcp.tool('aimeat_decision_review', descriptionFor('aimeat_decision_review'), zodShapeFor('aimeat_decision_review'), annotationsFor('aimeat_decision_review'), async (a) => {
    return out(await client.post(`/v1/ai/decisions/${encodeURIComponent(a.decision_id)}/review`, {
      outcome: a.outcome,
      ...(a.note !== undefined ? { note: a.note } : {}),
      ...(a.override !== undefined ? { override: a.override as never } : {}),
    }));
  });

  mcp.tool('aimeat_decide_run', descriptionFor('aimeat_decide_run'), zodShapeFor('aimeat_decide_run'), annotationsFor('aimeat_decide_run'), async (a) => {
    if (a.action === 'list') return out(await client.get('/v1/ai/decide/runs'));
    if (a.action === 'start') {
      return out(await client.post('/v1/ai/decide/runs', {
        ...(a.rule !== undefined ? { rule: a.rule } : {}),
        ...(a.provider !== undefined ? { provider: a.provider } : {}),
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

  mcp.tool('aimeat_decide_settings', descriptionFor('aimeat_decide_settings'), zodShapeFor('aimeat_decide_settings'),
    annotationsFor('aimeat_decide_settings'), async () => out(await client.get('/v1/ai/decide/settings')));

  mcp.tool('aimeat_decide_rules', descriptionFor('aimeat_decide_rules'), zodShapeFor('aimeat_decide_rules'), annotationsFor('aimeat_decide_rules'), async (a) => {
    if (a.rule_id !== undefined) return out(await client.get(`/v1/ai/decide/rules/${encodeURIComponent(a.rule_id)}`));
    return out(await client.get('/v1/ai/decide/rules'));
  });

  mcp.tool('aimeat_decide_rule_propose', descriptionFor('aimeat_decide_rule_propose'), zodShapeFor('aimeat_decide_rule_propose'), annotationsFor('aimeat_decide_rule_propose'), async (a) => {
    return out(await client.post('/v1/ai/decide/rule-proposals', { rule: a.rule as never, reason: a.reason }));
  });
}
