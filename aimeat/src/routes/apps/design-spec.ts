/**
 * @file src/routes/apps/design-spec.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app's design spec: the one document that says what the app is for, how it is
 *   put together and what was decided, kept beside the app for everybody who builds it.
 *
 *   Registered on the app router like the roadmap, so nothing had to be added to the boot path.
 *
 *   WHO MAY DO WHAT. Everybody inside the build reads and writes it: the owner, the owner's own
 *   agents, and anybody holding a development right at any rung, which is the same test the draft
 *   endpoints make (appTarget with the `draft` act). Removing it is the owner's alone, because a
 *   builder's answer to a wrong document is a corrected document, and a delete by a drafter would
 *   take away what the other builders read. Nobody outside the build sees it: it names data keys,
 *   decisions and open questions, which are the builders' conversation rather than a shop window.
 *
 *   A WRITE MAY NAME THE REVISION IT EXPECTS. Two builders' AIs can be working on one app, and a
 *   write that does not say what it read would overwrite the other one's edit unseen. With
 *   `expected_revision` the node answers 409 and the document that is there, so the caller reads
 *   again and writes from that. Without it the write replaces whatever is there, for the person
 *   editing in the page who just looked at it.
 * @structure registerDesignSpecRoutes(router, config, storage, appTarget) —
 *   GET /design-spec · PUT /design-spec · DELETE /design-spec
 * @usage registerDesignSpecRoutes(router, config, storage, appTarget);
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (wish-sovelluksen-design-speksi-sovelluksen-l-helle-settings-contr).
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppRecord } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { accountOf } from '../../services/app-members.js';
import { emitChange } from '../../services/event-bus.js';
import { recordAppAudit } from '../../services/app-audit.js';
import {
    APP_DESIGN_SPEC_TEMPLATE, checkDesignSpecMarkdown, deleteAppDesignSpec, designSpecMeaning, designSpecStamp,
    isDesignSpecStale, readAppDesignSpec, writeAppDesignSpec,
} from '../../services/app-design-spec.js';
import type { AppTargetFor } from './helpers.js';

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

export function registerDesignSpecRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    appTarget: AppTargetFor,
): void {
    /**
     * The app this request names, in the bucket the caller may build in. The refusal is already
     * sent when the answer is null: a filename that is not one, a right the caller does not hold
     * (403, or 404 for an owner that does not exist), or an app that is not there.
     */
    const resolve = async (req: Request, res: Response): Promise<{ app: AppRecord; appId: string; delegated: boolean } | null> => {
        const filename = String(req.params.filename ?? '');
        if (!FILENAME_RE.test(filename)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invalid filename.'));
            return null;
        }
        const t = await appTarget(req, 'draft');
        if (!t.ok) {
            res.status(t.status).json(error(config.nodeId, t.code, t.message));
            return null;
        }
        const app = await storage.getAppByOwnerName(t.owner, filename);
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such app.'));
            return null;
        }
        return { app, appId: `${app.ownerName}/${app.filename}`, delegated: !!t.delegated };
    };

    // ── GET .../design-spec — the document, and whether the app has moved past it ──
    // app:write, as the dev-grants list asks: the app domain has no read word, and an agent that
    // may build an app may read the document its builders keep. Without a word, any app-grant
    // token could read a builder's document whatever single scope its owner ticked.
    router.get('/v1/apps/:owner/:filename/design-spec', requireAuth(), requireScope('app:write'), async (req, res) => {
        const found = await resolve(req, res);
        if (!found) return;
        const spec = await readAppDesignSpec(storage, found.appId);
        return res.json(success(config.nodeId, {
            app: found.appId,
            app_version: found.app.versionNumber,
            design_spec: spec,
            stale: isDesignSpecStale(spec, found.app.versionNumber),
            ...(spec ? {} : { template: APP_DESIGN_SPEC_TEMPLATE }),
            meaning: designSpecMeaning(spec, found.app.versionNumber),
        }));
    });

    // ── PUT .../design-spec — write the whole document ──
    router.put('/v1/apps/:owner/:filename/design-spec', requireAuth(), requireScope('app:write'), async (req, res) => {
        const found = await resolve(req, res);
        if (!found) return;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const checked = checkDesignSpecMarkdown(body.markdown);
        if (!checked.ok) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', checked.message));
        const expected = body.expected_revision;
        if (expected !== undefined && expected !== null && (!Number.isInteger(expected) || (expected as number) < 0)) {
            return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'expected_revision is the revision you read, a whole number; omit it to replace whatever is there.'));
        }
        const principal = resolveIdentity(req.auth!, config.nodeId);
        const out = await writeAppDesignSpec(storage, {
            appId: found.appId, markdown: checked.markdown, by: accountOf(principal), principal,
            appVersion: found.app.versionNumber,
            ...(typeof expected === 'number' ? { expectedRevision: expected } : {}),
        });
        if ('conflict' in out) {
            return res.status(409).json(error(config.nodeId, 'REVISION_MISMATCH',
                `The design spec is at revision ${out.conflict.revision}, not ${expected}. Read it again and write from that.`,
                409, { design_spec: out.conflict }));
        }
        // The manifest's stamp follows every write, so a listing says when the spec was last written
        // without waiting for the next publish to copy it.
        await storage.updateAppMeta(found.app.ownerGaii, found.app.filename, { designSpec: designSpecStamp(out.spec) });
        await recordAppAudit(storage, {
            ownerGhii: found.app.ownerGaii, filename: found.app.filename, by: principal, action: 'design_spec.set',
            detail: { revision: out.spec.revision, version: out.spec.version, bytes: Buffer.byteLength(out.spec.markdown, 'utf8'), unchanged: out.unchanged },
        });
        emitChange('apps');
        return res.status(out.replacedRevision === null ? 201 : 200).json(success(config.nodeId, {
            app: found.appId,
            app_version: found.app.versionNumber,
            design_spec: out.spec,
            stale: false,
            replaced_revision: out.replacedRevision,
            unchanged: out.unchanged,
            meaning: out.unchanged
                ? `The text is the one that was there; the spec is now marked current for version ${out.spec.version}.`
                : designSpecMeaning(out.spec, found.app.versionNumber),
        }));
    });

    // ── DELETE .../design-spec — the owner takes the document away ──
    router.delete('/v1/apps/:owner/:filename/design-spec', requireAuth(), requireScope('app:write'), async (req, res) => {
        const found = await resolve(req, res);
        if (!found) return;
        if (found.delegated) {
            return res.status(403).json(error(config.nodeId, 'FORBIDDEN',
                'Only the app owner removes the design spec. Update it instead: write the document as it should read.'));
        }
        const removed = await deleteAppDesignSpec(storage, found.appId);
        if (removed) {
            await storage.updateAppMeta(found.app.ownerGaii, found.app.filename, { designSpec: null });
            await recordAppAudit(storage, {
                ownerGhii: found.app.ownerGaii, filename: found.app.filename,
                by: resolveIdentity(req.auth!, config.nodeId), action: 'design_spec.cleared',
            });
            emitChange('apps');
        }
        return res.json(success(config.nodeId, { removed }));
    });
}
