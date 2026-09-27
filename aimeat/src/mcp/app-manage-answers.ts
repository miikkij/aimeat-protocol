/**
 * @file src/mcp/app-manage-answers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How aimeat_app_manage answers on the node: a result as indented JSON, and a service's
 *   refusal as `CODE: message` (the same code the REST endpoint answers), so a test asserts the code.
 * @structure ToolAnswer · answer · refusalText
 * @usage return out.ok ? answer(out.data) : refusalText(out);
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial.
 */
import { toolError } from './tool-error.js';

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
