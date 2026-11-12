/**
 * @file src/middleware/openapi-body-guard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Checks a request's JSON body against the schema openapi.yaml declares for its route
 *   (services/openapi-body-contract.ts). Two modes per route:
 *   - observe (every route today): a body that does not match is logged as one structured line
 *     (route, field, reason, the status the route answered, and the running counts; never the value)
 *     and counted, and the request goes on to its route exactly as before. Nothing is refused,
 *     nothing in the body changes. The line is written when the response is done, so it says whether
 *     the route accepted the body (the contract disagrees with a working client) or refused it too.
 *   - enforce (the routes in data/openapi-body-modes.ts, none today): the same mismatch is answered
 *     400 VALIDATION_ERROR with the field named, as validateBody answers (models/validation-issues.ts).
 *     Only a caller with a session is refused. The guard runs before the route, so before the route's
 *     sign-in check: a caller without a session is passed on and gets the route's own answer (401),
 *     as before the route was enforced, and the mismatch is observed. What a session is comes from
 *     the option `hasSession`, which server.ts sets to the question requireAuth() asks
 *     (auth/middleware.ts). A route that admits a caller without a session therefore has that
 *     caller's body unchecked, and is not a candidate for the mode table.
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
 *   COST. Reading openapi.yaml takes about a second, so in observe mode it is read once per process
 *   after the server is built, off the boot path, and requests before that are passed on unchecked.
 *   A route's schema is compiled at its first request. Matching a path and validating a body cost
 *   under a microsecond each (measurements in the commit that added this file).
 *
 *   LOG VOLUME. One line per mismatching request, at warn, up to LOG_LINES_PER_MINUTE lines a minute;
 *   past that the lines of the minute are counted and one line says how many were left out. The
 *   counts in observations() are exact either way.
 * @structure openapiBodyGuard(nodeId, opts) → middleware with observations() and ready()
 * @usage app.use(openapiBodyGuard(config.nodeId));
 * @version-history
 *   v1.1.0 — 2026-11-13 — Option hasSession: an enforced route refuses a body only from a caller with
 *     a session, so a caller without one keeps the route's 401 (structure programme 2026-11, unit 1).
 *   v1.0.0 — 2026-11-04 — Initial, observe mode only (codebase analysis 2026-11-03, item B5).
 */
import type { Request, Response, NextFunction } from 'express';
import { createT } from '../i18n.js';
import { logger } from '../utils/logger.js';
import { requestLocale, validationFailure, type ValidationDetail } from '../models/validation-issues.js';
import { ENFORCED_BODY_ROUTES } from '../data/openapi-body-modes.js';
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
    /** Route keys to enforce, as openapi.yaml writes them; data/openapi-body-modes.ts by default. */
    enforced?: readonly string[];
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

export function openapiBodyGuard(nodeId: string, opts: OpenApiBodyGuardOptions = {}): OpenApiBodyGuard {
    const load = opts.load ?? sharedBodyContract;
    const enforced = new Set((opts.enforced ?? ENFORCED_BODY_ROUTES).map(r => {
        const [method, path] = r.split(' ');
        return routeKey(method, path);
    }));
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
    if (opts.loadNow || enforced.size > 0) read();
    else setTimeout(read, 0).unref();

    const counters = new Map<string, BodyObservation>();
    let minute = 0;
    let linesThisMinute = 0;
    let leftOut = 0;

    /** Count and log one mismatch with the status the route answered (0: no answer was finished). */
    const record = (route: string, issue: BodyIssue, status: number): void => {
        let key = `${route}\n${issue.field}\n${issue.reason}`;
        let field = issue.field;
        if (!counters.has(key) && counters.size >= MAX_COUNTERS) { field = '*'; key = `${route}\n*\n${issue.reason}`; }
        let c = counters.get(key);
        if (!c) { c = { route, field, reason: issue.reason, count: 0, accepted: 0, refused: 0 }; counters.set(key, c); }
        c.count++;
        if (status > 0 && status < 400) c.accepted++; else c.refused++;

        const now = Math.floor(Date.now() / 60_000);
        if (now !== minute) {
            if (leftOut > 0) logger.warn('openapi body mismatch lines left out', { left_out: leftOut, limit_per_minute: linesPerMinute });
            minute = now; linesThisMinute = 0; leftOut = 0;
        }
        if (linesThisMinute >= linesPerMinute) { leftOut++; return; }
        linesThisMinute++;
        logger.warn('openapi body mismatch', { mode: 'observe', route, field: c.field, reason: issue.reason, status, count: c.count, accepted: c.accepted });
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

    /** The issue to refuse with, or undefined to pass the request on. Never throws. */
    const check = (req: Request, res: Response): BodyIssue | undefined => {
        try {
            if (!contract || !CHECKED_METHODS.has(req.method)) return undefined;
            const op = contract.match(req.method, req.path);
            if (!op) return undefined;

            let issue: BodyIssue | undefined;
            const body: unknown = req.body;
            if (!hasBody(req)) {
                if (op.bodyRequired) issue = { field: '', reason: 'required' };
            } else if (req.is('application/json') && body !== undefined) {
                const validate = op.validator();
                if (validate && !validate(body)) issue = firstIssue(validate.errors);
            }
            if (!issue) return undefined;
            // A caller without a session is the route's to answer (401), whatever its body: refusing
            // the body first would change that answer to 400. Its mismatch is observed instead.
            if (enforced.has(op.key) && (!opts.hasSession || opts.hasSession(req))) return issue;
            observe(op.route, issue, res);
        } catch (err) {
            logger.warn('openapi body guard: check failed; the request goes on unchecked', { error: String(err) });
        }
        return undefined;
    };

    // next() is called outside check(), so an error thrown further down the chain is not taken for
    // one of this middleware's own.
    const guard = ((req: Request, res: Response, next: NextFunction): void => {
        const issue = check(req, res);
        if (!issue) { next(); return; }
        const locale = requestLocale(req);
        res.status(400).json(validationFailure(nodeId, [detailOf(issue, createT(locale))], locale));
    }) as OpenApiBodyGuard;

    guard.observations = () => [...counters.values()].sort((a, b) => b.count - a.count).map(o => ({ ...o }));
    guard.ready = () => loaded;
    return guard;
}
