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
 *
 *   WHAT THE OPERATOR CAN DO. Each record is an entry of the incident (services/incident-entries.ts)
 *   with one action besides 'keep': the agent's webhook, tags and capabilities are cleared on the
 *   agent record, and a skill or a data package is deleted with its files (clearAnonymousRecord).
 *   The operator decides an entry on the Security page, with POST
 *   /v1/admin/security/incidents/:id/resolve { name, resolution }, with the MCP tool
 *   aimeat_admin_incident_resolve or with its CLI twin. Operator only.
 * @structure ANONYMOUS_PRINCIPAL_RECORDS_KEY · ANONYMOUS_RECORDS_INCIDENT_TYPE · AnonymousPrincipalRecord ·
 *   anonymousPrincipalRecords() · reportAnonymousPrincipalRecordsOnce() · clearAnonymousRecord()
 * @usage await reportAnonymousPrincipalRecordsOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.1.0 -- 2026-10-25 -- The incident carries one entry per record, and the operator clears the
 *     agent's webhook, tags and capabilities or deletes a skill or a data package from it
 *     (clearAnonymousRecord; secaudit2026oct22, developer decision 2026-10-25).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22; developer ruling 2026-10-25).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { ANONYMOUS_ACCOUNT } from '../auth/anonymous-principal.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { recordSecurityIncident, type IncidentEntry } from './security-incident.js';
import { emitChange } from './event-bus.js';
import { deleteSkill } from './skills.js';

/** The incident's type, which services/incident-decisions.ts dispatches on. */
export const ANONYMOUS_RECORDS_INCIDENT_TYPE = 'anonymous_principal_records';

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
  /** The values the Security page puts in its own sentence for the kind, in the reader's language. */
  params?: Record<string, string | number>;
}

/** The entry id of a record: the agent field's kind, or `skill:<name>` and `datapackage:<name>`. */
function entryIdOf(r: AnonymousPrincipalRecord): string {
  if (r.kind === 'skill') return `skill:${/^skills\.(.+)\.manifest$/.exec(r.where)?.[1] ?? r.where}`;
  if (r.kind === 'datapackage') return `datapackage:${r.where.slice('datapkg/'.length, -'/latest.json'.length)}`;
  return r.kind;
}

/** A record as an entry of the incident: the agent's fields are cleared, a skill or a package deleted. */
function entryOf(r: AnonymousPrincipalRecord): IncidentEntry {
  const clears = r.kind === 'agent_webhook' || r.kind === 'agent_tags' || r.kind === 'agent_capabilities';
  return { id: entryIdOf(r), kind: r.kind, where: r.where, what: r.what, ...(r.params ? { params: r.params } : {}), action: clears ? 'clear' : 'delete', status: 'open' };
}

/** Every record of the kinds the step names, in a fixed order: the agent's fields, skills, packages. */
export async function anonymousPrincipalRecords(storage: Storage, nodeId: string): Promise<AnonymousPrincipalRecord[]> {
  const out: AnonymousPrincipalRecord[] = [];
  const gaii = `${ANONYMOUS_AGENT_NAME}#${ANONYMOUS_ACCOUNT}@${nodeId}`;
  const agent = await storage.getAgent(gaii);
  if (agent?.webhookUrl) {
    out.push({ kind: 'agent_webhook', where: `${gaii} webhookUrl`, what: `a webhook to ${agent.webhookUrl}${agent.webhookEnabled === false ? ' (switched off)' : ''}`, params: { url: agent.webhookUrl } });
  }
  if (agent?.tags?.length) {
    out.push({ kind: 'agent_tags', where: `${gaii} tags`, what: `tags ${agent.tags.join(', ')}`, params: { tags: agent.tags.join(', ') } });
  }
  const technical = agent?.technicalCapabilities?.length ?? 0;
  const domain = agent?.domainCapabilities?.length ?? 0;
  const languages = agent?.languages?.length ?? 0;
  if (technical || domain || languages) {
    out.push({ kind: 'agent_capabilities', where: `${gaii} capabilities`, what: `${technical} technical capabilities, ${domain} domain capabilities and ${languages} languages on its public card`, params: { technical, domain, languages } });
  }
  const owner = `${ANONYMOUS_ACCOUNT}@${nodeId}`;
  for (const rec of await storage.listMemory(owner, { prefix: 'skills.' })) {
    const m = /^skills\.(.+)\.manifest$/.exec(rec.key);
    if (m) out.push({ kind: 'skill', where: rec.key, what: `the skill user:${ANONYMOUS_ACCOUNT}/${m[1]}, ${rec.visibility}`, params: { name: `user:${ANONYMOUS_ACCOUNT}/${m[1]}`, visibility: rec.visibility } });
  }
  for (const file of await storage.listStorageFiles(owner)) {
    if (!file.key.startsWith('datapkg/') || !file.key.endsWith('/latest.json')) continue;
    const name = file.key.slice('datapkg/'.length, -'/latest.json'.length);
    out.push({ kind: 'datapackage', where: file.key, what: `the data package ${name}, ${file.visibility}`, params: { name, visibility: file.visibility } });
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
        type: ANONYMOUS_RECORDS_INCIDENT_TYPE,
        code: 'ANONYMOUS_PRINCIPAL_WROTE_OUTSIDE',
        actorGhii: `system@${config.nodeId}`,
        actorName: 'node',
        source: 'boot',
        detail: `${found.length} record(s) were written by the shared anonymous agent, which every holder of the anonymous token is: ${list}. `
          + 'From 2026-10-25 that token can no longer write any of these, and nothing here was changed. '
          + 'Anyone who held the token could have written them: a webhook receives the events addressed to the shared agent, '
          + 'tags and capabilities show on its public card, and a skill or a data package is read under the anonymous account. '
          + 'Check each one, then clear it or keep it: on the Security page, or with POST /v1/admin/security/incidents/{id}/resolve '
          + '{ "name": "<entry id>", "resolution": "clear" | "delete" | "keep" }. The incident resolves with the last entry.',
        entries: found.map(entryOf),
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

/**
 * The offered action of one entry of the incident (services/incident-entries.ts EntryActor). The
 * agent's webhook (with its secret and delivery state), tags or capabilities and languages are set
 * back to none on the shared agent's record; a skill is deleted with its files and versions, a data
 * package with every stored file under its `datapkg/<name>/`. Returns what it did, in one line.
 */
export async function clearAnonymousRecord(storage: Storage, config: AimeatConfig, entry: IncidentEntry): Promise<string> {
  const gaii = `${ANONYMOUS_AGENT_NAME}#${ANONYMOUS_ACCOUNT}@${config.nodeId}`;
  const owner = `${ANONYMOUS_ACCOUNT}@${config.nodeId}`;
  const onAgent = async (fields: Record<string, unknown>, done: string): Promise<string> => {
    if (!(await storage.getAgent(gaii))) return 'the shared anonymous agent is gone, nothing to clear';
    // null clears a field on both providers; undefined would leave it as it is.
    await storage.updateAgent(gaii, fields as unknown as Partial<AgentRecord>);
    emitChange('agents');
    return done;
  };
  switch (entry.kind) {
    case 'agent_webhook':
      return onAgent({ webhookUrl: null, webhookSecret: null, webhookEnabled: false, webhookFailCount: 0, webhookLastSuccess: null, webhookLastFailure: null }, 'the webhook was removed');
    case 'agent_tags':
      return onAgent({ tags: [] }, 'the tags were removed');
    case 'agent_capabilities':
      return onAgent({ technicalCapabilities: [], domainCapabilities: [], languages: [] }, 'the capabilities and languages were removed from the public card');
    case 'skill': {
      const name = entry.id.slice('skill:'.length);
      const gone = await deleteSkill(storage, config, 'user', name, { owner: ANONYMOUS_ACCOUNT });
      return gone ? `the skill user:${ANONYMOUS_ACCOUNT}/${name} was deleted with its files` : 'the skill was gone already';
    }
    case 'datapackage': {
      const name = entry.id.slice('datapackage:'.length);
      const files = (await storage.listStorageFiles(owner)).filter(f => f.key.startsWith(`datapkg/${name}/`));
      for (const f of files) await storage.deleteStorageFile(owner, f.key);
      if (files.length) emitChange('files');
      return files.length ? `the data package ${name} was deleted (${files.length} file(s))` : 'the data package was gone already';
    }
    default:
      throw new Error(`An entry of kind "${entry.kind}" has no action here.`);
  }
}
