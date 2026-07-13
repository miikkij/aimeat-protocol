/**
 * @file src/storage/providers/mongodb/methods/messaging.ts
 * @description Agent messages, direct messages, agent onboarding, telemetry, and webhook-delivery methods. Extracted from mongodb/index.ts (PrismaStorage) to satisfy max-file-lines; method bodies verbatim, bound to PrismaStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/mongodb/index.ts (max-file-lines)
 */
import type {
  AgentMessageRecord, DirectMessageRecord, ContactConsentRecord, MessageDeliveryLog, MessageDeliveryStats, TelemetryEvent, WebhookDeliveryLog, AgentOnboardingRecord, AgentOnboardingStep
} from '../../../interface.js';
import type { PrismaStorage, PrismaRow } from '../index.js';

export const messagingMethods = {
    // ── Agent Messages ──

    toMessageRecord(this: PrismaStorage, row: PrismaRow): AgentMessageRecord {
        const record: AgentMessageRecord = {
            id: row.id,
            agentGaii: row.agentGaii,
            threadId: row.threadId,
            direction: row.direction as AgentMessageRecord['direction'],
            senderGaii: row.senderGaii,
            content: row.content,
            status: row.status as AgentMessageRecord['status'],
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
        if (row.linkedTaskId) record.linkedTaskId = row.linkedTaskId;
        if (row.metadata) record.metadata = row.metadata as AgentMessageRecord['metadata'];
        if (row.processedAt) record.processedAt = row.processedAt instanceof Date ? row.processedAt.toISOString() : row.processedAt;
        return record;
    },

    async createMessage(this: PrismaStorage, record: AgentMessageRecord): Promise<AgentMessageRecord> {
        this.ensureReady();
        await this.prisma.agentMessage.create({
            data: {
                id: record.id,
                agentGaii: record.agentGaii,
                threadId: record.threadId,
                direction: record.direction,
                senderGaii: record.senderGaii,
                content: record.content,
                status: record.status,
                linkedTaskId: record.linkedTaskId ?? null,
                metadata: record.metadata ?? null,
                createdAt: new Date(record.createdAt),
                processedAt: record.processedAt ? new Date(record.processedAt) : null,
            },
        });
        return record;
    },

    async getMessage(this: PrismaStorage, id: string): Promise<AgentMessageRecord | null> {
        this.ensureReady();
        const row = await this.prisma.agentMessage.findUnique({ where: { id } });
        return row ? this.toMessageRecord(row) : null;
    },

    async listMessages(this: PrismaStorage, agentGaii: string, opts?: { direction?: 'inbound' | 'outbound'; threadId?: string; page?: number; perPage?: number }): Promise<{ messages: AgentMessageRecord[]; total: number }> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: Record<string, unknown> = { agentGaii };
        if (opts?.direction) where.direction = opts.direction;
        if (opts?.threadId) where.threadId = opts.threadId;

        const [rows, total] = await Promise.all([
            this.prisma.agentMessage.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * perPage,
                take: perPage,
            }),
            this.prisma.agentMessage.count({ where }),
        ]);
        return { messages: rows.map((r: PrismaRow) => this.toMessageRecord(r)), total };
    },

    async countMessagesByAgents(this: PrismaStorage, agentGaiis: string[]): Promise<Record<string, { total: number; lastMessageAt: string | null }>> {
        this.ensureReady();
        const out: Record<string, { total: number; lastMessageAt: string | null }> = {};
        if (agentGaiis.length === 0) return out;
        const grouped = await this.prisma.agentMessage.groupBy({
            by: ['agentGaii'],
            where: { agentGaii: { in: agentGaiis }, direction: { not: 'inbound' } },
            _count: true,
            _max: { createdAt: true },
        });
        for (const row of grouped as Array<{ agentGaii: string; _count: number; _max: { createdAt: Date | null } }>) {
            const last = row._max?.createdAt;
            out[row.agentGaii] = {
                total: typeof row._count === 'number' ? row._count : 0,
                lastMessageAt: last instanceof Date ? last.toISOString() : ((last as string | null) ?? null),
            };
        }
        return out;
    },

    async listPendingMessages(this: PrismaStorage, agentGaii: string): Promise<AgentMessageRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.agentMessage.findMany({
            where: { agentGaii, status: 'pending', direction: 'inbound' },
            orderBy: { createdAt: 'asc' },
        });
        return rows.map((r: PrismaRow) => this.toMessageRecord(r));
    },

    async updateMessageStatus(this: PrismaStorage, id: string, status: string, processedAt?: string): Promise<AgentMessageRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = { status };
            if (processedAt) data.processedAt = new Date(processedAt);
            const row = await this.prisma.agentMessage.update({
                where: { id },
                data,
            });
            return this.toMessageRecord(row);
        } catch { return null; }
    },

    async listThreads(this: PrismaStorage, agentGaii: string): Promise<{ threadId: string; lastMessage: string; messageCount: number; updatedAt: string }[]> {
        this.ensureReady();
        const groups = await this.prisma.agentMessage.groupBy({
            by: ['threadId'],
            where: { agentGaii },
            _count: { _all: true },
            _max: { createdAt: true },
        });

        const results: { threadId: string; lastMessage: string; messageCount: number; updatedAt: string }[] = [];
        for (const g of groups) {
            const lastMsg = await this.prisma.agentMessage.findFirst({
                where: { agentGaii, threadId: g.threadId },
                orderBy: { createdAt: 'desc' },
                select: { content: true },
            });
            results.push({
                threadId: g.threadId,
                lastMessage: lastMsg?.content ?? '',
                messageCount: g._count._all,
                updatedAt: g._max.createdAt instanceof Date ? g._max.createdAt.toISOString() : (g._max.createdAt ?? ''),
            });
        }

        // Sort by updatedAt descending
        results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return results;
    },

    // ══════════════════════════════════════════════════════════
    // ── Direct Messages (human↔human) ──
    // ══════════════════════════════════════════════════════════

    /** Composite _id for one mailbox copy of a message. */
    dmDocId(this: PrismaStorage, mid: string, ownerGhii: string): string { return `${mid}::${ownerGhii}`; },
    /** Composite _id for a contact-consent record. */
    contactDocId(this: PrismaStorage, ownerGhii: string, contactId: string): string { return `${ownerGhii}::${contactId}`; },

    toDirectMessageRecord(this: PrismaStorage, row: PrismaRow): DirectMessageRecord {
        const record: DirectMessageRecord = {
            id: row.mid,
            ownerGhii: row.ownerGhii,
            conversationId: row.conversationId,
            senderGhii: row.senderGhii,
            recipientGhii: row.recipientGhii,
            body: row.body ?? '',
            status: row.status as DirectMessageRecord['status'],
            direction: row.direction as DirectMessageRecord['direction'],
            origin: row.origin as DirectMessageRecord['origin'],
            originNodeId: row.originNodeId,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
        if (row.subject) record.subject = row.subject;
        if (row.attachments) record.attachments = row.attachments as DirectMessageRecord['attachments'];
        if (row.interactive) record.interactive = row.interactive as DirectMessageRecord['interactive'];
        if (row.broadcastId) record.broadcastId = row.broadcastId;
        if (row.respondable != null) record.respondable = row.respondable;
        if (row.replyToId) record.replyToId = row.replyToId;
        if (row.error) record.error = row.error;
        if (row.deliveredAt) record.deliveredAt = row.deliveredAt instanceof Date ? row.deliveredAt.toISOString() : row.deliveredAt;
        if (row.readAt) record.readAt = row.readAt instanceof Date ? row.readAt.toISOString() : row.readAt;
        return record;
    },

    toContactRecord(this: PrismaStorage, row: PrismaRow): ContactConsentRecord {
        const record: ContactConsentRecord = {
            ownerGhii: row.ownerGhii,
            contactId: row.contactId,
            state: row.state as ContactConsentRecord['state'],
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
        if (row.firstMessageId) record.firstMessageId = row.firstMessageId;
        return record;
    },

    async createDirectMessage(this: PrismaStorage, record: DirectMessageRecord): Promise<DirectMessageRecord> {
        this.ensureReady();
        await this.prisma.directMessage.create({
            data: {
                id: this.dmDocId(record.id, record.ownerGhii),
                mid: record.id,
                ownerGhii: record.ownerGhii,
                conversationId: record.conversationId,
                subject: record.subject ?? null,
                senderGhii: record.senderGhii,
                recipientGhii: record.recipientGhii,
                body: record.body,
                attachments: (record.attachments) ?? null,
                interactive: (record.interactive) ?? null,
                broadcastId: record.broadcastId ?? null,
                respondable: record.respondable ?? null,
                status: record.status,
                direction: record.direction,
                replyToId: record.replyToId ?? null,
                origin: record.origin,
                originNodeId: record.originNodeId,
                error: record.error ?? null,
                createdAt: new Date(record.createdAt),
                deliveredAt: record.deliveredAt ? new Date(record.deliveredAt) : null,
                readAt: record.readAt ? new Date(record.readAt) : null,
            },
        });
        return record;
    },

    async getDirectMessage(this: PrismaStorage, id: string, ownerGhii: string): Promise<DirectMessageRecord | null> {
        this.ensureReady();
        const row = await this.prisma.directMessage.findUnique({ where: { id: this.dmDocId(id, ownerGhii) } });
        return row ? this.toDirectMessageRecord(row) : null;
    },

    async listInbox(this: PrismaStorage, ownerGhii: string, opts?: { unreadOnly?: boolean; page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number; unread: number }> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: Record<string, unknown> = { ownerGhii, direction: 'inbound' };
        if (opts?.unreadOnly) where.readAt = null;

        const [rows, total, unread] = await Promise.all([
            this.prisma.directMessage.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
            this.prisma.directMessage.count({ where }),
            this.prisma.directMessage.count({ where: { ownerGhii, direction: 'inbound', readAt: null } }),
        ]);
        return { messages: rows.map((r: PrismaRow) => this.toDirectMessageRecord(r)), total, unread };
    },

    async listConversation(this: PrismaStorage, ownerGhii: string, conversationId: string, opts?: { page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 50;
        const where = { ownerGhii, conversationId };
        const [rows, total] = await Promise.all([
            this.prisma.directMessage.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
            this.prisma.directMessage.count({ where }),
        ]);
        return { messages: rows.map((r: PrismaRow) => this.toDirectMessageRecord(r)), total };
    },

    async listDmsAddressedTo(this: PrismaStorage, recipientGhii: string, opts?: { page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where = { recipientGhii, direction: 'inbound' };
        const [rows, total] = await Promise.all([
            this.prisma.directMessage.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
            this.prisma.directMessage.count({ where }),
        ]);
        return { messages: rows.map((r: PrismaRow) => this.toDirectMessageRecord(r)), total };
    },

    async listAgentDmThread(this: PrismaStorage, agentGaii: string, conversationId: string, opts?: { page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 50;
        // Agent's own sent copies (ownerGhii=agent, outbound) + inbound copies addressed to it. No overlap.
        const where = {
            conversationId,
            OR: [
                { ownerGhii: agentGaii, direction: 'outbound' },
                { recipientGhii: agentGaii, direction: 'inbound' },
            ],
        };
        const [rows, total] = await Promise.all([
            this.prisma.directMessage.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
            this.prisma.directMessage.count({ where }),
        ]);
        return { messages: rows.map((r: PrismaRow) => this.toDirectMessageRecord(r)), total };
    },

    async listDmsByBroadcast(this: PrismaStorage, broadcastId: string, ownerGhii: string): Promise<DirectMessageRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.directMessage.findMany({
            where: { broadcastId, ownerGhii }, orderBy: { createdAt: 'asc' },
        });
        return rows.map((r: PrismaRow) => this.toDirectMessageRecord(r));
    },

    async listConversations(this: PrismaStorage, ownerGhii: string): Promise<Array<{ conversationId: string; peerGhii: string; subject?: string; lastMessage: string; lastDirection: 'inbound' | 'outbound'; messageCount: number; unread: number; updatedAt: string }>> {
        this.ensureReady();
        const groups = await this.prisma.directMessage.groupBy({
            by: ['conversationId'],
            where: { ownerGhii },
            _count: { _all: true },
            _max: { createdAt: true },
        });

        const results: Array<{ conversationId: string; peerGhii: string; subject?: string; lastMessage: string; lastDirection: 'inbound' | 'outbound'; messageCount: number; unread: number; updatedAt: string }> = [];
        for (const g of groups) {
            const last = await this.prisma.directMessage.findFirst({
                where: { ownerGhii, conversationId: g.conversationId },
                orderBy: { createdAt: 'desc' },
                select: { body: true, direction: true, senderGhii: true, recipientGhii: true },
            });
            const unread = await this.prisma.directMessage.count({
                where: { ownerGhii, conversationId: g.conversationId, direction: 'inbound', readAt: null },
            });
            // Thread subject = the one set on the message that opened it (earliest non-null subject).
            const subj = await this.prisma.directMessage.findFirst({
                where: { ownerGhii, conversationId: g.conversationId, subject: { not: null } },
                orderBy: { createdAt: 'asc' },
                select: { subject: true },
            });
            const lastDirection = (last?.direction ?? 'inbound') as 'inbound' | 'outbound';
            results.push({
                conversationId: g.conversationId,
                peerGhii: last ? (lastDirection === 'inbound' ? last.senderGhii : last.recipientGhii) : '',
                subject: subj?.subject ?? undefined,
                lastMessage: last?.body ?? '',
                lastDirection,
                messageCount: g._count._all,
                unread,
                updatedAt: g._max.createdAt instanceof Date ? g._max.createdAt.toISOString() : (g._max.createdAt ?? ''),
            });
        }
        results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return results;
    },

    async markMessageRead(this: PrismaStorage, id: string, ownerGhii: string): Promise<DirectMessageRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.directMessage.update({
                where: { id: this.dmDocId(id, ownerGhii) },
                data: { status: 'read', readAt: new Date() },
            });
            return this.toDirectMessageRecord(row);
        } catch { return null; }
    },

    async markConversationRead(this: PrismaStorage, ownerGhii: string, conversationId: string): Promise<number> {
        this.ensureReady();
        const res = await this.prisma.directMessage.updateMany({
            where: { ownerGhii, conversationId, direction: 'inbound', readAt: null },
            data: { status: 'read', readAt: new Date() },
        });
        return res.count;
    },

    async updateMessageDeliveryStatus(this: PrismaStorage, id: string, status: DirectMessageRecord['status'], extra?: { deliveredAt?: string; error?: string }): Promise<DirectMessageRecord | null> {
        this.ensureReady();
        // Delivery status lives on the sender's (outbound) copy.
        const outbound = await this.prisma.directMessage.findFirst({ where: { mid: id, direction: 'outbound' } });
        if (!outbound) return null;
        const data: Record<string, unknown> = { status };
        if (extra?.deliveredAt) data.deliveredAt = new Date(extra.deliveredAt);
        if (extra?.error !== undefined) data.error = extra.error;
        const row = await this.prisma.directMessage.update({ where: { id: outbound.id }, data });
        return this.toDirectMessageRecord(row);
    },

    async setMessageReadReceipt(this: PrismaStorage, id: string, readAt: string): Promise<DirectMessageRecord | null> {
        this.ensureReady();
        const outbound = await this.prisma.directMessage.findFirst({ where: { mid: id, direction: 'outbound' } });
        if (!outbound) return null;
        const row = await this.prisma.directMessage.update({ where: { id: outbound.id }, data: { status: 'read', readAt: new Date(readAt) } });
        return this.toDirectMessageRecord(row);
    },

    async listOutboundForRetry(this: PrismaStorage, limit = 200): Promise<DirectMessageRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.directMessage.findMany({
            where: { direction: 'outbound', status: { in: ['queued', 'failed'] } },
            orderBy: { createdAt: 'asc' },
            take: limit,
        });
        return rows.map((r: PrismaRow) => this.toDirectMessageRecord(r));
    },

    async listInboundWithAttachments(this: PrismaStorage, limit = 200): Promise<DirectMessageRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.directMessage.findMany({
            where: { direction: 'inbound', NOT: { attachments: { equals: null } } },
            orderBy: { createdAt: 'asc' },
            take: limit,
        });
        return rows.map((r: PrismaRow) => this.toDirectMessageRecord(r));
    },

    async updateMessageAttachments(this: PrismaStorage, id: string, ownerGhii: string, attachments: DirectMessageRecord['attachments']): Promise<DirectMessageRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.directMessage.update({
                where: { id: this.dmDocId(id, ownerGhii) },
                data: { attachments: (attachments) ?? null },
            });
            return this.toDirectMessageRecord(row);
        } catch { return null; }
    },

    async deleteDirectMessage(this: PrismaStorage, id: string, ownerGhii: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.directMessage.delete({ where: { id: this.dmDocId(id, ownerGhii) } });
            return true;
        } catch { return false; }
    },

    async appendMessageDeliveryLog(this: PrismaStorage, log: MessageDeliveryLog): Promise<void> {
        this.ensureReady();
        await this.prisma.messageDeliveryLog.create({
            data: {
                id: log.id, messageId: log.messageId, origin: log.origin, targetNodeId: log.targetNodeId,
                status: log.status, httpStatus: log.httpStatus ?? null, errorMessage: log.errorMessage ?? null,
                latencyMs: log.latencyMs, createdAt: new Date(log.createdAt),
            },
        });
    },

    toMessageDeliveryLog(this: PrismaStorage, row: PrismaRow): MessageDeliveryLog {
        const rec: MessageDeliveryLog = {
            id: row.id, messageId: row.messageId, origin: row.origin, targetNodeId: row.targetNodeId,
            status: row.status, latencyMs: row.latencyMs ?? 0,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
        if (row.httpStatus != null) rec.httpStatus = row.httpStatus;
        if (row.errorMessage) rec.errorMessage = row.errorMessage;
        return rec;
    },

    async listMessageDeliveryLogs(this: PrismaStorage, limit = 100): Promise<MessageDeliveryLog[]> {
        this.ensureReady();
        const rows = await this.prisma.messageDeliveryLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
        return rows.map((r: PrismaRow) => this.toMessageDeliveryLog(r));
    },

    async getMessageDeliveryStats(this: PrismaStorage): Promise<MessageDeliveryStats> {
        this.ensureReady();
        const since = new Date(Date.now() - 24 * 3600_000);
        const [all, recent] = await Promise.all([
            this.prisma.messageDeliveryLog.groupBy({ by: ['status'], _count: { _all: true } }),
            this.prisma.messageDeliveryLog.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
        ]);
        const byStatus: Record<string, number> = {};
        const byStatus24h: Record<string, number> = {};
        let total = 0, total24h = 0;
        for (const r of all) { byStatus[r.status] = r._count._all; total += r._count._all; }
        for (const r of recent) { byStatus24h[r.status] = r._count._all; total24h += r._count._all; }
        const nodes = await this.prisma.messageDeliveryLog.groupBy({ by: ['targetNodeId'], _count: { _all: true } });
        const topTargetNodes = await Promise.all(
            nodes.sort((a: PrismaRow, b: PrismaRow) => b._count._all - a._count._all).slice(0, 10).map(async (n: PrismaRow) => ({
                nodeId: n.targetNodeId,
                total: n._count._all,
                failed: await this.prisma.messageDeliveryLog.count({ where: { targetNodeId: n.targetNodeId, status: { in: ['failed', 'undeliverable'] } } }),
            })),
        );
        return { total, total24h, byStatus, byStatus24h, topTargetNodes };
    },

    async pruneMessageDeliveryLogs(this: PrismaStorage, keep = 10000): Promise<number> {
        this.ensureReady();
        const cutoff = await this.prisma.messageDeliveryLog.findMany({
            orderBy: { createdAt: 'desc' }, skip: keep, take: 1, select: { createdAt: true },
        });
        if (cutoff.length === 0) return 0;
        const res = await this.prisma.messageDeliveryLog.deleteMany({ where: { createdAt: { lt: cutoff[0].createdAt } } });
        return res.count;
    },

    async getContact(this: PrismaStorage, ownerGhii: string, contactId: string): Promise<ContactConsentRecord | null> {
        this.ensureReady();
        const row = await this.prisma.contactConsent.findUnique({ where: { id: this.contactDocId(ownerGhii, contactId) } });
        return row ? this.toContactRecord(row) : null;
    },

    async setContactState(this: PrismaStorage, ownerGhii: string, contactId: string, state: ContactConsentRecord['state'], firstMessageId?: string): Promise<ContactConsentRecord> {
        this.ensureReady();
        const now = new Date();
        const docId = this.contactDocId(ownerGhii, contactId);
        const row = await this.prisma.contactConsent.upsert({
            where: { id: docId },
            create: { id: docId, ownerGhii, contactId, state, firstMessageId: firstMessageId ?? null, createdAt: now, updatedAt: now },
            update: { state, ...(firstMessageId ? { firstMessageId } : {}), updatedAt: now },
        });
        return this.toContactRecord(row);
    },

    async listContacts(this: PrismaStorage, ownerGhii: string, opts?: { state?: ContactConsentRecord['state'] }): Promise<ContactConsentRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = { ownerGhii };
        if (opts?.state) where.state = opts.state;
        const rows = await this.prisma.contactConsent.findMany({ where, orderBy: { updatedAt: 'desc' } });
        return rows.map((r: PrismaRow) => this.toContactRecord(r));
    },

    // ══════════════════════════════════════════════════════════
    // ── Agent Onboarding ──
    // ══════════════════════════════════════════════════════════

    toOnboardingRecord(this: PrismaStorage, row: PrismaRow): AgentOnboardingRecord {
        return {
            agentGaii: row.agentGaii,
            status: row.status,
            startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : row.startedAt,
            completedAt: row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt ?? undefined,
            steps: row.steps as AgentOnboardingStep[],
            readinessScore: row.readinessScore ?? undefined,
            readinessLevel: row.readinessLevel ?? undefined,
            detectedPlatform: row.detectedPlatform ?? undefined,
            installedRuntime: row.installedRuntime ?? undefined,
            onboardingBaseline: row.onboardingBaseline ?? undefined,
            operationalHealth: row.operationalHealth ?? undefined,
            healthComponents: row.healthComponents as AgentOnboardingRecord['healthComponents'] ?? undefined,
            healthRecalculatedAt: row.healthRecalculatedAt instanceof Date ? row.healthRecalculatedAt.toISOString() : row.healthRecalculatedAt ?? undefined,
            readinessOverride: row.readinessOverride as AgentOnboardingRecord['readinessOverride'] ?? undefined,
        };
    },

    async createOnboarding(this: PrismaStorage, record: AgentOnboardingRecord): Promise<AgentOnboardingRecord> {
        this.ensureReady();
        const row = await this.prisma.agentOnboarding.create({
            data: {
                agentGaii: record.agentGaii,
                status: record.status,
                startedAt: new Date(record.startedAt),
                completedAt: record.completedAt ? new Date(record.completedAt) : null,
                steps: record.steps,
                readinessScore: record.readinessScore ?? null,
                readinessLevel: record.readinessLevel ?? null,
                detectedPlatform: record.detectedPlatform ?? null,
                installedRuntime: record.installedRuntime ?? null,
                onboardingBaseline: record.onboardingBaseline ?? null,
                operationalHealth: record.operationalHealth ?? null,
                healthComponents: record.healthComponents ?? null,
                healthRecalculatedAt: record.healthRecalculatedAt ? new Date(record.healthRecalculatedAt) : null,
                readinessOverride: record.readinessOverride ?? null,
            },
        });
        return this.toOnboardingRecord(row);
    },

    async getOnboarding(this: PrismaStorage, agentGaii: string): Promise<AgentOnboardingRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.agentOnboarding.findUnique({ where: { agentGaii } });
            return row ? this.toOnboardingRecord(row) : null;
        } catch {
            return null;
        }
    },

    async updateOnboarding(this: PrismaStorage, agentGaii: string, updates: Partial<AgentOnboardingRecord>): Promise<AgentOnboardingRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.status !== undefined) data.status = updates.status;
            if (updates.startedAt !== undefined) data.startedAt = new Date(updates.startedAt);
            if (updates.completedAt !== undefined) data.completedAt = updates.completedAt ? new Date(updates.completedAt) : null;
            if (updates.steps !== undefined) data.steps = updates.steps;
            if (updates.readinessScore !== undefined) data.readinessScore = updates.readinessScore ?? null;
            if (updates.readinessLevel !== undefined) data.readinessLevel = updates.readinessLevel ?? null;
            if (updates.detectedPlatform !== undefined) data.detectedPlatform = updates.detectedPlatform ?? null;
            if (updates.installedRuntime !== undefined) data.installedRuntime = updates.installedRuntime ?? null;
            if (updates.onboardingBaseline !== undefined) data.onboardingBaseline = updates.onboardingBaseline ?? null;
            if (updates.operationalHealth !== undefined) data.operationalHealth = updates.operationalHealth ?? null;
            if (updates.healthComponents !== undefined) data.healthComponents = updates.healthComponents ?? null;
            if (updates.healthRecalculatedAt !== undefined) data.healthRecalculatedAt = updates.healthRecalculatedAt ? new Date(updates.healthRecalculatedAt) : null;
            if (updates.readinessOverride !== undefined) data.readinessOverride = updates.readinessOverride ?? null;
            const row = await this.prisma.agentOnboarding.update({ where: { agentGaii }, data });
            return this.toOnboardingRecord(row);
        } catch {
            return null;
        }
    },

    async deleteOnboarding(this: PrismaStorage, agentGaii: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.agentOnboarding.delete({ where: { agentGaii } });
            return true;
        } catch {
            return false;
        }
    },

    async listOnboardingByOwner(this: PrismaStorage, owner: string): Promise<AgentOnboardingRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.agentOnboarding.findMany({
            where: { agentGaii: { contains: `#${owner}@` } },
            orderBy: { startedAt: 'desc' },
        });
        return rows.map((r: PrismaRow) => this.toOnboardingRecord(r));
    },

    async listOnboardingByStatus(this: PrismaStorage, status: string): Promise<AgentOnboardingRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.agentOnboarding.findMany({
            where: { status },
            orderBy: { startedAt: 'desc' },
        });
        return rows.map((r: PrismaRow) => this.toOnboardingRecord(r));
    },

    // ── Agent Telemetry ──

    toTelemetryEvent(this: PrismaStorage, row: PrismaRow): TelemetryEvent {
        return {
            id: row.id,
            agentGaii: row.agentGaii,
            type: row.type,
            data: row.data as Record<string, unknown>,
            sessionId: row.sessionId ?? undefined,
            taskId: row.taskId ?? undefined,
            createdAt: row.createdAt.toISOString(),
        };
    },

    async appendTelemetry(this: PrismaStorage, event: TelemetryEvent): Promise<void> {
        this.ensureReady();
        await this.prisma.telemetryEvent.create({
            data: {
                id: event.id,
                agentGaii: event.agentGaii,
                type: event.type,
                data: event.data,
                sessionId: event.sessionId ?? null,
                taskId: event.taskId ?? null,
                createdAt: new Date(event.createdAt),
            },
        });
    },

    async listTelemetry(this: PrismaStorage, agentGaii: string, opts: { since?: string; type?: string; limit?: number }): Promise<TelemetryEvent[]> {
        this.ensureReady();
        const where: Record<string, unknown> = { agentGaii };
        if (opts.type) where.type = opts.type;
        if (opts.since) where.createdAt = { gt: new Date(opts.since) };
        const rows = await this.prisma.telemetryEvent.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: opts.limit ?? 50,
        });
        return rows.map((r: PrismaRow) => this.toTelemetryEvent(r));
    },

    // ── Webhook Delivery Log ──

    toDeliveryLog(this: PrismaStorage, row: PrismaRow): WebhookDeliveryLog {
        return {
            id: row.id,
            agentGaii: row.agentGaii,
            event: row.event,
            payload: row.payload as Record<string, unknown>,
            status: row.status as 'success' | 'failed',
            httpStatus: row.httpStatus ?? undefined,
            errorMessage: row.errorMessage ?? undefined,
            attemptCount: row.attemptCount,
            latencyMs: row.latencyMs,
            createdAt: row.createdAt.toISOString(),
        };
    },

    async appendDeliveryLog(this: PrismaStorage, log: WebhookDeliveryLog): Promise<void> {
        this.ensureReady();
        await this.prisma.webhookDeliveryLog.create({
            data: {
                id: log.id,
                agentGaii: log.agentGaii,
                event: log.event,
                payload: log.payload,
                status: log.status,
                httpStatus: log.httpStatus ?? null,
                errorMessage: log.errorMessage ?? null,
                attemptCount: log.attemptCount,
                latencyMs: log.latencyMs,
                createdAt: new Date(log.createdAt),
            },
        });
    },

    async listDeliveryLog(this: PrismaStorage, agentGaii: string, limit?: number): Promise<WebhookDeliveryLog[]> {
        this.ensureReady();
        const rows = await this.prisma.webhookDeliveryLog.findMany({
            where: { agentGaii },
            orderBy: { createdAt: 'desc' },
            take: limit ?? 50,
        });
        return rows.map((r: PrismaRow) => this.toDeliveryLog(r));
    },

    async pruneDeliveryLog(this: PrismaStorage, agentGaii: string, keepCount: number): Promise<number> {
        this.ensureReady();
        // Find the cutoff: the keepCount-th newest record's createdAt
        const cutoffRows = await this.prisma.webhookDeliveryLog.findMany({
            where: { agentGaii },
            orderBy: { createdAt: 'desc' },
            skip: keepCount,
            take: 1,
            select: { createdAt: true },
        });
        if (cutoffRows.length === 0) return 0;
        const cutoff = cutoffRows[0].createdAt;
        const result = await this.prisma.webhookDeliveryLog.deleteMany({
            where: { agentGaii, createdAt: { lte: cutoff } },
        });
        return result.count;
    },
};
