/**
 * @file src/mcp/help.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Ask someone who knows on the node MCP: aimeat_help_find, _ask, _inbox, _respond, _close,
 *   _profile_set, _report_data and _report_write. Each tool calls the same services/help/ function the
 *   REST route in routes/help/ calls, with the session's caller, so the scope check, the owner's
 *   choices, the AI level, the weekly limits and the morsels happen there once. Nothing is decided in
 *   this file.
 *
 *   ONLY THE DECLARED FIELDS ARE SENT ON. The body handed to a service is built from the catalog's
 *   field lists (tool-catalog/definitions/help.ts), the same lists the CLI dispatch table uses.
 * @structure registerHelpTools(mcp, storage, config, caller)
 * @usage registerHelpTools(mcp, storage, config, caller);   // mcp/register-all.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import {
    HELP_PROFILE_FIELDS, HELP_FIND_FIELDS, HELP_ASK_FIELDS, HELP_RESPOND_FIELDS, HELP_CLOSE_FIELDS, HELP_REPORT_WRITE_FIELDS,
} from '../tool-catalog/definitions/help.js';
import { setParticipation } from '../services/help/participants.js';
import { findHelp, askQuestion, takeFromBoard, listInbox } from '../services/help/questions.js';
import { respondToQuestion } from '../services/help/respond.js';
import { closeQuestion } from '../services/help/close.js';
import { reportData, writeReportText } from '../services/help/report.js';
import type { HelpResult } from '../services/help/rules.js';

/** The named fields of `args` that were given, as the body the REST route would receive. */
function bodyOf(args: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
    return Object.fromEntries(fields.filter(k => args[k] !== undefined).map(k => [k, args[k]]));
}

export function registerHelpTools(mcp: McpServer, storage: Storage, config: AimeatConfig, caller: () => CallerContext): void {
    const deps = { storage, config };
    const answer = <T>(r: HelpResult<T>): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } => (r.ok
        ? { content: [{ type: 'text' as const, text: JSON.stringify(r.data) }] }
        : toolError(r.code, r.message));
    const meta = (name: string) => ({ description: descriptionFor(name), inputSchema: zodShapeFor(name), annotations: annotationsFor(name) });

    mcp.registerTool('aimeat_help_find', meta('aimeat_help_find'),
        async (args) => answer(await findHelp(deps, caller(), bodyOf(args as Record<string, unknown>, HELP_FIND_FIELDS))));

    mcp.registerTool('aimeat_help_ask', meta('aimeat_help_ask'),
        async (args) => answer(await askQuestion(deps, caller(), bodyOf(args as Record<string, unknown>, HELP_ASK_FIELDS))));

    mcp.registerTool('aimeat_help_inbox', meta('aimeat_help_inbox'),
        async (args) => answer(await listInbox(deps, caller(), { include_closed: (args as { include_closed?: boolean }).include_closed === true })));

    mcp.registerTool('aimeat_help_respond', meta('aimeat_help_respond'),
        async (args) => {
            const a = args as unknown as Record<string, unknown>;
            const body = bodyOf(a, HELP_RESPOND_FIELDS);
            if (body.action === 'take') return answer(await takeFromBoard(deps, caller(), String(a.question_id ?? '')));
            return answer(await respondToQuestion(deps, caller(), String(a.question_id ?? ''), body));
        });

    mcp.registerTool('aimeat_help_close', meta('aimeat_help_close'),
        async (args) => {
            const a = args as unknown as Record<string, unknown>;
            return answer(await closeQuestion(deps, caller(), String(a.question_id ?? ''), bodyOf(a, HELP_CLOSE_FIELDS)));
        });

    mcp.registerTool('aimeat_help_profile_set', meta('aimeat_help_profile_set'),
        async (args) => answer(await setParticipation(deps, caller(), bodyOf(args as Record<string, unknown>, HELP_PROFILE_FIELDS))));

    mcp.registerTool('aimeat_help_report_data', meta('aimeat_help_report_data'),
        async (args) => {
            const a = args as { id?: string; make?: 'monthly' | 'weekly' };
            return answer(await reportData(deps, caller(), { ...(a.id ? { id: a.id } : {}), ...(a.make ? { make: a.make } : {}) }));
        });

    mcp.registerTool('aimeat_help_report_write', meta('aimeat_help_report_write'),
        async (args) => {
            const a = args as unknown as Record<string, unknown>;
            return answer(await writeReportText(deps, caller(), String(a.id ?? ''), bodyOf(a, HELP_REPORT_WRITE_FIELDS)));
        });
}
