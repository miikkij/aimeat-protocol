/**
 * @file src/services/app/draft-to-publish.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The checks before an app's draft is promoted: the draft is read from the bucket the
 *   caller's target scope named, a missing draft is refused, and the roadmap question is asked (a line
 *   is required on an app more than one person builds; services/app/roadmap.ts roadmapGate). POST
 *   /v1/apps/:owner/:filename/publish-draft and aimeat_app_draft_publish both call it after their own
 *   target-scope resolution (resolveAppTarget on both), so the read and the gate around it are written
 *   once (structure programme 2026-11, unit 2b).
 *
 *   THE LINE. The one the publisher gives, when it is a non-blank string; otherwise the draft's own
 *   notice answers it (services/app/news.ts draftNotice). Each surface names its own remedy for a
 *   missing draft, so the refusal is a code.
 * @structure draftToPublish(storage, target, roadmapLine?) → { draft } | refusal
 * @usage
 *   const checked = await draftToPublish(storage, { ownerName, ownerGhii, filename }, req.body?.roadmap);
 *   if (!checked.ok) refuse(checked.code, checked.message);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/apps/drafts.ts and mcp/apps.ts, which each held the read and
 *     the roadmap gate (structure programme 2026-11, unit 2b).
 */
import type { Storage, AppDraftRecord } from '../../storage/interface.js';
import { isSharedApp } from './dev-grant.js';
import { roadmapGate } from './roadmap.js';

/** The draft to promote, or why not: there is none, or a shared app's publish names no roadmap line. */
export async function draftToPublish(
    storage: Storage,
    target: { ownerName: string; ownerGhii: string; filename: string },
    roadmapLine: unknown,
): Promise<{ ok: true; draft: AppDraftRecord } | { ok: false; code: 'NO_DRAFT' } | { ok: false; code: 'ROADMAP_REQUIRED'; message: string }> {
    const draft = await storage.getAppDraft(target.ownerGhii, target.filename);
    if (!draft) return { ok: false, code: 'NO_DRAFT' };
    const given = typeof roadmapLine === 'string' && roadmapLine.trim() ? roadmapLine : undefined;
    const road = roadmapGate({
        line: given ?? draft.manifest.draftNotice?.text,
        shared: await isSharedApp(storage, target.ownerName, target.filename),
    });
    if (!road.ok) return { ok: false, code: 'ROADMAP_REQUIRED', message: road.message };
    return { ok: true, draft };
}
