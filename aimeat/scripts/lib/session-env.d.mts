/**
 * @file scripts/lib/session-env.d.mts
 * @description Types for session-env.mjs, so TypeScript scripts and tests can import it.
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial.
 */
export function isAgentSession(env?: Record<string, string | undefined>): boolean;
