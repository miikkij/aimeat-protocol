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
 *   2026-10-29 -- askUncertainAccountantGrantsOnce, last: an older accountant grant whose holder the
 *     estimate cannot place is asked of the client with one press (secaudit2026oct26 round 8c).
 *   2026-10-29 -- markPlatformFeeWritersOnce, after the capability step: the platform-fee records another writer wrote are left
 *     out of the dashboard's money fees, the undecided ones named on the Security page (secaudit2026oct26 round 8c).
 *   2026-10-28 -- keepOperatorOwnAddressesOnce, after the entries step: a redirect and an operator's own
 *     app are kept as they are without a question (Jouni, 2026-10-28).
 *   2026-10-27 -- addSubdomainIncidentEntriesOnce, after the subdomain step: an open subdomain incident
 *     recorded before entries gets one per undecided address (Jouni, 2026-10-27).
 *   2026-10-27 -- settleUnknownCapabilityVisibilityOnce in its place: an unknown word is set to private and
 *     the owner is told, in place of the Security page question (developer decision 2026-10-27).
 *   2026-10-26 -- reportUnknownCapabilityVisibilityOnce, last: the capabilities stored with a visibility word
 *     the node does not know are named on the Security page, nothing changed (secaudit2026oct22; developer
 *     decision 2026-10-26; services/capability-visibility-words.ts).
 *   2026-10-25 -- reportErasureLeftoverSchedulesOnce, last: the schedules older account erasures left are
 *     named on the Security page, nothing changed (secaudit2026oct22; developer decision 2026-10-25;
 *     services/erasure-leftover-schedules.ts).
 *   2026-10-25 -- reportAnonymousPrincipalRecordsOnce, last: what the shared anonymous agent wrote outside
 *     its namespace is named on the Security page, nothing changed (secaudit2026oct22; developer ruling
 *     2026-10-25; services/anonymous-principal-records.ts).
 *   2026-10-27 -- reindexCredentialSearchTextOnce, after the share reindex: the stored credential records
 *     get a search text without their value (secaudit2026oct26; services/credential-search-reindex.ts).
 *   2026-10-25 -- reindexShareSearchTextOnce, last: the stored workspace share records get a search text
 *     without the password hash (secaudit2026oct22; services/share-search-reindex.ts).
 *   v1.2.6 -- 2026-10-25 -- classifySubdomainSiteOriginsOnce, last: the subdomain rows from before
 *     `origin` are classified on evidence, the rest named on the Security page (secaudit2026oct22;
 *     services/subdomain-site-origin-keep.ts).
 *   v1.2.5 -- 2026-10-24 -- disableMalformedExtensionRefsOnce, last: a stored extension capability whose
 *     ref names no extension action gets the operator's disable switch with a note, nothing deleted
 *     (secaudit2026oct22; services/capability-extension-ref.ts).
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
import { disableMalformedExtensionRefsOnce } from '../services/capability-extension-ref.js';
import { classifySubdomainSiteOriginsOnce, addSubdomainIncidentEntriesOnce, keepOperatorOwnAddressesOnce } from '../services/subdomain-site-origin-keep.js';
import { reindexShareSearchTextOnce } from '../services/share-search-reindex.js';
import { reindexCredentialSearchTextOnce } from '../services/credential-search-reindex.js';
import { reportAnonymousPrincipalRecordsOnce } from '../services/anonymous-principal-records.js';
import { reportErasureLeftoverSchedulesOnce } from '../services/erasure-leftover-schedules.js';
import { settleUnknownCapabilityVisibilityOnce } from '../services/capability-visibility-words.js';
import { markPlatformFeeWritersOnce } from '../commerce/platform-fee-writers.js';
import { askUncertainAccountantGrantsOnce } from '../services/finance/accountant-grant-ask.js';

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
  // A stored extension capability whose ref names no extension action gets the operator's disable
  // switch with a note, and nothing is deleted (services/capability-extension-ref.ts). Awaited, so no
  // invoke meets such a ref first.
  await disableMalformedExtensionRefsOnce(storage, config)
    .catch(err => logger.error('Failed to switch off the extension capabilities whose ref names no action; the next boot tries again', { error: String(err) }));
  // The subdomain rows from before `origin` get the origin their evidence shows; the rest are named on
  // the Security page and served as before (services/subdomain-site-origin-keep.ts). Awaited, so the
  // apex answers by the classified origin from the first request.
  await classifySubdomainSiteOriginsOnce(storage, config)
    .catch(err => logger.error('Failed to classify the older subdomain addresses; the next boot tries again', { error: String(err) }));
  // An open subdomain incident recorded before incidents carried entries gets one per address still
  // undecided, so the operator decides each with one press. After the step above, whose new incident
  // has its entries already.
  await addSubdomainIncidentEntriesOnce(storage, config)
    .catch(err => logger.error('Failed to list the undecided subdomain addresses on their incident; the next boot tries again', { error: String(err) }));
  // The undecided addresses that need no decision, a redirect and an operator's own app, are kept as
  // they are, and an incident with nothing left to decide is resolved. After the step above, so the
  // entries it marks exist.
  await keepOperatorOwnAddressesOnce(storage, config)
    .catch(err => logger.error('Failed to keep the operators\' own subdomain addresses; the next boot tries again', { error: String(err) }));
  // The workspace share records stored before the search text left out the password hash are stored
  // again, so the index holds no word of it (services/share-search-reindex.ts). Awaited, so no search
  // meets the old index first.
  await reindexShareSearchTextOnce(storage, config)
    .catch(err => logger.error('Failed to rebuild the search text of the workspace share records; the next boot tries again', { error: String(err) }));
  // The same for the credential records, whose whole value was in the search text (services/credential-search-reindex.ts).
  await reindexCredentialSearchTextOnce(storage, config)
    .catch(err => logger.error('Failed to rebuild the search text of the credential records; the next boot tries again', { error: String(err) }));
  // What the shared anonymous agent wrote outside its namespace before its token was refused there is
  // named on the Security page, one entry per record, nothing changed (services/anonymous-principal-records.ts).
  await reportAnonymousPrincipalRecordsOnce(storage, config)
    .catch(err => logger.error('Failed to look for the records the shared anonymous agent wrote; the next boot tries again', { error: String(err) }));
  // The schedules account erasures before 2026-10-25 left are named on the Security page, one entry
  // per schedule, nothing changed (services/erasure-leftover-schedules.ts).
  await reportErasureLeftoverSchedulesOnce(storage, config)
    .catch(err => logger.error('Failed to look for the schedules older account erasures left; the next boot tries again', { error: String(err) }));
  // The capabilities stored with a visibility word the node does not know are set to private, which
  // changes no reach, and each owner is told (services/capability-visibility-words.ts).
  await settleUnknownCapabilityVisibilityOnce(storage, config)
    .catch(err => logger.error('Failed to look for the capabilities with an unknown visibility word; the next boot tries again', { error: String(err) }));
  // The platform-fee records an account or an agent wrote into its own memory before the prefix was
  // service-owned are left out of the dashboard's money fees; the ones nothing decides are named on the
  // Security page (commerce/platform-fee-writers.ts). Nothing is deleted.
  await markPlatformFeeWritersOnce(storage, config)
    .catch(err => logger.error('Failed to look for the platform-fee records other writers wrote; the next boot tries again', { error: String(err) }));
  // The accountant grants from before grant times were kept, whose holder the estimate cannot place,
  // are asked of the client with one press; each works as before until answered
  // (services/finance/accountant-grant-ask.ts).
  await askUncertainAccountantGrantsOnce(storage, config)
    .catch(err => logger.error('Failed to look for the older accountant grants to ask about; the next boot tries again', { error: String(err) }));
}
