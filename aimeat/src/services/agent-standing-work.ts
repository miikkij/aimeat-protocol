/**
 * @file src/services/agent-standing-work.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The standing work an agent made (its schedules and the workflows it saved), and the
 *   notices that tell the owner when that work stops and when a new agent of the same name takes it
 *   over.
 *
 *   WHY (secaudit2026oct26, saverAuthority:deleted-agent-authority-revived-by-same-name-agent).
 *   Deleting an agent leaves its schedules and saved workflows in place: at each fire their maker is
 *   asked again (workflow/trigger-authority.ts saverAuthority), and with no agent of that identity
 *   they do not run, with the sentence "Approve it again, or delete this schedule". An agent name is
 *   reusable, so a new agent approved under it is that maker again and the work runs as it, with the
 *   permissions the new agent was given. That is the designed recovery, and the approval is the
 *   owner's own act, or that of an agent the owner allowed to approve (developer rules 2 and 4,
 *   2026-10-27). What was missing is that the owner sees it: the delete now says what stops, and a
 *   new agent under a name with standing work tells the owner what it takes over.
 * @structure StandingWork · standingWorkOf(storage, ownerGhii, gaii) · noticeStandingWork(storage, ownerGhii, agent, work, when)
 * @usage
 *   const work = await standingWorkOf(storage, ownerGhii, agent.gaii);       // before the delete
 *   await noticeStandingWork(storage, ownerGhii, agent.name, work, 'stopped');
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import type { Storage } from '../storage/interface.js';
import { listWorkflows } from './workflow/store.js';
import { notify } from './notify.js';
import { logger } from '../utils/logger.js';

/** How many schedules and saved workflows name this agent as their maker. */
export interface StandingWork { schedules: number; workflows: number }

/** The schedules the agent made and the workflows it saved last, in the owner's account. */
export async function standingWorkOf(storage: Storage, ownerGhii: string, gaii: string): Promise<StandingWork> {
  const jobs = await storage.listScheduledJobs({ ownerScope: ownerGhii });
  const schedules = jobs.filter(j => j.createdByAgent && j.createdBy === gaii).length;
  const defs = await listWorkflows(storage, ownerGhii);
  const workflows = defs.filter(d => d?.savedBy?.kind === 'agent' && d.savedBy.id === gaii).length;
  return { schedules, workflows };
}

/**
 * Tell the owner what standing work stopped with an agent (`stopped`), or what a new agent under
 * the same name runs again (`resumed`). Nothing is sent when there is none. Never throws.
 */
export async function noticeStandingWork(
  storage: Storage, ownerGhii: string, agent: string, work: StandingWork, when: 'stopped' | 'resumed',
): Promise<void> {
  if (work.schedules === 0 && work.workflows === 0) return;
  const vars = { agent, schedules: work.schedules, workflows: work.workflows };
  const stopped = when === 'stopped';
  await notify(storage, ownerGhii, {
    type: `agent_standing_work_${when}`,
    title: stopped ? `${agent} is removed, and its standing work stops` : `The new agent ${agent} takes over earlier standing work`,
    body: stopped
      ? `${work.schedules} schedule(s) and ${work.workflows} saved workflow(s) that ${agent} made no longer run. If you approve a new agent named ${agent}, they run again as it, with the permissions you give it then. Delete them on the Schedules page to end them for good.`
      : `${work.schedules} schedule(s) and ${work.workflows} saved workflow(s) that an earlier agent named ${agent} made run again as this agent, with the permissions it has now. Delete them on the Schedules page if it should not run them.`,
    link: '/v1/profile?tab=scheduler',
    i18n: { key: `agent_standing_work_${when}`, vars },
  }).catch((err: unknown) => logger.warn('agent standing work: the owner could not be told', { agent, when, error: String(err) }));
}
