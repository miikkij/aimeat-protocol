/**
 * @file src/storage/providers/postgres-kysely/methods/startup-compat.ts
 * @description A few methods the server calls UNGUARDED during boot that belong to domains not yet
 *   migrated (apps, federation). Implemented here as correct-on-empty placeholders so the node boots on
 *   the Postgres+Kysely backend; each is replaced by the real implementation when its domain lands
 *   (apps slice / federation slice). They are safe: a legacy-normalisation migration is a no-op when the
 *   App table is empty, and there are no approved federation peers on a fresh node.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: boot placeholders (normalizeAppOwnerNames, mergeForkedAppBuckets, listFederationPeers).
 */
import type {
  CortexExtensionRecord,
  DisputeRecord, EscrowHoldRecord, ExtensionRecord, ExtensionInstanceRecord,
  GHIIRecord,
} from '../../../interface.js';
import type { PostgresKyselyStorage } from '../index.js';

export const startupCompatMethods = {
  // Post-listen hooks (extension scheduler warm-up) — empty until the extensions domain lands.
  async listExtensions(this: PostgresKyselyStorage): Promise<ExtensionRecord[]> { return []; },
  async listExtensionInstances(this: PostgresKyselyStorage, _extensionName: string): Promise<ExtensionInstanceRecord[]> { return []; },

  // Periodic background scans (directory index, capability aggregator, scheduler) call these on intervals;
  // their callers catch failures, but an empty result keeps the logs clean and the loops harmless until
  // the directory / actions / cortex / capabilities / scheduler domains land.
  async listGHIIs(this: PostgresKyselyStorage, _opts?: { q?: string; level?: number }): Promise<GHIIRecord[]> { return []; },
  async listCortexExtensions(this: PostgresKyselyStorage, _opts?: { status?: string; namespace?: string; visibility?: string; installedBy?: string }): Promise<CortexExtensionRecord[]> { return []; },

  // The DELETE /v1/owners/:name GDPR-export cascade lists across many domains before deleting; empty
  // until those domains (work / consent / boards / escrow / disputes) land — correct on a node with no
  // such data. Each is replaced by the real implementation with its domain slice.
  async listEscrowHolds(this: PostgresKyselyStorage, _fromGaii: string, _opts?: { status?: string }): Promise<EscrowHoldRecord[]> { return []; },
  async listAllDisputes(this: PostgresKyselyStorage, _limit?: number): Promise<DisputeRecord[]> { return []; },
};
