/**
 * @file src/services/task/app-start-notice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the owner sees when an app starts a task that would otherwise wait for them in
 *   person: an entry in the account's trail (event `task.started_by_app`) and a notification, both
 *   naming the app, the task and why it waited.
 *
 *   WHY. A same-owner app the owner granted task:write may start any of the owner's waiting tasks,
 *   among them one held by the permission floor (an agent that can spend money, send mail or delete
 *   in the owner's name), one whose plan declares such an effect, and a paused or stalled one that
 *   only the owner may restart (services/task/start-op.ts). That is allowed on purpose, so that an
 *   app can do what its user wants done; until 2026-11-19 it left no trace but the task's own event,
 *   and the consent sentence for task:write did not say it. The owner now sees each such start, and
 *   the notification links to the agent card, where the owner can make such tasks wait for them
 *   also when an app starts them (AgentRecord.taskStartAppWaits).
 *
 *   The notification is the node's own (no `source`), like the task-waiting notice: muting the app
 *   must not hide a start the app made. Best-effort, as every notice after the fact is: a failed
 *   notice never undoes the start.
 * @structure AppStartWhy · appStartReason() · noteAppStart()
 * @usage
 *   if (lifted) await noteAppStart(storage, { caller, task, agent: runner, why: lifted.why });
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, item 2.1).
 */
import type { Storage, AgentTaskRecord, AgentRecord } from '../../storage/interface.js';
import type { StartCaller, TaskStartDecision } from '../agent/task-rules.js';
import { waitReason } from './start-notice.js';
import { recordTrailEvent } from '../place-trail.js';
import { notify } from '../notify.js';
import { logger } from '../../utils/logger.js';

/** Why the task waited for the owner in person: the floor or a declared effect, or its status. */
export type AppStartWhy =
    | { kind: 'held'; decision: Pick<TaskStartDecision, 'waitsBecause' | 'floorScopes' | 'effects'> }
    | { kind: 'restart'; status: AgentTaskRecord['status'] };

/** The English sentence that says why the task waited for the owner. */
export function appStartReason(agentName: string, why: AppStartWhy): string {
    if (why.kind === 'held') return waitReason(agentName, why.decision);
    return `The task was ${why.status}, and only you start a ${why.status} task again.`;
}

/** The route both trail rows of a task start are filed under (middleware/trail-recorder.ts). */
const START_CODE = 'POST /v1/agents/:name/tasks/:id/start';

/**
 * Tell the owner that `caller` (an app) started `task`, which waited for them because of `why`.
 * Writes the trail entry and sends the notification; never throws.
 */
export async function noteAppStart(
    storage: Storage,
    input: { caller: StartCaller; task: Pick<AgentTaskRecord, 'id' | 'title' | 'agentGaii' | 'ownerGaii'>; agent: Pick<AgentRecord, 'name' | 'displayName'> | null; why: AppStartWhy },
): Promise<void> {
    const { caller, task, agent, why } = input;
    const agentName = task.agentGaii.split('#')[0];
    const who = agent?.displayName || agent?.name || agentName;
    let appName = 'An app';
    let appId = '';
    try {
        const grant = caller.appGrant ? await storage.getAppGrant(caller.appGrant) : null;
        if (grant) { appName = grant.appName || grant.app; appId = grant.app; }
    } catch (err) {
        logger.warn('task start: the app grant of an app start was not read', { taskId: task.id, error: String(err) });
    }
    const reason = appStartReason(who, why);
    try {
        recordTrailEvent({
            actor: task.ownerGaii, code: START_CODE, target: task.id, event: 'task.started_by_app',
            appId: appId || 'app', actorName: appName, detail: `${appName} started "${task.title}" for ${who}. ${reason}`,
        });
    } catch (err) {
        logger.warn('task start: the trail entry of an app start was not written', { taskId: task.id, error: String(err) });
    }
    try {
        const link = `/v1/home?agent=${encodeURIComponent(agentName)}&work=${encodeURIComponent(task.id)}`;
        const settings = `/v1/profile?tab=agents&agent=${encodeURIComponent(agentName)}`;
        await notify(storage, task.ownerGaii, {
            type: 'task_started_by_app',
            title: `${appName} started a task that waited for you: ${task.title}`.slice(0, 200),
            body: `${reason} ${appName} could start it because you let it start tasks for your agents. On ${who}'s card you can make such tasks wait for you also when an app starts them.`,
            link,
            i18n: { key: why.kind === 'held' ? 'task_started_by_app' : 'task_restarted_by_app', vars: { app: appName, agent: who, title: task.title } },
            actions: [
                { id: 'open', label: 'Open', kind: 'navigate', link, i18n: { key: 'task_started_by_app.open' } },
                { id: 'settings', label: 'Agent settings', kind: 'navigate', link: settings, i18n: { key: 'task_started_by_app.settings' } },
            ],
        });
    } catch (err) {
        logger.warn('task start: could not tell the owner an app started a task that waited for them', { taskId: task.id, error: String(err) });
    }
}
