/**
 * @file src/routes/home/welcome-mat.ts
 * @description The welcome-mat paste (aimeat_remake/03-welcome-mat.md, phase 2). A person copies a
 *   prompt into their own AI chat and pastes the answer here. This is step 1 of the new path and
 *   there is no way past it: without a mat there is no home.
 *
 *   What the endpoint does with a paste:
 *     1. reads a page out of it (five attempts, first hit wins — the paste arrives wrapped in
 *        whatever the model said around it);
 *     2. stores that page as the person's PORTFOLIO — the mat is not a new page type, it is the
 *        first version of the portfolio they already have;
 *     3. reads the four ai-* fields and decides the branch from `ai-client`, because MCP is a
 *        property of the client app and not of the model;
 *     4. writes the funnel markers.
 *
 *   A rejected paste is a 400 that NAMES what was missing and says how many attempts have been
 *   made. The person's text is never echoed back and never cleared: the box keeps it client-side,
 *   because a cleared box after a failed paste loses work their AI may not reproduce.
 * @structure registerWelcomeMatRoutes(router, ctx): POST /v1/home/welcome-mat, POST /v1/home/ai-client
 * @usage Registered from src/routes/home.ts.
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 2).
 */
import type { Router, RequestHandler } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { logger } from '../../utils/logger.js';
import { parseWelcomeMat } from '../../services/welcome-mat-parse.js';
import {
    resolveAiClient, decideBranch, type BranchDecision, type AiClientResolution,
} from '../../services/ai-tool-setup.js';
import {
    ONBOARDING_KEYS, recordOnboardingEvent, recordWelcomeMatPasted, recordAiModelDetected,
} from '../../services/onboarding-funnel.js';
import { readHomeState } from '../../services/home-state.js';
import {
    portfolioWriteGaii, portfolioStandaloneUrl, PORTFOLIO_HTML_KEY, PORTFOLIO_CONFIG_KEY,
} from '../portfolio.js';

export interface HomeRouteCtx {
    config: AimeatConfig;
    storage: Storage;
}

/**
 * The home is the PERSON's, so its routes need a person's session.
 *
 * requireRole('owner') is not that fence: an agent token inherits its owner's roles on this node
 * (the scope list is what fences an agent), so an agent would sail through it. The distinction the
 * codebase already uses for exactly this is `owner` present AND `agent` absent — extended here to
 * ecosystem apps and app grants, which are the other principals that act "as" an owner.
 *
 * It matters most on the welcome mat: the mat doubles as evidence that a human has an AI and
 * understands copy-paste, and an agent pasting it on their behalf would prove neither while
 * marking the gate passed.
 */
export function requireOwnerSession(nodeId: string): RequestHandler {
    return (req, res, next) => {
        const roles = req.auth?.roles ?? [];
        const isPerson = roles.includes('owner')
            && !roles.includes('agent') && !roles.includes('ecosystem') && !roles.includes('app');
        if (!isPerson) {
            res.status(403).json(error(nodeId, 'ACCESS_DENIED',
                'This is the account holder\'s own step. Sign in as yourself to do it.'));
            return;
        }
        next();
    };
}

/** The branch as the client sees it: what to show, and what still needs asking. */
function branchPayload(decision: BranchDecision) {
    return {
        branch: decision.branch,
        reason: 'reason' in decision ? decision.reason : null,
        question: decision.branch === 'ask' ? decision.question : null,
        tool_id: 'toolId' in decision ? decision.toolId ?? null : null,
    };
}

/**
 * Store the page as the owner's portfolio and turn the portfolio on.
 *
 * One write path with PUT /v1/portfolio/upload by construction: both call portfolioWriteGaii, so
 * a mat made before the first agent lands under the GHII and a later one under the agent, and the
 * reader finds either.
 */
async function storeMatAsPortfolio(
    ctx: HomeRouteCtx, owner: string, html: string, title: string | null,
): Promise<void> {
    const { storage, config } = ctx;
    const target = await portfolioWriteGaii(storage, owner, config.nodeId);
    const data = Buffer.from(html, 'utf-8');
    const now = new Date().toISOString();

    await storage.deleteStorageFile(target, PORTFOLIO_HTML_KEY);
    await storage.createStorageFile({
        key: PORTFOLIO_HTML_KEY,
        ownerGaii: target,
        visibility: 'public',
        mimeType: 'text/html',
        size: data.length,
        data,
        createdAt: now,
    });

    // Enable the portfolio, preserving whatever settings are already there. The mat is meant to be
    // looked at the moment it lands — an accepted mat behind a disabled portfolio would be the
    // "nothing happened" screen this whole step exists to avoid.
    const existing = await storage.getMemory(target, PORTFOLIO_CONFIG_KEY);
    const prev = (existing?.value ?? {}) as Record<string, unknown>;
    await storage.setMemory({
        key: PORTFOLIO_CONFIG_KEY,
        ownerGaii: target,
        value: { ...prev, enabled: true, source: 'welcome-mat', ...(title ? { title } : {}) },
        visibility: 'owner',
        tags: ['portfolio'],
        ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });
}

/** Record what we learned about the person's AI. Never carries the mat's content (05-mittaus.md). */
async function recordAiDetection(
    ctx: HomeRouteCtx, owner: string,
    fields: { model: string | null; vendor: string | null; client: string | null },
    resolution: AiClientResolution,
    source: 'meta' | 'asked',
    hasPaidPlan?: boolean,
    supersedes = false,
): Promise<void> {
    await recordAiModelDetected(ctx.storage, ctx.config, owner, {
        model: fields.model,
        vendor: fields.vendor,
        client: fields.client,
        // Our reading of the app, not the model's claim about its own capability.
        mcp: resolution.kind === 'known' ? (resolution.capability === 'yes' ? 'yes' : 'unknown') : 'unknown',
        source,
        // The unmatched name is the list from which the alias map grows.
        unknownClient: resolution.kind === 'unknown' ? resolution.claim : null,
        resolvedClient: resolution.kind === 'known' ? resolution.id : null,
        hasPaidPlan: typeof hasPaidPlan === 'boolean' ? hasPaidPlan : null,
        supersedes,
    });
}

/** Write branch_taken once a real branch (not a question) has been settled on. */
async function recordBranch(ctx: HomeRouteCtx, owner: string, decision: BranchDecision): Promise<void> {
    if (decision.branch === 'ask') return;
    await recordOnboardingEvent(ctx.storage, ctx.config, owner, ONBOARDING_KEYS.branchTaken, {
        branch: decision.branch,
    });
}

export function registerWelcomeMatRoutes(router: Router, ctx: HomeRouteCtx): void {
    const { config, storage } = ctx;

    /**
     * POST /v1/home/welcome-mat
     * Body: { paste: string }
     *
     * Owner role required. The mat is the person's own act and it doubles as the evidence that
     * they have an AI and understand copy-paste; an agent posting it on their behalf would prove
     * neither, so an agent or app token is refused here even though it can write memory.
     */
    router.post('/v1/home/welcome-mat', requireAuth(), requireRole('owner'), requireOwnerSession(config.nodeId), async (req, res) => {
        const owner = req.auth!.owner;
        const paste = (req.body ?? {}).paste;

        // Size cap before parsing: the same limit the portfolio itself enforces, applied early so a
        // multi-megabyte paste is refused rather than regex-scanned.
        const maxBytes = (config.portfolioMaxSizeKb ?? 512) * 1024;
        if (typeof paste === 'string' && Buffer.byteLength(paste, 'utf-8') > maxBytes) {
            res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED',
                `That paste is larger than ${config.portfolioMaxSizeKb ?? 512}KB. Ask your AI for a shorter page.`));
            return;
        }

        const parsed = parseWelcomeMat(paste);

        if (!parsed.ok) {
            const { attempts } = await recordWelcomeMatPasted(storage, config, owner, 'failed');
            // 400 with the specifics, and NO skip offered anywhere in it. The client keeps the
            // text; we never echo it back, so a rejection cannot leak the page into a log.
            res.status(400).json(error(config.nodeId, 'WELCOME_MAT_UNREADABLE',
                parsed.reason === 'empty'
                    ? 'There was nothing in the box.'
                    : parsed.reason === 'empty_page'
                        ? 'That was a page, but it had nothing on it.'
                        : 'I could not find a page in what you pasted.',
                undefined, { reason: parsed.reason, missing: parsed.missing, attempts }));
            return;
        }

        await storeMatAsPortfolio(ctx, owner, parsed.html, parsed.meta.title);
        const { attempts } = await recordWelcomeMatPasted(storage, config, owner, 'ok');

        // The branch comes from `ai-client`. The model's own `ai-can-mcp` claim is recorded and
        // deliberately not obeyed: models are confident about capabilities they do not have.
        const resolution = resolveAiClient(parsed.meta.client);
        const decision = decideBranch(resolution);
        // A paste is a NEW mat, so it replaces whatever was known — including a stale paid-tier
        // answer about the app they used last time.
        await recordAiDetection(ctx, owner, parsed.meta, resolution, 'meta', undefined, true);
        await recordBranch(ctx, owner, decision);

        const state = await readHomeState(storage, config, owner);
        res.json(success(config.nodeId, {
            saved: true,
            attempts,
            /** Which of the five attempts read it — grades the prompt, not the person. */
            level: parsed.level,
            wrapped: parsed.wrapped,
            meta: parsed.meta,
            ...branchPayload(decision),
            portfolio_url: `/v1/portfolio/${encodeURIComponent(owner)}`,
            standalone_url: portfolioStandaloneUrl(config, owner),
            state,
        }, [
            { description: 'Look at your welcome mat', method: 'GET', url: `/v1/portfolio/${encodeURIComponent(owner)}` },
            { description: 'Where your home stands now', method: 'GET', url: '/v1/home/state' },
        ]));
        emitChange('portfolio');
    });

    /**
     * POST /v1/home/ai-client
     * Body: { client?: string, has_paid_plan?: boolean }
     *
     * The person's own answer to the two questions the branch can raise: which app they talked in,
     * and whether they have the tier that app needs. An answer here is more trustworthy than the
     * page's metadata (a model misreports its own app), so it is recorded with source 'asked' and
     * overwrites nothing — both readings stay in the funnel.
     */
    router.post('/v1/home/ai-client', requireAuth(), requireRole('owner'), requireOwnerSession(config.nodeId), async (req, res) => {
        const owner = req.auth!.owner;
        const body = req.body ?? {};
        const clientAnswer = typeof body.client === 'string' ? body.client.trim().slice(0, 200) : undefined;
        const hasPaidPlan = typeof body.has_paid_plan === 'boolean' ? body.has_paid_plan : undefined;

        if (clientAnswer === undefined && hasPaidPlan === undefined) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'Answer with the app you talked in (client) or whether you have a paid plan (has_paid_plan).'));
            return;
        }

        // Re-read from whatever we know: the person's answer where they gave one, the page's claim
        // otherwise. Their answer is run through the same alias map — it is not privileged.
        const state = await readHomeState(storage, config, owner);
        const base = resolveAiClient(clientAnswer ?? state.ai?.client ?? null);
        const decision = decideBranch(base, { clientAnswer, hasPaidPlan });

        await recordAiDetection(ctx, owner, {
            model: state.ai?.model ?? null,
            vendor: state.ai?.vendor ?? null,
            client: clientAnswer ?? state.ai?.client ?? null,
        }, base, 'asked', hasPaidPlan);
        await recordBranch(ctx, owner, decision);

        res.json(success(config.nodeId, {
            ...branchPayload(decision),
            state: await readHomeState(storage, config, owner),
        }));
    });

    logger.debug('home: welcome-mat routes registered');
}
