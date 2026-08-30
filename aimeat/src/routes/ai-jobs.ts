/**
 * @file src/routes/ai-jobs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The four doors onto a background AI job: start one, list them, read one, stop one.
 *
 *   A START IS 202 AND RETURNS BEFORE THE WORK DOES. Nothing in this design ever holds an HTTP
 *   request for the duration of a model call — that is the whole reason the feature exists, since a
 *   generation can take twenty or thirty minutes and every other path on this node holds a request
 *   or a sandbox open for the wait.
 *
 *   NONE OF THESE HANDLERS DOES THE WORK. Each calls the same service function the MCP tools call
 *   (services/ai-jobs/), so the scope check, the validation, the queue and the provenance happen
 *   where they were written once. A route that reached storage directly would be a second
 *   implementation, and the same defect has already been fixed three separate times inside one MCP
 *   tool because two surfaces each had their own.
 *
 *   ALL FOUR ASK `assertAiUseAllowed`, WHICH IS THE SAME GATE `/v1/ai/complete` ASKS. It is the same
 *   money — the owner's own provider key, their daily budget, their per-app quota — so it has to be
 *   the same door, and "the same word" is not enough: these four stated `ai:use` as `requireScope`
 *   middleware for one commit, and that admits MORE people. `requireScope` asks
 *   `scopeIsCovered` (utils/scope-coverage.ts:185), which honours the domain wildcard, so an agent
 *   holding `ai:*` walked through here; `assertAiUseAllowed` (auth/ai-gate.ts:31-32) reads the exact
 *   string or the global `*` and nothing else, so the same agent is refused at /v1/ai/complete. One
 *   spend gate admitting two different sets is invariant 15 in the flesh, and the fix is to ask the
 *   one function rather than to restate its rule.
 *
 *   `check:route-scopes` cannot see a call inside a handler, so the four routes carry an entry in
 *   security/route-scope-exemptions.json naming this gate — exactly as /v1/ai/complete,
 *   /v1/ai/transcribe and /v1/ai/available already do.
 *
 *   WHOSE JOB IS WHOSE. Every read resolves under `resolveIdentity(req.auth!, config.nodeId)` and
 *   never a client-supplied id, so a stranger asking after somebody else's job simply finds nothing.
 *   That is a 404 rather than a 403 on purpose: whose jobs exist is not a stranger's business, and a
 *   403 would answer that question.
 * @structure aiJobsRouter(config, storage, service)
 * @usage app.use(aiJobsRouter(config, storage, aiJobService));
 * @version-history
 *   v1.1.0 — 2026-08-31 — The four doors ask assertAiUseAllowed instead of stating `ai:use` as
 *     requireScope middleware. The two are NOT the same test: requireScope honours the domain
 *     wildcard, so an `ai:*` agent could spend the owner's provider key here and not at
 *     /v1/ai/complete. Same money, same gate — and the gate is the shared function, not a second
 *     statement of its rule.
 *   v1.0.0 — 2026-08-31 — Initial.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { assertAiUseAllowed } from '../auth/ai-gate.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { AiJobError } from '../services/ai-jobs/index.js';
import type { AiJobService } from '../services/ai-jobs/index.js';
import type { AiJobState } from '../services/ai-jobs/types.js';

export function aiJobsRouter(config: AimeatConfig, storage: Storage, service: AiJobService): Router {
    const router = Router();
    const resolve = (req: Request) => resolveIdentity(req.auth!, config.nodeId);
    // The openrouter bucket, same as /v1/ai/complete: same provider, same spend concerns.
    const aiRateLimit = rateLimit(config.rateLimits.openrouter);

    /** One place the four refusals become a status, a code and a Retry-After. */
    const fail = (res: Response, e: unknown): Response => {
        if (e instanceof AiJobError) {
            if (e.retryAfterSeconds !== undefined) res.set('Retry-After', String(e.retryAfterSeconds));
            return res.status(e.status).json(error(config.nodeId, e.code, e.message));
        }
        return res.status(500).json(error(config.nodeId, 'AI_JOB_FAILED', (e as Error).message));
    };

    // ── POST /v1/ai/jobs ──
    router.post('/v1/ai/jobs',
        requireAuth(), aiRateLimit,
        async (req: Request, res: Response) => {
            if (!assertAiUseAllowed(req, res, config.nodeId)) return;
            const body = req.body as {
                prompt?: string; prompt_key?: string; input_keys?: string[];
                result_key?: string; result_visibility?: 'private' | 'owner' | 'public';
                model?: string; system_prompt?: string; json?: boolean; app_id?: string;
                on_done?: { extension?: string; action?: string };
            };

            if (body.input_keys !== undefined
                && (!Array.isArray(body.input_keys) || body.input_keys.some(k => typeof k !== 'string'))) {
                return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'input_keys must be an array of key strings.'));
            }
            if (body.result_visibility !== undefined
                && !['private', 'owner', 'public'].includes(body.result_visibility)) {
                return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'result_visibility must be private, owner or public.'));
            }
            if (body.on_done !== undefined
                && (!body.on_done || typeof body.on_done.extension !== 'string' || typeof body.on_done.action !== 'string')) {
                return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'on_done must be { extension, action }.'));
            }

            try {
                const started = await service.startJob({
                    ...(body.prompt !== undefined ? { prompt: String(body.prompt) } : {}),
                    ...(body.prompt_key !== undefined ? { prompt_key: String(body.prompt_key) } : {}),
                    ...(body.input_keys ? { input_keys: body.input_keys } : {}),
                    result_key: body.result_key as string,
                    ...(body.result_visibility ? { result_visibility: body.result_visibility } : {}),
                    ...(body.model !== undefined ? { model: String(body.model) } : {}),
                    ...(body.system_prompt !== undefined ? { system_prompt: String(body.system_prompt) } : {}),
                    ...(body.json ? { json: true } : {}),
                    ...(body.app_id !== undefined ? { app_id: String(body.app_id) } : {}),
                    ...(body.on_done ? { on_done: { extension: body.on_done.extension as string, action: body.on_done.action as string } } : {}),
                }, {
                    // Never from the body. `owner` decides whose key pays and whose namespace the
                    // answer lands in; `created_by` is the audit trail and carries no authority.
                    ownerGhii: resolve(req),
                    createdBy: (req.auth!.sub as string) ?? resolve(req),
                });

                // 202, not 200: accepted, not finished.
                return res.status(202).json(success(config.nodeId, started, [
                    { description: 'Check on it', method: 'GET', url: `/v1/ai/jobs/${started.job_id}` },
                    { description: 'Stop it', method: 'POST', url: `/v1/ai/jobs/${started.job_id}/cancel` },
                ]));
            } catch (e) {
                return fail(res, e);
            }
        });

    // ── GET /v1/ai/jobs ──
    router.get('/v1/ai/jobs',
        requireAuth(),
        async (req: Request, res: Response) => {
            if (!assertAiUseAllowed(req, res, config.nodeId)) return;
            const stateParam = typeof req.query.state === 'string' ? req.query.state : undefined;
            const allowed = ['queued', 'running', 'done', 'failed', 'cancelled', 'live', 'all'];
            if (stateParam && !allowed.includes(stateParam)) {
                return res.status(400).json(error(config.nodeId, 'INVALID_QUERY',
                    `state must be one of ${allowed.join(', ')}.`));
            }
            const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;

            try {
                const jobs = await service.listJobs(resolve(req), {
                    ...(stateParam ? { state: stateParam as AiJobState | 'live' | 'all' } : {}),
                    ...(Number.isFinite(limit) ? { limit: limit as number } : {}),
                });
                return res.json(success(config.nodeId, { jobs, count: jobs.length }));
            } catch (e) {
                return fail(res, e);
            }
        });

    // ── GET /v1/ai/jobs/:id ──
    router.get('/v1/ai/jobs/:id',
        requireAuth(),
        async (req: Request, res: Response) => {
            if (!assertAiUseAllowed(req, res, config.nodeId)) return;
            try {
                const job = await service.getJob(resolve(req), req.params.id as string);
                // 404 and not 403 on another owner's id: see the file header.
                if (!job) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such job.'));
                return res.json(success(config.nodeId, job));
            } catch (e) {
                return fail(res, e);
            }
        });

    // ── POST /v1/ai/jobs/:id/cancel ──
    router.post('/v1/ai/jobs/:id/cancel',
        requireAuth(),
        async (req: Request, res: Response) => {
            if (!assertAiUseAllowed(req, res, config.nodeId)) return;
            try {
                const job = await service.cancelJob(resolve(req), req.params.id as string);
                return res.json(success(config.nodeId, job));
            } catch (e) {
                return fail(res, e);
            }
        });

    void storage;
    return router;
}
