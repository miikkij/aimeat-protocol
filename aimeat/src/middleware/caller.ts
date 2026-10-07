/**
 * @file src/middleware/caller.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The REST request's caller, built once per request (secaudit 2026-10, C9): the first
 *   callerOf(req) builds it from req.auth (services/caller-context.ts) and every later one on the same
 *   request gets the same object, with its operator answer kept.
 * @structure callerOf(req, nodeId, storage)
 * @usage const caller = callerOf(req, config.nodeId, storage); if (!caller.has('company:write')) …
 * @version-history
 *   v1.0.1 — 2026-10-07 — The anonymous identity optionalAuth injects counts as no auth (code scanning alert 1701).
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C9).
 */
import type { Request } from 'express';
import type { Storage } from '../storage/interface.js';
import { callerFromAuth, type CallerContext } from '../services/caller-context.js';

const built = new WeakMap<Request, CallerContext>();

/** The caller of an authenticated request. Throws on a request no auth middleware ran on. */
export function callerOf(req: Request, nodeId: string, storage: Storage): CallerContext {
    let caller = built.get(req);
    if (!caller) {
        if (!req.auth || req.auth.anonymous) throw new Error('callerOf: the request carries no real auth; mount requireAuth() before it.');
        caller = callerFromAuth(req.auth, nodeId, storage);
        built.set(req, caller);
    }
    return caller;
}
