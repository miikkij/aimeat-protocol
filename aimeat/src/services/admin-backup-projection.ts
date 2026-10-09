/**
 * @file src/services/admin-backup-projection.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What GET /v1/admin/backup writes for an owner, an agent and a memory record: an
 *   allowlist of fields, never the stored row. The backup is a file that travels (the CLI `aimeat
 *   backup` writes it to disk) and an operator's agent holding operator:admin may fetch it, so a
 *   credential has no place in it.
 *
 *   ALLOWLIST, NOT DENYLIST. The route spread whole rows until 2026-10-09, and every agent's plaintext
 *   webhook signing secret was in the file (secrets audit 2026-10-09, finding 1.9). A denylist would
 *   leak the next credential column someone adds; a field added to OwnerRecord or AgentRecord stays
 *   out of the backup until it is named here.
 * @structure OWNER_FIELDS · AGENT_FIELDS · BACKUP_OMITTED · backupOwner · backupAgent · backupMemories
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, finding 1.9).
 */
import type { OwnerRecord, AgentRecord, MemoryRecord } from '../storage/interface.js';
import { isSecretRecordKey, isWorkspaceShareKey } from './secret-records.js';

/** Owner fields the backup carries. The public key is public; nothing here is a credential. */
const OWNER_FIELDS = ['name', 'displayName', 'publicKey', 'roles', 'createdAt', 'disabledAt', 'disabledBy', 'managedBy'] as const;

/** Agent fields the backup carries. No webhook URL or secret, no signed card. */
const AGENT_FIELDS = [
  'name', 'owner', 'gaii', 'displayName', 'description', 'capabilities', 'publicKey', 'trustScore',
  'morselBalance', 'createdAt', 'lastSeen', 'semantic', 'defaultScopes', 'allowedOrigins',
  'dailySpendLimit', 'scheduleConstraintDefaults', 'federate', 'technicalCapabilities',
  'domainCapabilities', 'languages', 'activityStats', 'modulesLoaded', 'agentLimitations', 'platform',
  'platformVersion', 'platformDetectedBy', 'model', 'modelDetectedBy', 'tags', 'mode',
  'maxConcurrentTasks', 'consoleUrl', 'registeredBy', 'runMode', 'taskStart', 'runtimeSource',
  'identityVersion', 'cardIssuedAt', 'enrolledAt', 'mcpClient', 'mcpLastSeen',
] as const;

/** What the backup leaves out, said in the backup itself so a restore knows what to set again. */
export const BACKUP_OMITTED = [
  'Owner and agent fields not on the backup\'s list: passwords, private keys and tokens are never stored in a backup.',
  'Agent webhook URL and signing secret (a webhook URL can carry its credential in the path). Set the webhook again after a restore.',
  'Agent signed card (cardJws). It is issued again when the agent enrols.',
  'Memory records that hold a credential (AI provider keys, payment provider settings, decide keys) and workspace share passwords.',
];

function pick<T extends object>(row: T, fields: readonly string[]): Record<string, unknown> {
  const src = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) if (src[f] !== undefined) out[f] = src[f];
  return out;
}

export function backupOwner(o: OwnerRecord): Record<string, unknown> {
  return pick(o, OWNER_FIELDS);
}

export function backupAgent(a: AgentRecord): Record<string, unknown> {
  return pick(a, AGENT_FIELDS);
}

/** An agent's memory without the records that hold a credential or a share password hash. */
export function backupMemories(records: MemoryRecord[]): MemoryRecord[] {
  return records.filter(m => !isSecretRecordKey(m.key) && !isWorkspaceShareKey(m.key));
}
