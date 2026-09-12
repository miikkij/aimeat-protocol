/**
 * @file src/mcp/admin-statistics.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's Statistics page over MCP: one read of what this node counted, the day
 *   tallies behind it, and the gauges that are neither.
 *
 *   THE DOOR EXISTS BECAUSE THE PAGE PROMISED IT. The Statistics page tells an operator to hand
 *   these numbers to their own AI, and the tool it named — aimeat_admin_stats — answers a different
 *   question entirely: how many agents, actions, boards and morsels this node holds. Not one
 *   counter, no day tallies, no period. The operator following the page's own advice got an answer
 *   that could not contain what they asked about. This is the read the page actually makes.
 *
 *   NOT A SECOND NAME FOR aimeat_admin_stats. That tool keeps its meaning and its callers; this one
 *   is the counters. Two tools, two questions, and the descriptions say which is which.
 *
 *   It calls services/stats-page.ts, the ONE implementation GET /v1/stats calls. Nothing here reads
 *   storage or the collector directly: building this payload twice is precisely how the older name
 *   came to mean three different things on three surfaces.
 *   IT HONOURS THE SAME SWITCH as the route. `statsEnabled: false` means an operator turned these
 *   numbers off on this node, and a door that ignores that is a door the switch does not cover.
 * @structure registerAdminStatisticsTools(mcp, storage, config, getAgentGaii) — one read.
 * @usage registerAdminStatisticsTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial: aimeat_admin_statistics.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { getStats } from '../services/stats.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { resolveOperatorName } from '../services/owner-lifecycle.js';
import { buildStatsSnapshot } from '../services/stats-page.js';

const text = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });
const refuse = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function registerAdminStatisticsTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  const agentGaii = getAgentGaii();
  const operatorName = () => resolveOperatorName(storage, agentGaii);

  mcp.tool('aimeat_admin_statistics', descriptionFor('aimeat_admin_statistics'),
    {
      from: z.string().optional().describe('First day of the period, inclusive, as YYYY-MM-DD. Give `to` as well, or neither is used and you get the whole life of this node.'),
      to: z.string().optional().describe('Last day of the period, inclusive, as YYYY-MM-DD. Give `from` as well, or neither is used.'),
    },
    annotationsFor('aimeat_admin_statistics'),
    async ({ from, to }) => {
      if (!(await operatorName())) return refuse('Operator role required');
      if (!config.statsEnabled) return refuse('Statistics are switched off on this node.');
      const stats = getStats();
      if (!stats) return refuse('The counters are not running on this node yet.');

      // A malformed date would be compared as a string against the day keys and silently match
      // nothing, which reads back as "the period was quiet" rather than as a mistake.
      for (const [label, value] of [['from', from], ['to', to]] as const) {
        if (value !== undefined && !ISO_DAY.test(value)) {
          return refuse(`\`${label}\` must be a day as YYYY-MM-DD; got "${value}".`);
        }
      }
      // Both or neither, and say which happened rather than quietly answering the other question.
      if ((from === undefined) !== (to === undefined)) {
        return refuse('Give both `from` and `to` for a period, or neither for the whole life of this node. One alone would answer a different question than the one asked.');
      }
      if (from && to && from > to) return refuse(`\`from\` (${from}) is after \`to\` (${to}).`);

      const range = from && to ? { from, to } : undefined;
      return text(await buildStatsSnapshot(config, storage, stats, range));
    });
}
