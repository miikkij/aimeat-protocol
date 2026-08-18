/**
 * @file src/storage/providers/sqlite/methods/internal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SqliteInternals — signatures of the private deserialize/helper methods shared across SqliteStorage method groups. Extracted from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 */
import type {
  OwnerRecord, AgentRecord, MemoryRecord, ActionRecord, WorkRecord, WalletTransaction,
  BoardRecord, BoardPostRecord, OtkRecord, DisputeRecord, MicroMemoryRecord, PeeringRequestRecord,
  GHIIRecord, PersonalNodeRecord, MailboxItemRecord, SchemaRecord, ConsentRecord, CsmRecord,
  MsmRecord, EmailVerificationRecord, FlagRecord, MatchRecord, OrganismRecord, OrganismMembershipRecord,
  JoinRequestRecord, PendingApprovalRecord, AppealRecord, ListingRecord, PurchaseRecord, TrustedIssuerRecord,
  GenesisPeerRecord, ChatInstanceRecord, RealtimeRoomRecord, ExtensionRecord, EscrowHoldRecord, BoardSubscriptionRecord,
  CortexExtensionRecord, PersonalPushSubscriptionRecord, NotificationPreferences, AppRecord, AppPurchaseRecord, SubdomainSiteRecord,
  AppGrantRecord, NotificationTemplateRecord, ScheduledJobRecord, ExtensionInstanceRecord, ReplicationQueueEntry, DeviceAuthorizationRecord,
  SystemPromptRecord, SystemPromptVersionRecord, ExecutionLogEntry, PackageRecord, TemplateListingRecord, TemplateReview,
  TemplateDiscussion, PackageInstanceRecord, CapabilityRecord, AgentOnboardingRecord
} from '../../../interface.js';

export interface SqliteInternals {
  cascadeDeleteAgentData(gaii: string): void ;
  deserializeOwner(row: Record<string, unknown>): OwnerRecord ;
  resolveGhii(identity: string): string | null ;
  deserializeAgent(row: Record<string, unknown>): AgentRecord ;
  isMemoryExpired(record: MemoryRecord): boolean ;
  deserializeMemory(row: Record<string, unknown>): MemoryRecord ;
  memoryAnnotation(value: unknown, field: '_actor' | '_event'): string | null ;
  deserializeAction(row: Record<string, unknown>): ActionRecord ;
  deserializeWork(row: Record<string, unknown>): WorkRecord ;
  deserializeTransaction(row: Record<string, unknown>): WalletTransaction ;
  deserializeBoard(row: Record<string, unknown>): BoardRecord ;
  deserializePost(row: Record<string, unknown>): BoardPostRecord ;
  deserializeBoardSubscription(row: Record<string, unknown>): BoardSubscriptionRecord ;
  deserializeOtk(row: Record<string, unknown>): OtkRecord ;
  deserializeDispute(row: Record<string, unknown>): DisputeRecord ;
  deserializeMicroMemory(row: Record<string, unknown>): MicroMemoryRecord ;
  deserializePeeringRequest(row: Record<string, unknown>): PeeringRequestRecord ;
  deserializeGHII(row: Record<string, unknown>): GHIIRecord ;
  deserializeChatInstance(row: Record<string, unknown>): ChatInstanceRecord ;
  deserializeEmailVerification(row: Record<string, unknown>): EmailVerificationRecord ;
  deserializePersonalNode(row: Record<string, unknown>): PersonalNodeRecord ;
  deserializeMailboxItem(row: Record<string, unknown>): MailboxItemRecord ;
  deserializeConsent(row: Record<string, unknown>): ConsentRecord ;
  deserializeSchema(row: Record<string, unknown>): SchemaRecord ;
  deserializeCsm(row: Record<string, unknown>): CsmRecord ;
  deserializeMsm(row: Record<string, unknown>): MsmRecord ;
  deserializeFlag(row: Record<string, unknown>): FlagRecord ;
  deserializeMatch(row: Record<string, unknown>): MatchRecord ;
  deserializeOrganism(row: Record<string, unknown>): OrganismRecord ;
  deserializeMembership(row: Record<string, unknown>): OrganismMembershipRecord ;
  deserializeJoinRequest(row: Record<string, unknown>): JoinRequestRecord ;
  deserializePendingApproval(row: Record<string, unknown>): PendingApprovalRecord ;
  deserializeAppeal(row: Record<string, unknown>): AppealRecord ;
  deserializeListing(row: Record<string, unknown>): ListingRecord ;
  deserializePurchase(row: Record<string, unknown>): PurchaseRecord ;
  deserializeTrustedIssuer(row: Record<string, unknown>): TrustedIssuerRecord ;
  deserializeGenesisPeer(row: Record<string, unknown>): GenesisPeerRecord ;
  deserializeRealtimeRoom(row: Record<string, unknown>): RealtimeRoomRecord ;
  deserializeExtension(row: Record<string, unknown>): ExtensionRecord ;
  deserializeEscrowHold(row: Record<string, unknown>): EscrowHoldRecord ;
  deserializeCortexExtension(row: Record<string, unknown>): CortexExtensionRecord ;
  deserializePersonalPushSubscription(row: Record<string, unknown>): PersonalPushSubscriptionRecord ;
  deserializeNotificationPreferences(row: Record<string, unknown>): NotificationPreferences ;
  deserializeNotificationTemplate(row: Record<string, unknown>): NotificationTemplateRecord ;
  mapSessionRow(row: Record<string, unknown>): import('../../../../storage/repositories/session.repository.js').SessionRecord ;
  mapPatRow(row: Record<string, unknown>): import('../../../../storage/repositories/pat.repository.js').PatRecord ;
  mapInvitationRow(row: Record<string, unknown>): import('../../../../storage/repositories/invitation.repository.js').InvitationRecord ;
  deserializeSubdomainSite(row: Record<string, unknown>): SubdomainSiteRecord ;
  deserializeAppGrant(row: Record<string, unknown>): AppGrantRecord ;
  deserializeApp(row: Record<string, unknown>): AppRecord ;
  deserializeAppPurchase(row: Record<string, unknown>): AppPurchaseRecord ;
  deserializeScheduledJob(row: Record<string, unknown>): ScheduledJobRecord ;
  deserializeExecutionLog(row: Record<string, unknown>): ExecutionLogEntry ;
  deserializeExtensionInstance(row: Record<string, unknown>): ExtensionInstanceRecord ;
  deserializeReplicationEntry(row: Record<string, unknown>): ReplicationQueueEntry ;
  deserializeDeviceAuth(row: Record<string, unknown>): DeviceAuthorizationRecord ;
  deserializeSystemPrompt(row: Record<string, unknown>): SystemPromptRecord ;
  deserializeSystemPromptVersion(row: Record<string, unknown>): SystemPromptVersionRecord ;
  deserializePackage(row: Record<string, unknown>): PackageRecord ;
  deserializeTemplateListing(row: Record<string, unknown>): TemplateListingRecord ;
  deserializeReview(row: Record<string, unknown>): TemplateReview ;
  deserializeDiscussion(row: Record<string, unknown>): TemplateDiscussion ;
  deserializeInstance(row: Record<string, unknown>): PackageInstanceRecord ;
  deserializeCapability(row: Record<string, unknown>): CapabilityRecord ;
  deserializeOnboarding(row: Record<string, unknown>): AgentOnboardingRecord ;
}
