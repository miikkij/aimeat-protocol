/**
 * @file src/storage/repositories/index.ts
 * @description Barrel module re-exporting every per-domain storage repository interface
 *   (owner, agent, memory, action, work, wallet, organism, app, capability, …). Provides
 *   a single import point for the repository contracts that compose the Storage interface.
 *
 * @structure
 *   - export type { …Repository }: re-exports of all domain repository interfaces
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
export type { OwnerRepository } from './owner.repository.js';
export type { AgentRepository } from './agent.repository.js';
export type { MemoryRepository } from './memory.repository.js';
export type { ActionRepository } from './action.repository.js';
export type { WorkRepository } from './work.repository.js';
export type { WalletRepository } from './wallet.repository.js';
export type { BoardRepository } from './board.repository.js';
export type { OtkRepository } from './otk.repository.js';
export type { DisputeRepository } from './dispute.repository.js';
export type { MicroMemoryRepository } from './micro-memory.repository.js';
export type { FileRepository } from './file.repository.js';
export type { IdentityRepository } from './identity.repository.js';
export type { SchemaRepository } from './schema.repository.js';
export type { ConsentRepository } from './consent.repository.js';
export type { CatalogueRepository } from './catalogue.repository.js';
export type { ModerationRepository } from './moderation.repository.js';
export type { OrganismRepository } from './organism.repository.js';
export type { MarketplaceRepository } from './marketplace.repository.js';
export type { FederationRepository } from './federation.repository.js';
export type { NodeRepository } from './node.repository.js';
export type { SessionRepository } from './session.repository.js';
export type { AppRepository } from './app.repository.js';
export type { AppMarketplaceRepository } from './app-marketplace.repository.js';
export type { SubdomainSiteRepository } from './subdomain-site.repository.js';
export type { AppGrantRepository } from './app-grant.repository.js';
export type { NotificationTemplateRepository } from './notification-template.repository.js';
export type { KnowledgeRepository } from './knowledge.repository.js';
export type { ExtensionInstanceRepository } from './extension-instance.repository.js';
export type { ReplicationQueueRepository } from './replication-queue.repository.js';
export type { DeviceAuthRepository } from './device-auth.repository.js';
export type { OAuthRepository } from './oauth.repository.js';
export type { SystemPromptRepository } from './system-prompt.repository.js';
export type { PackageRepository } from './package.repository.js';
export type { TemplateListingRepository } from './template-listing.repository.js';
export type { PackageInstanceRepository } from './package-instance.repository.js';
export type { CapabilityRepository } from './capability.repository.js';
export type { StatsRepository } from './stats.repository.js';
export type { AgentTaskRepository } from './agent-task.repository.js';
export type { AgentDirectivesRepository } from './agent-directives.repository.js';
export type { SharingGroupRepository } from './sharing-group.repository.js';
export type { AgentActivityRepository } from './agent-activity.repository.js';
export type { AgentMessageRepository } from './agent-message.repository.js';
export type { DirectMessageRepository } from './direct-message.repository.js';
export type { FeedbackRepository } from './feedback.repository.js';
export type { AgentTelemetryRepository, AgentWebhookRepository } from './agent-webhook.repository.js';
export type { AgentOnboardingRepository } from './agent-onboarding.repository.js';
