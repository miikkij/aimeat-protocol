/**
 * @file src/storage/providers/mongodb/methods/tasks.ts
 * @description Stats, agent tasks, sharing groups, agent directives, agent activity, and LLM usage-ledger methods. Extracted from mongodb/index.ts (PrismaStorage) to satisfy max-file-lines; method bodies verbatim, bound to PrismaStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/mongodb/index.ts (max-file-lines)
 */
import type {
  AgentTaskRecord, AgentTaskEventRecord, AgentDirectivesRecord, OwnerAgentDefaults, SharingGroupRecord, AgentActivityRecord, AgentUsageEvent, AgentUsageDailyRecord, UsageDailyFilter, UsageEventFilter, AdminUsageDailyFilter
} from '../../../interface.js';
import type { PrismaStorage, PrismaRow } from '../index.js';

export const tasksMethods = {
    // ── Stats Persistence ──

    async flushStats(this: PrismaStorage, counters: Record<string, number>): Promise<void> {
        const ops = Object.entries(counters).map(([key, value]) =>
            this.prisma.statsCounter.upsert({
                where: { id: key },
                create: { id: key, value },
                update: { value },
            })
        );
        await Promise.all(ops);
    },

    async loadStats(this: PrismaStorage): Promise<Record<string, number>> {
        const rows = await this.prisma.statsCounter.findMany();
        const result: Record<string, number> = {};
        for (const row of rows) {
            result[row.id] = row.value;
        }
        return result;
    },

    async flushDailyHistory(this: PrismaStorage, history: Record<string, Record<string, number>>): Promise<void> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const cutoffStr = cutoff.toISOString().split('T')[0];

        const ops: Promise<unknown>[] = [];
        for (const [date, counters] of Object.entries(history)) {
            for (const [key, value] of Object.entries(counters)) {
                ops.push(
                    this.prisma.statsDailyHistory.upsert({
                        where: { date_key: { date, key } },
                        create: { date, key, value },
                        update: { value },
                    })
                );
            }
        }
        ops.push(
            this.prisma.statsDailyHistory.deleteMany({ where: { date: { lt: cutoffStr } } })
        );
        await Promise.all(ops);
    },

    async loadDailyHistory(this: PrismaStorage): Promise<Record<string, Record<string, number>>> {
        const rows = await this.prisma.statsDailyHistory.findMany({ orderBy: { date: 'asc' } });
        const result: Record<string, Record<string, number>> = {};
        for (const row of rows) {
            if (!result[row.date]) result[row.date] = {};
            result[row.date][row.key] = row.value;
        }
        return result;
    },

    // ── Agent Tasks ──

    toTaskRecord(this: PrismaStorage, row: PrismaRow): AgentTaskRecord {
        return {
            id: row.id,
            agentGaii: row.agentGaii,
            ownerGaii: row.ownerGaii,
            title: row.title,
            description: row.description,
            scope: row.scope as AgentTaskRecord['scope'],
            rules: row.rules as string[],
            verification: row.verification as AgentTaskRecord['verification'],
            resources: row.resources as AgentTaskRecord['resources'] ?? undefined,
            todos: row.todos as AgentTaskRecord['todos'],
            status: row.status as AgentTaskRecord['status'],
            parentTaskId: row.parentTaskId ?? undefined,
            workTrackingCode: row.workTrackingCode ?? undefined,
            telemetry: row.telemetry as AgentTaskRecord['telemetry'] ?? undefined,
            lastEventAt: row.lastEventAt ? (row.lastEventAt instanceof Date ? row.lastEventAt.toISOString() : row.lastEventAt) : undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
            completedAt: row.completedAt ? (row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt) : undefined,
            deliverableKey: row.deliverableKey ?? undefined,
            rating: row.rating as AgentTaskRecord['rating'] ?? undefined,
            triage: (row.triage ?? undefined) as AgentTaskRecord['triage'],
            automation: (row.automation ?? undefined) as AgentTaskRecord['automation'],
        };
    },

    toTaskEventRecord(this: PrismaStorage, row: PrismaRow): AgentTaskEventRecord {
        return {
            id: row.id,
            taskId: row.taskId,
            type: row.type as AgentTaskEventRecord['type'],
            message: row.message,
            details: row.details as Record<string, unknown> | undefined ?? undefined,
            timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
        };
    },

    async createAgentTask(this: PrismaStorage, record: AgentTaskRecord): Promise<AgentTaskRecord> {
        this.ensureReady();
        await this.prisma.agentTask.create({
            data: {
                id: record.id,
                agentGaii: record.agentGaii,
                ownerGaii: record.ownerGaii,
                title: record.title,
                description: record.description,
                scope: record.scope,
                rules: record.rules,
                verification: record.verification,
                resources: record.resources ?? null,
                todos: record.todos,
                status: record.status,
                parentTaskId: record.parentTaskId ?? null,
                workTrackingCode: record.workTrackingCode ?? null,
                telemetry: record.telemetry ?? null,
                lastEventAt: record.lastEventAt ? new Date(record.lastEventAt) : null,
                createdAt: new Date(record.createdAt),
                completedAt: record.completedAt ? new Date(record.completedAt) : null,
                deliverableKey: record.deliverableKey ?? null,
                rating: record.rating ?? null,
                triage: record.triage ?? null,
                automation: record.automation ?? null,
            },
        });
        return record;
    },

    async getAgentTask(this: PrismaStorage, id: string): Promise<AgentTaskRecord | null> {
        this.ensureReady();
        const row = await this.prisma.agentTask.findUnique({ where: { id } });
        return row ? this.toTaskRecord(row) : null;
    },

    async listAgentTasks(this: PrismaStorage, agentGaii: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<{ tasks: AgentTaskRecord[]; total: number }> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: Record<string, unknown> = { agentGaii };
        if (opts?.status) where.status = opts.status;

        const [rows, total] = await Promise.all([
            this.prisma.agentTask.findMany({
                where,
                orderBy: { updatedAt: 'desc' },
                skip: (page - 1) * perPage,
                take: perPage,
            }),
            this.prisma.agentTask.count({ where }),
        ]);
        return { tasks: rows.map((r: PrismaRow) => this.toTaskRecord(r)), total };
    },

    async listAgentTasksByOwner(this: PrismaStorage, ownerGaii: string, opts?: { status?: string; agentGaii?: string; page?: number; perPage?: number }): Promise<{ tasks: AgentTaskRecord[]; total: number }> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: Record<string, unknown> = { ownerGaii };
        if (opts?.agentGaii) where.agentGaii = opts.agentGaii;
        if (opts?.status) where.status = opts.status;

        const [rows, total] = await Promise.all([
            this.prisma.agentTask.findMany({
                where,
                orderBy: { updatedAt: 'desc' },
                skip: (page - 1) * perPage,
                take: perPage,
            }),
            this.prisma.agentTask.count({ where }),
        ]);
        return { tasks: rows.map((r: PrismaRow) => this.toTaskRecord(r)), total };
    },

    async updateAgentTask(this: PrismaStorage, id: string, updates: Partial<AgentTaskRecord>): Promise<AgentTaskRecord | null> {
        this.ensureReady();
        const existing = await this.getAgentTask(id);
        if (!existing) return null;

        const merged: AgentTaskRecord = {
            ...existing,
            ...updates,
            id: existing.id,
            agentGaii: existing.agentGaii,
            ownerGaii: existing.ownerGaii,
            createdAt: existing.createdAt,
        };

        try {
            const row = await this.prisma.agentTask.update({
                where: { id },
                data: {
                    title: merged.title,
                    description: merged.description,
                    scope: merged.scope,
                    rules: merged.rules,
                    verification: merged.verification,
                    resources: merged.resources ?? null,
                    todos: merged.todos,
                    status: merged.status,
                    parentTaskId: merged.parentTaskId ?? null,
                    workTrackingCode: merged.workTrackingCode ?? null,
                    telemetry: merged.telemetry ?? null,
                    lastEventAt: merged.lastEventAt ? new Date(merged.lastEventAt) : null,
                    completedAt: merged.completedAt ? new Date(merged.completedAt) : null,
                    deliverableKey: merged.deliverableKey ?? null,
                    rating: merged.rating ?? null,
                    triage: merged.triage ?? null,
                    automation: merged.automation ?? null,
                },
            });
            return this.toTaskRecord(row);
        } catch { return null; }
    },

    async deleteAgentTask(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try {
            // Any non-active task is deletable; an active (running) task must be
            // cancelled/paused first so we never orphan a live runner. The status
            // guard is also a race safety-net for the route-level check.
            const result = await this.prisma.agentTask.deleteMany({
                where: { id, status: { not: 'active' } },
            });
            if (result.count > 0) {
                await this.prisma.agentTaskEvent.deleteMany({ where: { taskId: id } });
                return true;
            }
            return false;
        } catch { return false; }
    },

    async appendTaskEvent(this: PrismaStorage, event: AgentTaskEventRecord): Promise<AgentTaskEventRecord> {
        this.ensureReady();
        const row = await this.prisma.agentTaskEvent.create({
            data: {
                taskId: event.taskId,
                type: event.type,
                message: event.message,
                details: event.details ?? null,
                timestamp: new Date(event.timestamp),
            },
        });
        return this.toTaskEventRecord(row);
    },

    async listTaskEvents(this: PrismaStorage, taskId: string, opts?: { page?: number; perPage?: number }): Promise<{ events: AgentTaskEventRecord[]; total: number }> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where = { taskId };

        const [rows, total] = await Promise.all([
            this.prisma.agentTaskEvent.findMany({
                where,
                orderBy: { timestamp: 'asc' },
                skip: (page - 1) * perPage,
                take: perPage,
            }),
            this.prisma.agentTaskEvent.count({ where }),
        ]);
        return { events: rows.map((r: PrismaRow) => this.toTaskEventRecord(r)), total };
    },

    async countTasksByAgent(this: PrismaStorage, agentGaii: string): Promise<{ queued: number; active: number; done: number; failed: number }> {
        this.ensureReady();
        const rows = await this.prisma.agentTask.groupBy({
            by: ['status'],
            where: { agentGaii },
            _count: true,
        });
        const counts = { queued: 0, active: 0, done: 0, failed: 0 };
        for (const row of rows) {
            if (row.status in counts) {
                counts[row.status as keyof typeof counts] = row._count;
            }
        }
        return counts;
    },

    async countTasksByOwner(this: PrismaStorage, ownerGaii: string): Promise<Record<string, { queued: number; active: number; done: number; failed: number; doneToday: number; lastTaskUpdateAt: string | null; lastFailedAt: string | null }>> {
        this.ensureReady();
        const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : (d as string | null) ?? null);
        const dayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
        const grouped = await this.prisma.agentTask.groupBy({
            by: ['agentGaii', 'status'],
            where: { ownerGaii },
            _count: true,
            _max: { updatedAt: true },
        });
        const doneTodayRows = await this.prisma.agentTask.groupBy({
            by: ['agentGaii'],
            where: { ownerGaii, status: 'done', completedAt: { gte: dayStart } },
            _count: true,
        });
        const out: Record<string, { queued: number; active: number; done: number; failed: number; doneToday: number; lastTaskUpdateAt: string | null; lastFailedAt: string | null }> = {};
        const ensure = (g: string) => out[g] ?? (out[g] = { queued: 0, active: 0, done: 0, failed: 0, doneToday: 0, lastTaskUpdateAt: null, lastFailedAt: null });
        for (const row of grouped as Array<{ agentGaii: string; status: string; _count: number; _max: { updatedAt: Date | null } }>) {
            const e = ensure(row.agentGaii);
            const cnt = typeof row._count === 'number' ? row._count : 0;
            if (row.status === 'queued') e.queued = cnt;
            else if (row.status === 'active') e.active = cnt;
            else if (row.status === 'done') e.done = cnt;
            else if (row.status === 'failed') e.failed = cnt;
            const upd = iso(row._max?.updatedAt);
            if (upd && (!e.lastTaskUpdateAt || upd > e.lastTaskUpdateAt)) e.lastTaskUpdateAt = upd;
            if (row.status === 'failed' && upd) e.lastFailedAt = upd;
        }
        for (const row of doneTodayRows as Array<{ agentGaii: string; _count: number }>) {
            ensure(row.agentGaii).doneToday = typeof row._count === 'number' ? row._count : 0;
        }
        return out;
    },

    async findStalledTasks(this: PrismaStorage, thresholdMinutes: number): Promise<AgentTaskRecord[]> {
        this.ensureReady();
        const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
        const rows = await this.prisma.agentTask.findMany({
            where: {
                status: 'active',
                lastEventAt: { not: null, lt: threshold },
            },
        });
        return rows.map((r: PrismaRow) => this.toTaskRecord(r));
    },

    // ── Sharing Groups ──

    toSharingGroupRecord(this: PrismaStorage, row: PrismaRow): SharingGroupRecord {
        const record: SharingGroupRecord = {
            id: row.id,
            name: row.name,
            ownerGaii: row.ownerGaii,
            members: row.members as SharingGroupRecord['members'],
            defaultPermissions: row.defaultPermissions as SharingGroupRecord['defaultPermissions'],
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
        if (row.description) record.description = row.description;
        return record;
    },

    async createSharingGroup(this: PrismaStorage, record: SharingGroupRecord): Promise<SharingGroupRecord> {
        this.ensureReady();
        await this.prisma.sharingGroup.create({
            data: {
                id: record.id,
                name: record.name,
                description: record.description ?? null,
                ownerGaii: record.ownerGaii,
                members: record.members,
                defaultPermissions: record.defaultPermissions,
                createdAt: new Date(record.createdAt),
            },
        });
        return record;
    },

    async getSharingGroup(this: PrismaStorage, id: string): Promise<SharingGroupRecord | null> {
        this.ensureReady();
        const row = await this.prisma.sharingGroup.findUnique({ where: { id } });
        return row ? this.toSharingGroupRecord(row) : null;
    },

    async listSharingGroups(this: PrismaStorage, ownerGaii: string): Promise<SharingGroupRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.sharingGroup.findMany({
            where: { ownerGaii },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map((r: PrismaRow) => this.toSharingGroupRecord(r));
    },

    async listSharingGroupsByMember(this: PrismaStorage, identifier: string): Promise<SharingGroupRecord[]> {
        this.ensureReady();
        // MongoDB JSON arrays can't be queried with SQL json_each; filter in memory
        const allGroups = await this.prisma.sharingGroup.findMany();
        return allGroups
            .filter((g: PrismaRow) => {
                const members = g.members as Array<{ identifier: string }>;
                return Array.isArray(members) && members.some(m => m.identifier === identifier);
            })
            .map((r: PrismaRow) => this.toSharingGroupRecord(r));
    },

    async updateSharingGroup(this: PrismaStorage, id: string, updates: Partial<SharingGroupRecord>): Promise<SharingGroupRecord | null> {
        this.ensureReady();
        const existing = await this.getSharingGroup(id);
        if (!existing) return null;

        const merged: SharingGroupRecord = {
            ...existing,
            ...updates,
            id: existing.id,
            ownerGaii: existing.ownerGaii,
            createdAt: existing.createdAt,
        };

        try {
            const row = await this.prisma.sharingGroup.update({
                where: { id },
                data: {
                    name: merged.name,
                    description: merged.description ?? null,
                    members: merged.members,
                    defaultPermissions: merged.defaultPermissions,
                },
            });
            return this.toSharingGroupRecord(row);
        } catch { return null; }
    },

    async deleteSharingGroup(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.sharingGroup.delete({ where: { id } });
            return true;
        } catch { return false; }
    },

    async countEntriesReferencingGroup(this: PrismaStorage, groupId: string): Promise<number> {
        this.ensureReady();
        const [memoryCount, fileCount] = await Promise.all([
            this.prisma.memory.count({ where: { groupId } }),
            this.prisma.storageFile.count({ where: { groupId } }),
        ]);
        return memoryCount + fileCount;
    },

    // ── Agent Directives ──

    toDirectivesRecord(this: PrismaStorage, row: PrismaRow): AgentDirectivesRecord {
        const record: AgentDirectivesRecord = {
            agentGaii: row.agentGaii,
            purpose: row.purpose,
            rules: row.rules as AgentDirectivesRecord['rules'],
            memoryAreas: row.memoryAreas as AgentDirectivesRecord['memoryAreas'],
            resources: row.resources as AgentDirectivesRecord['resources'],
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
        if (row.budgetLimits) record.budgetLimits = row.budgetLimits as AgentDirectivesRecord['budgetLimits'];
        return record;
    },

    toOwnerDefaultsRecord(this: PrismaStorage, row: PrismaRow): OwnerAgentDefaults {
        const record: OwnerAgentDefaults = {
            ownerGaii: row.ownerGaii,
            rules: row.rules as OwnerAgentDefaults['rules'],
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
        if (row.defaultTokenBudget != null) record.defaultTokenBudget = row.defaultTokenBudget;
        if (row.defaultMemoryAreas) record.defaultMemoryAreas = row.defaultMemoryAreas as OwnerAgentDefaults['defaultMemoryAreas'];
        return record;
    },

    async getAgentDirectives(this: PrismaStorage, agentGaii: string): Promise<AgentDirectivesRecord | null> {
        this.ensureReady();
        const row = await this.prisma.agentDirective.findUnique({ where: { agentGaii } });
        return row ? this.toDirectivesRecord(row) : null;
    },

    async upsertAgentDirectives(this: PrismaStorage, record: AgentDirectivesRecord): Promise<AgentDirectivesRecord> {
        this.ensureReady();
        const row = await this.prisma.agentDirective.upsert({
            where: { agentGaii: record.agentGaii },
            create: {
                id: `dir-${record.agentGaii}`,
                agentGaii: record.agentGaii,
                purpose: record.purpose,
                rules: record.rules,
                memoryAreas: record.memoryAreas,
                resources: record.resources,
                budgetLimits: record.budgetLimits ?? null,
            },
            update: {
                purpose: record.purpose,
                rules: record.rules,
                memoryAreas: record.memoryAreas,
                resources: record.resources,
                budgetLimits: record.budgetLimits ?? null,
            },
        });
        return this.toDirectivesRecord(row);
    },

    async deleteAgentDirectives(this: PrismaStorage, agentGaii: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.agentDirective.delete({ where: { agentGaii } });
            return true;
        } catch { return false; }
    },

    async getOwnerAgentDefaults(this: PrismaStorage, ownerGaii: string): Promise<OwnerAgentDefaults | null> {
        this.ensureReady();
        const row = await this.prisma.ownerAgentDefault.findUnique({ where: { ownerGaii } });
        return row ? this.toOwnerDefaultsRecord(row) : null;
    },

    async upsertOwnerAgentDefaults(this: PrismaStorage, record: OwnerAgentDefaults): Promise<OwnerAgentDefaults> {
        this.ensureReady();
        const row = await this.prisma.ownerAgentDefault.upsert({
            where: { ownerGaii: record.ownerGaii },
            create: {
                id: `owd-${record.ownerGaii}`,
                ownerGaii: record.ownerGaii,
                rules: record.rules,
                defaultTokenBudget: record.defaultTokenBudget ?? null,
                defaultMemoryAreas: record.defaultMemoryAreas ?? [],
            },
            update: {
                rules: record.rules,
                defaultTokenBudget: record.defaultTokenBudget ?? null,
                defaultMemoryAreas: record.defaultMemoryAreas ?? [],
            },
        });
        return this.toOwnerDefaultsRecord(row);
    },

    // ── Agent Activity ──

    toActivityRecord(this: PrismaStorage, row: PrismaRow): AgentActivityRecord {
        return {
            agentGaii: row.agentGaii,
            date: row.date,
            hour: row.hour,
            metric: row.metric,
            value: row.value,
        };
    },

    async recordActivity(this: PrismaStorage, record: AgentActivityRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.agentActivity.upsert({
            where: {
                agentGaii_date_hour_metric: {
                    agentGaii: record.agentGaii,
                    date: record.date,
                    hour: record.hour,
                    metric: record.metric,
                },
            },
            create: {
                agentGaii: record.agentGaii,
                date: record.date,
                hour: record.hour,
                metric: record.metric,
                value: record.value,
            },
            update: {
                value: { increment: record.value },
            },
        });
    },

    async getActivityHistory(this: PrismaStorage, agentGaii: string, opts?: { days?: number; granularity?: 'daily' | 'hourly' }): Promise<AgentActivityRecord[]> {
        this.ensureReady();
        const days = opts?.days ?? 30;
        const granularity = opts?.granularity ?? 'daily';
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().split('T')[0];

        if (granularity === 'daily') {
            const rows = await this.prisma.agentActivity.groupBy({
                by: ['agentGaii', 'date', 'metric'],
                where: { agentGaii, date: { gte: cutoffStr } },
                _sum: { value: true },
                orderBy: { date: 'asc' },
            });
            return rows.map((r: PrismaRow) => ({
                agentGaii: r.agentGaii,
                date: r.date,
                hour: 0,
                metric: r.metric,
                value: r._sum.value ?? 0,
            }));
        }

        // hourly granularity
        const rows = await this.prisma.agentActivity.findMany({
            where: { agentGaii, date: { gte: cutoffStr } },
            orderBy: [{ date: 'asc' }, { hour: 'asc' }],
        });
        return rows.map((r: PrismaRow) => this.toActivityRecord(r));
    },

    // ── Agent LLM Usage Ledger (LEDGER / TARGET-016) ──

    async appendUsageEvent(this: PrismaStorage, event: AgentUsageEvent): Promise<void> {
        this.ensureReady();
        await this.prisma.agentUsageEvent.create({
            data: {
                id: event.id,
                ts: event.ts,
                agentGaii: event.agentGaii,
                ownerGhii: event.ownerGhii,
                runId: event.runId ?? null,
                model: event.model,
                provider: event.provider,
                promptTokens: event.promptTokens,
                completionTokens: event.completionTokens,
                costUsd: event.costUsd,
                priceRef: event.priceRef,
                source: event.source,
                apiKeyScope: event.apiKeyScope,
                organismId: event.organismId ?? null,
                workspaceId: event.workspaceId ?? null,
                capabilityId: event.capabilityId ?? null,
                consumerGhii: event.consumerGhii ?? null,
            },
        });
    },

    async incrementUsageDaily(this: PrismaStorage, d: AgentUsageDailyRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.agentUsageDaily.upsert({
            where: {
                date_agentGaii_ownerGhii_apiKeyScope_model_provider_organismId_workspaceId: {
                    date: d.date,
                    agentGaii: d.agentGaii,
                    ownerGhii: d.ownerGhii,
                    apiKeyScope: d.apiKeyScope,
                    model: d.model,
                    provider: d.provider,
                    organismId: d.organismId,
                    workspaceId: d.workspaceId,
                },
            },
            create: {
                date: d.date,
                agentGaii: d.agentGaii,
                ownerGhii: d.ownerGhii,
                apiKeyScope: d.apiKeyScope,
                model: d.model,
                provider: d.provider,
                organismId: d.organismId,
                workspaceId: d.workspaceId,
                promptTokens: d.promptTokens,
                completionTokens: d.completionTokens,
                costUsd: d.costUsd,
                calls: d.calls,
                unpricedCalls: d.unpricedCalls,
            },
            update: {
                promptTokens: { increment: d.promptTokens },
                completionTokens: { increment: d.completionTokens },
                costUsd: { increment: d.costUsd },
                calls: { increment: d.calls },
                unpricedCalls: { increment: d.unpricedCalls },
            },
        });
    },

    async queryUsageDaily(this: PrismaStorage, filter: UsageDailyFilter): Promise<AgentUsageDailyRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = { ownerGhii: filter.ownerGhii };
        if (filter.agentGaii) where.agentGaii = filter.agentGaii;
        if (filter.organismId !== undefined) where.organismId = filter.organismId;
        if (filter.workspaceId !== undefined) where.workspaceId = filter.workspaceId;
        if (filter.from || filter.to) {
            where.date = {};
            if (filter.from) (where.date as Record<string, unknown>).gte = filter.from;
            if (filter.to) (where.date as Record<string, unknown>).lte = filter.to;
        }
        const rows = await this.prisma.agentUsageDaily.findMany({ where, orderBy: { date: 'asc' } });
        return rows.map((r: PrismaRow) => ({
            date: r.date,
            agentGaii: r.agentGaii,
            ownerGhii: r.ownerGhii,
            apiKeyScope: r.apiKeyScope,
            model: r.model,
            provider: r.provider,
            organismId: r.organismId ?? '',
            workspaceId: r.workspaceId ?? '',
            promptTokens: r.promptTokens,
            completionTokens: r.completionTokens,
            costUsd: r.costUsd,
            calls: r.calls,
            unpricedCalls: r.unpricedCalls,
        }));
    },

    async queryUsageDailyAllOwners(this: PrismaStorage, filter: AdminUsageDailyFilter): Promise<AgentUsageDailyRecord[]> {
        this.ensureReady();
        // OPERATOR-ONLY: no ownerGhii filter — the route gates on the operator role.
        const where: Record<string, unknown> = {};
        if (filter.from || filter.to) {
            where.date = {};
            if (filter.from) (where.date as Record<string, unknown>).gte = filter.from;
            if (filter.to) (where.date as Record<string, unknown>).lte = filter.to;
        }
        const rows = await this.prisma.agentUsageDaily.findMany({ where, orderBy: { date: 'asc' } });
        return rows.map((r: PrismaRow) => ({
            date: r.date,
            agentGaii: r.agentGaii,
            ownerGhii: r.ownerGhii,
            apiKeyScope: r.apiKeyScope,
            model: r.model,
            provider: r.provider,
            organismId: r.organismId ?? '',
            workspaceId: r.workspaceId ?? '',
            promptTokens: r.promptTokens,
            completionTokens: r.completionTokens,
            costUsd: r.costUsd,
            calls: r.calls,
            unpricedCalls: r.unpricedCalls,
        }));
    },

    async listUsageEvents(this: PrismaStorage, filter: UsageEventFilter): Promise<AgentUsageEvent[]> {
        this.ensureReady();
        const where: Record<string, unknown> = { ownerGhii: filter.ownerGhii };
        if (filter.agentGaii) where.agentGaii = filter.agentGaii;
        if (filter.runId) where.runId = filter.runId;
        if (filter.capabilityId) where.capabilityId = filter.capabilityId;
        if (filter.hasCapability) where.capabilityId = { not: null };
        if (filter.from || filter.to) {
            where.ts = {};
            if (filter.from) (where.ts as Record<string, unknown>).gte = filter.from;
            if (filter.to) (where.ts as Record<string, unknown>).lte = filter.to;
        }
        const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
        const rows = await this.prisma.agentUsageEvent.findMany({
            where,
            orderBy: { ts: 'desc' },
            take: limit,
        });
        return rows.map((r: PrismaRow) => ({
            id: r.id,
            ts: r.ts,
            agentGaii: r.agentGaii,
            ownerGhii: r.ownerGhii,
            runId: r.runId ?? undefined,
            model: r.model,
            provider: r.provider,
            promptTokens: r.promptTokens,
            completionTokens: r.completionTokens,
            costUsd: r.costUsd === null || r.costUsd === undefined ? null : r.costUsd,
            priceRef: r.priceRef ?? null,
            source: r.source,
            apiKeyScope: r.apiKeyScope,
            organismId: r.organismId ?? undefined,
            workspaceId: r.workspaceId ?? undefined,
            capabilityId: r.capabilityId ?? undefined,
            consumerGhii: r.consumerGhii ?? undefined,
        }));
    },
};
