/**
 * @file src/middleware/system-fault.ts
 * @description Notices when a response says the node broke, and reports it to whoever runs the node.
 *
 *   ONE PLACE, NOT 108. `INTERNAL_ERROR` is written at 108 call sites and the other fault codes at a
 *   dozen more. Asking each of them to remember to report itself is asking for the ones that forget,
 *   and the ones that forget are exactly the paths nobody has looked at recently — which is where
 *   the interesting faults live. So the reporting sits where every response already passes, and a
 *   route written next year is covered without its author knowing this file exists.
 *
 *   It reads the ENVELOPE rather than the status code, because that is where the meaning is: a 500
 *   with a caller-error code is not a fault, and a fault answered with a 200 would still be one.
 *   FAULT_CODES in services/system-fault-report.ts decides, and it is short on purpose.
 *
 *   Fire-and-forget, always. The user's response is already written by the time this runs; a report
 *   that fails must never become a second failure the person waits on.
 * @structure systemFaultReporter() — express middleware, wraps res.json for the life of the request
 * @usage app.use(systemFaultReporter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial. From the finding that 108 INTERNAL_ERRORs were each a dead end
 *     seen by one person and heard about by nobody.
 */
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { reportSystemFault } from '../services/system-fault-report.js';

interface ErrorEnvelope {
    ok?: boolean;
    request_id?: string;
    error?: { code?: string; message?: string };
}

export function systemFaultReporter(config: AimeatConfig, storage: Storage) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const originalJson = res.json.bind(res);
        res.json = (body: unknown): Response => {
            const envelope = body as ErrorEnvelope | null;
            const code = envelope?.ok === false ? envelope.error?.code : undefined;
            if (code) {
                // The ROUTE PATTERN, not the filled-in path: `/v1/agents/:name/tasks/:id` groups the
                // failures of one route, while the concrete path would make every task id look like
                // a different fault and defeat the hourly deduplication.
                const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
                void reportSystemFault({ storage, config }, {
                    code,
                    route: typeof route === 'string' ? route : req.path,
                    method: req.method,
                    requestId: envelope?.request_id,
                    shown: envelope?.error?.message,
                });
            }
            return originalJson(body);
        };
        next();
    };
}
