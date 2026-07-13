/**
 * @file src/storage/providers/mongodb/methods/knowledge.ts
 * @description Config persistence, memory links, operator reviews, scheduler, execution log, extension instances, federation peers, replication queue, and device-authorization methods. Extracted from mongodb/index.ts (PrismaStorage) to satisfy max-file-lines; method bodies verbatim, bound to PrismaStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/mongodb/index.ts (max-file-lines)
 */
import type {
  MemoryLinkRecord, OperatorReviewRecord, ScheduledJobRecord, ExtensionInstanceRecord, FederationPeerRecord, ReplicationQueueEntry, DeviceAuthorizationRecord, ExecutionLogEntry
} from '../../../interface.js';
import { randomUUID } from 'node:crypto';
import type { PrismaStorage, PrismaRow } from '../index.js';

export const knowledgeMethods = {
    // ── Config Persistence ──────────────────────────────────

    supportsConfigPersistence(this: PrismaStorage): boolean { return true; },

    async getConfigValue(this: PrismaStorage, key: string): Promise<string | null> {
        this.ensureReady();
        const row = await this.prisma.systemSetting.findUnique({ where: { key: `config:${key}` } });
        return row?.value ?? null;
    },

    async setConfigValue(this: PrismaStorage, key: string, value: string): Promise<void> {
        this.ensureReady();
        await this.prisma.systemSetting.upsert({
            where: { key: `config:${key}` },
            update: { value },
            create: { key: `config:${key}`, value },
        });
    },

    async deleteConfigValue(this: PrismaStorage, key: string): Promise<void> {
        this.ensureReady();
        await this.prisma.systemSetting.deleteMany({ where: { key: `config:${key}` } });
    },

    async getAllConfigValues(this: PrismaStorage): Promise<Record<string, string>> {
        this.ensureReady();
        const rows = await this.prisma.systemSetting.findMany({
            where: { key: { startsWith: 'config:' } },
        });
        const result: Record<string, string> = {};
        for (const r of rows) result[r.key.replace('config:', '')] = r.value;
        return result;
    },

    // ══════════════════════════════════════════════════════════
    // ── Knowledge: Memory Links ──
    // ══════════════════════════════════════════════════════════

    toMemoryLinkRecord(this: PrismaStorage, row: PrismaRow): MemoryLinkRecord {
        return {
            source: row.source,
            target: row.target,
            relation: row.relation,
            description: row.description,
            linked_at: row.linkedAt instanceof Date ? row.linkedAt.toISOString() : row.linkedAt,
            linked_by: row.linkedBy,
        };
    },

    async createLink(this: PrismaStorage, record: MemoryLinkRecord): Promise<MemoryLinkRecord> {
        this.ensureReady();
        await this.prisma.knowledgeLink.create({
            data: {
                source: record.source,
                target: record.target,
                relation: record.relation,
                description: record.description,
                linkedAt: new Date(record.linked_at),
                linkedBy: record.linked_by,
            },
        });
        return record;
    },

    async getLink(this: PrismaStorage, source: string, target: string): Promise<MemoryLinkRecord | null> {
        this.ensureReady();
        const row = await this.prisma.knowledgeLink.findUnique({
            where: { source_target: { source, target } },
        });
        return row ? this.toMemoryLinkRecord(row) : null;
    },

    async listLinks(this: PrismaStorage, key: string, opts?: { direction?: 'outgoing' | 'incoming' | 'both'; relation?: string }): Promise<MemoryLinkRecord[]> {
        this.ensureReady();
        const dir = opts?.direction ?? 'both';
        const where: Record<string, unknown> = {};
        if (dir === 'outgoing') where.source = key;
        else if (dir === 'incoming') where.target = key;
        else where.OR = [{ source: key }, { target: key }];
        if (opts?.relation) where.relation = opts.relation;
        const rows = await this.prisma.knowledgeLink.findMany({ where });
        return rows.map((r: PrismaRow) => this.toMemoryLinkRecord(r));
    },

    async deleteLink(this: PrismaStorage, source: string, target: string): Promise<boolean> {
        this.ensureReady();
        const result = await this.prisma.knowledgeLink.deleteMany({
            where: { source, target },
        });
        return result.count > 0;
    },

    async findBrokenLinks(this: PrismaStorage, ownerGaii: string): Promise<MemoryLinkRecord[]> {
        this.ensureReady();
        const links = await this.prisma.knowledgeLink.findMany({
            where: { linkedBy: ownerGaii },
        });
        const broken: MemoryLinkRecord[] = [];
        for (const link of links) {
            const sourceExists = await this.getMemory(ownerGaii, link.source);
            const targetExists = await this.getMemory(ownerGaii, link.target);
            if (!sourceExists || !targetExists) broken.push(this.toMemoryLinkRecord(link));
        }
        return broken;
    },

    async deleteLinksByContributor(this: PrismaStorage, gaii: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.knowledgeLink.deleteMany({ where: { linkedBy: gaii } });
        return result.count;
    },

    // ══════════════════════════════════════════════════════════
    // ── Knowledge: Operator Reviews (Prisma-persisted) ──
    // ══════════════════════════════════════════════════════════

    toOperatorReviewRecord(this: PrismaStorage, row: PrismaRow): OperatorReviewRecord {
        return {
            id: row.id,
            packageId: row.packageId,
            operatorGaii: row.operatorGaii,
            reason: row.reason,
            customText: row.customText ?? undefined,
            action: row.action,
            timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
        };
    },

    async createReview(this: PrismaStorage, record: OperatorReviewRecord): Promise<OperatorReviewRecord> {
        this.ensureReady();
        await this.prisma.knowledgeReview.create({
            data: {
                id: record.id,
                packageId: record.packageId,
                operatorGaii: record.operatorGaii,
                reason: record.reason,
                customText: record.customText,
                action: record.action,
                timestamp: new Date(record.timestamp),
            },
        });
        return record;
    },

    async listReviews(this: PrismaStorage, packageId: string): Promise<OperatorReviewRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.knowledgeReview.findMany({ where: { packageId } });
        return rows.map((r: PrismaRow) => this.toOperatorReviewRecord(r));
    },

    async listAllReviews(this: PrismaStorage, opts?: { page?: number; perPage?: number }): Promise<OperatorReviewRecord[]> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const rows = await this.prisma.knowledgeReview.findMany({
            orderBy: { timestamp: 'desc' },
            skip: (page - 1) * perPage,
            take: perPage,
        });
        return rows.map((r: PrismaRow) => this.toOperatorReviewRecord(r));
    },

    async deleteReviewsByOperator(this: PrismaStorage, gaii: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.knowledgeReview.deleteMany({ where: { operatorGaii: gaii } });
        return result.count;
    },

    // ══════════════════════════════════════════════════════════
    // ── Scheduler: Scheduled Jobs ──
    // ══════════════════════════════════════════════════════════

    toScheduledJobRecord(this: PrismaStorage, row: PrismaRow): ScheduledJobRecord {
        return {
            id: row.id,
            name: row.name,
            type: row.type as ScheduledJobRecord['type'],
            extensionName: row.extensionName ?? undefined,
            instanceId: row.instanceId ?? undefined,
            actionId: row.actionId ?? undefined,
            coreHandler: row.coreHandler ?? undefined,
            cron: row.cron,
            enabled: row.enabled,
            input: row.input as Record<string, unknown> | undefined,
            lastRunAt: row.lastRunAt instanceof Date ? row.lastRunAt.toISOString() : row.lastRunAt ?? undefined,
            lastRunResult: row.lastRunResult as ScheduledJobRecord['lastRunResult'],
            lastRunError: row.lastRunError ?? undefined,
            lastRunDurationMs: row.lastRunDurationMs ?? undefined,
            nextRunAt: row.nextRunAt instanceof Date ? row.nextRunAt.toISOString() : row.nextRunAt ?? undefined,
            createdBy: row.createdBy,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
            ownerScope: row.ownerScope ?? undefined,
            agentName: row.agentName ?? undefined,
            agentGaii: row.agentGaii ?? undefined,
            createdByAgent: row.createdByAgent ?? undefined,
            displayName: row.displayName ?? undefined,
            description: row.description ?? undefined,
            purpose: row.purpose ?? undefined,
            timezone: row.timezone ?? undefined,
            constraints: (row.constraints as ScheduledJobRecord['constraints']) ?? undefined,
            runCount: row.runCount ?? undefined,
        };
    },

    async createScheduledJob(this: PrismaStorage, record: ScheduledJobRecord): Promise<ScheduledJobRecord> {
        this.ensureReady();
        await this.prisma.scheduledJob.create({
            data: {
                id: record.id,
                name: record.name,
                type: record.type,
                extensionName: record.extensionName,
                instanceId: record.instanceId,
                actionId: record.actionId,
                coreHandler: record.coreHandler,
                cron: record.cron,
                enabled: record.enabled,
                input: record.input,
                lastRunAt: record.lastRunAt ? new Date(record.lastRunAt) : null,
                lastRunResult: record.lastRunResult,
                lastRunError: record.lastRunError,
                lastRunDurationMs: record.lastRunDurationMs,
                nextRunAt: record.nextRunAt ? new Date(record.nextRunAt) : null,
                createdBy: record.createdBy,
                createdAt: new Date(record.createdAt),
                updatedAt: new Date(record.updatedAt),
                ownerScope: record.ownerScope,
                agentName: record.agentName,
                agentGaii: record.agentGaii,
                createdByAgent: record.createdByAgent ?? false,
                displayName: record.displayName,
                description: record.description,
                purpose: record.purpose,
                timezone: record.timezone,
                constraints: record.constraints,
                runCount: record.runCount ?? 0,
            },
        });
        return record;
    },

    async getScheduledJob(this: PrismaStorage, id: string): Promise<ScheduledJobRecord | null> {
        this.ensureReady();
        const row = await this.prisma.scheduledJob.findUnique({ where: { id } });
        return row ? this.toScheduledJobRecord(row) : null;
    },

    async listScheduledJobs(this: PrismaStorage, filter?: { type?: string; extensionName?: string; enabled?: boolean; ownerScope?: string; agentGaii?: string }): Promise<ScheduledJobRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (filter?.type !== undefined) where.type = filter.type;
        if (filter?.extensionName !== undefined) where.extensionName = filter.extensionName;
        if (filter?.enabled !== undefined) where.enabled = filter.enabled;
        if (filter?.ownerScope !== undefined) where.ownerScope = filter.ownerScope;
        if (filter?.agentGaii !== undefined) where.agentGaii = filter.agentGaii;
        const rows = await this.prisma.scheduledJob.findMany({ where });
        return rows.map((r: PrismaRow) => this.toScheduledJobRecord(r));
    },

    async updateScheduledJob(this: PrismaStorage, id: string, updates: Partial<ScheduledJobRecord>): Promise<ScheduledJobRecord | null> {
        this.ensureReady();
        const existing = await this.prisma.scheduledJob.findUnique({ where: { id } });
        if (!existing) return null;
        const data: Record<string, unknown> = {};
        if (updates.name !== undefined) data.name = updates.name;
        if (updates.type !== undefined) data.type = updates.type;
        if (updates.extensionName !== undefined) data.extensionName = updates.extensionName;
        if (updates.instanceId !== undefined) data.instanceId = updates.instanceId;
        if (updates.actionId !== undefined) data.actionId = updates.actionId;
        if (updates.coreHandler !== undefined) data.coreHandler = updates.coreHandler;
        if (updates.cron !== undefined) data.cron = updates.cron;
        if (updates.enabled !== undefined) data.enabled = updates.enabled;
        if (updates.input !== undefined) data.input = updates.input;
        if (updates.lastRunAt !== undefined) data.lastRunAt = updates.lastRunAt ? new Date(updates.lastRunAt) : null;
        if (updates.lastRunResult !== undefined) data.lastRunResult = updates.lastRunResult;
        if (updates.lastRunError !== undefined) data.lastRunError = updates.lastRunError;
        if (updates.lastRunDurationMs !== undefined) data.lastRunDurationMs = updates.lastRunDurationMs;
        if (updates.nextRunAt !== undefined) data.nextRunAt = updates.nextRunAt ? new Date(updates.nextRunAt) : null;
        if (updates.ownerScope !== undefined) data.ownerScope = updates.ownerScope;
        if (updates.agentName !== undefined) data.agentName = updates.agentName;
        if (updates.agentGaii !== undefined) data.agentGaii = updates.agentGaii;
        if (updates.createdByAgent !== undefined) data.createdByAgent = updates.createdByAgent;
        if (updates.displayName !== undefined) data.displayName = updates.displayName;
        if (updates.description !== undefined) data.description = updates.description;
        if (updates.purpose !== undefined) data.purpose = updates.purpose;
        if (updates.timezone !== undefined) data.timezone = updates.timezone;
        if (updates.constraints !== undefined) data.constraints = updates.constraints;
        if (updates.runCount !== undefined) data.runCount = updates.runCount;
        const row = await this.prisma.scheduledJob.update({ where: { id }, data });
        return this.toScheduledJobRecord(row);
    },

    async deleteScheduledJob(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        const result = await this.prisma.scheduledJob.deleteMany({ where: { id } });
        return result.count > 0;
    },

    // ══════════════════════════════════════════════════════════
    // ── Execution Log ──
    // ══════════════════════════════════════════════════════════

    async createExecutionLog(this: PrismaStorage, entry: ExecutionLogEntry): Promise<ExecutionLogEntry> {
        this.ensureReady();
        await this.prisma.executionLog.create({
            data: {
                id: entry.id,
                jobId: entry.jobId,
                jobName: entry.jobName,
                type: entry.type,
                extensionName: entry.extensionName,
                actionId: entry.actionId,
                trigger: entry.trigger,
                result: entry.result,
                errorMessage: entry.errorMessage,
                durationMs: entry.durationMs,
                memoryReads: entry.memoryReads,
                memoryWrites: entry.memoryWrites,
                taskId: entry.taskId,
                createdAt: new Date(entry.createdAt),
            },
        });
        return entry;
    },

    async listExecutionLogs(this: PrismaStorage, filter?: {
        jobId?: string; extensionName?: string; trigger?: string; result?: string;
        limit?: number; offset?: number;
    }): Promise<ExecutionLogEntry[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (filter?.jobId) where.jobId = filter.jobId;
        if (filter?.extensionName) where.extensionName = filter.extensionName;
        if (filter?.trigger) where.trigger = filter.trigger;
        if (filter?.result) where.result = filter.result;
        const rows = await this.prisma.executionLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: filter?.limit ?? 100,
            skip: filter?.offset ?? 0,
        });
        return rows.map((r: PrismaRow) => this.toExecutionLogEntry(r));
    },

    async countExecutionLogs(this: PrismaStorage, filter?: {
        jobId?: string; extensionName?: string; trigger?: string; result?: string;
    }): Promise<number> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (filter?.jobId) where.jobId = filter.jobId;
        if (filter?.extensionName) where.extensionName = filter.extensionName;
        if (filter?.trigger) where.trigger = filter.trigger;
        if (filter?.result) where.result = filter.result;
        return this.prisma.executionLog.count({ where });
    },

    async pruneExecutionLogs(this: PrismaStorage, beforeDate: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.executionLog.deleteMany({
            where: { createdAt: { lt: new Date(beforeDate) } },
        });
        return result.count;
    },

    toExecutionLogEntry(this: PrismaStorage, row: PrismaRow): ExecutionLogEntry {
        return {
            id: row.id,
            jobId: row.jobId,
            jobName: row.jobName,
            type: row.type as ExecutionLogEntry['type'],
            extensionName: row.extensionName ?? undefined,
            actionId: row.actionId ?? undefined,
            trigger: row.trigger as 'cron' | 'manual' | 'activate',
            result: row.result as 'success' | 'error' | 'skipped',
            errorMessage: row.errorMessage ?? undefined,
            durationMs: row.durationMs,
            memoryReads: Array.isArray(row.memoryReads) ? row.memoryReads : JSON.parse(row.memoryReads || '[]'),
            memoryWrites: Array.isArray(row.memoryWrites) ? row.memoryWrites : JSON.parse(row.memoryWrites || '[]'),
            taskId: row.taskId ?? undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    },

    // ══════════════════════════════════════════════════════════
    // ── Extension Instances (Prisma-persisted) ──
    // ══════════════════════════════════════════════════════════

    toExtensionInstanceRecord(this: PrismaStorage, row: PrismaRow): ExtensionInstanceRecord {
        return {
            id: row.instanceId,
            extensionName: row.extensionName,
            config: (row.config as Record<string, unknown>) || {},
            status: row.status as 'active' | 'paused',
            translations: row.translations as Record<string, Record<string, string>> | undefined,
            createdBy: row.createdBy,
            createdByAgent: row.createdByAgent ?? undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
    },

    async createExtensionInstance(this: PrismaStorage, record: ExtensionInstanceRecord): Promise<ExtensionInstanceRecord> {
        this.ensureReady();
        const row = await this.prisma.extensionInstance.create({
            data: {
                instanceId: record.id,
                extensionName: record.extensionName,
                config: record.config,
                status: record.status,
                translations: record.translations ? record.translations : undefined,
                createdBy: record.createdBy,
                createdByAgent: record.createdByAgent ?? null,
                createdAt: new Date(record.createdAt),
            },
        });
        return this.toExtensionInstanceRecord(row);
    },

    async getExtensionInstance(this: PrismaStorage, extensionName: string, instanceId: string): Promise<ExtensionInstanceRecord | null> {
        this.ensureReady();
        const row = await this.prisma.extensionInstance.findUnique({
            where: { extensionName_instanceId: { extensionName, instanceId } },
        });
        return row ? this.toExtensionInstanceRecord(row) : null;
    },

    async listExtensionInstances(this: PrismaStorage, extensionName: string): Promise<ExtensionInstanceRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.extensionInstance.findMany({
            where: { extensionName },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map((r: PrismaRow) => this.toExtensionInstanceRecord(r));
    },

    async updateExtensionInstance(this: PrismaStorage, extensionName: string, instanceId: string, updates: Partial<ExtensionInstanceRecord>): Promise<ExtensionInstanceRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.config !== undefined) data.config = updates.config;
            if (updates.status !== undefined) data.status = updates.status;
            if (updates.translations !== undefined) data.translations = updates.translations;
            const row = await this.prisma.extensionInstance.update({
                where: { extensionName_instanceId: { extensionName, instanceId } },
                data,
            });
            return this.toExtensionInstanceRecord(row);
        } catch {
            return null;
        }
    },

    async deleteExtensionInstance(this: PrismaStorage, extensionName: string, instanceId: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.extensionInstance.delete({
                where: { extensionName_instanceId: { extensionName, instanceId } },
            });
            return true;
        } catch {
            return false;
        }
    },

    async deleteExtensionInstancesByOwner(this: PrismaStorage, ownerIdentity: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.extensionInstance.deleteMany({ where: { createdBy: ownerIdentity } });
        return result.count;
    },

    // ══════════════════════════════════════════════════════════
    // ── Federation Peers (persisted active peer connections) ──
    // ══════════════════════════════════════════════════════════

    async saveFederationPeer(this: PrismaStorage, peer: FederationPeerRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.federationPeer.upsert({
            where: { nodeId: peer.nodeId },
            create: { nodeId: peer.nodeId, url: peer.url, publicKey: peer.publicKey, status: peer.status, addedAt: new Date(peer.addedAt), lastSeen: new Date(peer.lastSeen), shareCatalogue: peer.shareCatalogue, replicateMemory: peer.replicateMemory, allowRouting: peer.allowRouting, peerMode: peer.peerMode || 'federation', allowFederatedAuth: peer.allowFederatedAuth ?? false, federationAuthScopes: peer.federationAuthScopes ?? [], tier: peer.tier ?? 'member', availability: peer.availability ?? null, expiresAt: peer.expiresAt ? new Date(peer.expiresAt) : null, heartbeatOk: peer.heartbeatOk ?? 0, heartbeatTotal: peer.heartbeatTotal ?? 0, availabilityWindow: peer.availabilityWindow ?? null, availabilityPct: peer.availabilityPct ?? null, softwareVersion: peer.softwareVersion ?? null, nodeCardHash: peer.nodeCardHash ?? null },
            update: { url: peer.url, publicKey: peer.publicKey, status: peer.status, lastSeen: new Date(peer.lastSeen), shareCatalogue: peer.shareCatalogue, replicateMemory: peer.replicateMemory, allowRouting: peer.allowRouting, peerMode: peer.peerMode || 'federation', allowFederatedAuth: peer.allowFederatedAuth ?? false, federationAuthScopes: peer.federationAuthScopes ?? [], tier: peer.tier ?? 'member', availability: peer.availability ?? null, expiresAt: peer.expiresAt ? new Date(peer.expiresAt) : null, heartbeatOk: peer.heartbeatOk ?? 0, heartbeatTotal: peer.heartbeatTotal ?? 0, availabilityWindow: peer.availabilityWindow ?? null, availabilityPct: peer.availabilityPct ?? null, softwareVersion: peer.softwareVersion ?? null, nodeCardHash: peer.nodeCardHash ?? null },
        });
    },

    async listFederationPeers(this: PrismaStorage): Promise<FederationPeerRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.federationPeer.findMany();
        return rows.map((r: PrismaRow) => ({
            nodeId: r.nodeId,
            url: r.url,
            publicKey: r.publicKey,
            status: r.status,
            addedAt: r.addedAt instanceof Date ? r.addedAt.toISOString() : r.addedAt,
            lastSeen: r.lastSeen instanceof Date ? r.lastSeen.toISOString() : r.lastSeen,
            shareCatalogue: r.shareCatalogue ?? true,
            replicateMemory: r.replicateMemory ?? true,
            allowRouting: r.allowRouting ?? true,
            peerMode: r.peerMode || 'federation',
            allowFederatedAuth: r.allowFederatedAuth ?? false,
            federationAuthScopes: r.federationAuthScopes ?? [],
            tier: r.tier ?? 'member',
            availability: r.availability ?? null,
            expiresAt: r.expiresAt instanceof Date ? r.expiresAt.toISOString() : (r.expiresAt ?? null),
            heartbeatOk: r.heartbeatOk ?? 0,
            heartbeatTotal: r.heartbeatTotal ?? 0,
            availabilityWindow: r.availabilityWindow ?? null,
            availabilityPct: r.availabilityPct ?? null,
            softwareVersion: r.softwareVersion ?? null,
            nodeCardHash: r.nodeCardHash ?? null,
        }));
    },

    async deleteFederationPeer(this: PrismaStorage, nodeId: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.federationPeer.delete({ where: { nodeId } });
            return true;
        } catch {
            return false;
        }
    },

    // ══════════════════════════════════════════════════════════
    // ── Replication Queue (B.1) — persisted to MongoDB
    // ══════════════════════════════════════════════════════════

    async enqueueReplication(this: PrismaStorage, entry: Omit<ReplicationQueueEntry, 'id' | 'attempts' | 'lastAttemptAt' | 'status'>): Promise<string> {
        this.ensureReady();
        const id = randomUUID();
        await this.prisma.replicationQueue.create({
            data: {
                id,
                type: entry.type,
                targetPeers: entry.targetPeers,
                payload: entry.payload != null ? JSON.stringify(entry.payload) : null,
                createdAt: new Date(entry.createdAt),
                attempts: 0,
                lastAttemptAt: null,
                status: 'pending',
            },
        });
        return id;
    },

    async dequeueReplication(this: PrismaStorage, peerId: string, limit: number): Promise<ReplicationQueueEntry[]> {
        this.ensureReady();
        const rows = await this.prisma.replicationQueue.findMany({
            where: { status: 'pending', targetPeers: { has: peerId } },
            orderBy: { createdAt: 'asc' },
            take: limit,
        });
        return rows.map((r: PrismaRow) => ({
            id: r.id,
            type: r.type,
            targetPeers: r.targetPeers,
            payload: r.payload ? JSON.parse(r.payload) : null,
            createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
            attempts: r.attempts,
            lastAttemptAt: r.lastAttemptAt instanceof Date ? r.lastAttemptAt.toISOString() : r.lastAttemptAt,
            status: r.status,
        }));
    },

    async markReplicationSent(this: PrismaStorage, ids: string[]): Promise<void> {
        this.ensureReady();
        await this.prisma.replicationQueue.updateMany({
            where: { id: { in: ids } },
            data: { status: 'sent' },
        });
    },

    async markReplicationFailed(this: PrismaStorage, ids: string[]): Promise<void> {
        this.ensureReady();
        for (const id of ids) {
            await this.prisma.replicationQueue.update({
                where: { id },
                data: { status: 'failed', attempts: { increment: 1 }, lastAttemptAt: new Date() },
            }).catch(() => {});
        }
    },

    async pruneReplicationQueue(this: PrismaStorage, maxAge: Date): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.replicationQueue.deleteMany({
            where: { OR: [{ createdAt: { lt: maxAge } }, { status: 'sent' }] },
        });
        return result.count;
    },

    async replicationQueueSize(this: PrismaStorage): Promise<number> {
        this.ensureReady();
        return this.prisma.replicationQueue.count();
    },

    // ── Device Authorization (RFC 8628) ──

    async createDeviceAuth(this: PrismaStorage, req: DeviceAuthorizationRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.deviceAuth.create({
            data: {
                deviceCode: req.deviceCode,
                userCode: req.userCode,
                ownerName: req.ownerName,
                agentName: req.agentName,
                displayName: req.displayName,
                description: req.description,
                status: req.status,
                scopes: req.scopes ?? [],
                createdAt: new Date(req.createdAt),
                expiresAt: new Date(req.expiresAt),
                lastPolledAt: req.lastPolledAt ? new Date(req.lastPolledAt) : null,
                pollInterval: req.pollInterval,
                approvedBy: req.approvedBy,
                agentCredentials: req.agentCredentials ?? undefined,
                mode: req.mode ?? 'interactive',
            },
        });
    },

    async getDeviceAuthByDeviceCode(this: PrismaStorage, deviceCode: string): Promise<DeviceAuthorizationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.deviceAuth.findUnique({ where: { deviceCode } });
        return row ? this.toDeviceAuthRecord(row) : null;
    },

    async getDeviceAuthByUserCode(this: PrismaStorage, userCode: string): Promise<DeviceAuthorizationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.deviceAuth.findUnique({ where: { userCode } });
        return row ? this.toDeviceAuthRecord(row) : null;
    },

    async updateDeviceAuth(this: PrismaStorage, deviceCode: string, updates: Partial<DeviceAuthorizationRecord>): Promise<void> {
        this.ensureReady();
        const data: Record<string, unknown> = {};
        if (updates.status !== undefined) data.status = updates.status;
        if (updates.scopes !== undefined) data.scopes = updates.scopes;
        if (updates.lastPolledAt !== undefined) data.lastPolledAt = updates.lastPolledAt ? new Date(updates.lastPolledAt) : null;
        if (updates.pollInterval !== undefined) data.pollInterval = updates.pollInterval;
        if (updates.approvedBy !== undefined) data.approvedBy = updates.approvedBy;
        if ('agentCredentials' in updates) data.agentCredentials = updates.agentCredentials ?? null;
        await this.prisma.deviceAuth.update({ where: { deviceCode }, data });
    },

    async countPendingDeviceAuthByOwner(this: PrismaStorage, ownerName: string): Promise<number> {
        this.ensureReady();
        return this.prisma.deviceAuth.count({
            where: { ownerName, status: 'pending', expiresAt: { gt: new Date() } },
        });
    },

    async listPendingDeviceAuthByOwner(this: PrismaStorage, ownerName: string): Promise<DeviceAuthorizationRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.deviceAuth.findMany({
            where: { ownerName, status: 'pending', expiresAt: { gt: new Date() } },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map((row: PrismaRow) => this.toDeviceAuthRecord(row));
    },

    async cleanupExpiredDeviceAuth(this: PrismaStorage): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.deviceAuth.deleteMany({
            where: { status: 'pending', expiresAt: { lte: new Date() } },
        });
        return result.count;
    },

    async deleteDeviceAuthByOwner(this: PrismaStorage, ownerName: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.deviceAuth.deleteMany({ where: { ownerName } });
        return result.count;
    },
};
