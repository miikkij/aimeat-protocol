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
 * @structure OWNER_FIELDS · AGENT_FIELDS · BACKUP_OMITTED · backupOwner · backupAgent · backupMemories ·
 *   BACKUP_WITHHELD_NOTE · readableBackupMemories
 * @version-history
 *   v1.1.0 — 2026-10-25 — secaudit2026oct22: readableBackupMemories reads a delegated caller's backup
 *     records through the classification reader and names the ones it left behind.
 *   v1.0.2 — 2026-10-18 — Agent.clearance travels in a backup (migration 0107).
 *   v1.0.1 — 2026-10-11 — Agent.stoppedAt and stoppedBy travel in a backup (migration 0101).
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, finding 1.9).
 */
import type { OwnerRecord, AgentRecord, MemoryRecord } from '../storage/interface.js';
import { isSecretRecordKey, isWorkspaceShareKey } from './secret-records.js';
import { presentMemories } from './classification/present-memory.js';
import type { ContentReader } from './classification/reader.js';

/** Owner fields the backup carries. The public key is public; nothing here is a credential. */
const OWNER_FIELDS = ['name', 'displayName', 'publicKey', 'roles', 'createdAt', 'disabledAt', 'disabledBy', 'managedBy'] as const;

/** Agent fields the backup carries. No webhook URL or secret, no signed card. */
const AGENT_FIELDS = [
  'name', 'owner', 'gaii', 'displayName', 'description', 'capabilities', 'publicKey', 'trustScore',
  'morselBalance', 'createdAt', 'lastSeen', 'semantic', 'defaultScopes', 'allowedOrigins',
  'dailySpendLimit', 'scheduleConstraintDefaults', 'federate', 'technicalCapabilities',
  'domainCapabilities', 'languages', 'activityStats', 'modulesLoaded', 'agentLimitations', 'platform',
  'platformVersion', 'platformDetectedBy', 'model', 'modelDetectedBy', 'tags', 'mode',
  'maxConcurrentTasks', 'consoleUrl', 'registeredBy', 'runMode', 'taskStart', 'stoppedAt', 'stoppedBy', 'clearance', 'runtimeSource',
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

/** The line `omitted` carries when a delegated caller's backup left records behind. */
export const BACKUP_WITHHELD_NOTE =
  'Memory records this caller may not read: their classification or the caller\'s clearance keeps them out. `withheld` names each one. Take the backup in person to include them.';

/**
 * The records a delegated caller (the operator's agent holding operator:admin) may have in a backup,
 * read through the classification reader as the per-record admin route reads them, and the keys it
 * left behind. The operator in person takes the backup without this step: it is a restore file
 * (secaudit2026oct22, get-admin-backup:memory-values-without-reader-or-trail).
 */
export async function readableBackupMemories(reader: ContentReader, records: MemoryRecord[]): Promise<{ kept: MemoryRecord[]; withheld: string[] }> {
  // The stored records go into the file as they are (a restore writes them back); the reader only
  // decides which of them may.
  const shown = new Set((await presentMemories(reader, records)).map(m => m.key));
  return { kept: records.filter(m => shown.has(m.key)), withheld: records.filter(m => !shown.has(m.key)).map(m => m.key) };
}
