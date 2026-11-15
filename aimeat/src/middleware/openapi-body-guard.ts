/**
 * @file src/middleware/openapi-body-guard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Checks a request's JSON body against the schema openapi.yaml declares for its route
 *   (services/openapi-body-contract.ts). The node setting security.request_body_check (option `mode`,
 *   asked on every request, so an operator's change applies without a restart) decides which mode a
 *   route is in: in enforce mode (the default) every route with a JSON body schema is enforced except
 *   the exempt routes of data/openapi-body-modes.ts; in observe mode every route is observed.
 *   - observe: a body that does not match is logged as one structured line
 *     (route, field, reason, the status the route answered, and the running counts; never the value)
 *     and counted, and the request goes on to its route exactly as before. Nothing is refused,
 *     nothing in the body changes. The line is written when the response is done, so it says whether
 *     the route accepted the body (the contract disagrees with a working client) or refused it too.
 *   - enforce: the same mismatch is answered
 *     400 VALIDATION_ERROR with the field named, as validateBody answers (models/validation-issues.ts).
 *     WHERE IT IS REFUSED. The middleware only compares the body and leaves the refusal pending on the
 *     request; the refusal runs just before the route's handler, after every middleware in the route's
 *     own chain (installHandlerCheck patches Express's Route dispatch, so it holds for every route,
 *     whenever and wherever it was registered). A caller the route refuses for sign-in, role, scope,
 *     readiness, ownership checked in middleware, or a rate limit gets the route's own answer as before,
 *     and its mismatch is observed. Authorization done inside a handler cannot come first this way.
 *     Only a caller with a session is refused: a caller without one that the route admits is passed on
 *     and the mismatch is observed. What a session is comes from the option `hasSession`, which
 *     server.ts sets to the question requireAuth() asks (auth/middleware.ts). A request answered
 *     without reaching a route handler (a terminal handler mounted with use()) is observed, and its
 *     line says `unchecked`.
 *
 *   WHY OBSERVE FIRST. 612 writing routes read their body without a schema, and the contract that
 *   describes most of them was never held against a real request (codebase analysis 2026-11-03,
 *   security-architecture finding 6). Where the contract and a working client disagree, enforcing it
 *   would refuse a designed use. The observe log shows those places; a route is switched to enforce
 *   once its log has shown no mismatch from a real client (AIMEAT-PURPOSE rule: a fix makes a use safe
 *   and never removes it).
 *
 *   WHAT IS CHECKED. A request whose method and path match a contract operation with an
 *   `application/json` body schema: its parsed JSON body, or, when it carries no body at all and the
 *   contract says the body is required, that absence. A body in another media type is not checked.
 *   The middleware never throws: any failure of its own passes the request on.
 *
 *   COST. Reading openapi.yaml takes about a second. In enforce mode it is read when the middleware
 *   is built; in observe mode once per process after the server is built, off the boot path, and
 *   requests before that are passed on unchecked. A switch to enforce before that read reads it at
 *   the next request.
 *   A route's schema is compiled at its first request. Matching a path and validating a body cost
 *   under a microsecond each (measurements in the commit that added this file).
 *
 *   LOG VOLUME. One line per mismatching request, at warn ('openapi body mismatch' when observed,
 *   'openapi body mismatch refused' with mode enforce when refused; the refusals are not counted in
 *   observations()), up to LOG_LINES_PER_MINUTE lines a minute;
 *   past that the lines of the minute are counted and one line says how many were left out. The
 *   counts in observations() are exact either way.
 * @structure pendingChecks · wrapHandler(route, method) · installHandlerCheck() ·
 *   openapiBodyGuard(nodeId, opts) → middleware with observations() and ready()
 * @usage app.use(openapiBodyGuard(config.nodeId));
 * @version-history
 *   v1.3.0 — 2026-11-15 — The refusal runs just before the route's handler, after the route's own
 *     middleware, so a caller the route refuses keeps the route's answer (structure programme 2026-11,
 *     unit 1). An enforced mismatch answered without reaching a route handler is logged as unchecked.
 *   v1.2.0 — 2026-11-14 — Options `mode` and `exempt`: the node setting security.request_body_check
 *     enforces every route except the exempt ones, or observes every route; `enforced` no longer
 *     defaults to a list in data/ (structure programme 2026-11, unit 1). A refusal is logged too.
 *   v1.1.0 — 2026-11-13 — Option hasSession: an enforced route refuses a body only from a caller with
 *     a session, so a caller without one keeps the route's 401 (structure programme 2026-11, unit 1).
 *   v1.0.0 — 2026-11-04 — Initial, observe mode only (codebase analysis 2026-11-03, item B5).
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import { createT } from '../i18n.js';
import { logger } from '../utils/logger.js';
import { requestLocale, validationFailure, type ValidationDetail } from '../models/validation-issues.js';
import { EXEMPT_BODY_ROUTES, type BodyCheckMode } from '../data/openapi-body-modes.js';
import {
    firstIssue, routeKey, sharedBodyContract,
    type BodyContract, type BodyIssue,
} from '../services/openapi-body-contract.js';

/** Log lines a minute before the rest of the minute is only counted. */
const LOG_LINES_PER_MINUTE = 1000;
/** Distinct (route, field, reason) counters kept; field names come from callers, so the map is bounded. */
const MAX_COUNTERS = 5000;
const CHECKED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface BodyObservation {
    route: string;
    field: string;
    reason: string;
    count: number;
    /** Of those, answered below 400 by the route: the route took a body the contract does not describe. */
    accepted: number;
    /** Answered 400 or above, or not answered: the route refused the body too. */
    refused: number;
}

export interface OpenApiBodyGuardOptions {
    /** Where the contract comes from; the running code's openapi.yaml by default. */
    load?: () => BodyContract | null;
    /** Route keys to enforce whatever the mode, as openapi.yaml writes them. None by default. */
    enforced?: readonly string[];
    /**
     * The node's mode, asked on every request (server.ts passes config.requestBodyCheck, the setting
     * security.request_body_check): 'enforce' enforces every contract operation except `exempt`.
     * Without it the guard observes every route outside `enforced`.
     */
    mode?: () => BodyCheckMode;
    /** Route keys observed in enforce mode, as openapi.yaml writes them; data/openapi-body-modes.ts by default. */
    exempt?: readonly string[];
    /**
     * Read the contract while the middleware is built rather than after. Always so when a route is
     * enforced, because an enforced route must never be passed unchecked.
     */
    loadNow?: boolean;
    logLinesPerMinute?: number;
    /**
     * Whether the request carries a session, as the routes' own sign-in check reads it
     * (auth/middleware.ts hasSession, which server.ts passes). With it, an enforced route refuses a
     * body only from a caller with a session: a caller without one is passed on, so the route's
     * sign-in check answers it as before, and the mismatch is observed. Without it every caller of
     * an enforced route is refused.
     */
    hasSession?: (req: Request) => boolean;
}

export interface OpenApiBodyGuard {
    (req: Request, res: Response, next: NextFunction): void;
    /** Every mismatch seen since start, by route, field and reason, most frequent first. */
    observations(): BodyObservation[];
    /** The contract has been read (or there is none to read). */
    ready(): boolean;
}

function hasBody(req: Request): boolean {
    const length = Number(req.headers['content-length'] ?? 0);
    return length > 0 || req.headers['transfer-encoding'] !== undefined;
}

function detailOf(issue: BodyIssue, t: ReturnType<typeof createT>): ValidationDetail {
    const d: ValidationDetail = { path: issue.field, code: issue.reason, message: '' };
    switch (issue.reason) {
        case 'required': d.message = t('validation.required'); break;
        case 'unknown_field': d.message = t('validation.unknownField'); break;
        case 'invalid_type': d.message = t('validation.invalidType', { expected: issue.expected ?? '' }); break;
        case 'too_long': d.max = issue.max; d.message = t(issue.text ? 'validation.tooLong' : 'validation.tooMany', { n: issue.max ?? 0 }); break;
        case 'too_short': d.min = issue.min; d.message = t(issue.text ? 'validation.tooShort' : 'validation.tooFew', { n: issue.min ?? 0 }); break;
        case 'invalid_format': d.message = t('validation.invalidFormat'); break;
        default: d.message = t('validation.invalidValue');
    }
    return d;
}

/**
 * A request whose body an enforced route may refuse, with the refusal to run at that route's handler:
 * it answers the request and returns true, or returns false to let the handler run. Set by the guard,
 * taken by the first route handler the request reaches.
 */
type PendingCheck = (req: Request, res: Response) => boolean;
const pendingChecks = new WeakMap<Request, PendingCheck>();

interface RouteLayer { method?: string; handle: ((...args: unknown[]) => unknown) & { [HANDLER_CHECKED]?: true } }
interface RouteInternals { stack: RouteLayer[]; dispatch(req: Request, res: Response, done: NextFunction): unknown }
const HANDLER_CHECKED = Symbol('openapiBodyHandlerChecked');
const DISPATCH_PATCHED = Symbol('openapiBodyDispatchPatched');

/**
 * The handler a route runs for this method: the last function registered for it (or for all
 * methods), which is not an error handler. Everything registered before it in the same route is the
 * route's own middleware (requireAuth, requireRole, requireScope, a rate limit, validateBody).
 */
function wrapHandler(route: RouteInternals, method: string): void {
    const m = method.toLowerCase();
    for (let i = route.stack.length - 1; i >= 0; i--) {
        const layer = route.stack[i];
        if (layer.method !== undefined && layer.method !== m) continue;
        if (typeof layer.handle !== 'function' || layer.handle.length > 3) continue;
        if (layer.handle[HANDLER_CHECKED]) return;
        const handler = layer.handle;
        const checked = function (this: unknown, req: Request, res: Response, next: NextFunction): unknown {
            const refuse = pendingChecks.get(req);
            if (refuse) {
                pendingChecks.delete(req);
                if (refuse(req, res)) return undefined;
            }
            return handler.call(this, req, res, next);
        } as RouteLayer['handle'];
        checked[HANDLER_CHECKED] = true;
        layer.handle = checked;
        return;
    }
}

/**
 * Makes every Express route run a pending body refusal just before its handler, whenever and
 * wherever the route was registered (a router built at import time, a sub-router, app.post): the
 * route's dispatch wraps its handler the first time a request with a pending refusal reaches it. One
 * patch per process; a request without a pending refusal costs one WeakMap lookup per route it reaches.
 */
function installHandlerCheck(): void {
    const proto = (express as unknown as { Route: { prototype: RouteInternals & { [DISPATCH_PATCHED]?: true } } }).Route.prototype;
    if (proto[DISPATCH_PATCHED]) return;
    const dispatch = proto.dispatch;
    proto.dispatch = function (this: RouteInternals, req: Request, res: Response, done: NextFunction): unknown {
        if (pendingChecks.has(req)) wrapHandler(this, req.method);
        return dispatch.call(this, req, res, done);
    };
    proto[DISPATCH_PATCHED] = true;
}

export function openapiBodyGuard(nodeId: string, opts: OpenApiBodyGuardOptions = {}): OpenApiBodyGuard {
    installHandlerCheck();
    const load = opts.load ?? sharedBodyContract;
    const keysOf = (list: readonly string[]): Set<string> => new Set(list.map(r => {
        const [method, path] = r.split(' ');
        return routeKey(method, path);
    }));
    const enforced = keysOf(opts.enforced ?? []);
    const exempt = keysOf(opts.exempt ?? EXEMPT_BODY_ROUTES.map(e => e.route));
    /** The node is in enforce mode now. */
    const enforcing = (): boolean => opts.mode?.() === 'enforce';
    const isEnforced = (key: string): boolean => enforced.has(key) || (enforcing() && !exempt.has(key));
    const linesPerMinute = opts.logLinesPerMinute ?? LOG_LINES_PER_MINUTE;

    let contract: BodyContract | null = null;
    let loaded = false;
    const read = (): void => {
        if (loaded) return;
        loaded = true;
        try {
            contract = load();
            if (!contract) logger.warn('openapi body guard: no openapi.yaml in this install; request bodies are not checked against the contract');
        } catch (err) {
            logger.warn('openapi body guard: could not read openapi.yaml; request bodies are not checked against the contract', { error: String(err) });
        }
    };
    if (opts.loadNow || enforced.size > 0 || enforcing()) read();
    else setTimeout(read, 0).unref();

    const counters = new Map<string, BodyObservation>();
    let minute = 0;
    let linesThisMinute = 0;
    let leftOut = 0;

    /**
     * Count and log one mismatch with the status the route answered (0: no answer was finished).
     * `unchecked`: the route was enforced, but the request was answered below 400 without reaching
     * a route handler, so nothing refused it (a terminal handler mounted with use()).
     */
    const record = (route: string, issue: BodyIssue, status: number, unchecked = false): void => {
        let key = `${route}\n${issue.field}\n${issue.reason}`;
        let field = issue.field;
        if (!counters.has(key) && counters.size >= MAX_COUNTERS) { field = '*'; key = `${route}\n*\n${issue.reason}`; }
        let c = counters.get(key);
        if (!c) { c = { route, field, reason: issue.reason, count: 0, accepted: 0, refused: 0 }; counters.set(key, c); }
        c.count++;
        if (status > 0 && status < 400) c.accepted++; else c.refused++;
        line('openapi body mismatch', { mode: 'observe', route, field: c.field, reason: issue.reason, status, count: c.count, accepted: c.accepted, ...(unchecked ? { unchecked: true } : {}) });
    };

    /** One log line within the minute's budget; past it the line is only counted. */
    const line = (message: string, fields: Record<string, unknown>): void => {
        const now = Math.floor(Date.now() / 60_000);
        if (now !== minute) {
            if (leftOut > 0) logger.warn('openapi body mismatch lines left out', { left_out: leftOut, limit_per_minute: linesPerMinute });
            minute = now; linesThisMinute = 0; leftOut = 0;
        }
        if (linesThisMinute >= linesPerMinute) { leftOut++; return; }
        linesThisMinute++;
        logger.warn(message, fields);
    };

    // Recorded when the response is done, so the line says whether the route accepted the body: a
    // mismatch on a request the route answered 2xx is a working client the contract disagrees with,
    // one the route refused itself is a body the route already does not take.
    const observe = (route: string, issue: BodyIssue, res: Response): void => {
        res.once('close', () => {
            try { record(route, issue, res.writableFinished ? res.statusCode : 0); }
            catch (err) { logger.warn('openapi body guard: could not record a mismatch', { error: String(err) }); }
        });
    };

    /**
     * Compares the body with the contract. A mismatch on a route enforced now is left for the route's
     * handler to refuse (pendingChecks); every mismatch it does not refuse is observed. Never throws.
     */
    const check = (req: Request, res: Response): void => {
        try {
            if (!CHECKED_METHODS.has(req.method)) return;
            // Switched to enforce before the deferred read ran: read now, so no request of an
            // enforced route is passed unchecked.
            if (!loaded && enforcing()) read();
            if (!contract) return;
            const op = contract.match(req.method, req.path);
            if (!op) return;

            let issue: BodyIssue | undefined;
            const body: unknown = req.body;
            if (!hasBody(req)) {
                if (op.bodyRequired) issue = { field: '', reason: 'required' };
            } else if (req.is('application/json') && body !== undefined) {
                const validate = op.validator();
                if (validate && !validate(body)) issue = firstIssue(validate.errors);
            }
            if (!issue) return;
            const found = issue;
            if (!isEnforced(op.key)) { observe(op.route, found, res); return; }

            // Enforced: refused just before the route's handler runs, after the route's own
            // middleware admitted the caller. A caller the route refuses first (sign-in, role,
            // scope, readiness, a rate limit) gets that answer, and the mismatch is observed.
            let refused = false;
            pendingChecks.set(req, (r, s) => {
                // Asked again at the handler: the mode may have changed, and the route's own
                // middleware may have read the session.
                if (!isEnforced(op.key)) return false;
                // A caller without a session that the route admits is the route's to answer.
                if (opts.hasSession && !opts.hasSession(r)) return false;
                refused = true;
                // The same line budget as the observed mismatches, so an operator sees which route
                // refuses which field, and when to switch the setting back.
                line('openapi body mismatch refused', { mode: 'enforce', route: op.route, field: found.field, reason: found.reason, status: 400 });
                const locale = requestLocale(r);
                s.status(400).json(validationFailure(nodeId, [detailOf(found, createT(locale))], locale));
                return true;
            });
            res.once('close', () => {
                try {
                    if (refused) return;
                    // Still pending: no route handler was reached, so the request was answered by
                    // middleware (a refusal) or by a handler that is not a route's (unchecked).
                    const unreached = pendingChecks.delete(req);
                    const status = res.writableFinished ? res.statusCode : 0;
                    record(op.route, found, status, unreached && status > 0 && status < 400);
                } catch (err) { logger.warn('openapi body guard: could not record a mismatch', { error: String(err) }); }
            });
        } catch (err) {
            logger.warn('openapi body guard: check failed; the request goes on unchecked', { error: String(err) });
        }
    };

    // next() is called outside check(), so an error thrown further down the chain is not taken for
    // one of this middleware's own. The refusal itself is made where the route's own middleware
    // chain hands over to its handler (installHandlerCheck), so a caller the route refuses gets the
    // route's own answer.
    const guard = ((req: Request, res: Response, next: NextFunction): void => {
        check(req, res);
        next();
    }) as OpenApiBodyGuard;

    guard.observations = () => [...counters.values()].sort((a, b) => b.count - a.count).map(o => ({ ...o }));
    guard.ready = () => loaded;
    return guard;
}
