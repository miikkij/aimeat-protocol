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
  ActionRecord, CapabilityRecord, ConsentRecord, ConsentAuditEntry, CortexExtensionRecord,
  DisputeRecord, EcosystemAppRecord, EscrowHoldRecord, ExtensionRecord, ExtensionInstanceRecord,
  FederationPeerRecord, GHIIRecord, PersonalNodeRecord, ScheduledJobRecord, WorkRecord,
} from '../../../interface.js';
import type { PostgresKyselyStorage } from '../index.js';

export const startupCompatMethods = {
  // App owner-name legacy normalisation / fork-bucket merge — data migrations that are no-ops until the
  // apps domain (and any legacy rows) exist. Real impl lands with the apps slice.
  async normalizeAppOwnerNames(this: PostgresKyselyStorage): Promise<number> { return 0; },
  async mergeForkedAppBuckets(this: PostgresKyselyStorage): Promise<number> { return 0; },

  // Approved federation peers — none on a fresh node; real impl lands with the federation slice.
  async listFederationPeers(this: PostgresKyselyStorage): Promise<FederationPeerRecord[]> { return []; },

  // Post-listen hooks (extension scheduler warm-up, personal-node reconnect) — empty on a fresh node.
  // Real impls land with the extensions / personal-node slices.
  async listExtensions(this: PostgresKyselyStorage): Promise<ExtensionRecord[]> { return []; },
  async listExtensionInstances(this: PostgresKyselyStorage, _extensionName: string): Promise<ExtensionInstanceRecord[]> { return []; },
  async getPersonalNodeByOwner(this: PostgresKyselyStorage, _ownerName: string): Promise<PersonalNodeRecord | null> { return null; },

  // Periodic background scans (directory index, capability aggregator, scheduler) call these on intervals;
  // their callers catch failures, but an empty result keeps the logs clean and the loops harmless until
  // the directory / actions / cortex / capabilities / scheduler domains land.
  async listGHIIs(this: PostgresKyselyStorage, _opts?: { q?: string; level?: number }): Promise<GHIIRecord[]> { return []; },
  async listActions(this: PostgresKyselyStorage, _opts?: { search?: string; category?: string }): Promise<ActionRecord[]> { return []; },
  async listCortexExtensions(this: PostgresKyselyStorage, _opts?: { status?: string; namespace?: string; visibility?: string; installedBy?: string }): Promise<CortexExtensionRecord[]> { return []; },
  async listCapabilitiesBySourceType(this: PostgresKyselyStorage, _sourceType: string): Promise<CapabilityRecord[]> { return []; },
  async listScheduledJobs(this: PostgresKyselyStorage, _filter?: { type?: string; extensionName?: string; enabled?: boolean; ownerScope?: string; agentGaii?: string }): Promise<ScheduledJobRecord[]> { return []; },

  // Owner-scope identity resolution calls this on every owner-scoped memory op; empty until the
  // ecosystem-apps domain lands (a node with no connected ecosystem apps).
  async getEcosystemAppsByOwner(this: PostgresKyselyStorage, _owner: string): Promise<EcosystemAppRecord[]> { return []; },

  // The DELETE /v1/owners/:name GDPR-export cascade lists across many domains before deleting; empty
  // until those domains (work / consent / boards / escrow / disputes) land — correct on a node with no
  // such data. Each is replaced by the real implementation with its domain slice.
  async listWorkByProvider(this: PostgresKyselyStorage, _gaii: string): Promise<WorkRecord[]> { return []; },
  async listWorkByRequester(this: PostgresKyselyStorage, _gaii: string): Promise<WorkRecord[]> { return []; },
  async listConsents(this: PostgresKyselyStorage, _ownerGaii: string, _opts?: unknown): Promise<ConsentRecord[]> { return []; },
  async listConsentAudit(this: PostgresKyselyStorage, _ownerGaii: string, _opts?: unknown): Promise<ConsentAuditEntry[]> { return []; },
  async listEscrowHolds(this: PostgresKyselyStorage, _fromGaii: string, _opts?: { status?: string }): Promise<EscrowHoldRecord[]> { return []; },
  async listAllDisputes(this: PostgresKyselyStorage, _limit?: number): Promise<DisputeRecord[]> { return []; },
};
