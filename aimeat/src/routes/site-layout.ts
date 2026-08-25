/**
 * @file src/routes/site-layout.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The doors onto a surface layout: which blocks this node's front page and its members'
 *   home are built from, in what order, and the operator's own passages between them.
 *
 *   ONE WRITE ROUTE WITH A SURFACE PARAMETER, NOT ONE PER SURFACE. Three routes doing the same thing
 *   is three places for the gate, the validation and the changelog to drift apart, and this repo has
 *   already paid for exactly that when one tool name meant two different backends for months.
 *
 *   THE GATE IS NOT requireRole('operator'). Every older site route uses it, and it is right for
 *   them: it reads the TOKEN's roles, so it admits the operator's browser. It also refuses the
 *   operator's AGENT, which is the wrong answer for a capability whose whole point is "ask your own
 *   AI to take the shop off our home page". requireOperatorPrincipal admits the operator in person,
 *   refuses an app grant outright, and otherwise requires that the ACCOUNT is an operator and the
 *   principal carries the exact word — a word no wildcard hands out.
 *
 *   READING THE PORTAL LAYOUT NEEDS NO SESSION, reading a member surface does. The portal's layout
 *   describes a page anyone can already look at, and the SPA fetches it before anybody has signed
 *   in. A member surface's layout is a statement about how this node's people work, which an
 *   enterprise operator has no reason to publish; the free-form passages behind it are private
 *   whatever this route does, because they are stored outside the world-readable prefix.
 * @structure siteLayoutRouter(config, storage)
 * @usage Mounted from siteRouter() so it inherits the site family's LB guard.
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { Router, type RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOperatorPrincipal } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { SiteError } from '../services/site.js';
import { SurfaceLayoutService, type LayoutSubmission, type PassageProvenance } from '../services/surface-layout/service.js';
import { toDeclaredProvenance, type AiProvenanceToolInput } from '../mcp/ai-provenance-input.js';
import { resolveIdentity } from '../utils/gaii.js';
import { blocksForSurface, defaultLayout, operatorLabelKey } from '../services/surface-layout/registry.js';
import type { SurfaceId } from '../services/surface-layout/types.js';
import { SURFACE_LAYOUT_WRITE_SCOPE } from '../utils/scope-coverage.js';

export function siteLayoutRouter(config: AimeatConfig, storage: Storage, requireNotLb: RequestHandler): Router {
    const router = Router();
    const svc = new SurfaceLayoutService(config, storage);
    /**
     * The gate, as one array so every door carries the identical pair and none can be given the
     * weaker half by accident. requireOperatorPrincipal, not requireRole('operator'): the latter
     * reads the TOKEN's roles, which admits the operator's browser and refuses the operator's agent.
     */
    const operator: RequestHandler[] = [requireAuth(), requireOperatorPrincipal(storage, SURFACE_LAYOUT_WRITE_SCOPE)];

    /** Read the surface out of the path, or answer 404 rather than guessing. */
    function surfaceOf(req: { params: Record<string, string | string[]> }, res: Parameters<RequestHandler>[1]): SurfaceId | null {
        const raw = String(req.params.surface as string);
        if (!SurfaceLayoutService.isSurface(raw)) {
            res.status(404).json(error(config.nodeId, 'SURFACE_NOT_FOUND', `This node has no surface called "${raw}".`));
            return null;
        }
        return raw;
    }

    /** Every refusal from the service is already worded for a person; pass it through unchanged. */
    function sendError(res: Parameters<RequestHandler>[1], err: unknown): void {
        if (err instanceof SiteError) {
            res.status(err.httpStatus).json(error(config.nodeId, err.code, err.message));
            return;
        }
        throw err;
    }

    /**
     * What the writer said about how a passage was made. A free-form passage is prose on a page every
     * member lands on, and an AI is exactly who an operator asks to write one — so the declaration
     * travels, and silence stays UNSTATED rather than becoming a claim that a person wrote it.
     */
    function passageProvenance(req: Parameters<RequestHandler>[0]): PassageProvenance {
        const body = (req.body ?? {}) as { ai_provenance?: AiProvenanceToolInput; ai_provenance_id?: unknown };
        return {
            principal: resolveIdentity(req.auth!, config.nodeId),
            ...(typeof body.ai_provenance_id === 'string' ? { declaredId: body.ai_provenance_id } : {}),
            ...(body.ai_provenance ? { declared: toDeclaredProvenance(body.ai_provenance) } : {}),
        };
    }

    function layoutBody(resolved: Awaited<ReturnType<SurfaceLayoutService['resolve']>>, freeform: Record<string, string>) {
        return {
            layout: resolved.layout,
            freeform,
            source: resolved.source,
            degraded: resolved.degraded,
            problems: resolved.problems,
        };
    }

    // GET /v1/site/layout/portal — public: the SPA reads this before anyone has signed in.
    router.get('/v1/site/layout/portal', async (_req, res) => {
        const resolved = await svc.resolve('portal');
        const freeform = await svc.readFreeform(resolved.layout);
        // A visitor is not the audience for a repair note; the operator reads those in the admin tab.
        res.json(success(config.nodeId, { ...layoutBody(resolved, freeform), problems: [] }));
    });

    // GET /v1/site/layout/:surface — a member surface, for a signed-in reader.
    router.get('/v1/site/layout/:surface', requireAuth(), async (req, res) => {
        const surface = surfaceOf(req, res);
        if (!surface) return;
        const resolved = await svc.resolve(surface);
        const freeform = await svc.readFreeform(resolved.layout);
        res.json(success(config.nodeId, layoutBody(resolved, freeform)));
    });

    // PUT /v1/site/layout/:surface — store a layout. Refuses in full or writes in full.
    router.put('/v1/site/layout/:surface', ...operator, requireNotLb, async (req, res) => {
        const surface = surfaceOf(req, res);
        if (!surface) return;
        try {
            const result = await svc.write(surface, (req.body ?? {}) as LayoutSubmission, req.auth!.sub, 'admin', passageProvenance(req));
            res.json(success(config.nodeId, layoutBody(result, {}), [
                { description: 'See it', method: 'GET', url: `/v1/site/layout/${surface}` },
            ]));
        } catch (err) { sendError(res, err); }
    });

    // DELETE /v1/site/layout/:surface — back to the built-in layout.
    router.delete('/v1/site/layout/:surface', ...operator, requireNotLb, async (req, res) => {
        const surface = surfaceOf(req, res);
        if (!surface) return;
        try {
            await svc.remove(surface, req.auth!.sub);
            const resolved = await svc.resolve(surface);
            res.json(success(config.nodeId, layoutBody(resolved, {})));
        } catch (err) { sendError(res, err); }
    });

    // POST /v1/site/layout/:surface/reset — store the built-in layout as an editable starting point.
    // Distinct from DELETE on purpose: this is "start from what we ship and change it", which leaves
    // a stored record to edit, while DELETE leaves none at all.
    router.post('/v1/site/layout/:surface/reset', ...operator, requireNotLb, async (req, res) => {
        const surface = surfaceOf(req, res);
        if (!surface) return;
        try {
            const built = defaultLayout(surface, config);
            const result = await svc.write(surface, { v: 1, blocks: built.blocks, meta: { note: 'Started from the built-in layout' } }, req.auth!.sub, 'admin');
            res.json(success(config.nodeId, layoutBody(result, {})));
        } catch (err) { sendError(res, err); }
    });

    // GET /v1/site/layout/:surface/versions — what this layout used to be.
    router.get('/v1/site/layout/:surface/versions', ...operator, async (req, res) => {
        const surface = surfaceOf(req, res);
        if (!surface) return;
        const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
        const history = await svc.versions(surface, limit);
        res.json(success(config.nodeId, {
            versions: history.map(h => ({
                version: h.version,
                recorded_at: h.recordedAt,
                changed_by: h.actor ?? null,
            })),
        }));
    });

    // POST /v1/site/layout/:surface/restore — put an earlier version back, re-validated first.
    router.post('/v1/site/layout/:surface/restore', ...operator, requireNotLb, async (req, res) => {
        const surface = surfaceOf(req, res);
        if (!surface) return;
        const version = Number((req.body ?? {}).version);
        if (!Number.isInteger(version)) {
            res.status(422).json(error(config.nodeId, 'VERSION_INVALID', 'Name the version number to go back to.'));
            return;
        }
        try {
            const result = await svc.restore(surface, version, req.auth!.sub);
            res.json(success(config.nodeId, layoutBody(result, {})));
        } catch (err) { sendError(res, err); }
    });

    // GET /v1/site/blocks — what this node can put on a surface, with the settings each one takes.
    // The admin form draws itself from this, and the AI prompt is generated from it, so the two
    // cannot describe different blocks.
    router.get('/v1/site/blocks', ...operator, (req, res) => {
        const raw = String(req.query.surface ?? '');
        if (!SurfaceLayoutService.isSurface(raw)) {
            res.status(422).json(error(config.nodeId, 'SURFACE_NOT_FOUND', `Name a surface: portal, home or home-onboarding. Got "${raw}".`));
            return;
        }
        const blocks = blocksForSurface(raw, config).map(def => ({
            id: def.id,
            label_key: operatorLabelKey(def.id),
            locale_stem: def.localeStem,
            summary: def.summary,
            max_per_surface: def.maxPerSurface,
            container: def.container === true,
            live_domains: def.liveDomains,
            props: def.props,
        }));
        res.json(success(config.nodeId, { surface: raw, blocks }));
    });

    // POST /v1/site/layout-import — one paste from an AI, which may cover more than one surface and
    // may carry each free-form passage's words inline on its block.
    //
    // Its own route rather than a branch of /v1/site/import, and the reason is a rule this repo had
    // to be audited to discover: a permission word is enforced on every door or it does not exist.
    // The older bundle is gated by requireRole('operator'), which reads the token's roles; routing a
    // layout through it would mean one capability with two doors, only one of which asks for the
    // word. So the bundle keeps template, memory and kv, and layouts come here.
    //
    // Every surface is validated before ANY of them is written: half a paste applied is a page in a
    // state nobody designed.
    router.post('/v1/site/layout-import', ...operator, requireNotLb, async (req, res) => {
        const bundle = (req.body ?? {}) as { layout?: Record<string, LayoutSubmission> };
        const entries = Object.entries(bundle.layout ?? {});
        if (entries.length === 0) {
            res.status(422).json(error(config.nodeId, 'IMPORT_INVALID',
                'Send a "layout" holding at least one surface: portal, home or home-onboarding.'));
            return;
        }
        for (const [name] of entries) {
            if (!SurfaceLayoutService.isSurface(name)) {
                res.status(422).json(error(config.nodeId, 'SURFACE_NOT_FOUND', `This node has no surface called "${name}".`));
                return;
            }
        }
        try {
            // Check every surface first, then write them. A refusal on the second must not leave the
            // first one applied.
            const prepared = entries.map(([name, submission]) =>
                svc.prepare(name as SurfaceId, submission, req.auth!.sub, 'import'));
            const declared = passageProvenance(req);
            const written: string[] = [];
            for (const p of prepared) {
                await svc.commit(p, req.auth!.sub, declared);
                written.push(p.surface);
            }
            res.json(success(config.nodeId, { surfaces_written: written }, written.map(s => ({
                description: `See the ${s} surface`, method: 'GET', url: `/v1/site/layout/${s}`,
            }))));
        } catch (err) { sendError(res, err); }
    });

    // POST /v1/site/freeform — edit one passage without rewriting the layout around it.
    router.post('/v1/site/freeform', ...operator, requireNotLb, async (req, res) => {
        const body = req.body ?? {};
        if (typeof body.key !== 'string' || typeof body.body !== 'string') {
            res.status(422).json(error(config.nodeId, 'FREEFORM_INVALID', 'Send the passage name and its text.'));
            return;
        }
        try {
            await svc.writeFreeform(body.key, body.body, req.auth!.sub, passageProvenance(req));
            res.json(success(config.nodeId, { key: body.key, bytes: Buffer.byteLength(body.body, 'utf-8') }));
        } catch (err) { sendError(res, err); }
    });

    return router;
}
