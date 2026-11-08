/**
 * @file src/services/extension-access/script-refusal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A named refusal thrown by an extension's own script: `throw new Error('CLAIM_CONFLICT:
 *   …')`. The caller gets that code and a 4xx status instead of EXTENSION_ERROR and a 500.
 *
 *   WHY. Every error a script threw came back as EXTENSION_ERROR with status 500, the shape of a
 *   fault in the node. Lifecycle Central's claim_open refuses an area that overlaps a live claim with
 *   `CLAIM_CONFLICT: … Talk to that session`, and an agent in the instruction audit of 2026-11-08 met
 *   it as EXTENSION_ERROR, took it for an unexplained failure and changed its area until the call
 *   went through. The script had said what was wrong; the wrapper made it look like the node broke.
 *
 *   A script never speaks for the node: the platform's own codes (sign-in, scopes, tokens,
 *   payment, limits, the extension's own failure codes) stay reserved, and a script that throws one
 *   of them keeps getting EXTENSION_ERROR, so an extension cannot dress its answer as the node's.
 * @structure scriptRefusal(message) → { code, status } | null
 * @usage
 *   The node's own extension context throws codes the same way (VISITOR_READ_ONLY, FETCH_TIMEOUT,
 *   RESPONSE_TOO_LARGE), and they are named the same way; CONSENT_REQUIRED and RATE_LIMITED are
 *   platform codes and stay EXTENSION_ERROR as before.
 *
 *   const named = scriptRefusal(message);
 *   if (named) return { kind: 'refused', status: named.status, code: named.code, message, keepMessage: true };
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial.
 */

/** `CODE: text` at the start of the message, the code in UPPER_SNAKE_CASE. */
const NAMED = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+):\s/;

/** Codes that belong to the platform, by prefix or whole: a script's error never carries them. */
const RESERVED = /^(?:AUTH|SCOPE|TOKEN|PERMISSION|PAYMENT|PAYWALL|RATE_LIMIT(?:ED)?|API_LIMIT|EXTENSION|INTERNAL|ADMIN|OPERATOR|OWNER|CONSENT|MFA|TOTP|SESSION|CSRF|FEDERATION)(?:_|$)/;

/**
 * The code and status of a named refusal, or null when the message is not one or names a reserved
 * code. The status is a 4xx only where the code says the caller's request was the problem; any
 * other code keeps the 500 it had (an upstream that did not answer, a fetch that timed out), so a
 * workflow or a schedule that reads the status reads what it read before, and only the code is new.
 */
export function scriptRefusal(message: string): { code: string; status: number } | null {
    const code = NAMED.exec(message)?.[1];
    if (!code || code.length > 48 || RESERVED.test(code)) return null;
    const status = /CONFLICT$/.test(code) ? 409
        : /NOT_FOUND$/.test(code) ? 404
        : /(?:FORBIDDEN|DENIED|READ_ONLY)$/.test(code) ? 403
        : /(?:^INVALID|_INVALID|_REQUIRED|^MISSING|^NO_INPUT$)/.test(code) ? 400
        : 500;
    return { code, status };
}
