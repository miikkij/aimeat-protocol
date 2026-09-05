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
 *   ALL FOUR ASK `assertAiUseAllowed` (auth/ai-gate.ts:35-52), WHICH IS THE GATE `/v1/ai/complete`
 *   ASKS. It is the same money — the owner's own provider key, their daily budget, their per-app
 *   quota — so it has to be the same door, and naming the same WORD is not enough to make it one:
 *   these four stated `ai:use` as `requireScope` middleware for one commit, which is a second way of
 *   asking the same question, and the two ways disagreed about `ai:*`.
 *
 *   ASKING, RATHER THAN RESTATING, IS WHY THESE ROUTES ARE STILL RIGHT. The rule they depend on
 *   CHANGED underneath them: `assertAiUseAllowed` used to spell the scope test out by hand and now
 *   asks `scopeIsCovered` (utils/scope-coverage.ts:185), so `ai:use` covers the domain wildcard
 *   where it did not before. Not a line here moved, and every door that spends AI money moved
 *   together. That is the whole property — what `ai:use` covers is ONE rule in ONE place, and the
 *   next change to it (making AI spend wildcard-proof is one line in SCOPES_OUTSIDE_WILDCARD,
 *   utils/scope-coverage.ts:169) reaches these four without anybody walking the doors one by one and
 *   getting three of the four.
 *
 *   `check:route-scopes` cannot see a call inside a handler, so the four routes carry an entry in
 *   security/route-scope-exemptions.json naming this gate — exactly as /v1/ai/complete,
 *   /v1/ai/transcribe and /v1/ai/available already do. Cases 16, 16b and 16c of
 *   test/e2e-ai-jobs.ts hold these doors level with /v1/ai/complete from the outside, because an
 *   exemption entry is a claim and a route can quietly stop asking.
 *
 *   WHOSE JOB IS WHOSE. Every read resolves under `resolveIdentity(req.auth!, config.nodeId)` and
 *   never a client-supplied id, so a stranger asking after somebody else's job simply finds nothing.
 *   That is a 404 rather than a 403 on purpose: whose jobs exist is not a stranger's business, and a
 *   403 would answer that question.
 * @structure aiJobsRouter(config, storage, service)
 * @usage app.use(aiJobsRouter(config, storage, aiJobService));
 * @version-history
 *   v1.1.1 — 2026-09-05 — `created_by` is the resolved principal, not the raw `sub`: on an owner
 *     session the two differ (bare name against GHII), and the identity ratchet main grew while
 *     this branch waited refuses a route that reads `sub` and never resolves it.
 *   v1.1.0 — 2026-08-31 — The four doors ask assertAiUseAllowed instead of stating `ai:use` as
 *     requireScope middleware. Two ways of asking one question is one way too many: they disagreed
 *     about `ai:*` on the same key and the same budget. Asking the shared function is what has since
 *     kept these routes correct without being edited — the gate was changed to consult
 *     scope-coverage.ts and `ai:use` widened underneath them, and they inherited it.
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
                    // Both are the RESOLVED principal: an agent's GAII as it is, an owner session's
                    // bare name turned into their GHII, so the trail names the same identity every
                    // other record on this node names (and the MCP door writes the agent's GAII).
                    ownerGhii: resolve(req),
                    createdBy: resolve(req),
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
