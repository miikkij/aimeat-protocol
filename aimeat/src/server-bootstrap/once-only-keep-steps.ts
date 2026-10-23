/**
 * @file src/server-bootstrap/once-only-keep-steps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The once-per-node boot steps that keep what already worked working when a scope word
 *   starts to be asked: an app's extension schedule made before the kind asked ext:invoke, the agents
 *   and ecosystem apps carried onto the 2026-10-06 tool words and the 4.0.0 REST gate words, and the
 *   published apps that keep storage:read and ext:invoke. Moved out of service-init.ts, which had
 *   reached the 800-line limit.
 *
 *   ORDER. The scope steps run one after another, never side by side, because each rewrites a
 *   principal's whole scope list or an app's allowance record, and two writers side by side would
 *   write over each other. `scopeStepsBegan` is taken before the first of them, so the third step
 *   hands its words only to principals that existed before this start.
 *
 *   BEFORE THE NODE SERVES. runOnceOnlyKeepSteps resolves when every step has finished, and
 *   initializeServices awaits it, so the node takes no request until the kept apps and schedules
 *   hold their words. Until 2026-10-21 the scope chain ran in the background, and on the first start
 *   a kept app could meet the refusal its keep step exists to prevent. A step that throws is logged
 *   and the node starts anyway; the step writes no record, so the next start tries it again.
 * @structure runOnceOnlyKeepSteps(storage, config)
 * @usage await runOnceOnlyKeepSteps(storage, config);   // server-bootstrap/service-init.ts
 * @version-history
 *   v1.2.5 -- 2026-10-23 -- flagOrphanPeerApprovalsOnce, last: the approved peering requests no peer
 *     stands behind are named on the Security page, none changed (secaudit2026oct22;
 *     services/federation-orphan-approvals.ts).
 *   v1.2.4 -- 2026-10-22 -- keepTaskContentForAppGrantsOnce, after the scope chain: an app grant made
 *     before a task's title and reason in the event record asked task:read keeps reading them while it
 *     holds what it held (secaudit 2026-10 wave 3, v89; services/account-event-task-keep.ts).
 *   v1.2.3 -- 2026-10-22 -- keepAiScheduleReadsOnce: an ai schedule an agent made before a fire read for
 *     its maker keeps reading as before until its input changes (secaudit 2026-10 wave 3, r49;
 *     services/schedule-ai-read.ts).
 *   v1.2.2 — 2026-10-22 — keepExtensionPublishOnce: an extension an agent or an app installed before
 *     its unattended runs asked the publish gate keeps publishing as before until its code changes
 *     (secaudit 2026-10, v68 and v69; services/extension-publish-keep.ts).
 *   v1.2.1 — 2026-10-22 — placeKnowledgeLinkOwnersOnce: the knowledge link rows written before link rows
 *     carried their owner keep showing (secaudit 2026-10, v78; services/knowledge-link-owner-keep.ts).
 *   v1.2.0 — 2026-10-22 — keepAppToolInvokeOnce, after the scope chain: the agents and ecosystem apps
 *     that called app tools over HTTP before the route asked exchange:write keep calling them
 *     (secaudit 2026-10, v72; services/app-tool-invoke-keep.ts).
 *   v1.1.0 — 2026-10-21 — keepExtensionFirstUseOnce: the extensions installed before the first-use
 *     rules keep their first use (Jouni, 2026-10-21; services/extension-first-use-keep.ts).
 *   v1.0.0 — 2026-10-21 — Moved unchanged out of service-init.ts (max-file-lines), then the scope
 *     chain is awaited as keepAppExtensionSchedulesOnce already was (secaudit 2026-10, capability-loss
 *     review: P2 and P3 must hold before the first request).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { migrateToolScopeWordsOnce } from '../services/tool-scope-words-migration.js';
import { migrateRestScopeGatesOnce, migrateAgentReadGrantOnce } from '../services/rest-scope-gates-migration.js';
import { migrateRestScopeKeepWorkingOnce } from '../services/rest-scope-keep-working-migration.js';
import { keepStorageReadForAppsOnce } from '../services/app-storage-read-keep-migration.js';
import { keepOnDoneForAppsOnce } from '../services/app-on-done-keep-migration.js';
import { keepDatapackageReadForAppsOnce } from '../services/app-datapackage-read-keep-migration.js';
import { keepAppExtensionSchedulesOnce } from '../services/schedule-extension-keep.js';
import { keepAiScheduleReadsOnce } from '../services/schedule-ai-read.js';
import { keepExtensionFirstUseOnce } from '../services/extension-first-use-keep.js';
import { keepExtensionPublishOnce } from '../services/extension-publish-keep.js';
import { keepAppToolInvokeOnce } from '../services/app-tool-invoke-keep.js';
import { placeKnowledgeLinkOwnersOnce } from '../services/knowledge-link-owner-keep.js';
import { keepTaskContentForAppGrantsOnce } from '../services/account-event-task-keep.js';
import { flagOrphanPeerApprovalsOnce } from '../services/federation-orphan-approvals.js';

/** Run the once-only keep steps. Never throws: a failed step is logged and tried at the next start. */
export async function runOnceOnlyKeepSteps(storage: Storage, config: AimeatConfig): Promise<void> {
  // An app's extension schedule made before the kind asked ext:invoke keeps firing (services/schedule-extension-keep.ts).
  // Awaited, so the list exists before scheduler.start() (background-jobs.ts, after this function); a failure logs and boots on.
  await keepAppExtensionSchedulesOnce(storage, config)
    .catch(err => logger.error('Failed to keep the older app extension schedules; the next boot tries again', { error: String(err) }));
  // An agent's ai schedule made before a fire read for its maker keeps reading as before until its
  // input changes (services/schedule-ai-read.ts). Awaited, so the list exists before scheduler.start().
  await keepAiScheduleReadsOnce(storage, config)
    .catch(err => logger.error('Failed to keep the reads of the older agent ai schedules; the next boot tries again', { error: String(err) }));
  // The knowledge link rows written before link rows carried their owner get the namespace that holds
  // their source package (services/knowledge-link-owner-keep.ts). Awaited, so a package's links show
  // from the first request.
  await placeKnowledgeLinkOwnersOnce(storage, config)
    .catch(err => logger.error('Failed to place the older knowledge link rows; the next boot tries again', { error: String(err) }));
  // Every extension installed before the first-use rules of secaudit 2026-10 keeps the first use it
  // had (services/extension-first-use-keep.ts). Awaited, so no call meets the new rule first.
  await keepExtensionFirstUseOnce(storage, config)
    .catch(err => logger.error('Failed to keep the first use of the older extensions; the next boot tries again', { error: String(err) }));
  // An extension an agent or an app installed before its unattended runs asked the publish gate keeps
  // publishing as before until its code changes (services/extension-publish-keep.ts). Awaited, so no
  // scheduled run meets the new rule first.
  await keepExtensionPublishOnce(storage, config)
    .catch(err => logger.error('Failed to keep the publishing of the older agent-installed extensions; the next boot tries again', { error: String(err) }));
  // The MCP tool scope words of 2026-10-06 (services/tool-scope-words-migration.ts), once per node:
  // an agent approved before them keeps its workspace read tools and its send-as-owner tool.
  // Taken before the chain starts, so the third step below hands its words only to principals that
  // existed before this start, never to one made while the steps still run.
  const scopeStepsBegan = new Date().toISOString();
  // Awaited, so the kept apps hold storage:read and ext:invoke before the first request (P2, P3).
  await migrateToolScopeWordsOnce(storage, config.nodeId)
    .catch(err => logger.error('Failed to carry existing agents onto the 2026-10-06 tool scope words; the next boot tries again', { error: String(err) }))
    // The REST scope gates of 4.0.0 (services/rest-scope-gates-migration.ts), once per node: the one new
    // word goes to every agent and approved ecosystem app that could reach its routes. Chained after
    // the line above because both rewrite an agent's whole scope list.
    .then(() => migrateRestScopeGatesOnce(storage, config.nodeId))
    // agent:read, the word of the owner's agent list from 4.0.0: the second step, once, under its own record.
    .then(() => migrateAgentReadGrantOnce(storage, config.nodeId))
    // The third step, on the first start as 4.0.x only: every word the 4.0.0 gates check goes to the
    // agents and ecosystem apps that existed before, so what worked on 3.x keeps working (ruling
    // decision-4-0-x-olemassa-olevat-agentit-saavat-rest-porttien-uudet-san).
    .then(() => migrateRestScopeKeepWorkingOnce(storage, config, { existedBefore: scopeStepsBegan }))
    // storage:read for published apps that read data packages, before the /v1/pub step (app-datapackage-read-keep-migration.ts).
    .then(() => keepDatapackageReadForAppsOnce(storage, config, { existedBefore: scopeStepsBegan }))
    // storage:read for the published apps that read /v1/pub, on a node that ran the third step before
    // S3-03 gated that route (services/app-storage-read-keep-migration.ts).
    .then(() => keepStorageReadForAppsOnce(storage, config, { existedBefore: scopeStepsBegan }))
    // ext:invoke for the published apps whose AI jobs bind on_done (services/app-on-done-keep-migration.ts).
    .then(() => keepOnDoneForAppsOnce(storage, config, { existedBefore: scopeStepsBegan }))
    .catch(err => logger.error('Failed to give the REST scope gate words to existing principals; the next boot tries again', { error: String(err) }));
  // The agents and ecosystem apps that called app tools over HTTP before that route asked exchange:write
  // keep calling them (services/app-tool-invoke-keep.ts). After the chain, which it reads and does not
  // write; awaited, so no kept caller meets the refusal first.
  await keepAppToolInvokeOnce(storage, config, { existedBefore: scopeStepsBegan })
    .catch(err => logger.error('Failed to keep the earlier app-tool callers; the next boot tries again', { error: String(err) }));
  // The app grants that read task titles and decline reasons in the event record on memory:read before
  // that content asked task:read keep reading them (services/account-event-task-keep.ts). After the
  // chain, which can write words onto grants, so the kept list is the one the grants hold from now on;
  // awaited, so no kept app meets the new rule first.
  await keepTaskContentForAppGrantsOnce(storage, config, { existedBefore: scopeStepsBegan })
    .catch(err => logger.error('Failed to keep the task content reads of the earlier app grants; the next boot tries again', { error: String(err) }));
  // The approved peering requests a peer removal left standing before removal revoked them are named
  // on the Security page, and none is changed (services/federation-orphan-approvals.ts).
  await flagOrphanPeerApprovalsOnce(storage, config)
    .catch(err => logger.error('Failed to look for approved peering requests without a peer; the next boot tries again', { error: String(err) }));
}
