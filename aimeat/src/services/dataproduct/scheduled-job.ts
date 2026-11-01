/**
 * @file src/services/dataproduct/scheduled-job.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `dataproduct` schedule kind: each fire builds one data product (plan
 *   doc-mvwxcas3dom3, D9.5). Registered at boot through registerKindExecutor, as the refinery and ai
 *   kinds are, because importing the build from scheduler.ts would close import cycles. The run of a
 *   product that runs when its source changes (./on-change.ts) is here too, for the same reason and
 *   with the same actor rule.
 *
 *   IT FIRES AS ITS MAKER, asked again at every fire (services/schedule-actor.ts): the owner, or the
 *   agent, app or ecosystem app that defined the product, with the words it holds today. Every source
 *   is read as that principal, so a fire reaches nothing the maker could not read now. A fire whose
 *   definition is gone fails with that sentence; deleting a definition removes its schedules, so this
 *   only happens to a record deleted around the service.
 * @structure runDataproductJob · runDataproductOnChange
 * @usage scheduler.registerKindExecutor('dataproduct', (job) => runDataproductJob(storage, config, job));
 * @version-history
 *   v1.1.0 — 2026-11-01 — runDataproductOnChange: the run after a source change, as the definition's
 *     `runAs` maker through scheduleActor (WP9c). The shared half is runAsMaker.
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9.5).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, ScheduledJobRecord } from '../../storage/interface.js';
import type { JobRunResult } from '../scheduler-types.js';
import { localAccountName } from '../../utils/gaii.js';
import { callerFromAuth } from '../caller-context.js';
import { scheduleActor } from '../schedule-actor.js';
import { runStored } from './service.js';
import { dataProductKey, asDefinition, runsOnChange, ON_CHANGE } from './definition.js';

type Maker = Pick<ScheduledJobRecord, 'createdBy' | 'createdByAgent' | 'createdByApp' | 'ownerScope'> & { createdAt?: string };

/** Build `name` as `maker` is now; throws with the sentence a refusal or a failure gave. */
async function runAsMaker(storage: Storage, config: AimeatConfig, maker: Maker, name: string, schedule: string): Promise<void> {
    const ownerGhii = maker.ownerScope!;
    const actor = await scheduleActor(storage, maker);
    if (!actor.ok) throw new Error(actor.reason);
    const owner = localAccountName(ownerGhii);
    const caller = callerFromAuth({
        sub: actor.isOwner ? owner : actor.principal, owner, roles: actor.roles, scopes: actor.isOwner ? [] : actor.scopes,
    }, config.nodeId, storage);
    const out = await runStored({ deps: { storage, config }, caller, ...(actor.appRef ? { app: actor.appRef } : {}), schedule }, name);
    if (!out.ok) throw new Error(`${out.code}: ${out.message}`);
}

/** Fire one dataproduct schedule: build the product it names. */
export async function runDataproductJob(storage: Storage, config: AimeatConfig, job: ScheduledJobRecord): Promise<JobRunResult> {
    if (!job.ownerScope) throw new Error(`dataproduct job "${job.id}" has no ownerScope`);
    const name = String((job.input as { name?: unknown } | undefined)?.name ?? '');
    await runAsMaker(storage, config, job, name, job.cron);
    return { reads: [dataProductKey(name)], writes: [dataProductKey(name), `datapkg/${name}/latest.json`] };
}

/**
 * Build a product that runs when its source changes, as the maker its definition names. A definition
 * that is gone or no longer runs on a change is left alone: the change runner forgets it.
 */
export async function runDataproductOnChange(storage: Storage, config: AimeatConfig, ownerGhii: string, name: string): Promise<void> {
    const def = asDefinition((await storage.getMemory(ownerGhii, dataProductKey(name)))?.value);
    if (!def || !runsOnChange(def) || !def.runAs) return;
    await runAsMaker(storage, config, { ...def.runAs, ownerScope: ownerGhii, createdAt: def.createdAt }, name, ON_CHANGE);
}
