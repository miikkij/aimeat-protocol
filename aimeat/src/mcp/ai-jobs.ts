/**
 * @file src/mcp/ai-jobs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The four AI-job tools on the node's own MCP surface: start one, list them, read one,
 *   stop one. An agent can do what a person can do here, which is the point — a background model
 *   call is the thing an agent needs most and the thing a chat session can hold open least.
 *
 *   NONE OF THESE DOES THE WORK. Each calls the same service function the REST routes call
 *   (services/ai-jobs/), so the queue, the refusals, the budget and the provenance happen where they
 *   were written once. A tool that reached storage itself would be a second implementation, which is
 *   how the same defect came to be fixed three separate times inside aimeat_memory_write.
 *
 *   The tools are declared on THREE surfaces, and this is one of them. See the catalog entry
 *   (tool-catalog/definitions/ai-jobs.ts) for the other two and for the gates that keep them in step.
 *
 *   WHOSE JOBS THESE TOOLS SHOW. The lookup key is the OWNER's GHII, because a job started here
 *   lands in the owner's namespace, so the key alone says nothing about who may read it. The
 *   session's own principal is passed on as the viewer, and the service shows the caller only the
 *   jobs it started, unless it reads as the owner (owner-scope-read.ts readsAsOwner: an app grant,
 *   or an agent holding memory:read-as-owner). The REST routes need none of this because their key
 *   IS the principal (resolveIdentity), and until this was added the two surfaces disagreed: the
 *   same agent got 404 over REST and the owner's prompt over MCP.
 * @structure registerAiJobTools(mcp, storage, config, getAgentGaii, scopes, caller)
 * @usage registerAiJobTools(mcp, storage, config, () => agentGaii, scopes, caller);
 * @version-history
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-20 — The three reads pass the session principal as the viewer, so an agent sees and stops
 *     only the jobs it started unless it reads as the owner (secaudit 2026-10,
 *     registerAiJobTools:jobs-keyed-by-owner-ghii).
 *   2026-10-16 — A catch-all failure carries the caught error (withCaughtError, mcp/tool-fault.ts): an internal exception is logged, reported and answered with a sentence instead of its text (QA audit E5-01, D2-01).
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-08-31 — Initial.
 *   v1.0.1 — 2026-09-26 — The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 *   v1.1.0 — 2026-09-28 — System 2 plan, V5: aimeat_ai_job_start declares and passes on `op`,
 *     `provider`, `audio_key`, `language` and `size`.
 *   v1.2.0 — 2026-09-28 — aimeat_ai_job_start declares and passes on `role`, the AI role the call runs as.
 *   v1.3.0 — 2026-09-29 — aimeat_ai_job_start records who started the job (the agent, its account and
 *     the session's scopes), so the job reads its inputs as that agent (TARGET-082 V4). Takes the
 *     session's scopes as a fifth parameter.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withCaughtError } from './tool-fault.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { localAccountName } from '../utils/gaii.js';
import { AiJobError, getActiveAiJobService } from '../services/ai-jobs/index.js';
import type { AiJobState, AiJobViewer } from '../services/ai-jobs/types.js';
import { startedByOf } from '../services/ai-jobs/starter.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { readsAsOwner } from '../services/owner-scope-read.js';
import type { CallerContext } from '../services/caller-context.js';

export function registerAiJobTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    /** The session's scopes. Unused here: the session caller below carries them. */
    _scopes: readonly string[] = [],
    /** The session's caller (services/caller-context.ts). Its scopes are recorded on a started job,
     *  so the job reads its inputs as this agent. */
    caller: () => CallerContext,
): void {
    const agentGaii = getAgentGaii();
    const owner = localAccountName(agentGaii);
    const ownerGhii = `${owner}@${config.nodeId}`;
    // Every node MCP session is an agent (mcp/index.ts refuses any other credential), so the starter
    // is the session caller. Taken once, at registration, as it was before the caller existed.
    const session = caller();
    const startedBy = startedByOf(session.auth, session.principal);
    // Who may see which job under that owner GHII. `all` is the owner in person, an app grant of the
    // owner, and an agent holding memory:read-as-owner; everybody else sees what they started.
    const viewer: AiJobViewer = { principal: session.principal, all: readsAsOwner(session) };

    const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
    const err = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });
    const failed = (e: unknown) => withCaughtError(err(e instanceof AiJobError ? `${e.code}: ${e.message}` : String((e as Error).message ?? e)), e);

    /** Resolved per call, not at registration: the service belongs to the process and the tool
     *  surface is built per session. A node with no service running says so instead of throwing. */
    const service = () => {
        const s = getActiveAiJobService();
        if (!s) throw new AiJobError('AI_JOBS_UNAVAILABLE', 503, 'Background AI jobs are not running on this node.');
        return s;
    };

    // ── aimeat_ai_job_start ──
    mcp.registerTool(
        'aimeat_ai_job_start',
        {
            description: descriptionFor('aimeat_ai_job_start'),
            inputSchema: zodShapeFor('aimeat_ai_job_start'),
            annotations: annotationsFor('aimeat_ai_job_start'),
        },
        async (a) => {
            if (!owner) return err('Could not resolve caller owner');
            try {
                const started = await service().startJob({
                    ...(a.prompt !== undefined ? { prompt: a.prompt } : {}),
                    ...(a.prompt_key !== undefined ? { prompt_key: a.prompt_key } : {}),
                    ...(a.input_keys ? { input_keys: a.input_keys } : {}),
                    result_key: a.result_key,
                    ...(a.result_visibility ? { result_visibility: a.result_visibility } : {}),
                    ...(a.model !== undefined ? { model: a.model } : {}),
                    ...(a.system_prompt !== undefined ? { system_prompt: a.system_prompt } : {}),
                    ...(a.json ? { json: true } : {}),
                    ...(a.app_id !== undefined ? { app_id: a.app_id } : {}),
                    ...(a.on_done ? { on_done: a.on_done } : {}),
                    ...(a.op !== undefined ? { op: a.op } : {}),
                    ...(a.provider !== undefined ? { provider: a.provider } : {}),
                    ...(a.role !== undefined ? { role: a.role } : {}),
                    ...(a.audio_key !== undefined ? { audio_key: a.audio_key } : {}),
                    ...(a.language !== undefined ? { language: a.language } : {}),
                    ...(a.size !== undefined ? { size: a.size } : {}),
                }, { ownerGhii, createdBy: agentGaii, startedBy });
                return text(started);
            } catch (e) {
                return failed(e);
            }
        },
    );

    // ── aimeat_ai_job_list ──
    mcp.registerTool(
        'aimeat_ai_job_list',
        {
            description: descriptionFor('aimeat_ai_job_list'),
            inputSchema: zodShapeFor('aimeat_ai_job_list'),
            annotations: annotationsFor('aimeat_ai_job_list'),
        },
        async (a) => {
            try {
                const jobs = await service().listJobs(ownerGhii, {
                    ...(a.state ? { state: a.state as AiJobState | 'live' | 'all' } : {}),
                    ...(a.limit !== undefined ? { limit: a.limit } : {}),
                    viewer,
                });
                return text({ jobs, count: jobs.length });
            } catch (e) {
                return failed(e);
            }
        },
    );

    // ── aimeat_ai_job_get ──
    mcp.registerTool(
        'aimeat_ai_job_get',
        {
            description: descriptionFor('aimeat_ai_job_get'),
            inputSchema: zodShapeFor('aimeat_ai_job_get'),
            annotations: annotationsFor('aimeat_ai_job_get'),
        },
        async (a) => {
            try {
                const job = await service().getJob(ownerGhii, a.job_id, viewer);
                // Not found and not-yours read the same, deliberately: whose jobs exist is not a
                // stranger's business, and a different message would answer that question. A
                // sibling agent's job and the owner's own job read the same way.
                if (!job) return err('No such job.');
                return text(job);
            } catch (e) {
                return failed(e);
            }
        },
    );

    // ── aimeat_ai_job_cancel ──
    mcp.registerTool(
        'aimeat_ai_job_cancel',
        {
            description: descriptionFor('aimeat_ai_job_cancel'),
            inputSchema: zodShapeFor('aimeat_ai_job_cancel'),
            annotations: annotationsFor('aimeat_ai_job_cancel'),
        },
        async (a) => {
            try {
                // The viewer is checked before anything is aborted: a job this session did not start
                // is refused with the same 404 a read answers, and it keeps running.
                return text(await service().cancelJob(ownerGhii, a.job_id, viewer));
            } catch (e) {
                return failed(e);
            }
        },
    );

    void storage;
}
