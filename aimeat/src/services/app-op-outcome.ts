/**
 * @file src/services/app-op-outcome.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The answer of an app-management service that both the REST route and the
 *   aimeat_app_manage MCP tool call: the data the route answers under `data` with its HTTP status,
 *   or a refusal with the status, the envelope code, the message and the details the route answers.
 *   The route maps it with sendAppOp (routes/app-op-answer.ts), the MCP tool with opAnswer
 *   (mcp/app-manage-answers.ts), so the two answer from one decision.
 * @structure AppOpCaller · AppOpOutcome · AppOpRefusal · done · refuse
 * @usage return refuse(403, 'FORBIDDEN', 'Only the app owner reads its carry plan');
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial: the member, plan, audit, dev-grant and design-spec services answer
 *     in this shape; aimeat_app_manage calls the service in place of the route over loopback HTTP
 *     (secaudit 2026-10, M6).
 */

/**
 * Who is calling, as data rather than an Express request: the route passes its verified token, the
 * MCP tool the session's agent identity ({ sub: gaii, owner, roles: ['agent'], scopes }).
 */
export interface AppOpCaller {
  sub: string;
  owner: string;
  roles: string[];
  scopes?: string[];
  federated?: boolean;
  homeNode?: string;
  /** The app a role-'app' token was minted for ("owner/filename"). */
  app?: string;
}

/** A refusal, as the route answers it: HTTP status, envelope code, message, optional details. */
export interface AppOpRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** The data the route answers under `data`, with its status (200 when absent), or a refusal. */
export type AppOpOutcome = { ok: true; status?: number; data: Record<string, unknown> } | AppOpRefusal;

export function done(data: Record<string, unknown>, status?: number): AppOpOutcome {
  return status && status !== 200 ? { ok: true, status, data } : { ok: true, data };
}

export function refuse(status: number, code: string, message: string, details?: unknown): AppOpRefusal {
  return details === undefined ? { ok: false, status, code, message } : { ok: false, status, code, message, details };
}
