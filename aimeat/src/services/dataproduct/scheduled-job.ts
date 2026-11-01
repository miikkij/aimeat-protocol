/**
 * @file src/services/dataproduct/scheduled-job.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `dataproduct` schedule kind: each fire builds one data product (plan
 *   doc-mvwxcas3dom3, D9.5). Registered at boot through registerKindExecutor, as the refinery and ai
 *   kinds are, because importing the build from scheduler.ts would close import cycles.
 *
 *   IT FIRES AS ITS MAKER, asked again at every fire (services/schedule-actor.ts): the owner, or the
 *   agent, app or ecosystem app that defined the product, with the words it holds today. Every source
 *   is read as that principal, so a fire reaches nothing the maker could not read now. A fire whose
 *   definition is gone fails with that sentence; deleting a definition removes its schedules, so this
 *   only happens to a record deleted around the service.
 * @structure runDataproductJob
 * @usage scheduler.registerKindExecutor('dataproduct', (job) => runDataproductJob(storage, config, job));
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9.5).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, ScheduledJobRecord } from '../../storage/interface.js';
import type { JobRunResult } from '../scheduler-types.js';
import { localAccountName } from '../../utils/gaii.js';
import { callerFromAuth } from '../caller-context.js';
import { scheduleActor } from '../schedule-actor.js';
import { runStored } from './service.js';
import { dataProductKey } from './definition.js';

/** Fire one dataproduct schedule: build the product it names. */
export async function runDataproductJob(storage: Storage, config: AimeatConfig, job: ScheduledJobRecord): Promise<JobRunResult> {
    const ownerGhii = job.ownerScope;
    if (!ownerGhii) throw new Error(`dataproduct job "${job.id}" has no ownerScope`);
    const name = String((job.input as { name?: unknown } | undefined)?.name ?? '');
    const actor = await scheduleActor(storage, job);
    if (!actor.ok) throw new Error(actor.reason);
    const owner = localAccountName(ownerGhii);
    const caller = callerFromAuth({
        sub: actor.isOwner ? owner : actor.principal, owner, roles: actor.roles, scopes: actor.isOwner ? [] : actor.scopes,
    }, config.nodeId, storage);
    const out = await runStored({ deps: { storage, config }, caller, ...(actor.appRef ? { app: actor.appRef } : {}), schedule: job.cron }, name);
    if (!out.ok) throw new Error(`${out.code}: ${out.message}`);
    return { reads: [dataProductKey(name)], writes: [dataProductKey(name), `datapkg/${name}/latest.json`] };
}
