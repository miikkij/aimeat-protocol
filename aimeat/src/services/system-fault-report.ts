/**
 * @file src/services/system-fault-report.ts
 * @description When the node breaks, the node says so — to the people who run it, without asking
 *   the user to describe anything.
 *
 *   WHY THIS EXISTS. `INTERNAL_ERROR` is raised in 108 places. Every one of them was a dead end seen
 *   by one person and heard about by nobody: the user got "An unexpected error occurred", and the
 *   operators learned about it only if that person happened to write in. An agent in August 2026 hit
 *   an onboarding step it could not pass, invented three explanations, and its user waited six days
 *   for a human to relay the problem by email.
 *
 *   So the report is the node's own job, not the user's. The machine knows what it was doing better
 *   than the person could describe it, and asking someone to write a bug report is asking them to do
 *   our work at the exact moment we already failed them.
 *
 *   WHAT THE USER IS TOLD, and this is the point rather than a nicety: that it was not their doing,
 *   that it is already reported, and that they can carry on. Never a code, never a stack, never a
 *   request to go and tell someone.
 *
 *   NO CONSENT PROMPT, by the owner's decision on 2026-08-16: the report describes the SYSTEM, not
 *   the person. It carries the route, the code and the request id — never the body, never their
 *   content. What it does carry is `kind: 'system-fault'`, so an operator's inbox can tell it from a
 *   person's question on sight: a question wants an answer, this wants a fix and at most an
 *   acknowledgement.
 * @structure
 *   - FAULT_CODES — the error codes that mean "we broke", as opposed to a caller's mistake
 *   - reportSystemFault() — send one, deduplicated, fire-and-forget
 *   - SYSTEM_FAULT_REPLY — the shape an operator's answer takes when they send one
 * @usage
 *   void reportSystemFault({ storage, config }, { code, route, method, requestId });
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial, from the review of what 2107 user-visible messages actually say.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { findOperatorGhii } from './operators.js';
import { sendDirectMessage } from './message-send.js';

/**
 * The codes that mean the node failed, as opposed to a caller getting the call wrong.
 *
 * Deliberately short. A code belongs here only when NOTHING the caller could have done differently
 * would have avoided it — a permission refusal or a missing field is not a fault, it is the system
 * working. Adding a caller-error code here would bury the real ones under noise, which is the same
 * failure as not reporting at all.
 */
export const FAULT_CODES = new Set([
    'INTERNAL_ERROR',
    'INTERNAL',
    'UPDATE_FAILED',
    'IMPORT_FAILED',
    'ZIP_ERROR',
    'ENCRYPTION_NOT_CONFIGURED',
]);

/** What an operator's reply says, when they choose to send one. Three things, always these three. */
export const SYSTEM_FAULT_REPLY = [
    'This was not caused by anything you did.',
    'It is a fault on our side and it is being corrected.',
    'Thank you for using the node and finding it — this is how the service gets better.',
].join(' ');

/**
 * One report per code+route per hour, per process.
 *
 * A failing route fails for everyone at once. Without this, one bad deploy writes a thousand
 * identical messages into the operator inbox and buries the second, different fault underneath —
 * which turns the channel we built for learning into the reason nobody reads it. A restart re-reports
 * once, on purpose: a fault that survives a restart is worth saying again.
 */
const seen = new Map<string, number>();
const WINDOW_MS = 60 * 60 * 1000;

export interface SystemFaultInput {
    code: string;
    route: string;
    method: string;
    requestId?: string;
    /** The message the caller was given, so the operator sees exactly what the user saw. */
    shown?: string;
}

/**
 * Report one fault to whoever runs this node. Never throws and never blocks the response: a failure
 * to report a failure must not become a second failure the user waits on.
 */
export async function reportSystemFault(
    deps: { storage: Storage; config: AimeatConfig },
    input: SystemFaultInput,
): Promise<void> {
    if (!FAULT_CODES.has(input.code)) return;

    const key = `${input.code} ${input.method} ${input.route}`;
    const now = Date.now();
    const last = seen.get(key);
    if (last !== undefined && now - last < WINDOW_MS) return;
    seen.set(key, now);

    try {
        const operator = await findOperatorGhii(deps.storage, deps.config);
        if (!operator) return;   // a node with no operator has nobody to tell.

        const body = [
            `The node answered **${input.code}** on \`${input.method} ${input.route}\`.`,
            '',
            input.shown ? `The caller was shown: "${input.shown}"` : '',
            input.requestId ? `Request id: \`${input.requestId}\`` : '',
            '',
            'Reported by the node itself. Nobody was asked to write this, and no user content is in it.',
        ].filter(Boolean).join('\n');

        // Local delivery only: sender and recipient are the same operator on this node, so the
        // federation peer map is never consulted.
        await sendDirectMessage({ storage: deps.storage, config: deps.config, peers: new Map() }, {
            senderGhii: operator,
            recipientGhii: operator,
            subject: `Fault: ${input.code} on ${input.route}`,
            body,
            kind: 'system-fault',
            skipContactGate: true,
        });
    } catch (err) {
        // The report is best-effort by design. If it cannot be sent the user is unaffected, and a
        // silent catch here is the one place it is correct: the alternative is a failure to report a
        // failure surfacing as a third failure.
        logger.warn('system-fault report could not be sent', { code: input.code, error: String(err) });
    }
}
