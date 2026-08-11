/**
 * @file src/storage/interface.ts
 * @description Central storage contract for the node: the record type definitions
 *   (owners, agents, memory, and every other domain entity) plus the `Storage`
 *   interface every backend (SQLite, MongoDB, PostgreSQL) must implement. Adding a
 *   data type/field here means updating all backends (see storage-sync guide).
 *
 * @structure
 *   - Re-exports of every record/value type from ./types/* (moved out to satisfy max-file-lines);
 *     each `import … from '../storage/interface.js'` still resolves unchanged
 *   - Storage interface: the full CRUD surface aggregated from the per-domain repositories
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-13 — Moved record/type declarations into ./types/* and re-exported them
 *     (max-file-lines); Storage interface + repository wiring stay here
 */

// ── Re-exported record/type declarations ───────────────────────────
// The record/type definitions were moved into ./types/* to satisfy max-file-lines.
// They are re-exported here so every existing `import … from '../storage/interface.js'`
// keeps resolving unchanged. The Storage interface itself stays below.
export * from './types/common.js';
export * from './types/identity.js';
export * from './types/auth.js';
export * from './types/commerce.js';
export * from './types/apps.js';
export * from './types/organisms-federation.js';
export * from './types/agents-messaging.js';
export * from './types/ai-provenance.js';

// ── Domain Repository Interfaces ────────────────────────────────────
import type { OwnerRepository } from './repositories/owner.repository.js';
import type { AgentRepository } from './repositories/agent.repository.js';
import type { EcosystemAppRepository } from './repositories/ecosystem-app.repository.js';
import type { MemoryRepository } from './repositories/memory.repository.js';
import type { ActionRepository } from './repositories/action.repository.js';
import type { WorkRepository } from './repositories/work.repository.js';
import type { WalletRepository } from './repositories/wallet.repository.js';
import type { BoardRepository } from './repositories/board.repository.js';
import type { OtkRepository } from './repositories/otk.repository.js';
import type { DisputeRepository } from './repositories/dispute.repository.js';
import type { MicroMemoryRepository } from './repositories/micro-memory.repository.js';
import type { FileRepository } from './repositories/file.repository.js';
import type { IdentityRepository } from './repositories/identity.repository.js';
import type { SchemaRepository } from './repositories/schema.repository.js';
import type { ConsentRepository } from './repositories/consent.repository.js';
import type { CatalogueRepository } from './repositories/catalogue.repository.js';
import type { ModerationRepository } from './repositories/moderation.repository.js';
import type { OrganismRepository } from './repositories/organism.repository.js';
import type { MarketplaceRepository } from './repositories/marketplace.repository.js';
import type { FederationRepository } from './repositories/federation.repository.js';
import type { NodeRepository } from './repositories/node.repository.js';
import type { NotificationRepository } from './repositories/notification.repository.js';
import type { AuthRepository } from './repositories/auth.repository.js';
import type { SessionRepository } from './repositories/session.repository.js';
import type { PatRepository } from './repositories/pat.repository.js';
import type { AppRepository } from './repositories/app.repository.js';
import type { AppMarketplaceRepository } from './repositories/app-marketplace.repository.js';
import type { SubdomainSiteRepository } from './repositories/subdomain-site.repository.js';
import type { AppGrantRepository } from './repositories/app-grant.repository.js';
import type { ConfigRepository } from './repositories/config.repository.js';
import type { NotificationTemplateRepository } from './repositories/notification-template.repository.js';
import type { KnowledgeRepository } from './repositories/knowledge.repository.js';
import type { SchedulerRepository } from './repositories/scheduler.repository.js';
import type { ExtensionInstanceRepository } from './repositories/extension-instance.repository.js';
import type { ReplicationQueueRepository } from './repositories/replication-queue.repository.js';
import type { DeviceAuthRepository } from './repositories/device-auth.repository.js';
import type { OAuthRepository } from './repositories/oauth.repository.js';
import type { SystemPromptRepository } from './repositories/system-prompt.repository.js';
import type { PackageRepository } from './repositories/package.repository.js';
import type { TemplateListingRepository } from './repositories/template-listing.repository.js';
import type { PackageInstanceRepository } from './repositories/package-instance.repository.js';
import type { CapabilityRepository } from './repositories/capability.repository.js';
import type { StatsRepository } from './repositories/stats.repository.js';
export type { StorageStatsSnapshot } from './repositories/stats.repository.js';
import type { AgentTaskRepository } from './repositories/agent-task.repository.js';
import type { AgentDirectivesRepository } from './repositories/agent-directives.repository.js';
import type { SharingGroupRepository } from './repositories/sharing-group.repository.js';
import type { AgentActivityRepository } from './repositories/agent-activity.repository.js';
import type { AgentUsageRepository } from './repositories/agent-usage.repository.js';
import type { AgentMessageRepository } from './repositories/agent-message.repository.js';
import type { DirectMessageRepository } from './repositories/direct-message.repository.js';
import type { AgentTelemetryRepository, AgentWebhookRepository } from './repositories/agent-webhook.repository.js';
import type { AgentOnboardingRepository } from './repositories/agent-onboarding.repository.js';
import type { InvitationRepository } from './repositories/invitation.repository.js';
import type { AiProvenanceRepository } from './repositories/ai-provenance.repository.js';
import type { ConnectionRepository } from './repositories/connection.repository.js';
import type { FinanceRepository } from './repositories/finance.repository.js';
import type { OutboundRepository } from './repositories/outbound.repository.js';
import type { CompanyRepository } from './repositories/company.repository.js';

export interface Storage extends
  OwnerRepository, AgentRepository, MemoryRepository,
  ActionRepository, WorkRepository, WalletRepository,
  BoardRepository, OtkRepository, DisputeRepository,
  MicroMemoryRepository, FileRepository, IdentityRepository,
  SchemaRepository, ConsentRepository, CatalogueRepository,
  ModerationRepository, OrganismRepository, MarketplaceRepository,
  FederationRepository, NodeRepository, NotificationRepository,
  AuthRepository, SessionRepository, PatRepository,
  AppRepository, AppMarketplaceRepository, SubdomainSiteRepository, AppGrantRepository, ConfigRepository,
  NotificationTemplateRepository,
  KnowledgeRepository, SchedulerRepository,
  ExtensionInstanceRepository, ReplicationQueueRepository,
  DeviceAuthRepository,
  EcosystemAppRepository,
  OAuthRepository, SystemPromptRepository,
  PackageRepository, TemplateListingRepository, PackageInstanceRepository,
  CapabilityRepository,
  AgentTaskRepository, AgentDirectivesRepository, SharingGroupRepository, AgentActivityRepository,
  AgentUsageRepository,
  AgentMessageRepository,
  DirectMessageRepository,
  AgentTelemetryRepository, AgentWebhookRepository,
  AgentOnboardingRepository,
  InvitationRepository,
  AiProvenanceRepository,
  ConnectionRepository,
  FinanceRepository,
  OutboundRepository,
  CompanyRepository,
  StatsRepository {
  /**
   * Run `fn` inside ONE database transaction: every storage call made underneath it commits together
   * or not at all. Binding is ambient — the ordinary `storage.setX()` calls inside `fn` join the open
   * transaction without being handed anything — so an existing multi-step operation becomes atomic by
   * being wrapped, with no change to the calls themselves.
   *
   * WHERE IT BELONGS. In the service function that owns a whole operation, which is the same place
   * REST and MCP both call. Not in a route (two doors would each need their own), and not around a
   * single write (one write is already atomic).
   *
   * THE CONTRACT, and it is load-bearing on SQLite. Inside `fn`, do storage calls and nothing else:
   * no HTTP, no file I/O, no AI calls, no long waits. SQLite runs the whole process on one connection,
   * so an open transaction is process-wide; the implementation serialises transactions and makes other
   * async writes wait, but a callback that parks on the network holds every other writer for that long.
   * Postgres takes its own pooled connection and does not have this constraint — write to the stricter
   * one, since SQLite is the desktop's only backend and the local default.
   *
   * NESTING joins rather than nests: calling `transaction()` inside an open one runs `fn` in the
   * transaction already open, so a service function is safe to call from another one.
   *
   * @example
   * await storage.transaction(async () => {
   *   await storage.debitBalance(buyer, price);
   *   await storage.createPurchase(receipt);
   *   await storage.setMemory(provenanceRecord);
   * });
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
