/**
 * @file src/storage/providers/mongodb/methods/ecosystem.ts
 * @description Ecosystem applications, automation recipes, OAuth 2.1 state, system prompts, and package-repository methods. Extracted from mongodb/index.ts (PrismaStorage) to satisfy max-file-lines; method bodies verbatim, bound to PrismaStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/mongodb/index.ts (max-file-lines)
 */
import type {
  DeviceAuthorizationRecord, EcosystemAppRecord, EcoAuthorizationRecord, EcoAutomationRecipe, OAuthClientRecord, OAuthRefreshTokenRecord, OAuthApprovalRecord, SystemPromptRecord, SystemPromptVersionRecord, PackageRecord, PackageComponent, PackageFilter
} from '../../../interface.js';
import { logger } from '../../../../utils/logger.js';
import type { PrismaStorage, PrismaRow } from '../index.js';

export const ecosystemMethods = {
    // ── Ecosystem Applications (GEAI) + hello-integration handshake ──
    async createEcosystemApp(this: PrismaStorage, app: EcosystemAppRecord): Promise<EcosystemAppRecord> {
        this.ensureReady();
        const row = await this.prisma.ecosystemApp.create({
            data: {
                geai: app.geai,
                app: app.app,
                owner: app.owner,
                displayName: app.displayName ?? null,
                description: app.description ?? null,
                publicKey: app.publicKey,
                scopes: app.scopes ?? [],
                dataAreas: (app.dataAreas) ?? null,
                boundRef: app.boundRef ?? null,
                status: app.status,
                morselBalance: app.morselBalance ?? 0,
                capabilities: (app.capabilities) ?? undefined,
                automation: (app.automation) ?? undefined,
                setup: (app.setup) ?? undefined,
                createdAt: new Date(app.createdAt),
                lastSeen: new Date(app.lastSeen),
            },
        });
        return this.toEcosystemAppRecord(row);
    },

    async getEcosystemApp(this: PrismaStorage, geai: string): Promise<EcosystemAppRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ecosystemApp.findUnique({ where: { geai } });
        return row ? this.toEcosystemAppRecord(row) : null;
    },

    async getEcosystemAppByOwnerAndApp(this: PrismaStorage, owner: string, app: string): Promise<EcosystemAppRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ecosystemApp.findFirst({ where: { owner, app } });
        return row ? this.toEcosystemAppRecord(row) : null;
    },

    async getEcosystemAppsByOwner(this: PrismaStorage, owner: string): Promise<EcosystemAppRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.ecosystemApp.findMany({ where: { owner } });
        return rows.map((r: PrismaRow) => this.toEcosystemAppRecord(r));
    },

    async updateEcosystemApp(this: PrismaStorage, geai: string, updates: Partial<EcosystemAppRecord>): Promise<EcosystemAppRecord | null> {
        this.ensureReady();
        const data: Record<string, unknown> = {};
        if (updates.app !== undefined) data.app = updates.app;
        if (updates.owner !== undefined) data.owner = updates.owner;
        if (updates.displayName !== undefined) data.displayName = updates.displayName;
        if (updates.description !== undefined) data.description = updates.description;
        if (updates.publicKey !== undefined) data.publicKey = updates.publicKey;
        if (updates.scopes !== undefined) data.scopes = updates.scopes;
        if (updates.dataAreas !== undefined) data.dataAreas = (updates.dataAreas) ?? null;
        if (updates.boundRef !== undefined) data.boundRef = updates.boundRef;
        if (updates.status !== undefined) data.status = updates.status;
        if (updates.morselBalance !== undefined) data.morselBalance = updates.morselBalance;
        if (updates.capabilities !== undefined) data.capabilities = (updates.capabilities) ?? null;
        if (updates.automation !== undefined) data.automation = (updates.automation) ?? null;
        if (updates.setup !== undefined) data.setup = (updates.setup) ?? null;
        if (updates.lastSeen !== undefined) data.lastSeen = new Date(updates.lastSeen);
        try {
            const row = await this.prisma.ecosystemApp.update({ where: { geai }, data });
            return this.toEcosystemAppRecord(row);
        } catch (err) {
            logger.warn('updateEcosystemApp failed for %s: %s', geai, (err as Error).message);
            return null;
        }
    },

    async deleteEcosystemApp(this: PrismaStorage, geai: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.ecosystemApp.delete({ where: { geai } });
            return true;
        } catch { return false; }
    },

    async createEcoAuth(this: PrismaStorage, req: EcoAuthorizationRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.ecoAuth.create({
            data: {
                deviceCode: req.deviceCode,
                userCode: req.userCode,
                ownerName: req.ownerName,
                app: req.app,
                displayName: req.displayName,
                description: req.description,
                status: req.status,
                publicKey: req.publicKey ?? null,
                scopes: req.scopes ?? [],
                dataAreas: (req.dataAreas) ?? null,
                boundRef: req.boundRef ?? null,
                createdAt: new Date(req.createdAt),
                expiresAt: new Date(req.expiresAt),
                lastPolledAt: req.lastPolledAt ? new Date(req.lastPolledAt) : null,
                pollInterval: req.pollInterval,
                approvedBy: req.approvedBy,
                validationResult: (req.validationResult) ?? undefined,
                capabilities: (req.capabilities) ?? undefined,
                automation: (req.automation) ?? undefined,
                setup: (req.setup) ?? undefined,
                appCredentials: (req.appCredentials) ?? undefined,
            },
        });
    },

    async getEcoAuthByDeviceCode(this: PrismaStorage, deviceCode: string): Promise<EcoAuthorizationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ecoAuth.findUnique({ where: { deviceCode } });
        return row ? this.toEcoAuthRecord(row) : null;
    },

    async getEcoAuthByUserCode(this: PrismaStorage, userCode: string): Promise<EcoAuthorizationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ecoAuth.findUnique({ where: { userCode } });
        return row ? this.toEcoAuthRecord(row) : null;
    },

    async updateEcoAuth(this: PrismaStorage, deviceCode: string, updates: Partial<EcoAuthorizationRecord>): Promise<void> {
        this.ensureReady();
        const data: Record<string, unknown> = {};
        if (updates.status !== undefined) data.status = updates.status;
        if (updates.scopes !== undefined) data.scopes = updates.scopes;
        if (updates.dataAreas !== undefined) data.dataAreas = (updates.dataAreas) ?? null;
        if (updates.boundRef !== undefined) data.boundRef = updates.boundRef;
        if (updates.lastPolledAt !== undefined) data.lastPolledAt = updates.lastPolledAt ? new Date(updates.lastPolledAt) : null;
        if (updates.pollInterval !== undefined) data.pollInterval = updates.pollInterval;
        if (updates.approvedBy !== undefined) data.approvedBy = updates.approvedBy;
        if ('appCredentials' in updates) data.appCredentials = updates.appCredentials ?? null;
        await this.prisma.ecoAuth.update({ where: { deviceCode }, data });
    },

    async countPendingEcoAuthByOwner(this: PrismaStorage, ownerName: string): Promise<number> {
        this.ensureReady();
        return this.prisma.ecoAuth.count({
            where: { ownerName, status: 'pending', expiresAt: { gt: new Date() } },
        });
    },

    async listPendingEcoAuthByOwner(this: PrismaStorage, ownerName: string): Promise<EcoAuthorizationRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.ecoAuth.findMany({
            where: { ownerName, status: 'pending', expiresAt: { gt: new Date() } },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map((row: PrismaRow) => this.toEcoAuthRecord(row));
    },

    async cleanupExpiredEcoAuth(this: PrismaStorage): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.ecoAuth.deleteMany({
            where: { status: 'pending', expiresAt: { lte: new Date() } },
        });
        return result.count;
    },

    // ── Automation recipes (feature B4). The Prisma client may not be regenerated in
    // dev (Mongo db:generate can EPERM on the native DLL under the infra ban), so the
    // ecoAutomationRecipe delegate + JSON columns are accessed via `as any` — same
    // workaround the Phase-2 capabilities/automation columns use above.
    async getAutomationRecipe(this: PrismaStorage, owner: string, app: string): Promise<EcoAutomationRecipe | null> {
        this.ensureReady();
        const row = await (this.prisma).ecoAutomationRecipe.findFirst({ where: { owner, app } });
        return row ? this.toAutomationRecipe(row) : null;
    },

    async upsertAutomationRecipe(this: PrismaStorage, recipe: EcoAutomationRecipe): Promise<EcoAutomationRecipe> {
        this.ensureReady();
        const data: Record<string, unknown> = {
            owner: recipe.owner,
            app: recipe.app,
            trigger: recipe.trigger,
            agents: recipe.agents,
            organism: recipe.organism ?? null,
            email: !!recipe.email,
            requireApproval: !!recipe.requireApproval,
            enabled: recipe.enabled,
            updatedAt: new Date(recipe.updatedAt),
        };
        const row = await (this.prisma).ecoAutomationRecipe.upsert({
            where: { owner_app: { owner: recipe.owner, app: recipe.app } },
            update: data,
            create: { ...data, createdAt: new Date(recipe.createdAt) },
        });
        return this.toAutomationRecipe(row);
    },

    async deleteAutomationRecipe(this: PrismaStorage, owner: string, app: string): Promise<boolean> {
        this.ensureReady();
        try {
            await (this.prisma).ecoAutomationRecipe.delete({ where: { owner_app: { owner, app } } });
            return true;
        } catch { return false; }
    },

    async listAutomationRecipesByOwner(this: PrismaStorage, owner: string): Promise<EcoAutomationRecipe[]> {
        this.ensureReady();
        const rows = await (this.prisma).ecoAutomationRecipe.findMany({ where: { owner } });
        return rows.map((r: PrismaRow) => this.toAutomationRecipe(r));
    },

    toAutomationRecipe(this: PrismaStorage, row: PrismaRow): EcoAutomationRecipe {
        return {
            id: row.id,
            owner: row.owner,
            app: row.app,
            trigger: row.trigger as EcoAutomationRecipe['trigger'],
            agents: Array.isArray(row.agents) ? row.agents : [],
            organism: row.organism ?? null,
            email: !!row.email,
            requireApproval: !!row.requireApproval,
            enabled: !!row.enabled,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
    },

    toEcosystemAppRecord(this: PrismaStorage, row: PrismaRow): EcosystemAppRecord {
        const record: EcosystemAppRecord = {
            geai: row.geai,
            app: row.app,
            owner: row.owner,
            publicKey: row.publicKey,
            scopes: row.scopes ?? [],
            status: row.status,
            morselBalance: row.morselBalance ?? 0,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            lastSeen: row.lastSeen instanceof Date ? row.lastSeen.toISOString() : row.lastSeen,
        };
        if (row.displayName) record.displayName = row.displayName;
        if (row.description) record.description = row.description;
        if (row.dataAreas) record.dataAreas = row.dataAreas;
        if (row.boundRef) record.boundRef = row.boundRef;
        if (row.capabilities) record.capabilities = row.capabilities;
        if (row.automation) record.automation = row.automation;
        if (row.setup) record.setup = row.setup;
        return record;
    },

    toEcoAuthRecord(this: PrismaStorage, row: PrismaRow): EcoAuthorizationRecord {
        return {
            deviceCode: row.deviceCode,
            userCode: row.userCode,
            ownerName: row.ownerName,
            app: row.app,
            displayName: row.displayName ?? undefined,
            description: row.description ?? undefined,
            status: row.status,
            publicKey: row.publicKey ?? undefined,
            scopes: row.scopes?.length ? row.scopes : undefined,
            dataAreas: row.dataAreas ?? undefined,
            boundRef: row.boundRef ?? undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
            lastPolledAt: row.lastPolledAt ? (row.lastPolledAt instanceof Date ? row.lastPolledAt.toISOString() : row.lastPolledAt) : undefined,
            pollInterval: row.pollInterval,
            approvedBy: row.approvedBy ?? undefined,
            validationResult: row.validationResult ?? undefined,
            capabilities: row.capabilities ?? undefined,
            automation: row.automation ?? undefined,
            setup: row.setup ?? undefined,
            appCredentials: row.appCredentials ?? undefined,
        };
    },

    toDeviceAuthRecord(this: PrismaStorage, row: PrismaRow): DeviceAuthorizationRecord {
        return {
            deviceCode: row.deviceCode,
            userCode: row.userCode,
            ownerName: row.ownerName,
            agentName: row.agentName,
            displayName: row.displayName ?? undefined,
            description: row.description ?? undefined,
            status: row.status,
            scopes: row.scopes?.length ? row.scopes : undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
            lastPolledAt: row.lastPolledAt ? (row.lastPolledAt instanceof Date ? row.lastPolledAt.toISOString() : row.lastPolledAt) : undefined,
            pollInterval: row.pollInterval,
            approvedBy: row.approvedBy ?? undefined,
            agentCredentials: row.agentCredentials ?? undefined,
            mode: row.mode ?? undefined,
        };
    },

    // ── OAuth 2.1 Persistent State ──

    async createOAuthClient(this: PrismaStorage, client: OAuthClientRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.oAuthClient.create({
            data: {
                clientId: client.clientId,
                clientSecret: client.clientSecret,
                clientName: client.clientName,
                redirectUris: client.redirectUris,
                createdAt: new Date(client.createdAt),
            },
        });
    },

    async getOAuthClient(this: PrismaStorage, clientId: string): Promise<OAuthClientRecord | null> {
        this.ensureReady();
        const row = await this.prisma.oAuthClient.findUnique({ where: { clientId } });
        if (!row) return null;
        return {
            clientId: row.clientId,
            clientSecret: row.clientSecret,
            clientName: row.clientName,
            redirectUris: row.redirectUris,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    },

    async deleteOAuthClient(this: PrismaStorage, clientId: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.oAuthRefreshToken.deleteMany({ where: { clientId } });
            await this.prisma.oAuthApproval.deleteMany({ where: { clientId } });
            await this.prisma.oAuthClient.delete({ where: { clientId } });
            return true;
        } catch { return false; }
    },

    async listOAuthClients(this: PrismaStorage): Promise<OAuthClientRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.oAuthClient.findMany({ orderBy: { createdAt: 'desc' } });
        return rows.map((row: PrismaRow) => ({
            clientId: row.clientId,
            clientSecret: row.clientSecret,
            clientName: row.clientName,
            redirectUris: row.redirectUris,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        }));
    },

    async createOAuthRefreshToken(this: PrismaStorage, token: OAuthRefreshTokenRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.oAuthRefreshToken.create({
            data: {
                tokenHash: token.tokenHash,
                clientId: token.clientId,
                gaii: token.gaii,
                owner: token.owner,
                roles: token.roles,
                createdAt: new Date(token.createdAt),
            },
        });
    },

    async getOAuthRefreshToken(this: PrismaStorage, tokenHash: string): Promise<OAuthRefreshTokenRecord | null> {
        this.ensureReady();
        const row = await this.prisma.oAuthRefreshToken.findUnique({ where: { tokenHash } });
        if (!row) return null;
        return {
            tokenHash: row.tokenHash,
            clientId: row.clientId,
            gaii: row.gaii,
            owner: row.owner,
            roles: row.roles,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    },

    async deleteOAuthRefreshToken(this: PrismaStorage, tokenHash: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.oAuthRefreshToken.delete({ where: { tokenHash } });
            return true;
        } catch { return false; }
    },

    async deleteOAuthRefreshTokensByClient(this: PrismaStorage, clientId: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.oAuthRefreshToken.deleteMany({ where: { clientId } });
        return result.count;
    },

    async deleteOAuthRefreshTokensByGaii(this: PrismaStorage, gaii: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.oAuthRefreshToken.deleteMany({ where: { gaii } });
        return result.count;
    },

    async createOAuthApproval(this: PrismaStorage, approval: OAuthApprovalRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.oAuthApproval.upsert({
            where: { clientId_gaii: { clientId: approval.clientId, gaii: approval.gaii } },
            update: { scope: approval.scope, approvedAt: new Date(approval.approvedAt) },
            create: {
                clientId: approval.clientId,
                gaii: approval.gaii,
                owner: approval.owner,
                scope: approval.scope,
                approvedAt: new Date(approval.approvedAt),
            },
        });
    },

    async getOAuthApproval(this: PrismaStorage, clientId: string, gaii: string): Promise<OAuthApprovalRecord | null> {
        this.ensureReady();
        const row = await this.prisma.oAuthApproval.findUnique({ where: { clientId_gaii: { clientId, gaii } } });
        if (!row) return null;
        return {
            clientId: row.clientId,
            gaii: row.gaii,
            owner: row.owner,
            scope: row.scope,
            approvedAt: row.approvedAt instanceof Date ? row.approvedAt.toISOString() : row.approvedAt,
        };
    },

    async deleteOAuthApproval(this: PrismaStorage, clientId: string, gaii: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.oAuthApproval.delete({ where: { clientId_gaii: { clientId, gaii } } });
            return true;
        } catch { return false; }
    },

    async deleteOAuthApprovalsByClient(this: PrismaStorage, clientId: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.oAuthApproval.deleteMany({ where: { clientId } });
        return result.count;
    },

    async deleteOAuthApprovalsByGaii(this: PrismaStorage, gaii: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.oAuthApproval.deleteMany({ where: { gaii } });
        return result.count;
    },

    async listOAuthApprovalsByOwner(this: PrismaStorage, owner: string): Promise<OAuthApprovalRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.oAuthApproval.findMany({ where: { owner }, orderBy: { approvedAt: 'desc' } });
        return rows.map((row: PrismaRow) => ({
            clientId: row.clientId,
            gaii: row.gaii,
            owner: row.owner,
            scope: row.scope,
            approvedAt: row.approvedAt instanceof Date ? row.approvedAt.toISOString() : row.approvedAt,
        }));
    },

    // ── System Prompts ────────────────────────────────────────────────

    async listSystemPrompts(this: PrismaStorage, opts?: { group?: string }): Promise<SystemPromptRecord[]> {
        this.ensureReady();
        const where = opts?.group ? { group: opts.group } : {};
        const rows = await this.prisma.systemPrompt.findMany({
            where,
            orderBy: [{ group: 'asc' }, { name: 'asc' }],
        });
        return rows.map((r: PrismaRow) => this.toSystemPromptRecord(r));
    },

    async getSystemPrompt(this: PrismaStorage, id: string): Promise<SystemPromptRecord | null> {
        this.ensureReady();
        const row = await this.prisma.systemPrompt.findUnique({ where: { id } });
        return row ? this.toSystemPromptRecord(row) : null;
    },

    async upsertSystemPrompt(this: PrismaStorage, record: SystemPromptRecord): Promise<SystemPromptRecord> {
        this.ensureReady();
        const fields = {
            group: record.group,
            name: record.name,
            description: record.description,
            content: record.content,
            locales: record.locales ?? undefined,
            active: record.active,
            variables: record.variables,
            usedIn: record.usedIn,
            version: record.version,
            updatedAt: new Date(record.updatedAt),
            updatedBy: record.updatedBy,
        };
        await this.prisma.systemPrompt.upsert({
            where: { id: record.id },
            create: { id: record.id, ...fields },
            update: fields,
        });
        return record;
    },

    async getSystemPromptVersions(this: PrismaStorage, promptId: string): Promise<SystemPromptVersionRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.systemPromptVersion.findMany({
            where: { promptId },
            orderBy: { version: 'desc' },
        });
        return rows.map((r: PrismaRow) => this.toSystemPromptVersionRecord(r));
    },

    async getSystemPromptVersion(this: PrismaStorage, promptId: string, version: number): Promise<SystemPromptVersionRecord | null> {
        this.ensureReady();
        const row = await this.prisma.systemPromptVersion.findUnique({
            where: { promptId_version: { promptId, version } },
        });
        return row ? this.toSystemPromptVersionRecord(row) : null;
    },

    async createSystemPromptVersion(this: PrismaStorage, record: SystemPromptVersionRecord): Promise<SystemPromptVersionRecord> {
        this.ensureReady();
        await this.prisma.systemPromptVersion.create({
            data: {
                promptId: record.promptId,
                version: record.version,
                content: record.content,
                locales: record.locales ?? undefined,
                changedBy: record.changedBy,
                changedAt: new Date(record.changedAt),
                changeNote: record.changeNote ?? null,
            },
        });
        return record;
    },

    async pruneSystemPromptVersions(this: PrismaStorage, promptId: string, keepCount: number): Promise<number> {
        this.ensureReady();
        // Get versions to keep
        const keep = await this.prisma.systemPromptVersion.findMany({
            where: { promptId },
            orderBy: { version: 'desc' },
            take: keepCount,
            select: { version: true },
        });
        const keepVersions = keep.map((r: PrismaRow) => r.version);
        if (keepVersions.length === 0) return 0;
        const result = await this.prisma.systemPromptVersion.deleteMany({
            where: { promptId, version: { notIn: keepVersions } },
        });
        return result.count;
    },

    async deleteAllSystemPrompts(this: PrismaStorage): Promise<void> {
        this.ensureReady();
        await this.prisma.systemPromptVersion.deleteMany({});
        await this.prisma.systemPrompt.deleteMany({});
    },

    toSystemPromptRecord(this: PrismaStorage, row: PrismaRow): SystemPromptRecord {
        return {
            id: row.id,
            group: row.group,
            name: row.name,
            description: row.description ?? '',
            content: row.content,
            locales: row.locales && Object.keys(row.locales).length > 0 ? row.locales : undefined,
            active: row.active,
            variables: row.variables ?? [],
            usedIn: row.usedIn ?? [],
            version: row.version,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
            updatedBy: row.updatedBy,
        };
    },

    toSystemPromptVersionRecord(this: PrismaStorage, row: PrismaRow): SystemPromptVersionRecord {
        return {
            promptId: row.promptId,
            version: row.version,
            content: row.content,
            locales: row.locales && Object.keys(row.locales).length > 0 ? row.locales : undefined,
            changedBy: row.changedBy,
            changedAt: row.changedAt instanceof Date ? row.changedAt.toISOString() : row.changedAt,
            changeNote: row.changeNote ?? undefined,
        };
    },

    // ── Package Repository ─────────────────────────────────────────────

    async createPackage(this: PrismaStorage, record: PackageRecord): Promise<PackageRecord> {
        this.ensureReady();
        try {
            const row = await this.prisma.package.create({
                data: {
                    packageGroupId: record.packageGroupId,
                    name: record.name,
                    author: record.author,
                    authorGhii: record.authorGhii,
                    version: record.version,
                    changelog: record.changelog,
                    description: record.description,
                    category: record.category,
                    tags: record.tags,
                    visibility: record.visibility,
                    status: record.status,
                    components: record.components,
                    manifest: record.manifest,
                    createdAt: new Date(record.createdAt),
                    updatedAt: new Date(record.updatedAt),
                },
            });
            return this.toPackageRecord(row);
        } catch (e) {
            if ((e as { code?: string }).code === 'P2002') {
                throw new Error('PACKAGE_EXISTS', { cause: e });
            }
            throw e;
        }
    },

    async getPackage(this: PrismaStorage, id: string): Promise<PackageRecord | null> {
        this.ensureReady();
        const row = await this.prisma.package.findUnique({ where: { id } });
        return row ? this.toPackageRecord(row) : null;
    },

    async getPackageByGroupAndVersion(this: PrismaStorage, groupId: string, version: string): Promise<PackageRecord | null> {
        this.ensureReady();
        const row = await this.prisma.package.findFirst({ where: { packageGroupId: groupId, version } });
        return row ? this.toPackageRecord(row) : null;
    },

    async getLatestPublished(this: PrismaStorage, groupId: string): Promise<PackageRecord | null> {
        this.ensureReady();
        const row = await this.prisma.package.findFirst({
            where: { packageGroupId: groupId, status: 'published' },
            orderBy: { version: 'desc' },
        });
        return row ? this.toPackageRecord(row) : null;
    },

    async listPackages(this: PrismaStorage, filter: PackageFilter): Promise<{ packages: PackageRecord[]; total: number }> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (filter.author) where.author = filter.author;
        if (filter.category) where.category = filter.category;
        if (filter.status) where.status = filter.status;
        if (filter.visibility) where.visibility = filter.visibility;
        if (filter.search) {
            where.OR = [
                { name: { contains: filter.search, mode: 'insensitive' } },
                { description: { contains: filter.search, mode: 'insensitive' } },
            ];
        }
        const [rows, total] = await Promise.all([
            this.prisma.package.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: filter.offset ?? 0,
                take: filter.limit ?? 50,
            }),
            this.prisma.package.count({ where }),
        ]);
        return { packages: rows.map((r: PrismaRow) => this.toPackageRecord(r)), total };
    },

    async listVersions(this: PrismaStorage, groupId: string, limit?: number, offset?: number): Promise<{ versions: PackageRecord[]; total: number }> {
        this.ensureReady();
        const where = { packageGroupId: groupId };
        const [rows, total] = await Promise.all([
            this.prisma.package.findMany({
                where,
                orderBy: { version: 'desc' },
                skip: offset ?? 0,
                take: limit ?? 50,
            }),
            this.prisma.package.count({ where }),
        ]);
        return { versions: rows.map((r: PrismaRow) => this.toPackageRecord(r)), total };
    },

    async updatePackage(this: PrismaStorage, id: string, updates: Partial<PackageRecord>): Promise<PackageRecord | null> {
        this.ensureReady();
        const data: Record<string, unknown> = {};
        if (updates.name !== undefined) data.name = updates.name;
        if (updates.description !== undefined) data.description = updates.description;
        if (updates.changelog !== undefined) data.changelog = updates.changelog;
        if (updates.category !== undefined) data.category = updates.category;
        if (updates.tags !== undefined) data.tags = updates.tags;
        if (updates.visibility !== undefined) data.visibility = updates.visibility;
        if (updates.status !== undefined) data.status = updates.status;
        if (updates.components !== undefined) data.components = updates.components;
        if (updates.manifest !== undefined) data.manifest = updates.manifest;
        data.updatedAt = new Date();
        try {
            const row = await this.prisma.package.update({ where: { id }, data });
            return this.toPackageRecord(row);
        } catch {
            return null;
        }
    },

    async archivePackage(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.package.update({ where: { id }, data: { status: 'archived', updatedAt: new Date() } });
            return true;
        } catch {
            return false;
        }
    },

    async archivePackageGroup(this: PrismaStorage, groupId: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.package.updateMany({
            where: { packageGroupId: groupId, status: { not: 'archived' } },
            data: { status: 'archived', updatedAt: new Date() },
        });
        return result.count;
    },

    toPackageRecord(this: PrismaStorage, row: PrismaRow): PackageRecord {
        return {
            id: row.id,
            packageGroupId: row.packageGroupId,
            name: row.name,
            author: row.author,
            authorGhii: row.authorGhii,
            version: row.version,
            changelog: row.changelog ?? '',
            description: row.description ?? '',
            category: row.category ?? 'other',
            tags: row.tags ?? [],
            visibility: row.visibility ?? 'private',
            status: row.status ?? 'draft',
            components: (row.components ?? []) as PackageComponent[],
            manifest: row.manifest ?? '',
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
    },
};
