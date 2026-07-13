/**
 * @file src/storage/providers/mongodb/methods/internal.ts
 * @description PrismaInternals — signatures of the private row-mapper / helper methods shared across PrismaStorage method groups. Extracted from mongodb/index.ts to satisfy max-file-lines; implementations live in the group modules, bound via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/mongodb/index.ts (max-file-lines)
 */
import type {
  OwnerRecord, AgentRecord, MemoryRecord, ActionRecord, WorkRecord, BoardRecord, BoardPostRecord, OtkRecord, DisputeRecord, PeeringRequestRecord, GHIIRecord, ChatInstanceRecord, PersonalNodeRecord, MailboxItemRecord, SchemaRecord, ConsentRecord, CsmRecord, MsmRecord, EmailVerificationRecord, TrustedIssuerRecord, ExtensionRecord, EscrowHoldRecord, CortexExtensionRecord, PersonalPushSubscriptionRecord, AppRecord, AppPurchaseRecord, SubdomainSiteRecord, AppGrantRecord, MemoryLinkRecord, OperatorReviewRecord, ScheduledJobRecord, ExtensionInstanceRecord, DeviceAuthorizationRecord, EcosystemAppRecord, EcoAuthorizationRecord, EcoAutomationRecipe, SystemPromptRecord, SystemPromptVersionRecord, ExecutionLogEntry, PackageRecord, TemplateListingRecord, TemplateReview, TemplateDiscussion, PackageInstanceRecord, CapabilityRecord, AgentTaskRecord, AgentTaskEventRecord, AgentDirectivesRecord, OwnerAgentDefaults, SharingGroupRecord, AgentActivityRecord, AgentMessageRecord, DirectMessageRecord, ContactConsentRecord, MessageDeliveryLog, TelemetryEvent, WebhookDeliveryLog, AgentOnboardingRecord
} from '../../../interface.js';
import type { PrismaRow } from '../index.js';

export interface PrismaInternals {
  cascadeDeleteAgentData(gaii: string): Promise<void>;
  resolveGhii(identity: string): Promise<string | null>;
  buildSearchBlob(record: MemoryRecord): string;
  toBoardSubscriptionRecord(row: PrismaRow): import('../../../interface.js').BoardSubscriptionRecord;
  toOtkRecord(row: PrismaRow): OtkRecord;
  toOwnerRecord(row: PrismaRow): OwnerRecord;
  toAgentRecord(row: PrismaRow): AgentRecord;
  toMemoryRecord(row: PrismaRow): MemoryRecord;
  archivedWhere(archived?: import('../../../interface.js').ArchiveFilter): Record<string, unknown>;
  memoryAnnotation(value: unknown, field: '_actor' | '_event'): string | null;
  toActionRecord(row: PrismaRow): ActionRecord;
  toWorkRecord(row: PrismaRow): WorkRecord;
  toBoardRecord(row: PrismaRow): BoardRecord;
  toPostRecord(row: PrismaRow): BoardPostRecord;
  toDisputeRecord(row: PrismaRow): DisputeRecord;
  toPeeringRecord(row: PrismaRow): PeeringRequestRecord;
  toGHIIRecord(row: PrismaRow): GHIIRecord;
  toChatInstanceRecord(row: PrismaRow): ChatInstanceRecord;
  toPersonalNodeRecord(row: PrismaRow): PersonalNodeRecord;
  toMailboxItemRecord(row: PrismaRow): MailboxItemRecord;
  toSchemaRecord(row: PrismaRow): SchemaRecord;
  toConsentRecord(row: PrismaRow): ConsentRecord;
  toCsmRecord(row: PrismaRow): CsmRecord;
  toMsmRecord(row: PrismaRow): MsmRecord;
  toEmailVerificationRecord(row: PrismaRow): EmailVerificationRecord;
  toFlagRecord(row: PrismaRow): import('../../../interface.js').FlagRecord;
  toMatchRecord(row: PrismaRow): import('../../../interface.js').MatchRecord;
  toOrganismRecord(row: PrismaRow): import('../../../interface.js').OrganismRecord;
  toMembershipRecord(row: PrismaRow): import('../../../interface.js').OrganismMembershipRecord;
  toJoinRequestRecord(row: PrismaRow): import('../../../interface.js').JoinRequestRecord;
  toPendingApprovalRecord(row: PrismaRow): import('../../../interface.js').PendingApprovalRecord;
  toAppealRecord(row: PrismaRow): import('../../../interface.js').AppealRecord;
  toListingRecord(row: PrismaRow): import('../../../interface.js').ListingRecord;
  toPurchaseRecord(row: PrismaRow): import('../../../interface.js').PurchaseRecord;
  toTrustedIssuerRecord(row: PrismaRow): TrustedIssuerRecord;
  toGenesisPeerRecord(row: PrismaRow): import('../../../interface.js').GenesisPeerRecord;
  toExtensionRecord(row: PrismaRow): ExtensionRecord;
  toEscrowHoldRecord(row: PrismaRow): EscrowHoldRecord;
  toCortexExtensionRecord(row: PrismaRow): CortexExtensionRecord;
  toPersonalPushSubRecord(row: PrismaRow): PersonalPushSubscriptionRecord;
  ntKey(id: string, locale: string): string;
  mapPrismaSession(s: {
        sessionId: string; gaii: string; owner: string;
        issuedAt: Date | string; expiresAt: Date | string; revoked: boolean;
        refreshTokenHash?: string | null; prevTokenHash?: string | null;
        prevValidUntil?: Date | string | null; lastUsedAt?: Date | string | null;
        idleExpiresAt?: Date | string | null; absoluteExpiresAt?: Date | string | null;
        deviceLabel?: string | null; userAgent?: string | null;
    }): import('../../../../storage/repositories/session.repository.js').SessionRecord;
  mapPat(p: {
        id: string; tokenHash: string; label: string; owner: string; scopes: string[];
        grantOwner: boolean; grantOperator: boolean; readOwnerData: boolean; gaii: string;
        createdAt: Date | string; expiresAt?: Date | string | null; lastUsedAt?: Date | string | null; revoked: boolean;
    }): import('../../../../storage/repositories/pat.repository.js').PatRecord;
  toInvitationRecord(row: PrismaRow): import('../../../../storage/repositories/invitation.repository.js').InvitationRecord;
  toAppRecord(row: PrismaRow): AppRecord;
  toSubdomainSiteRecord(row: PrismaRow): SubdomainSiteRecord;
  toAppGrantRecord(row: PrismaRow): AppGrantRecord;
  toAppPurchaseRecord(row: PrismaRow): AppPurchaseRecord;
  toMemoryLinkRecord(row: PrismaRow): MemoryLinkRecord;
  toOperatorReviewRecord(row: PrismaRow): OperatorReviewRecord;
  toScheduledJobRecord(row: PrismaRow): ScheduledJobRecord;
  toExecutionLogEntry(row: PrismaRow): ExecutionLogEntry;
  toExtensionInstanceRecord(row: PrismaRow): ExtensionInstanceRecord;
  toAutomationRecipe(row: PrismaRow): EcoAutomationRecipe;
  toEcosystemAppRecord(row: PrismaRow): EcosystemAppRecord;
  toEcoAuthRecord(row: PrismaRow): EcoAuthorizationRecord;
  toDeviceAuthRecord(row: PrismaRow): DeviceAuthorizationRecord;
  toSystemPromptRecord(row: PrismaRow): SystemPromptRecord;
  toSystemPromptVersionRecord(row: PrismaRow): SystemPromptVersionRecord;
  toPackageRecord(row: PrismaRow): PackageRecord;
  toTemplateReview(row: PrismaRow): TemplateReview;
  toTemplateListingRecord(row: PrismaRow): TemplateListingRecord;
  toTemplateDiscussion(row: PrismaRow): TemplateDiscussion;
  toPackageInstanceRecord(row: PrismaRow): PackageInstanceRecord;
  toCapabilityRecord(row: PrismaRow): CapabilityRecord;
  toTaskRecord(row: PrismaRow): AgentTaskRecord;
  toTaskEventRecord(row: PrismaRow): AgentTaskEventRecord;
  toSharingGroupRecord(row: PrismaRow): SharingGroupRecord;
  toDirectivesRecord(row: PrismaRow): AgentDirectivesRecord;
  toOwnerDefaultsRecord(row: PrismaRow): OwnerAgentDefaults;
  toActivityRecord(row: PrismaRow): AgentActivityRecord;
  toMessageRecord(row: PrismaRow): AgentMessageRecord;
  dmDocId(mid: string, ownerGhii: string): string;
  contactDocId(ownerGhii: string, contactId: string): string;
  toDirectMessageRecord(row: PrismaRow): DirectMessageRecord;
  toContactRecord(row: PrismaRow): ContactConsentRecord;
  toMessageDeliveryLog(row: PrismaRow): MessageDeliveryLog;
  toOnboardingRecord(row: PrismaRow): AgentOnboardingRecord;
  toTelemetryEvent(row: PrismaRow): TelemetryEvent;
  toDeliveryLog(row: PrismaRow): WebhookDeliveryLog;
}
