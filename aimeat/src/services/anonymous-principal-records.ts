/**
 * @file src/services/anonymous-principal-records.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: what the shared anonymous principal wrote before its token was
 *   refused at those writes is named to the operator on the Security page, one incident with one entry
 *   per record, and nothing is deleted or changed.
 *
 *   WHY. Every holder of the token POST /v1/auth/anonymous mints is the same agent,
 *   `shared#anonymous@<node>` of the reserved account `anonymous`. Until 2026-10-25 that token could set
 *   the shared agent's webhook (and so receive the events addressed to every other holder), its tags and
 *   its capabilities (its public card and the agent catalogue), publish a skill under the anonymous
 *   account (aimeat_skill_publish) and publish a data package under datapkg/ (POST /v1/datapackages,
 *   aimeat_datapackage_publish). Those writes are refused now (secaudit2026oct22,
 *   routes/auth.ts:anonymous-mint:writes-outside-anonymous-namespace). A node may already hold such
 *   records. Nobody can tell from a record whether its writer meant well, so the operator decides
 *   (CLAUDE.md, Backend: anything ambiguous goes to the operator's page; developer ruling 2026-10-25).
 *
 *   WHICH RECORDS. On the shared agent's record: a webhook address, a tag list, and reported
 *   capabilities or languages (the `capabilities` list the node seeds the agent with is not one). Under
 *   the anonymous account: each published skill (its `skills.<name>.manifest` record) and each data
 *   package (its `datapkg/<name>/latest.json` pointer). One entry each.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (ANONYMOUS_PRINCIPAL_RECORDS_KEY), before the node
 *   serves (server-bootstrap/once-only-keep-steps.ts). A node with none records the run and opens no
 *   incident; a later start opens none.
 * @structure ANONYMOUS_PRINCIPAL_RECORDS_KEY · AnonymousPrincipalRecord · anonymousPrincipalRecords() ·
 *   reportAnonymousPrincipalRecordsOnce()
 * @usage await reportAnonymousPrincipalRecordsOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22; developer ruling 2026-10-25).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { ANONYMOUS_ACCOUNT } from '../auth/anonymous-principal.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { recordSecurityIncident } from './security-incident.js';

/** The record under `system@<nodeId>` that says this node has run the step. */
export const ANONYMOUS_PRINCIPAL_RECORDS_KEY = 'migrations.secaudit2026oct22.anonymous-principal-records';

/** The shared anonymous agent's name, as server-bootstrap/service-init.ts makes it. */
const ANONYMOUS_AGENT_NAME = 'shared';

/** One record the shared anonymous principal wrote outside its own namespace. */
export interface AnonymousPrincipalRecord {
  kind: 'agent_webhook' | 'agent_tags' | 'agent_capabilities' | 'skill' | 'datapackage';
  /** Where it is: the agent field, the memory key or the storage key. */
  where: string;
  /** What it is, in one line. */
  what: string;
}

/** Every record of the kinds the step names, in a fixed order: the agent's fields, skills, packages. */
export async function anonymousPrincipalRecords(storage: Storage, nodeId: string): Promise<AnonymousPrincipalRecord[]> {
  const out: AnonymousPrincipalRecord[] = [];
  const gaii = `${ANONYMOUS_AGENT_NAME}#${ANONYMOUS_ACCOUNT}@${nodeId}`;
  const agent = await storage.getAgent(gaii);
  if (agent?.webhookUrl) {
    out.push({ kind: 'agent_webhook', where: `${gaii} webhookUrl`, what: `a webhook to ${agent.webhookUrl}${agent.webhookEnabled === false ? ' (switched off)' : ''}` });
  }
  if (agent?.tags?.length) {
    out.push({ kind: 'agent_tags', where: `${gaii} tags`, what: `tags ${agent.tags.join(', ')}` });
  }
  const technical = agent?.technicalCapabilities?.length ?? 0;
  const domain = agent?.domainCapabilities?.length ?? 0;
  const languages = agent?.languages?.length ?? 0;
  if (technical || domain || languages) {
    out.push({ kind: 'agent_capabilities', where: `${gaii} capabilities`, what: `${technical} technical capabilities, ${domain} domain capabilities and ${languages} languages on its public card` });
  }
  const owner = `${ANONYMOUS_ACCOUNT}@${nodeId}`;
  for (const rec of await storage.listMemory(owner, { prefix: 'skills.' })) {
    const m = /^skills\.(.+)\.manifest$/.exec(rec.key);
    if (m) out.push({ kind: 'skill', where: rec.key, what: `the skill user:${ANONYMOUS_ACCOUNT}/${m[1]}, ${rec.visibility}` });
  }
  for (const file of await storage.listStorageFiles(owner)) {
    if (!file.key.startsWith('datapkg/') || !file.key.endsWith('/latest.json')) continue;
    const name = file.key.slice('datapkg/'.length, -'/latest.json'.length);
    out.push({ kind: 'datapackage', where: file.key, what: `the data package ${name}, ${file.visibility}` });
  }
  return out;
}

/**
 * Name what the shared anonymous principal wrote outside its namespace in one Security page
 * incident, one entry per record, and record the run. Writes nothing else. Throws when a write fails,
 * and then leaves no record, so the next start tries again.
 * @returns the records named, or null on a node that ran the step before
 */
export async function reportAnonymousPrincipalRecordsOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<AnonymousPrincipalRecord[] | null> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, ANONYMOUS_PRINCIPAL_RECORDS_KEY);
  if (!claim) return null;
  try {
    const found = await anonymousPrincipalRecords(storage, config.nodeId);
    if (found.length) {
      const list = found.map((r, i) => `${i + 1}. ${r.what} (${r.where})`).join('; ');
      await recordSecurityIncident(storage, config, {
        type: 'anonymous_principal_records',
        code: 'ANONYMOUS_PRINCIPAL_WROTE_OUTSIDE',
        actorGhii: `system@${config.nodeId}`,
        actorName: 'node',
        source: 'boot',
        detail: `${found.length} record(s) were written by the shared anonymous agent, which every holder of the anonymous token is: ${list}. `
          + 'From 2026-10-25 that token can no longer write any of these, and nothing here was changed. '
          + 'Anyone who held the token could have written them: a webhook receives the events addressed to the shared agent, '
          + 'tags and capabilities show on its public card, and a skill or a data package is read under the anonymous account. '
          + 'Check each one. A skill is removed with DELETE /v1/admin/memory/anonymous@{node}/{key} for its manifest and its files. '
          + 'Then resolve this incident.',
      });
    }
    await claim.finish({ at: new Date().toISOString(), records: found.map(r => r.where) });
    if (found.length) logger.warn(`${found.length} record(s) the shared anonymous agent wrote need the operator's review; see the Security page`);
    return found;
  } catch (err) {
    await claim.release();
    throw err;
  }
}
