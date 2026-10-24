/**
 * @file src/routes/organisms/workspace-pages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A member's two calls about one page of a document space:
 *     - POST …/documents/:space/:docId/frame — the frame address of an HTML page, the published copy
 *       or the draft (services/page-frame.ts). A member reads a page through membership, so the
 *       token is minted for a member (`k: 'mem'`), and only after the same read gate the workspace
 *       read answers to and the classification reader's show.
 *     - POST …/documents/:space/:docId/opened — the day this page was last opened, for a page the
 *       member's own view renders itself (a Markdown page). The public reads and the frame address
 *       record it on their own (services/workspace-opened.ts).
 *   The space and the page are in the path and the workspace in `?ws=`, as the document edit routes
 *   on this router have them.
 * @structure registerOrganismWorkspacePageRoutes(router, config, storage, H)
 * @usage registerOrganismWorkspacePageRoutes(router, config, storage, H) in routes/organisms.ts
 * @version-history
 *   v1.0.1 — 2026-10-24 — The member's page gate asks canReadWorkspaceRecords instead of the manifest
 *     alone, so a workspace creator removed from the organism gets no member frame token
 *     (secaudit2026oct22, canReadWsManifest no-membership-gate).
 *   v1.0.0 — 2026-10-16 — Initial (HTML pages in workspaces).
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { findWorkspaceRecord } from '../../services/workspace-write.js';
import { readerFor } from '../../services/classification/reader.js';
import { memoryTarget } from '../../services/classification/labels.js';
import { isHtmlPageValue } from '../../services/html-page.js';
import { frameUrlFor } from '../../services/page-frame.js';
import { PAGE_FRAME_TTL_SECONDS } from '../../services/page-frame-token.js';
import { markPageOpened } from '../../services/workspace-opened.js';
import { canReadWorkspaceRecords } from '../../services/workspace-access.js';
import type { OrganismHelpers } from './shared.js';

export function registerOrganismWorkspacePageRoutes(router: Router, config: AimeatConfig, storage: Storage, H: OrganismHelpers): void {
    const { readWsManifestValue } = H;

    /** The page a member may read, with its space's namespace; or the error already sent. */
    const memberPage = async (req: Request, res: Response, role: 'latest' | 'draft'): Promise<{ ws: string; namespace: string; rec: MemoryRecord | null } | null> => {
        const id = req.params.id as string;
        const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
        if (!ws) { res.status(400).json(error(config.nodeId, 'WS_REQUIRED', 'Name the workspace with ?ws=<workspace id>.')); return null; }
        // 404 for a workspace the caller cannot read, the same no-disclosure answer the workspace read gives.
        // The gate of the member records read (services/workspace-access.ts canReadWorkspaceRecords):
        // the manifest alone admitted its own owner, a creator removed from the organism (secaudit2026oct22).
        const organism = await storage.getOrganism(id);
        if (!organism || !(await canReadWorkspaceRecords(storage, config, organism, req.auth!.sub, req.auth!.owner, resolveIdentity(req.auth!, config.nodeId), ws))) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Not found')); return null;
        }
        const space = req.params.space as string;
        const types = ((await readWsManifestValue(id, ws))?.objectTypes as Array<Record<string, unknown>> | undefined) ?? [];
        const ot = types.find(o => o && o.name === space && (o.mode === 'document' || (!o.mode && o.kind === 'document')) && typeof o.namespace === 'string');
        if (!ot) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `This workspace has no document space "${space}".`)); return null; }
        const namespace = ot.namespace as string;
        const found = await findWorkspaceRecord(storage, `organism.${id}.w.${ws}.${namespace}.${req.params.docId as string}.${role}`);
        const shown = found ? (await readerFor({ storage, config }, req.auth).show([found], r => memoryTarget(r.ownerGaii, r.key)))[0] ?? null : null;
        return { ws, namespace, rec: shown };
    };

    /** The frame address of one HTML page. `version` is "latest" (the default) or "draft". */
    router.post('/v1/organisms/:id/workspace/documents/:space/:docId/frame',
        requireAuth(), requireScope('organism:read'),
        rateLimit({ windowMs: 60_000, max: 240 }),
        async (req: Request, res: Response) => {
            const role = req.body?.version === 'draft' ? 'draft' : 'latest';
            const page = await memberPage(req, res, role);
            if (!page) return;
            if (!page.rec || !isHtmlPageValue(page.rec.value)) {
                res.status(404).json(error(config.nodeId, 'NOT_AN_HTML_PAGE', `There is no HTML page here as a ${role === 'draft' ? 'draft' : 'published page'}.`));
                return;
            }
            const orgId = req.params.id as string, space = req.params.space as string, docId = req.params.docId as string;
            const frame_url = await frameUrlFor(config, { org: orgId, ws: page.ws, sp: space, ns: page.namespace, id: docId, r: role, k: 'mem' });
            void markPageOpened(storage, config, orgId, page.ws, space, docId);
            res.json(success(config.nodeId, {
                frame_url, version: role, expires_in: PAGE_FRAME_TTL_SECONDS,
                // Without a page host the node shows the page as its text; the reader is told why.
                ...(frame_url ? {} : { reason: 'This node has no page host (AIMEAT_PAGE_HOST), so the page is shown as its text.' }),
            }));
        });

    /** Record that a member opened this page today. */
    router.post('/v1/organisms/:id/workspace/documents/:space/:docId/opened',
        requireAuth(), requireScope('organism:read'),
        rateLimit({ windowMs: 60_000, max: 240 }),
        async (req: Request, res: Response) => {
            const page = await memberPage(req, res, 'latest');
            if (!page) return;
            const orgId = req.params.id as string, space = req.params.space as string, docId = req.params.docId as string;
            const rec = page.rec ?? await findWorkspaceRecord(storage, `organism.${orgId}.w.${page.ws}.${page.namespace}.${docId}.draft`);
            if (!rec) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such page.')); return; }
            await markPageOpened(storage, config, orgId, page.ws, space, docId);
            res.json(success(config.nodeId, { recorded: true, day: new Date().toISOString().slice(0, 10) }));
        });
}
