/**
 * @file src/services/schedule-actor.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who a schedule fires as, asked again at every fire.
 *
 *   A schedule keeps acting after the call that made it, with nobody at the screen. It acts as its
 *   maker: the owner, an agent, an ecosystem app, or an app (by the grant it was made under). The
 *   owner can narrow an agent, delete it, or revoke an app at any time after, so the maker is looked
 *   up at the fire, the same way a workflow's trigger asks its saver (workflow/trigger-authority.ts
 *   saverAuthority, which this reuses), and a maker that is gone does not fire.
 *
 *   Until 2026-10-05 an app's schedule was stored with the owner's identity as its maker and fired
 *   with the owner's whole authority: a refinery batch ran with every scope and the owner's role,
 *   and went on after the owner revoked the app; a scheduled ai job asked the model as the owner in
 *   person (secaudit 2026-10, AI-2 and AI-3). An app's schedule now carries its grant
 *   (`createdByApp`) and fires as that app, with the grant's scopes. One an app made before that
 *   carries no grant and cannot be told from the owner's own except by `createdByAgent`; it does not
 *   fire, and says why.
 * @structure ScheduleActor · scheduleActor(storage, job)
 * @usage
 *   const actor = await scheduleActor(storage, job);
 *   if (!actor.ok) throw new Error(actor.reason);
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, AI-2 and AI-3).
 */
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import type { WorkflowSaver } from '../models/workflow-schemas.js';
import { isGEAI } from '../utils/gaii.js';
import { saverAuthority } from './workflow/trigger-authority.js';
import { aiCallerOfPrincipal, OWNER_CALLER, type AiCallerContext } from './ai/caller-context.js';

export type ScheduleActor =
  | {
    ok: true;
    /** The identity the fire acts as: the owner's GHII for the owner and their apps, else the maker's own. */
    principal: string;
    roles: string[];
    scopes: string[];
    isOwner: boolean;
    /** `owner/file.html` when an app made it. */
    appRef?: string;
    /** Who its AI calls run as. */
    ai: AiCallerContext;
  }
  | { ok: false; reason: string };

/** The maker of a schedule, in the terms the workflow trigger uses for a saver. */
function makerOf(job: Pick<ScheduledJobRecord, 'createdBy' | 'createdByAgent' | 'createdByApp'>): WorkflowSaver | 'unknown-app' {
  if (job.createdByApp) return { kind: 'app', id: job.createdByApp };
  const id = job.createdBy ?? '';
  if (job.createdByAgent && id.includes('#')) return isGEAI(id) ? { kind: 'ecosystem', id } : { kind: 'agent', id };
  // Not the owner in person, and no `#`: an app before its grant was kept (the owner's identity was
  // stored as the maker). Which app is not known.
  if (job.createdByAgent) return 'unknown-app';
  return { kind: 'owner', id };
}

/** Who `job` fires as now, or why it does not fire. */
export async function scheduleActor(
  storage: Storage, job: Pick<ScheduledJobRecord, 'createdBy' | 'createdByAgent' | 'createdByApp' | 'ownerScope'>,
): Promise<ScheduleActor> {
  const owner = job.ownerScope ?? '';
  const maker = makerOf(job);
  if (maker === 'unknown-app') {
    return { ok: false, reason: 'An app made this schedule before 2026-10-05, and the node cannot tell which app, so it no longer runs with your whole authority. Open the app to make it again, or delete this schedule.' };
  }
  if (maker.kind === 'owner') return { ok: true, principal: owner, roles: ['owner'], scopes: ['*'], isOwner: true, ai: { ...OWNER_CALLER } };

  const now = await saverAuthority(storage, maker);
  if (now.gone) {
    const what = maker.kind === 'app' ? 'The app that made this schedule no longer holds your permission' : `${now.name}, which made this schedule, is no longer connected`;
    return { ok: false, reason: `${what}, so the schedule does not run. Approve it again, or delete this schedule.` };
  }
  if (maker.kind === 'app') {
    const grant = await storage.getAppGrant(maker.id);
    return { ok: true, principal: owner, roles: ['app'], scopes: now.scopes, isOwner: false,
      ...(grant ? { appRef: grant.app } : {}), ai: grant ? { caller: 'app', verifiedApp: grant.app } : { caller: 'app' } };
  }
  return { ok: true, principal: maker.id, roles: [maker.kind === 'ecosystem' ? 'ecosystem' : 'agent'], scopes: now.scopes, isOwner: false, ai: aiCallerOfPrincipal(maker.id) };
}
