/**
 * @file src/services/extension-access/script-refusal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A named refusal thrown by an extension's own script: `throw new Error('CLAIM_CONFLICT:
 *   …')`. The caller gets the code EXTENSION_REFUSED, the script's own code as `reason`, and a 4xx
 *   status where that reason says the request was the problem, instead of EXTENSION_ERROR and a 500.
 *
 *   WHY. Every error a script threw came back as EXTENSION_ERROR with status 500, the shape of a
 *   fault in the node. Lifecycle Central's claim_open refuses an area that overlaps a live claim with
 *   `CLAIM_CONFLICT: … Talk to that session`, and an agent in the instruction audit of 2026-11-08 met
 *   it as EXTENSION_ERROR, took it for an unexplained failure and changed its area until the call
 *   went through. The script had said what was wrong; the wrapper made it look like the node broke.
 *
 *   WHY THE SCRIPT'S CODE IS A REASON, NOT THE CODE. The first version (2026-11-08) passed the
 *   script's code through as the response code and kept a list of platform prefixes a script could
 *   not use. The re-check of the same day counted the node's own codes: 863 of 948 passed that list,
 *   so a script could still answer NOT_FOUND, INVALID_INPUT or CAPABILITY_NOT_FOUND in the node's
 *   voice. No list can be complete, so the response code is now always the node's own,
 *   EXTENSION_REFUSED, and what the script said travels in `error.details.reason` and the message.
 *   A caller who branches on the code reads the node; a caller who wants the extension's reason
 *   reads `reason`, and knows the extension wrote it.
 * @structure scriptRefusal(message) → { reason, status } | null · EXTENSION_REFUSED
 * @usage
 *   The node's own extension context throws codes the same way (VISITOR_READ_ONLY, FETCH_TIMEOUT,
 *   RESPONSE_TOO_LARGE), and they arrive the same way, as a reason under EXTENSION_REFUSED.
 *
 *   const named = scriptRefusal(message);
 *   if (named) return { kind: 'refused', status: named.status, code: EXTENSION_REFUSED, reason: named.reason, message, keepMessage: true };
 * @version-history
 *   v2.0.0 — 2026-11-08 — The code is always EXTENSION_REFUSED and the script's code is `reason`; the
 *     reserved-prefix list is gone (instruction audit re-check, round 2).
 *   v1.0.0 — 2026-11-08 — Initial.
 */

/** The node's code for a refusal an extension's script named. Never a code the script chose. */
export const EXTENSION_REFUSED = 'EXTENSION_REFUSED';

/** `CODE: text` at the start of the message, the code in UPPER_SNAKE_CASE. */
const NAMED = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+):\s/;

/**
 * The script's reason and the status it maps to, or null when the message names no code. The
 * status is a 4xx only where the reason says the caller's request was the problem; any other reason
 * keeps the 500 it had (an upstream that did not answer, a fetch that timed out), so a workflow or a
 * schedule that reads the status reads what it read before.
 */
export function scriptRefusal(message: string): { reason: string; status: number } | null {
    const reason = NAMED.exec(message)?.[1];
    if (!reason || reason.length > 48) return null;
    const status = /CONFLICT$/.test(reason) ? 409
        : /NOT_FOUND$/.test(reason) ? 404
        : /(?:FORBIDDEN|DENIED|READ_ONLY)$/.test(reason) ? 403
        : /(?:^INVALID|_INVALID|_REQUIRED|^MISSING|^NO_INPUT$)/.test(reason) ? 400
        : 500;
    return { reason, status };
}
