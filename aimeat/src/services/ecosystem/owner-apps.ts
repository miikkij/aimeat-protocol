/**
 * @file src/services/ecosystem/owner-apps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's view of the outside applications (ecosystem apps, GEAI) connected to the
 *   account, and their removal. GET /v1/ecosystem-apps and DELETE /v1/ecosystem-apps/:app run these
 *   functions, and so do the MCP tools aimeat_ecosystem_app_list and aimeat_ecosystem_app_revoke, so
 *   the person's own AI answers "which outside apps read my data" and removes one with the same
 *   result the Outside apps page gives. Moved out of routes/ecosystem-apps.ts unchanged.
 *
 *   WHAT A REMOVAL DOES, in this order: the app is told first (binding.revoked), while its grant
 *   still exists; every session it holds ends; its record goes; its automation recipe, its
 *   eco-capability schedules and its pending advisories go. The data it deposited into the owner's
 *   memory stays, because it is the owner's refined data, and so do the incoming webhooks it made,
 *   which keep working; the answer names them and the owner gets a notice.
 * @structure ecosystemAppView(record) · listOwnerEcosystemApps(storage, owner) · revokeOwnerEcosystemApp(deps, owner, app)
 * @usage
 *   const apps = await listOwnerEcosystemApps(storage, owner);
 *   const out = await revokeOwnerEcosystemApp({ storage, config, scheduler }, owner, 'zendesk');
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: moved out of routes/ecosystem-apps.ts for the MCP tools (feature
 *     audit 2026-11-19, 4.4 item 2).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, EcosystemAppRecord } from '../../storage/interface.js';
import type { Scheduler } from '../scheduler.js';
import { receiversMadeBy, noticeReceiversKept } from '../receivers/makers.js';
import { emitEcosystemBindingRevoked } from './events.js';
import { pendingPrefix } from './automation-advisories.js';
import { approvableDataAreas } from './access.js';
import { logger } from '../../utils/logger.js';

/** One connected outside app as the owner reads it. */
export function ecosystemAppView(a: EcosystemAppRecord): Record<string, unknown> {
    return {
        geai: a.geai,
        app: a.app,
        owner: a.owner,
        display_name: a.displayName,
        description: a.description,
        scopes: a.scopes,
        // An app approved before 2026-11-15 can still hold a `memory` area; it is not shown (L045).
        data_areas: approvableDataAreas(a.dataAreas ?? []),
        status: a.status,
        public_key: a.publicKey,
        capabilities: a.capabilities ?? [],
        automation: a.automation ?? null,
        setup: a.setup ?? null,
        // What the owner allowed other accounts' capabilities to have this app run, and what waits.
        capability_approvals: a.capabilityApprovals ?? [],
        created_at: a.createdAt,
        last_seen: a.lastSeen,
    };
}

/** Every outside app connected to `owner`'s account. */
export async function listOwnerEcosystemApps(storage: Storage, owner: string): Promise<Record<string, unknown>[]> {
    const apps = await storage.getEcosystemAppsByOwner(owner);
    return apps.map(ecosystemAppView);
}

export type RevokeOutcome =
    | { ok: true; data: { deleted: true; app: string; geai: string; receivers_kept: Awaited<ReturnType<typeof receiversMadeBy>> } }
    | { ok: false; status: 404; code: 'NOT_FOUND'; message: string };

/**
 * Remove the outside app `app` from `owner`'s account: tell it, end its sessions, delete its record
 * and the automation it set up. What it deposited stays. NOT_FOUND when the owner has no such app.
 */
export async function revokeOwnerEcosystemApp(
    deps: { storage: Storage; config: AimeatConfig; scheduler?: Scheduler | null },
    owner: string,
    app: string,
): Promise<RevokeOutcome> {
    const { storage, config, scheduler } = deps;
    const record = await storage.getEcosystemAppByOwnerAndApp(owner, app);
    if (!record) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Ecosystem app "${app}" not found under owner "${owner}"` };
    }
    const ownerGhii = `${owner}@${config.nodeId}`;

    // 1) Lifecycle outbound event FIRST (best-effort) — emit while the grant is still present so the
    //    live grant re-check passes; the connected app/desk reacts to binding.revoked and drops its side.
    await emitEcosystemBindingRevoked(storage, config, ownerGhii, record.geai, 'owner_revoked').catch(err => { logger.warn('DELETE /v1/ecosystem-apps/:app: best-effort', { error: String(err) }); });

    // 2) End every credential this app holds, THEN delete the principal row. Deleting the row alone
    //    left the app's ninety-day bearer authenticating for the rest of its life — the card was
    //    gone, DELETE answered 404, and the owner had no surface left to stop it. Every session
    //    rather than one, because each re-approval mints another. Order matters: the row has to go
    //    after, or a token minted between the two calls survives.
    for (const s of await storage.listActiveSessions(owner)) {
        if (s.gaii === record.geai) await storage.revokeSession(s.sessionId);
    }

    await storage.deleteEcosystemApp(record.geai);

    // 3a) Remove the app's automation recipe (the "data published → run agents" rule), if any.
    await storage.deleteAutomationRecipe(owner, app).catch(err => { logger.warn('DELETE /v1/ecosystem-apps/:app: best-effort', { error: String(err) }); });

    // 3b) Remove the app's eco-capability schedules (cron jobs that invoke this app's capability).
    const jobs = await storage.listScheduledJobs({ type: 'eco-capability', ownerScope: ownerGhii }).catch(err => { logger.warn('DELETE /v1/ecosystem-apps/:app: continuing after a suppressed failure', { error: String(err) }); return []; });
    for (const job of jobs) {
        if ((job.input as { app?: string } | undefined)?.app === app) {
            scheduler?.removeJob(job.id);
            await storage.deleteScheduledJob(job.id).catch(err => { logger.warn('DELETE /v1/ecosystem-apps/:app: best-effort', { error: String(err) }); });
        }
    }

    // 3c) Drop any pending (awaiting-approval) advisories parked in owner memory for this app.
    const pendingItems = await storage.listMemory(ownerGhii, { prefix: pendingPrefix(app) }).catch(err => { logger.warn('DELETE /v1/ecosystem-apps/:app: continuing after a suppressed failure', { error: String(err) }); return []; });
    for (const item of pendingItems) {
        await storage.deleteMemory(ownerGhii, item.key).catch(err => { logger.warn('DELETE /v1/ecosystem-apps/:app: best-effort', { error: String(err) }); });
    }

    // NOTE: the app's DEPOSITED insight data (its eco: namespace writes into the owner's Memory)
    // is the owner's refined data and is intentionally LEFT IN PLACE. So are the receivers it made:
    // they are the owner's and keep working; the answer and a notice say so (ruling 3, 2026-11-08).
    const receiversKept = await receiversMadeBy(storage, ownerGhii, record.geai);
    await noticeReceiversKept(storage, ownerGhii, app, receiversKept);

    return { ok: true, data: { deleted: true, app, geai: record.geai, receivers_kept: receiversKept } };
}
