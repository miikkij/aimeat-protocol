/**
 * @file src/mcp/app-manage-answers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How aimeat_app_manage answers on the node: a result as indented JSON, and a service's
 *   refusal as `CODE: message` (the same code the REST endpoint answers), so a test asserts the code.
 * @structure ToolAnswer · answer · refusalText · opAnswer
 * @usage return out.ok ? answer(out.data) : refusalText(out);
 * @version-history
 *   v1.1.0 — 2026-10-05 — opAnswer: an AppOpOutcome (services/app-op-outcome.ts) as the tool's answer,
 *     the data the route answers under `data` or `CODE: message`; aimeat_app_manage calls the service
 *     in place of the route over loopback HTTP (secaudit 2026-10, M6).
 *   v1.0.0 — 2026-09-27 — Initial.
 */
import { toolError } from './tool-error.js';
import type { AppOpOutcome } from '../services/app-op-outcome.js';

export type ToolAnswer = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

export function answer(data: unknown): ToolAnswer {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/**
 * The seo, marks, legal and audit services refuse with a sentence and no code; their tools answered
 * with that sentence as it was, and so does this one.
 */
export function plainRefusal(sentence: string): ToolAnswer {
    return { content: [{ type: 'text', text: sentence }], isError: true };
}

/** A service refusal, any of the shapes the app services use: { code, message } at the top. */
export function refusalText(r: { code: string; message: string }): ToolAnswer {
    return toolError(r.code, r.message);
}

/** A shared app-management service's outcome: the same JSON the route answers under `data`, or its refusal. */
export function opAnswer(out: AppOpOutcome): ToolAnswer {
    return out.ok ? answer(out.data) : toolError(out.code, out.message);
}
