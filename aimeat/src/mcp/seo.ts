/**
 * @file seo.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent-facing half of search visibility: what this node's discovery state is, and
 *   the switch on one app.
 *
 *   Both tools exist because the capability is not finished while it is only clickable. An owner
 *   who works through their own AI has to be able to say "make my app findable" and have it happen,
 *   and an operator has to be able to ask "is my node findable and what is left to do" without
 *   opening a dashboard.
 *
 *   Neither does the work itself. `aimeat_seo_status` calls buildSeoStatus(), the same function
 *   GET /v1/admin/seo/status renders. An app's own search visibility is action "seo" of
 *   aimeat_app_manage (src/mcp/app-manage.ts), which calls the same service PATCH /v1/apps/:filename
 *   calls.
 *
 *   An app's other settings (parked, forkable, access code, protection, name) are action
 *   "settings" of aimeat_app_manage since 2026-09-27; they were reachable only over HTTP before.
 *
 * @structure registerSeoTools(mcp, storage, config, getAgentGaii, scopes)
 * @usage import { registerSeoTools } from './seo.js';
 * @version-history
 *   v1.3.1 — 2026-10-05 — A comment names requireOperator, the REST route's check since secaudit 2026-10, C2.
 *   v1.3.0 — 2026-09-27 — aimeat_app_seo_set moved into aimeat_app_manage (action "seo", src/mcp/app-manage.ts).
 *   v1.2.0 — 2026-09-24 — SECURITY (audit A8-1): the status and the announcement ask the
 *     operator:admin word as well as the account (services/owner-lifecycle.ts
 *     resolveOperatorAgentName), and are registered on that word rather than on app:write.
 *   v1.1.0 — 2026-09-11 — aimeat_seo_announce: the whole site to IndexNow, or its plan. Calls
 *     planAnnouncement / announceEverything (indexnow-site.ts), the same functions
 *     POST /v1/admin/seo/indexnow calls.
 *   v1.0.1 — 2026-08-29 — The header's gap note names the marks door that now exists (app-marks.ts).
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { buildSeoStatus, announceNote } from '../routes/admin-seo.js';
import { planAnnouncement, announceEverything } from '../services/indexnow-site.js';
import { emitChange } from '../services/event-bus.js';
import { resolveOperatorAgentName, OPERATOR_AGENT_REFUSAL } from '../services/owner-lifecycle.js';

export function registerSeoTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  /** This session's granted scopes: the two operator tools ask operator:admin of them at call time. */
  scopes: readonly string[] = [],
): void {
  mcp.tool(
    'aimeat_seo_status',
    descriptionFor('aimeat_seo_status'),
    {},
    annotationsFor('aimeat_seo_status'),
    async () => {
      // The REST route is behind requireOperator() (askOperator with operator:admin), and this tool
      // calls buildSeoStatus() directly rather than over HTTP, so the check has to be made HERE too, or the tool
      // is a way around the gate on the route. That is the shape the August 2026 audit named: a
      // permission word is enforced on every door or it does not exist.
      //
      // An MCP token carries roles ['agent'] and nothing else, so the check is on the ACCOUNT the
      // agent acts for, and then on the operator:admin word the operator ticked for this agent, the
      // way every other operator tool on this surface does it.
      if (!(await resolveOperatorAgentName(storage, getAgentGaii(), scopes))) {
        return { content: [{ type: 'text' as const, text: OPERATOR_AGENT_REFUSAL }], isError: true };
      }
      const status = await buildSeoStatus(config, storage);
      return { content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }] };
    },
  );

  mcp.tool(
    'aimeat_seo_announce',
    descriptionFor('aimeat_seo_announce'),
    {
      scope: z.enum(['all', 'pages']).optional().describe('"all" (default): the pages and every findable application. "pages": the pages alone.'),
      plan: z.boolean().optional().describe('true lists what would be sent, host by host, and sends nothing.'),
    },
    annotationsFor('aimeat_seo_announce'),
    async (args: { scope?: 'all' | 'pages'; plan?: boolean }) => {
      // Operator-gated here for the same reason aimeat_seo_status is: this calls the service the
      // route calls, not the route, so the route's gate has to be repeated at this door.
      const operator = await resolveOperatorAgentName(storage, getAgentGaii(), scopes);
      if (!operator) {
        return { content: [{ type: 'text' as const, text: OPERATOR_AGENT_REFUSAL }], isError: true };
      }
      const scope = args.scope ?? 'all';
      if (args.plan) {
        const plan = await planAnnouncement(config, storage, scope);
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          scope, url_count: plan.urls.length, host_count: plan.hosts.length, hosts: plan.hosts, urls: plan.urls,
        }, null, 2) }] };
      }
      const out = await announceEverything(config, storage, { scope, by: operator });
      if (!out.sent) {
        const why = out.reason === 'no_key'
          ? 'No IndexNow key is set on this node (AIMEAT_INDEXNOW_KEY); whoever installed it is the one to ask.'
          : out.reason === 'indexing_off'
            ? 'Search engines are turned away on this node (seo.indexing is off), so there is nothing to announce.'
            : 'There is nothing to send: no pages and no findable application.';
        return { content: [{ type: 'text' as const, text: why }], isError: true };
      }
      emitChange('apps');
      const { run } = out;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          scope, url_count: run.urlCount, host_count: run.hosts, run,
          note: announceNote(scope, run.urlCount, run.hosts, run.failed),
        }, null, 2) }],
        ...(run.failed.length === run.hosts ? { isError: true } : {}),
      };
    },
  );
}
