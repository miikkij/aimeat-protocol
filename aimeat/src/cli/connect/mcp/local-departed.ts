/**
 * @file src/cli/connect/mcp/local-departed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `GET /local/departed` of the serve daemon: the agents that left this connector home
 *   because the node moved or deleted them, with the node's reason (../departed-agents.ts).
 *
 *   For a runtime on the same machine that keeps files of its own per agent. It reads this
 *   instead of asking the node whether an agent that is missing from its roster still exists.
 *   The answer needs no caller identity: it is about the home, not about one agent, so it works
 *   when the agent that left was the last one of its owner here.
 *
 *   Read-only, and behind the same admission check as every other route of the daemon
 *   (./local-admission.ts: a loopback Host for this port, no Origin, the per-start secret).
 *
 *   `?since=<ISO 8601 time>` leaves out what the caller has already seen. An identity the daemon
 *   carries again is never in the answer (a recreated agent has not departed).
 * @structure registerLocalDepartedRoute(app, carried)
 * @usage registerLocalDepartedRoute(app, () => registry.list().map(e => e.gaii));
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial.
 */
import type { Express, Request, Response } from 'express';
import { DEPARTED_MAX_AGE_DAYS, readDeparted } from '../departed-agents.js';

/** `carried`: every identity the daemon holds a working credential for at the moment of the call. */
export function registerLocalDepartedRoute(app: Express, carried: () => string[]): void {
  app.get('/local/departed', (req: Request, res: Response) => {
    const raw = typeof req.query.since === 'string' ? req.query.since : undefined;
    const since = raw === undefined ? null : Date.parse(raw);
    if (since !== null && !Number.isFinite(since)) {
      res.status(400).json({ ok: false, error: { code: 'INVALID_INPUT', message: '`since` is an ISO 8601 time, for example 2026-10-12T08:50:00.000Z' } });
      return;
    }
    const departed = readDeparted(carried()).filter(r => since === null || Date.parse(r.at) > since);
    res.json({ ok: true, data: { departed, max_age_days: DEPARTED_MAX_AGE_DAYS } });
  });
}
