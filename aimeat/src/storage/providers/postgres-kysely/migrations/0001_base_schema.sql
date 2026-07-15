-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "publicKey" TEXT NOT NULL,
    "roles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "gaii" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "capabilities" TEXT[],
    "publicKey" TEXT NOT NULL,
    "trustScore" INTEGER NOT NULL DEFAULT 50,
    "morselBalance" INTEGER NOT NULL DEFAULT 0,
    "dailySpendLimit" INTEGER,
    "allowedOrigins" TEXT[],
    "defaultScopes" TEXT[],
    "federate" BOOLEAN NOT NULL DEFAULT false,
    "technicalCapabilities" JSONB,
    "domainCapabilities" JSONB,
    "activityStats" JSONB,
    "modulesLoaded" JSONB,
    "agentLimitations" JSONB,
    "languages" JSONB,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "webhookEnabled" BOOLEAN NOT NULL DEFAULT false,
    "webhookLastSuccess" TIMESTAMP(3),
    "webhookLastFailure" TIMESTAMP(3),
    "webhookFailCount" INTEGER NOT NULL DEFAULT 0,
    "platform" TEXT,
    "platformVersion" TEXT,
    "mode" TEXT,
    "maxConcurrentTasks" INTEGER NOT NULL DEFAULT 1,
    "scheduleConstraintDefaults" JSONB,
    "platformDetectedBy" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ownerGaii" TEXT NOT NULL,
    "value" JSONB,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "tags" TEXT[],
    "ttlHours" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 1,
    "flagCount" INTEGER NOT NULL DEFAULT 0,
    "allowedOrigins" TEXT[],
    "groupId" TEXT,
    "workspaceRef" TEXT,
    "searchBlob" TEXT,
    "trackable" BOOLEAN NOT NULL DEFAULT false,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "archivedRoot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryVersion" (
    "id" TEXT NOT NULL,
    "ownerGaii" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB,
    "actor" TEXT,
    "event" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "providerGaii" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "pricingBaseMorsels" INTEGER NOT NULL,
    "pricingPerUnit" JSONB,
    "estimatedTimeSeconds" INTEGER,
    "maxInputSizeBytes" INTEGER,
    "tags" TEXT[],
    "webhookUrl" TEXT,
    "semantic" JSONB,
    "federate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Work" (
    "id" TEXT NOT NULL,
    "trackingCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "providerGaii" TEXT NOT NULL,
    "requesterGaii" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "costBasePrice" INTEGER NOT NULL,
    "costNetworkFee" INTEGER NOT NULL,
    "costTotal" INTEGER NOT NULL,
    "costInEscrow" INTEGER NOT NULL,
    "ttlExpiresAt" TIMESTAMP(3) NOT NULL,
    "callbackUrl" TEXT,
    "ratingScore" INTEGER,
    "ratingComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Work_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "gaii" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "counterpartyGaii" TEXT,
    "trackingCode" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" TEXT NOT NULL,
    "ownerGaii" TEXT NOT NULL,
    "allowedGaiis" TEXT[],
    "federate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardPost" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "authorGaii" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "tags" TEXT[],
    "ttlExpiresAt" TIMESTAMP(3),
    "reactions" JSONB NOT NULL DEFAULT '{}',
    "replyTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Otk" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ownerGaii" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Otk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "trackingCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "openedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ruling" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeAudit" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "previousHash" TEXT NOT NULL,

    CONSTRAINT "DisputeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MicroMemory" (
    "id" TEXT NOT NULL,
    "gaii" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "entries" JSONB NOT NULL,
    "visibility" TEXT NOT NULL,
    "accessCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MicroMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageFile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ownerGaii" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "federate" BOOLEAN NOT NULL DEFAULT false,
    "groupId" TEXT,
    "workspaceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeeringRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromNodeUrl" TEXT NOT NULL,
    "fromNodeId" TEXT,
    "toNodeId" TEXT,
    "targetUrl" TEXT,
    "publicKey" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeeringRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeKey" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,

    CONSTRAINT "NodeKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RealtimeRoom" (
    "id" TEXT NOT NULL,
    "appType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "maxPeers" INTEGER NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[],
    "peerCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealtimeRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteChangeLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ghii" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "ghii" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "avatar" TEXT,
    "locale" TEXT,
    "passwordHash" TEXT,
    "verificationLevel" INTEGER NOT NULL DEFAULT 0,
    "ownerName" TEXT NOT NULL,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpBackupCodes" TEXT[],
    "totpLastUsedAt" TEXT,
    "totpLastUsedCode" TEXT,
    "totpFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "totpLockedUntil" TEXT,
    "emailHash" TEXT,
    "emailVerifiedAt" TEXT,
    "notificationEmail" TEXT,
    "verificationMethod" TEXT,
    "magicLinkEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TEXT,
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "verifiedAttributes" TEXT[],
    "verificationIssuer" TEXT,
    "verificationCredentialHash" TEXT,
    "ftnVerified" BOOLEAN NOT NULL DEFAULT false,
    "googleSub" TEXT,
    "externalIdentities" JSONB,
    "trustScore" INTEGER,
    "morselBalance" INTEGER,
    "allowedOrigins" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ghii_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Extension" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "requiredApis" TEXT[],
    "actions" JSONB NOT NULL,
    "config" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "federation" JSONB NOT NULL,
    "instances" JSONB,
    "installedBy" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Extension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtensionInstance" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "extensionName" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "translations" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdByAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtensionInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscrowHold" (
    "id" TEXT NOT NULL,
    "holdId" TEXT NOT NULL,
    "fromGaii" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'held',
    "extensionName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedTo" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscrowHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "placeholders" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardSubscription" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "gaii" TEXT NOT NULL,
    "callbackUrl" TEXT,
    "filters" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalNode" (
    "id" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "anchorNodeId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "agentGaiis" TEXT[],
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mailboxQuotaBytes" INTEGER NOT NULL,
    "mailboxUsedBytes" INTEGER NOT NULL DEFAULT 0,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxItem" (
    "id" TEXT NOT NULL,
    "personalNodeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromGaii" TEXT NOT NULL,
    "toGaii" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatInstance" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "ghii" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentGaii" TEXT,
    "mcpClientId" TEXT,

    CONSTRAINT "ChatInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchemaLock" (
    "id" TEXT NOT NULL,
    "keyPattern" TEXT NOT NULL,
    "applyTo" TEXT NOT NULL,
    "schemaJson" JSONB NOT NULL,
    "schemaMode" TEXT NOT NULL DEFAULT 'open',
    "lockedBy" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "semanticContext" JSONB,

    CONSTRAINT "SchemaLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "ownerGaii" TEXT NOT NULL,
    "dataPattern" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expires" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentAudit" (
    "id" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "ownerGaii" TEXT NOT NULL,
    "accessorGaii" TEXT NOT NULL,
    "memoryKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allowed" BOOLEAN NOT NULL,

    CONSTRAINT "ConsentAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Csm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "jsonSchemaKey" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "registeredBy" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "semantic" JSONB,
    "federate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Csm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Msm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "category" TEXT NOT NULL,
    "authType" TEXT NOT NULL,
    "actionsCount" INTEGER NOT NULL,
    "registeredBy" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "federate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Msm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flag" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "flaggedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "profileA" TEXT NOT NULL,
    "profileB" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "notifiedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organism" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "location" JSONB,
    "interests" TEXT[],
    "creatorGhii" TEXT NOT NULL,
    "admins" TEXT[],
    "members" TEXT[],
    "agentGaiis" TEXT[],
    "boardId" TEXT NOT NULL,
    "joinPolicy" TEXT NOT NULL DEFAULT 'open',
    "maxMembers" INTEGER NOT NULL DEFAULT 100,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "memberVisibility" TEXT,
    "moderationConfig" JSONB NOT NULL,
    "memoryNamespace" TEXT NOT NULL,
    "semantic" JSONB,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organism_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganismMembership" (
    "id" TEXT NOT NULL,
    "organismId" TEXT NOT NULL,
    "ghii" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedBy" TEXT,

    CONSTRAINT "OrganismMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JoinRequest" (
    "id" TEXT NOT NULL,
    "organismId" TEXT NOT NULL,
    "ghii" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "JoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingApproval" (
    "id" TEXT NOT NULL,
    "organismId" TEXT NOT NULL,
    "flowGateId" TEXT,
    "stageId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "arguments" JSONB,
    "risk" TEXT NOT NULL DEFAULT 'medium',
    "approverRole" TEXT NOT NULL DEFAULT 'owner',
    "prompt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" TEXT NOT NULL,
    "flagId" TEXT NOT NULL,
    "appealedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "sellerGhii" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priceMorsels" INTEGER NOT NULL,
    "condition" TEXT,
    "availability" TEXT,
    "location" JSONB,
    "tags" TEXT[],
    "images" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "memoryKey" TEXT NOT NULL,
    "flagCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "semantic" JSONB,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerOwner" TEXT NOT NULL,
    "sellerOwner" TEXT NOT NULL,
    "priceMorsels" INTEGER NOT NULL,
    "transactionFeeMorsels" INTEGER NOT NULL,
    "totalCostMorsels" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_delivery',
    "ratingScore" INTEGER,
    "ratingComment" TEXT,
    "trackingCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedIssuer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "trusted" BOOLEAN NOT NULL DEFAULT true,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedIssuer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationNonce" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenesisPeer" (
    "id" TEXT NOT NULL,
    "genesisNodeId" TEXT NOT NULL,
    "genesisUrl" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "catalogueHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenesisPeer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederationPeer" (
    "nodeId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shareCatalogue" BOOLEAN NOT NULL DEFAULT true,
    "replicateMemory" BOOLEAN NOT NULL DEFAULT true,
    "allowRouting" BOOLEAN NOT NULL DEFAULT true,
    "peerMode" TEXT NOT NULL DEFAULT 'federation',
    "allowFederatedAuth" BOOLEAN NOT NULL DEFAULT false,
    "federationAuthScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tier" TEXT NOT NULL DEFAULT 'member',
    "availability" TEXT,
    "expiresAt" TIMESTAMP(3),
    "heartbeatOk" INTEGER NOT NULL DEFAULT 0,
    "heartbeatTotal" INTEGER NOT NULL DEFAULT 0,
    "availabilityWindow" TEXT,
    "availabilityPct" INTEGER,
    "softwareVersion" TEXT,
    "nodeCardHash" TEXT,

    CONSTRAINT "FederationPeer_pkey" PRIMARY KEY ("nodeId")
);

-- CreateTable
CREATE TABLE "OrganismReputation" (
    "id" TEXT NOT NULL,
    "organismId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganismReputation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CortexExtension" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "license" TEXT,
    "tags" TEXT[],
    "labels" JSONB NOT NULL,
    "aimeatCompat" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "installedBy" TEXT NOT NULL,
    "manifest" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "activationArtifacts" JSONB NOT NULL,

    CONSTRAINT "CortexExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CortexLibFile" (
    "id" TEXT NOT NULL,
    "extName" TEXT NOT NULL,
    "libName" TEXT NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "CortexLibFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalPushSubscription" (
    "id" TEXT NOT NULL,
    "personalNodeId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PersonalPushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "personalNodeId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "channels" TEXT[],
    "notifyTypes" TEXT[],
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 5,
    "quietHoursUtc" JSONB,
    "email" TEXT,
    "locale" TEXT,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "gaii" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "refreshTokenHash" TEXT,
    "prevTokenHash" TEXT,
    "prevValidUntil" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "idleExpiresAt" TIMESTAMP(3),
    "absoluteExpiresAt" TIMESTAMP(3),
    "deviceLabel" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalAccessToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "scopes" TEXT[],
    "grantOwner" BOOLEAN NOT NULL DEFAULT false,
    "grantOperator" BOOLEAN NOT NULL DEFAULT false,
    "readOwnerData" BOOLEAN NOT NULL DEFAULT false,
    "gaii" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PersonalAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "organismId" TEXT NOT NULL,
    "orgRole" TEXT NOT NULL DEFAULT 'member',
    "type" TEXT NOT NULL DEFAULT 'link',
    "workspaces" JSONB NOT NULL,
    "email" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "provisionedOwner" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevokedToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" INTEGER NOT NULL,

    CONSTRAINT "RevokedToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL,
    "ownerGaii" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "accessCode" TEXT,
    "parked" BOOLEAN NOT NULL DEFAULT false,
    "forkable" BOOLEAN NOT NULL DEFAULT false,
    "operatorHidden" BOOLEAN NOT NULL DEFAULT false,
    "operatorHiddenBy" TEXT,
    "operatorHiddenAt" TIMESTAMP(3),
    "operatorHideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppDownload" (
    "id" TEXT NOT NULL,
    "ownerGaii" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AppDownload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppDraft" (
    "id" TEXT NOT NULL,
    "ownerGaii" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppFork" (
    "id" TEXT NOT NULL,
    "sourceOwnerGaii" TEXT NOT NULL,
    "sourceOwnerName" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "childOwnerGaii" TEXT NOT NULL,
    "childOwnerName" TEXT NOT NULL,
    "childFilename" TEXT NOT NULL,
    "forkedByGaii" TEXT NOT NULL,
    "forkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppFork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppPurchase" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "buyerGaii" TEXT NOT NULL,
    "buyerOwner" TEXT NOT NULL,
    "sellerGaii" TEXT NOT NULL,
    "sellerOwner" TEXT NOT NULL,
    "appFilename" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "appVersionNumber" INTEGER NOT NULL,
    "licenseType" TEXT NOT NULL,
    "priceMorsels" INTEGER NOT NULL,
    "transactionFeeMorsels" INTEGER NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appContent" TEXT NOT NULL,
    "appManifest" JSONB NOT NULL,
    "appScreenshot" TEXT,
    "signature" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodePublicKey" TEXT NOT NULL,

    CONSTRAINT "AppPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeLink" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedBy" TEXT NOT NULL,

    CONSTRAINT "KnowledgeLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeReview" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "operatorGaii" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "customText" TEXT,
    "action" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "extensionName" TEXT,
    "instanceId" TEXT,
    "actionId" TEXT,
    "coreHandler" TEXT,
    "cron" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "input" JSONB,
    "lastRunAt" TIMESTAMP(3),
    "lastRunResult" TEXT,
    "lastRunError" TEXT,
    "lastRunDurationMs" INTEGER,
    "nextRunAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerScope" TEXT,
    "agentName" TEXT,
    "agentGaii" TEXT,
    "createdByAgent" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "description" TEXT,
    "purpose" TEXT,
    "timezone" TEXT,
    "constraints" JSONB,
    "runCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionLog" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "extensionName" TEXT,
    "actionId" TEXT,
    "trigger" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "errorMessage" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "memoryReads" JSONB NOT NULL DEFAULT '[]',
    "memoryWrites" JSONB NOT NULL DEFAULT '[]',
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAuth" (
    "id" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastPolledAt" TIMESTAMP(3),
    "pollInterval" INTEGER NOT NULL DEFAULT 5,
    "approvedBy" TEXT,
    "agentCredentials" JSONB,
    "mode" TEXT,

    CONSTRAINT "DeviceAuth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcosystemApp" (
    "id" TEXT NOT NULL,
    "geai" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "publicKey" TEXT NOT NULL,
    "scopes" TEXT[],
    "dataAreas" JSONB,
    "boundRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "morselBalance" INTEGER NOT NULL DEFAULT 0,
    "capabilities" JSONB,
    "automation" JSONB,
    "setup" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcosystemApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcoAuth" (
    "id" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "publicKey" TEXT,
    "scopes" TEXT[],
    "dataAreas" JSONB,
    "boundRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastPolledAt" TIMESTAMP(3),
    "pollInterval" INTEGER NOT NULL DEFAULT 5,
    "approvedBy" TEXT,
    "validationResult" JSONB,
    "capabilities" JSONB,
    "automation" JSONB,
    "setup" JSONB,
    "appCredentials" JSONB,

    CONSTRAINT "EcoAuth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcoAutomationRecipe" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "trigger" JSONB NOT NULL,
    "agents" JSONB NOT NULL,
    "organism" TEXT,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "requireApproval" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcoAutomationRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthRefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "gaii" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "roles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthApproval" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "gaii" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'aimeat:full',
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemPrompt" (
    "id" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "locales" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "variables" TEXT[],
    "usedIn" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "SystemPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemPromptVersion" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "locales" JSONB,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changeNote" TEXT,

    CONSTRAINT "SystemPromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "packageGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorGhii" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "changelog" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'other',
    "tags" TEXT[],
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "components" JSONB NOT NULL,
    "manifest" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateListing" (
    "id" TEXT NOT NULL,
    "packageGroupId" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "packageAuthor" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "publishedByGhii" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "screenshots" TEXT[],
    "category" TEXT NOT NULL DEFAULT 'other',
    "tags" TEXT[],
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "installCount" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'listed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rejectionReason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "proposedAt" TIMESTAMP(3),
    "proposedBy" TEXT,

    CONSTRAINT "TemplateListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateReview" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "authorGhii" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateDiscussion" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "authorGhii" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateDiscussion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageInstance" (
    "id" TEXT NOT NULL,
    "packageGroupId" TEXT NOT NULL,
    "packageVersion" TEXT NOT NULL,
    "packageRecordId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "ownerGhii" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "installedComponents" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'installed',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Capability" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "ownerGhii" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "scope" TEXT NOT NULL DEFAULT 'local',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rejectionReason" TEXT,
    "deprecationMessage" TEXT,
    "replacedBy" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL DEFAULT '',
    "authRequired" TEXT NOT NULL DEFAULT 'registered',
    "callable" BOOLEAN NOT NULL DEFAULT false,
    "inputSchema" JSONB,
    "outputSchema" JSONB,
    "exports" JSONB,
    "usage" TEXT NOT NULL DEFAULT '',
    "whenToUse" TEXT NOT NULL DEFAULT '',
    "whenNotToUse" TEXT NOT NULL DEFAULT '',
    "examples" JSONB NOT NULL DEFAULT '[]',
    "dependencies" JSONB NOT NULL DEFAULT '[]',
    "schemaHash" TEXT NOT NULL DEFAULT '',
    "webhookUrl" TEXT,
    "cost" JSONB,
    "trustRequired" DOUBLE PRECISION,
    "trust" JSONB NOT NULL,
    "redactedFields" JSONB NOT NULL DEFAULT '[]',
    "operatorOverride" JSONB,
    "stats" JSONB NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Capability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityLog" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "callerGhii" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityVouch" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "userGhii" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityVouch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplicationQueue" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetPeers" TEXT[],
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "ReplicationQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatsCounter" (
    "id" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StatsCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatsDailyHistory" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StatsDailyHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "agentGaii" TEXT NOT NULL,
    "ownerGaii" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "scope" JSONB NOT NULL DEFAULT '[]',
    "rules" JSONB NOT NULL DEFAULT '[]',
    "verification" JSONB NOT NULL DEFAULT '{}',
    "resources" JSONB,
    "todos" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "parentTaskId" TEXT,
    "workTrackingCode" TEXT,
    "telemetry" JSONB,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "deliverableKey" TEXT,
    "rating" JSONB,
    "triage" TEXT,
    "automation" JSONB,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDirective" (
    "id" TEXT NOT NULL,
    "agentGaii" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "rules" JSONB NOT NULL DEFAULT '[]',
    "memoryAreas" JSONB NOT NULL DEFAULT '[]',
    "resources" JSONB NOT NULL DEFAULT '[]',
    "budgetLimits" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentDirective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerAgentDefault" (
    "id" TEXT NOT NULL,
    "ownerGaii" TEXT NOT NULL,
    "rules" JSONB NOT NULL DEFAULT '[]',
    "defaultTokenBudget" INTEGER,
    "defaultMemoryAreas" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerAgentDefault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharingGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerGaii" TEXT NOT NULL,
    "members" JSONB NOT NULL DEFAULT '[]',
    "defaultPermissions" JSONB NOT NULL DEFAULT '{"read":true,"write":false}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentActivity" (
    "id" TEXT NOT NULL,
    "agentGaii" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "metric" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AgentActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentUsageEvent" (
    "id" TEXT NOT NULL,
    "ts" TEXT NOT NULL,
    "agentGaii" TEXT NOT NULL,
    "ownerGhii" TEXT NOT NULL,
    "runId" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION,
    "priceRef" TEXT,
    "source" TEXT NOT NULL,
    "apiKeyScope" TEXT NOT NULL DEFAULT 'own',
    "organismId" TEXT,
    "workspaceId" TEXT,
    "capabilityId" TEXT,
    "consumerGhii" TEXT,

    CONSTRAINT "AgentUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentUsageDaily" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "agentGaii" TEXT NOT NULL,
    "ownerGhii" TEXT NOT NULL,
    "apiKeyScope" TEXT NOT NULL DEFAULT 'own',
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "organismId" TEXT NOT NULL DEFAULT '',
    "workspaceId" TEXT NOT NULL DEFAULT '',
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "unpricedCalls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AgentUsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryEvent" (
    "id" TEXT NOT NULL,
    "agentGaii" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "sessionId" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDeliveryLog" (
    "id" TEXT NOT NULL,
    "agentGaii" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "errorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentOnboarding" (
    "id" TEXT NOT NULL,
    "agentGaii" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "steps" JSONB NOT NULL DEFAULT '[]',
    "readinessScore" INTEGER,
    "readinessLevel" TEXT,
    "detectedPlatform" TEXT,
    "installedRuntime" TEXT,
    "onboardingBaseline" INTEGER,
    "operationalHealth" DOUBLE PRECISION,
    "healthComponents" JSONB,
    "healthRecalculatedAt" TIMESTAMP(3),
    "readinessOverride" JSONB,

    CONSTRAINT "AgentOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubdomainSite" (
    "id" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubdomainSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppGrant" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "appOrigin" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "gaii" TEXT NOT NULL,
    "scopes" TEXT[],
    "refreshTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AppGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "agentGaii" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "senderGaii" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "linkedTaskId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectMessage" (
    "id" TEXT NOT NULL,
    "mid" TEXT NOT NULL,
    "ownerGhii" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "subject" TEXT,
    "senderGhii" TEXT NOT NULL,
    "recipientGhii" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "attachments" JSONB,
    "interactive" JSONB,
    "broadcastId" TEXT,
    "respondable" BOOLEAN,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "direction" TEXT NOT NULL,
    "replyToId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'local',
    "originNodeId" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),

    CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactConsent" (
    "id" TEXT NOT NULL,
    "ownerGhii" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "firstMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageDeliveryLog" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "errorMessage" TEXT,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Owner_name_key" ON "Owner"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_gaii_key" ON "Agent"("gaii");

-- CreateIndex
CREATE INDEX "Agent_owner_idx" ON "Agent"("owner");

-- CreateIndex
CREATE INDEX "Memory_ownerGaii_idx" ON "Memory"("ownerGaii");

-- CreateIndex
CREATE INDEX "Memory_archived_key_idx" ON "Memory"("archived", "key");

-- CreateIndex
CREATE INDEX "Memory_archivedRoot_idx" ON "Memory"("archivedRoot");

-- CreateIndex
CREATE INDEX "Memory_key_idx" ON "Memory"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Memory_ownerGaii_key_key" ON "Memory"("ownerGaii", "key");

-- CreateIndex
CREATE INDEX "MemoryVersion_ownerGaii_key_idx" ON "MemoryVersion"("ownerGaii", "key");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryVersion_ownerGaii_key_version_key" ON "MemoryVersion"("ownerGaii", "key", "version");

-- CreateIndex
CREATE INDEX "Action_providerGaii_idx" ON "Action"("providerGaii");

-- CreateIndex
CREATE INDEX "Action_category_idx" ON "Action"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Action_actionId_providerGaii_key" ON "Action"("actionId", "providerGaii");

-- CreateIndex
CREATE UNIQUE INDEX "Work_trackingCode_key" ON "Work"("trackingCode");

-- CreateIndex
CREATE INDEX "Work_providerGaii_status_idx" ON "Work"("providerGaii", "status");

-- CreateIndex
CREATE INDEX "Work_requesterGaii_idx" ON "Work"("requesterGaii");

-- CreateIndex
CREATE INDEX "Transaction_gaii_idx" ON "Transaction"("gaii");

-- CreateIndex
CREATE UNIQUE INDEX "Board_boardId_key" ON "Board"("boardId");

-- CreateIndex
CREATE INDEX "Board_ownerGaii_idx" ON "Board"("ownerGaii");

-- CreateIndex
CREATE UNIQUE INDEX "BoardPost_postId_key" ON "BoardPost"("postId");

-- CreateIndex
CREATE INDEX "BoardPost_boardId_idx" ON "BoardPost"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "Otk_key_key" ON "Otk"("key");

-- CreateIndex
CREATE INDEX "Otk_expiresAt_idx" ON "Otk"("expiresAt");

-- CreateIndex
CREATE INDEX "Otk_sessionId_idx" ON "Otk"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_disputeId_key" ON "Dispute"("disputeId");

-- CreateIndex
CREATE INDEX "Dispute_trackingCode_idx" ON "Dispute"("trackingCode");

-- CreateIndex
CREATE INDEX "DisputeAudit_disputeId_idx" ON "DisputeAudit"("disputeId");

-- CreateIndex
CREATE UNIQUE INDEX "MicroMemory_gaii_setName_key" ON "MicroMemory"("gaii", "setName");

-- CreateIndex
CREATE UNIQUE INDEX "StorageFile_ownerGaii_key_key" ON "StorageFile"("ownerGaii", "key");

-- CreateIndex
CREATE UNIQUE INDEX "PeeringRequest_requestId_key" ON "PeeringRequest"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Ghii_ghii_key" ON "Ghii"("ghii");

-- CreateIndex
CREATE INDEX "Ghii_ownerName_idx" ON "Ghii"("ownerName");

-- CreateIndex
CREATE INDEX "Ghii_emailHash_idx" ON "Ghii"("emailHash");

-- CreateIndex
CREATE INDEX "Ghii_googleSub_idx" ON "Ghii"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "Extension_name_key" ON "Extension"("name");

-- CreateIndex
CREATE INDEX "ExtensionInstance_extensionName_idx" ON "ExtensionInstance"("extensionName");

-- CreateIndex
CREATE UNIQUE INDEX "ExtensionInstance_extensionName_instanceId_key" ON "ExtensionInstance"("extensionName", "instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "EscrowHold_holdId_key" ON "EscrowHold"("holdId");

-- CreateIndex
CREATE INDEX "EscrowHold_fromGaii_idx" ON "EscrowHold"("fromGaii");

-- CreateIndex
CREATE INDEX "EscrowHold_status_idx" ON "EscrowHold"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_ownerName_key" ON "PushSubscription"("ownerName");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_templateId_locale_key" ON "NotificationTemplate"("templateId", "locale");

-- CreateIndex
CREATE INDEX "BoardSubscription_boardId_idx" ON "BoardSubscription"("boardId");

-- CreateIndex
CREATE INDEX "BoardSubscription_gaii_idx" ON "BoardSubscription"("gaii");

-- CreateIndex
CREATE UNIQUE INDEX "BoardSubscription_boardId_gaii_key" ON "BoardSubscription"("boardId", "gaii");

-- CreateIndex
CREATE INDEX "PersonalNode_ownerName_idx" ON "PersonalNode"("ownerName");

-- CreateIndex
CREATE INDEX "MailboxItem_personalNodeId_idx" ON "MailboxItem"("personalNodeId");

-- CreateIndex
CREATE INDEX "MailboxItem_expiresAt_idx" ON "MailboxItem"("expiresAt");

-- CreateIndex
CREATE INDEX "ChatInstance_ownerName_idx" ON "ChatInstance"("ownerName");

-- CreateIndex
CREATE INDEX "ChatInstance_ghii_idx" ON "ChatInstance"("ghii");

-- CreateIndex
CREATE INDEX "ChatInstance_agentGaii_idx" ON "ChatInstance"("agentGaii");

-- CreateIndex
CREATE UNIQUE INDEX "SchemaLock_applyTo_keyPattern_key" ON "SchemaLock"("applyTo", "keyPattern");

-- CreateIndex
CREATE INDEX "Consent_ownerGaii_idx" ON "Consent"("ownerGaii");

-- CreateIndex
CREATE INDEX "Consent_ownerGaii_status_idx" ON "Consent"("ownerGaii", "status");

-- CreateIndex
CREATE INDEX "ConsentAudit_ownerGaii_idx" ON "ConsentAudit"("ownerGaii");

-- CreateIndex
CREATE INDEX "ConsentAudit_consentId_idx" ON "ConsentAudit"("consentId");

-- CreateIndex
CREATE UNIQUE INDEX "Csm_name_key" ON "Csm"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Msm_name_key" ON "Msm"("name");

-- CreateIndex
CREATE INDEX "EmailVerification_ownerName_purpose_status_idx" ON "EmailVerification"("ownerName", "purpose", "status");

-- CreateIndex
CREATE INDEX "EmailVerification_expiresAt_idx" ON "EmailVerification"("expiresAt");

-- CreateIndex
CREATE INDEX "Flag_targetType_targetId_idx" ON "Flag"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Flag_status_idx" ON "Flag"("status");

-- CreateIndex
CREATE INDEX "Match_profileA_idx" ON "Match"("profileA");

-- CreateIndex
CREATE INDEX "Match_profileB_idx" ON "Match"("profileB");

-- CreateIndex
CREATE INDEX "Match_expiresAt_idx" ON "Match"("expiresAt");

-- CreateIndex
CREATE INDEX "Organism_creatorGhii_idx" ON "Organism"("creatorGhii");

-- CreateIndex
CREATE INDEX "Organism_visibility_idx" ON "Organism"("visibility");

-- CreateIndex
CREATE INDEX "OrganismMembership_organismId_idx" ON "OrganismMembership"("organismId");

-- CreateIndex
CREATE INDEX "OrganismMembership_ghii_idx" ON "OrganismMembership"("ghii");

-- CreateIndex
CREATE UNIQUE INDEX "OrganismMembership_organismId_ghii_key" ON "OrganismMembership"("organismId", "ghii");

-- CreateIndex
CREATE INDEX "JoinRequest_organismId_idx" ON "JoinRequest"("organismId");

-- CreateIndex
CREATE INDEX "JoinRequest_organismId_status_idx" ON "JoinRequest"("organismId", "status");

-- CreateIndex
CREATE INDEX "PendingApproval_organismId_idx" ON "PendingApproval"("organismId");

-- CreateIndex
CREATE INDEX "PendingApproval_organismId_status_idx" ON "PendingApproval"("organismId", "status");

-- CreateIndex
CREATE INDEX "Appeal_flagId_idx" ON "Appeal"("flagId");

-- CreateIndex
CREATE INDEX "Appeal_status_idx" ON "Appeal"("status");

-- CreateIndex
CREATE INDEX "Listing_category_idx" ON "Listing"("category");

-- CreateIndex
CREATE INDEX "Listing_ownerName_idx" ON "Listing"("ownerName");

-- CreateIndex
CREATE INDEX "Listing_status_idx" ON "Listing"("status");

-- CreateIndex
CREATE INDEX "Purchase_buyerOwner_idx" ON "Purchase"("buyerOwner");

-- CreateIndex
CREATE INDEX "Purchase_sellerOwner_idx" ON "Purchase"("sellerOwner");

-- CreateIndex
CREATE INDEX "Purchase_listingId_idx" ON "Purchase"("listingId");

-- CreateIndex
CREATE INDEX "TrustedIssuer_url_idx" ON "TrustedIssuer"("url");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationNonce_state_key" ON "VerificationNonce"("state");

-- CreateIndex
CREATE INDEX "VerificationNonce_expiresAt_idx" ON "VerificationNonce"("expiresAt");

-- CreateIndex
CREATE INDEX "GenesisPeer_genesisNodeId_idx" ON "GenesisPeer"("genesisNodeId");

-- CreateIndex
CREATE INDEX "GenesisPeer_status_idx" ON "GenesisPeer"("status");

-- CreateIndex
CREATE INDEX "FederationPeer_status_idx" ON "FederationPeer"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganismReputation_organismId_key" ON "OrganismReputation"("organismId");

-- CreateIndex
CREATE UNIQUE INDEX "CortexExtension_name_key" ON "CortexExtension"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CortexLibFile_extName_libName_key" ON "CortexLibFile"("extName", "libName");

-- CreateIndex
CREATE INDEX "PersonalPushSubscription_personalNodeId_idx" ON "PersonalPushSubscription"("personalNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_personalNodeId_key" ON "NotificationPreference"("personalNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionId_key" ON "Session"("sessionId");

-- CreateIndex
CREATE INDEX "Session_owner_idx" ON "Session"("owner");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_refreshTokenHash_idx" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_prevTokenHash_idx" ON "Session"("prevTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalAccessToken_tokenHash_key" ON "PersonalAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PersonalAccessToken_owner_idx" ON "PersonalAccessToken"("owner");

-- CreateIndex
CREATE INDEX "Invitation_tokenHash_idx" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_organismId_idx" ON "Invitation"("organismId");

-- CreateIndex
CREATE INDEX "Invitation_emailHash_idx" ON "Invitation"("emailHash");

-- CreateIndex
CREATE INDEX "Invitation_expiresAt_idx" ON "Invitation"("expiresAt");

-- CreateIndex
CREATE INDEX "Invitation_invitedBy_idx" ON "Invitation"("invitedBy");

-- CreateIndex
CREATE UNIQUE INDEX "RevokedToken_tokenHash_key" ON "RevokedToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RevokedToken_expiresAt_idx" ON "RevokedToken"("expiresAt");

-- CreateIndex
CREATE INDEX "App_ownerGaii_filename_idx" ON "App"("ownerGaii", "filename");

-- CreateIndex
CREATE INDEX "App_ownerName_filename_idx" ON "App"("ownerName", "filename");

-- CreateIndex
CREATE UNIQUE INDEX "App_ownerGaii_filename_versionNumber_key" ON "App"("ownerGaii", "filename", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AppDownload_ownerGaii_filename_key" ON "AppDownload"("ownerGaii", "filename");

-- CreateIndex
CREATE UNIQUE INDEX "AppDraft_ownerGaii_filename_key" ON "AppDraft"("ownerGaii", "filename");

-- CreateIndex
CREATE INDEX "AppFork_sourceOwnerGaii_sourceFilename_idx" ON "AppFork"("sourceOwnerGaii", "sourceFilename");

-- CreateIndex
CREATE INDEX "AppFork_childOwnerGaii_childFilename_idx" ON "AppFork"("childOwnerGaii", "childFilename");

-- CreateIndex
CREATE UNIQUE INDEX "AppPurchase_transactionId_key" ON "AppPurchase"("transactionId");

-- CreateIndex
CREATE INDEX "AppPurchase_buyerGaii_idx" ON "AppPurchase"("buyerGaii");

-- CreateIndex
CREATE INDEX "AppPurchase_sellerGaii_idx" ON "AppPurchase"("sellerGaii");

-- CreateIndex
CREATE INDEX "KnowledgeLink_source_idx" ON "KnowledgeLink"("source");

-- CreateIndex
CREATE INDEX "KnowledgeLink_target_idx" ON "KnowledgeLink"("target");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLink_source_target_key" ON "KnowledgeLink"("source", "target");

-- CreateIndex
CREATE INDEX "KnowledgeReview_packageId_idx" ON "KnowledgeReview"("packageId");

-- CreateIndex
CREATE INDEX "ScheduledJob_type_idx" ON "ScheduledJob"("type");

-- CreateIndex
CREATE INDEX "ScheduledJob_extensionName_idx" ON "ScheduledJob"("extensionName");

-- CreateIndex
CREATE INDEX "ScheduledJob_enabled_idx" ON "ScheduledJob"("enabled");

-- CreateIndex
CREATE INDEX "ScheduledJob_ownerScope_idx" ON "ScheduledJob"("ownerScope");

-- CreateIndex
CREATE INDEX "ScheduledJob_agentGaii_idx" ON "ScheduledJob"("agentGaii");

-- CreateIndex
CREATE INDEX "ExecutionLog_jobId_idx" ON "ExecutionLog"("jobId");

-- CreateIndex
CREATE INDEX "ExecutionLog_extensionName_idx" ON "ExecutionLog"("extensionName");

-- CreateIndex
CREATE INDEX "ExecutionLog_createdAt_idx" ON "ExecutionLog"("createdAt");

-- CreateIndex
CREATE INDEX "ExecutionLog_trigger_idx" ON "ExecutionLog"("trigger");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuth_deviceCode_key" ON "DeviceAuth"("deviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuth_userCode_key" ON "DeviceAuth"("userCode");

-- CreateIndex
CREATE UNIQUE INDEX "EcosystemApp_geai_key" ON "EcosystemApp"("geai");

-- CreateIndex
CREATE INDEX "EcosystemApp_owner_idx" ON "EcosystemApp"("owner");

-- CreateIndex
CREATE UNIQUE INDEX "EcoAuth_deviceCode_key" ON "EcoAuth"("deviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "EcoAuth_userCode_key" ON "EcoAuth"("userCode");

-- CreateIndex
CREATE INDEX "EcoAutomationRecipe_owner_idx" ON "EcoAutomationRecipe"("owner");

-- CreateIndex
CREATE UNIQUE INDEX "EcoAutomationRecipe_owner_app_key" ON "EcoAutomationRecipe"("owner", "app");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthClient_clientId_key" ON "OAuthClient"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthRefreshToken_tokenHash_key" ON "OAuthRefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthApproval_clientId_gaii_key" ON "OAuthApproval"("clientId", "gaii");

-- CreateIndex
CREATE UNIQUE INDEX "SystemPromptVersion_promptId_version_key" ON "SystemPromptVersion"("promptId", "version");

-- CreateIndex
CREATE INDEX "Package_packageGroupId_idx" ON "Package"("packageGroupId");

-- CreateIndex
CREATE INDEX "Package_author_idx" ON "Package"("author");

-- CreateIndex
CREATE INDEX "Package_status_idx" ON "Package"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Package_packageGroupId_version_key" ON "Package"("packageGroupId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateListing_packageGroupId_key" ON "TemplateListing"("packageGroupId");

-- CreateIndex
CREATE INDEX "TemplateListing_category_idx" ON "TemplateListing"("category");

-- CreateIndex
CREATE INDEX "TemplateListing_featured_idx" ON "TemplateListing"("featured");

-- CreateIndex
CREATE INDEX "TemplateListing_status_idx" ON "TemplateListing"("status");

-- CreateIndex
CREATE INDEX "TemplateReview_listingId_idx" ON "TemplateReview"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateReview_listingId_authorGhii_key" ON "TemplateReview"("listingId", "authorGhii");

-- CreateIndex
CREATE INDEX "TemplateDiscussion_listingId_idx" ON "TemplateDiscussion"("listingId");

-- CreateIndex
CREATE INDEX "PackageInstance_owner_idx" ON "PackageInstance"("owner");

-- CreateIndex
CREATE INDEX "PackageInstance_packageGroupId_idx" ON "PackageInstance"("packageGroupId");

-- CreateIndex
CREATE INDEX "Capability_ownerGhii_idx" ON "Capability"("ownerGhii");

-- CreateIndex
CREATE INDEX "Capability_sourceType_sourceRef_idx" ON "Capability"("sourceType", "sourceRef");

-- CreateIndex
CREATE INDEX "Capability_status_idx" ON "Capability"("status");

-- CreateIndex
CREATE INDEX "Capability_visibility_idx" ON "Capability"("visibility");

-- CreateIndex
CREATE INDEX "CapabilityLog_capabilityId_timestamp_idx" ON "CapabilityLog"("capabilityId", "timestamp");

-- CreateIndex
CREATE INDEX "CapabilityLog_capabilityId_status_idx" ON "CapabilityLog"("capabilityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityVouch_capabilityId_userGhii_key" ON "CapabilityVouch"("capabilityId", "userGhii");

-- CreateIndex
CREATE INDEX "ReplicationQueue_status_idx" ON "ReplicationQueue"("status");

-- CreateIndex
CREATE INDEX "ReplicationQueue_createdAt_idx" ON "ReplicationQueue"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StatsDailyHistory_date_key_key" ON "StatsDailyHistory"("date", "key");

-- CreateIndex
CREATE INDEX "AgentTask_agentGaii_status_idx" ON "AgentTask"("agentGaii", "status");

-- CreateIndex
CREATE INDEX "AgentTask_ownerGaii_idx" ON "AgentTask"("ownerGaii");

-- CreateIndex
CREATE INDEX "AgentTaskEvent_taskId_timestamp_idx" ON "AgentTaskEvent"("taskId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDirective_agentGaii_key" ON "AgentDirective"("agentGaii");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerAgentDefault_ownerGaii_key" ON "OwnerAgentDefault"("ownerGaii");

-- CreateIndex
CREATE INDEX "SharingGroup_ownerGaii_idx" ON "SharingGroup"("ownerGaii");

-- CreateIndex
CREATE INDEX "AgentActivity_agentGaii_date_idx" ON "AgentActivity"("agentGaii", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AgentActivity_agentGaii_date_hour_metric_key" ON "AgentActivity"("agentGaii", "date", "hour", "metric");

-- CreateIndex
CREATE INDEX "AgentUsageEvent_ownerGhii_ts_idx" ON "AgentUsageEvent"("ownerGhii", "ts");

-- CreateIndex
CREATE INDEX "AgentUsageEvent_agentGaii_ts_idx" ON "AgentUsageEvent"("agentGaii", "ts");

-- CreateIndex
CREATE INDEX "AgentUsageEvent_runId_idx" ON "AgentUsageEvent"("runId");

-- CreateIndex
CREATE INDEX "AgentUsageDaily_ownerGhii_date_idx" ON "AgentUsageDaily"("ownerGhii", "date");

-- CreateIndex
CREATE INDEX "AgentUsageDaily_organismId_date_idx" ON "AgentUsageDaily"("organismId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AgentUsageDaily_date_agentGaii_ownerGhii_apiKeyScope_model__key" ON "AgentUsageDaily"("date", "agentGaii", "ownerGhii", "apiKeyScope", "model", "provider", "organismId", "workspaceId");

-- CreateIndex
CREATE INDEX "TelemetryEvent_agentGaii_createdAt_idx" ON "TelemetryEvent"("agentGaii", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDeliveryLog_agentGaii_createdAt_idx" ON "WebhookDeliveryLog"("agentGaii", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentOnboarding_agentGaii_key" ON "AgentOnboarding"("agentGaii");

-- CreateIndex
CREATE INDEX "AgentOnboarding_status_idx" ON "AgentOnboarding"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SubdomainSite_subdomain_key" ON "SubdomainSite"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "AppGrant_grantId_key" ON "AppGrant"("grantId");

-- CreateIndex
CREATE INDEX "AppGrant_owner_idx" ON "AppGrant"("owner");

-- CreateIndex
CREATE INDEX "AppGrant_refreshTokenHash_idx" ON "AppGrant"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "AgentMessage_agentGaii_threadId_createdAt_idx" ON "AgentMessage"("agentGaii", "threadId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentMessage_agentGaii_status_idx" ON "AgentMessage"("agentGaii", "status");

-- CreateIndex
CREATE INDEX "DirectMessage_ownerGhii_direction_createdAt_idx" ON "DirectMessage"("ownerGhii", "direction", "createdAt");

-- CreateIndex
CREATE INDEX "DirectMessage_ownerGhii_conversationId_createdAt_idx" ON "DirectMessage"("ownerGhii", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "DirectMessage_mid_idx" ON "DirectMessage"("mid");

-- CreateIndex
CREATE INDEX "DirectMessage_status_origin_idx" ON "DirectMessage"("status", "origin");

-- CreateIndex
CREATE INDEX "DirectMessage_broadcastId_idx" ON "DirectMessage"("broadcastId");

-- CreateIndex
CREATE INDEX "ContactConsent_ownerGhii_state_idx" ON "ContactConsent"("ownerGhii", "state");

-- CreateIndex
CREATE INDEX "MessageDeliveryLog_createdAt_idx" ON "MessageDeliveryLog"("createdAt");

-- CreateIndex
CREATE INDEX "MessageDeliveryLog_status_idx" ON "MessageDeliveryLog"("status");

-- AddForeignKey
ALTER TABLE "CapabilityLog" ADD CONSTRAINT "CapabilityLog_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityVouch" ADD CONSTRAINT "CapabilityVouch_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

