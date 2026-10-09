/**
 * @file src/tool-dispatch/index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared REST tool dispatch for node invoke, connector MCP and CLI.
 * @version-history
 *   v1.7.0 -- 2026-10-09 -- docsignCliTools: aimeat_docsign_validate, _lookup, _request_create,
 *     _requests, _request_get, _sign and _cancel.
 *   v1.6.0 -- 2026-10-08 -- visibilityCliTools: aimeat_visibility_report and aimeat_visibility_settings_set.
 *   v1.5.0 -- 2026-09-29 -- storageCliTools: the storage tools moved out of tool-call-defs-core.ts.
 *   v1.4.0 -- 2026-09-29 -- classificationCliTools: aimeat_classification (TARGET-082 V5).
 *   v1.3.0 -- 2026-09-29 -- refineryCliTools: aimeat_refinery_classes, _run and _status.
 *   v1.2.0 -- 2026-09-28 -- aiModelCliTools: aimeat_ai_policy_set on the shell dispatch.
 *   v1.1.0 -- 2026-09-27 -- Integrate the published app-manage tool into the shared dispatch table.
 *   v1.0.0 -- 2026-09-27 -- Extracted unchanged from the CLI shell adapter.
 */
import { getAimeatToolDefinition } from '../tool-catalog/definitions.js';
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';

import { agentTools } from './tool-call-defs-agent.js';
import { coreTools } from './tool-call-defs-core.js';
import { storageCliTools } from './tool-call-defs-storage.js';
import { boardTools } from './tool-call-defs-boards.js';
import { skillTools } from './tool-call-defs-skills.js';
import { secretTools } from './tool-call-defs-secrets.js';
import { organismTools } from './tool-call-defs-organism.js';
import { appTools } from './tool-call-defs-apps.js';
import { commerceCliTools } from './tool-call-defs-commerce.js';
import { packageTools } from './tool-call-defs-packages.js';
import { workflowTools } from './tool-call-defs-workflows.js';
import { aiJobTools } from './tool-call-defs-ai-jobs.js';
import { decideTools } from './tool-call-defs-decide.js';
import { voiceTools } from './tool-call-defs-ai-voice.js';
import { aiModelCliTools } from './tool-call-defs-ai-models.js';
import { appDraftEditTools } from './tool-call-defs-app-draft-edit.js';
import { appManageCliTools } from './tool-call-defs-app-manage.js';
import { exchangeTools } from './tool-call-defs-exchange.js';
import { connectionCliTools } from './tool-call-defs-connections.js';
import { refineryCliTools } from './tool-call-defs-refinery.js';
import { classificationCliTools } from './tool-call-defs-classification.js';
import { mcpProxyCliTools } from './tool-call-defs-mcp-proxy.js';
import { adminCliTools } from './tool-call-defs-admin.js';
import { themeCliTools } from './tool-call-defs-themes.js';
import { visibilityCliTools } from './tool-call-defs-visibility.js';
import { docsignCliTools } from './tool-call-defs-docsign.js';
import { withProvenanceCarrying } from './ai-provenance-carry.js';

// The full tool catalog is assembled from sibling group modules, preserving declaration order.
//
// TARGET-058 Phase 11: every definition goes through withProvenanceCarrying(), which is where an
// `ai_provenance` block sent to a shell-callable tool is validated, recorded (or reported as not
// recorded), and echoed back. ONE wrapper rather than thirteen edited handlers — this dispatch table
// serves both `aimeat connect call` and `POST /local/call/:tool`, and a per-handler version would
// have left whichever one somebody forgot silently stripping the block, which is the bug being fixed.
export const CONNECT_CLI_TOOLS: ConnectCliToolDefinition[] = [
    ...agentTools,
    ...coreTools,
    ...storageCliTools,
    ...boardTools,
    ...skillTools,
    ...secretTools,
    ...organismTools,
    ...appTools,
    ...commerceCliTools,
    ...packageTools,
    ...workflowTools,
    ...aiJobTools,
    ...decideTools,
    ...voiceTools,
    ...aiModelCliTools,
    ...appDraftEditTools,
    ...appManageCliTools,
    ...exchangeTools,
    ...connectionCliTools,
    ...refineryCliTools,
    ...classificationCliTools,
    ...mcpProxyCliTools,
    ...adminCliTools,
    ...themeCliTools,
    ...visibilityCliTools,
    ...docsignCliTools,
].map(withProvenanceCarrying).map(withDeclaredInputOnly);

/**
 * REFUSE A PARAMETER THIS TOOL DOES NOT DECLARE, instead of ignoring it.
 *
 * THE DEFECT THIS ENDS. A caller sent `deliverable_key` to aimeat_task_complete, got `ok: true`
 * back, and the pointer to its own output was gone: no error, no warning, no log line. The same
 * shape then repeated with `owner_scope` on the memory tools, and a crew's public mirror read only
 * its own namespace for weeks while every call it made succeeded. Silent loss is the whole problem;
 * a dropped parameter that ANSWERS is worse than one that refuses, because nobody investigates a
 * success.
 *
 * So the contract is enforced in one place, on the assembled table, exactly like
 * withProvenanceCarrying above — a per-handler version would have left whichever door somebody
 * forgot still swallowing the field, which is the bug, not the fix.
 *
 * A tool that declares NO input anywhere stays permissive: absence of a schema is not evidence that
 * a parameter is wrong, and guessing would refuse working calls.
 */
function withDeclaredInputOnly(tool: ConnectCliToolDefinition): ConnectCliToolDefinition {
    const declared = new Set<string>([
        ...Object.keys(tool.input ?? {}),
        ...Object.keys(getAimeatToolDefinition(tool.name)?.input ?? {}),
        // Handled by the wrapper above rather than by any handler.
        'ai_provenance', 'ai_provenance_id',
        // Chosen by the dispatcher, not forwarded as a field.
        'agent_name', 'response_format',
    ]);
    // Nothing to check against.
    if (declared.size <= 4) return tool;
    return {
        ...tool,
        handler: (ctx, input) => {
            const unknown = Object.keys(input ?? {}).filter(key => !declared.has(key));
            if (unknown.length) {
                const accepted = [...declared].filter(k => k !== 'ai_provenance' && k !== 'ai_provenance_id' && k !== 'response_format').sort();
                return Promise.resolve({ ok: false as const, error: {
                    code: 'UNKNOWN_PARAMETER',
                    message: `${tool.name} does not take ${unknown.map(u => `"${u}"`).join(', ')}. `
                        + `It takes: ${accepted.join(', ')}. `
                        + 'This is a refusal rather than a silent drop on purpose: a parameter that is ignored '
                        + 'while the call succeeds is how a caller loses data without ever being told.',
                    unknown_parameters: unknown,
                    accepted_parameters: accepted,
                } });
            }
            return tool.handler(ctx, input);
        },
    };
}
