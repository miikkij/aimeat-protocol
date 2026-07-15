/**
 * @file src/storage/providers/postgres-kysely/methods/ecosystem.ts
 * @description Ecosystem-application (GEAI) domain for the Postgres+Kysely backend: the EcosystemApp
 *   principal CRUD, the "hello integration" handshake (EcoAuth — the eco twin of device-auth), and the
 *   per-(owner, app) automation recipes (EcoAutomationRecipe, feature B4). Translated 1:1 from the
 *   Prisma implementation. jsonb columns (dataAreas/capabilities/automation/setup/validationResult/
 *   appCredentials/trigger/agents) go through the `jsonb()` helper on write and cast back on read.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: ecosystem-apps on Postgres+Kysely.
 */
import { sql, type Selectable } from 'kysely';
import type { EcosystemAppRecord, EcoAuthorizationRecord, EcoAutomationRecipe } from '../../../interface.js';
import type { EcosystemApp, EcoAuth, EcoAutomationRecipe as EcoAutomationRecipeTable } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoOpt = (t: Date | string | null | undefined): string | undefined => (t == null ? undefined : iso(t));

function toEcosystemApp(r: Selectable<EcosystemApp>): EcosystemAppRecord {
  return {
    geai: r.geai, app: r.app, owner: r.owner, publicKey: r.publicKey,
    scopes: r.scopes ?? [], status: r.status as EcosystemAppRecord['status'], morselBalance: r.morselBalance ?? 0,
    displayName: r.displayName ?? undefined, description: r.description ?? undefined,
    dataAreas: (r.dataAreas ?? undefined) as unknown as EcosystemAppRecord['dataAreas'],
    boundRef: r.boundRef ?? undefined,
    capabilities: (r.capabilities ?? undefined) as unknown as EcosystemAppRecord['capabilities'],
    automation: (r.automation ?? undefined) as unknown as EcosystemAppRecord['automation'],
    setup: (r.setup ?? undefined) as unknown as EcosystemAppRecord['setup'],
    createdAt: iso(r.createdAt), lastSeen: iso(r.lastSeen),
  };
}

function toEcoAuth(r: Selectable<EcoAuth>): EcoAuthorizationRecord {
  return {
    deviceCode: r.deviceCode, userCode: r.userCode, ownerName: r.ownerName, app: r.app,
    displayName: r.displayName ?? undefined, description: r.description ?? undefined,
    status: r.status as EcoAuthorizationRecord['status'], publicKey: r.publicKey ?? undefined,
    scopes: r.scopes?.length ? r.scopes : undefined,
    dataAreas: (r.dataAreas ?? undefined) as unknown as EcoAuthorizationRecord['dataAreas'],
    boundRef: r.boundRef ?? undefined, createdAt: iso(r.createdAt), expiresAt: iso(r.expiresAt),
    lastPolledAt: isoOpt(r.lastPolledAt), pollInterval: r.pollInterval, approvedBy: r.approvedBy ?? undefined,
    validationResult: (r.validationResult ?? undefined) as unknown as EcoAuthorizationRecord['validationResult'],
    capabilities: (r.capabilities ?? undefined) as unknown as EcoAuthorizationRecord['capabilities'],
    automation: (r.automation ?? undefined) as unknown as EcoAuthorizationRecord['automation'],
    setup: (r.setup ?? undefined) as unknown as EcoAuthorizationRecord['setup'],
    appCredentials: (r.appCredentials ?? undefined) as unknown as EcoAuthorizationRecord['appCredentials'],
  };
}

function toAutomationRecipe(r: Selectable<EcoAutomationRecipeTable>): EcoAutomationRecipe {
  return {
    id: r.id, owner: r.owner, app: r.app,
    trigger: r.trigger as unknown as EcoAutomationRecipe['trigger'],
    agents: Array.isArray(r.agents) ? (r.agents as unknown as string[]) : [],
    organism: r.organism ?? null, email: !!r.email, requireApproval: !!r.requireApproval, enabled: !!r.enabled,
    createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
  };
}

export const ecosystemMethods = {
  // ── Ecosystem Applications (GEAI principal) ──
  async createEcosystemApp(this: PostgresKyselyStorage, app: EcosystemAppRecord): Promise<EcosystemAppRecord> {
    const [row] = await this.db.insertInto('EcosystemApp').values({
      geai: app.geai, app: app.app, owner: app.owner, displayName: app.displayName ?? null, description: app.description ?? null,
      publicKey: app.publicKey, scopes: app.scopes ?? [], dataAreas: jsonb(app.dataAreas ?? null), boundRef: app.boundRef ?? null,
      status: app.status, morselBalance: app.morselBalance ?? 0, capabilities: jsonb(app.capabilities ?? null),
      automation: jsonb(app.automation ?? null), setup: jsonb(app.setup ?? null),
      createdAt: new Date(app.createdAt), lastSeen: new Date(app.lastSeen),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).returningAll().execute();
    return toEcosystemApp(row);
  },
  async getEcosystemApp(this: PostgresKyselyStorage, geai: string): Promise<EcosystemAppRecord | null> {
    const r = await this.db.selectFrom('EcosystemApp').selectAll().where('geai', '=', geai).executeTakeFirst();
    return r ? toEcosystemApp(r) : null;
  },
  async getEcosystemAppByOwnerAndApp(this: PostgresKyselyStorage, owner: string, app: string): Promise<EcosystemAppRecord | null> {
    const r = await this.db.selectFrom('EcosystemApp').selectAll().where('owner', '=', owner).where('app', '=', app).executeTakeFirst();
    return r ? toEcosystemApp(r) : null;
  },
  async getEcosystemAppsByOwner(this: PostgresKyselyStorage, owner: string): Promise<EcosystemAppRecord[]> {
    return (await this.db.selectFrom('EcosystemApp').selectAll().where('owner', '=', owner).execute()).map(toEcosystemApp);
  },
  async updateEcosystemApp(this: PostgresKyselyStorage, geai: string, updates: Partial<EcosystemAppRecord>): Promise<EcosystemAppRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.app !== undefined) data.app = updates.app;
    if (updates.owner !== undefined) data.owner = updates.owner;
    if (updates.displayName !== undefined) data.displayName = updates.displayName;
    if (updates.description !== undefined) data.description = updates.description;
    if (updates.publicKey !== undefined) data.publicKey = updates.publicKey;
    if (updates.scopes !== undefined) data.scopes = updates.scopes;
    if (updates.dataAreas !== undefined) data.dataAreas = jsonb(updates.dataAreas ?? null);
    if (updates.boundRef !== undefined) data.boundRef = updates.boundRef;
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.morselBalance !== undefined) data.morselBalance = updates.morselBalance;
    if (updates.capabilities !== undefined) data.capabilities = jsonb(updates.capabilities ?? null);
    if (updates.automation !== undefined) data.automation = jsonb(updates.automation ?? null);
    if (updates.setup !== undefined) data.setup = jsonb(updates.setup ?? null);
    if (updates.lastSeen !== undefined) data.lastSeen = new Date(updates.lastSeen);
    try {
      const rows = await this.db.updateTable('EcosystemApp').set(data as never).where('geai', '=', geai).returningAll().execute();
      return rows[0] ? toEcosystemApp(rows[0]) : null;
    } catch { return null; }
  },
  async deleteEcosystemApp(this: PostgresKyselyStorage, geai: string): Promise<boolean> {
    const r = await this.db.deleteFrom('EcosystemApp').where('geai', '=', geai).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  // ── "Hello integration" handshake (EcoAuth — the eco twin of device-auth) ──
  async createEcoAuth(this: PostgresKyselyStorage, req: EcoAuthorizationRecord): Promise<void> {
    await this.db.insertInto('EcoAuth').values({
      deviceCode: req.deviceCode, userCode: req.userCode, ownerName: req.ownerName, app: req.app,
      displayName: req.displayName ?? null, description: req.description ?? null, status: req.status,
      publicKey: req.publicKey ?? null, scopes: req.scopes ?? [], dataAreas: jsonb(req.dataAreas ?? null), boundRef: req.boundRef ?? null,
      createdAt: new Date(req.createdAt), expiresAt: new Date(req.expiresAt),
      lastPolledAt: req.lastPolledAt ? new Date(req.lastPolledAt) : null, pollInterval: req.pollInterval,
      approvedBy: req.approvedBy ?? null, validationResult: jsonb(req.validationResult ?? null), capabilities: jsonb(req.capabilities ?? null),
      automation: jsonb(req.automation ?? null), setup: jsonb(req.setup ?? null), appCredentials: jsonb(req.appCredentials ?? null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
  },
  async getEcoAuthByDeviceCode(this: PostgresKyselyStorage, deviceCode: string): Promise<EcoAuthorizationRecord | null> {
    const r = await this.db.selectFrom('EcoAuth').selectAll().where('deviceCode', '=', deviceCode).executeTakeFirst();
    return r ? toEcoAuth(r) : null;
  },
  async getEcoAuthByUserCode(this: PostgresKyselyStorage, userCode: string): Promise<EcoAuthorizationRecord | null> {
    const r = await this.db.selectFrom('EcoAuth').selectAll().where('userCode', '=', userCode).executeTakeFirst();
    return r ? toEcoAuth(r) : null;
  },
  async updateEcoAuth(this: PostgresKyselyStorage, deviceCode: string, updates: Partial<EcoAuthorizationRecord>): Promise<void> {
    const data: Record<string, unknown> = {};
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.scopes !== undefined) data.scopes = updates.scopes;
    if (updates.dataAreas !== undefined) data.dataAreas = jsonb(updates.dataAreas ?? null);
    if (updates.boundRef !== undefined) data.boundRef = updates.boundRef;
    if (updates.lastPolledAt !== undefined) data.lastPolledAt = updates.lastPolledAt ? new Date(updates.lastPolledAt) : null;
    if (updates.pollInterval !== undefined) data.pollInterval = updates.pollInterval;
    if (updates.approvedBy !== undefined) data.approvedBy = updates.approvedBy;
    if ('appCredentials' in updates) data.appCredentials = jsonb(updates.appCredentials ?? null);
    if (Object.keys(data).length === 0) return;
    await this.db.updateTable('EcoAuth').set(data as never).where('deviceCode', '=', deviceCode).execute();
  },
  async countPendingEcoAuthByOwner(this: PostgresKyselyStorage, ownerName: string): Promise<number> {
    const r = await this.db.selectFrom('EcoAuth').select(sql<number>`count(*)`.as('n'))
      .where('ownerName', '=', ownerName).where('status', '=', 'pending').where('expiresAt', '>', new Date()).executeTakeFirst();
    return Number(r?.n ?? 0);
  },
  async listPendingEcoAuthByOwner(this: PostgresKyselyStorage, ownerName: string): Promise<EcoAuthorizationRecord[]> {
    const rows = await this.db.selectFrom('EcoAuth').selectAll().where('ownerName', '=', ownerName).where('status', '=', 'pending')
      .where('expiresAt', '>', new Date()).orderBy('createdAt', 'desc').execute();
    return rows.map(toEcoAuth);
  },
  async cleanupExpiredEcoAuth(this: PostgresKyselyStorage): Promise<number> {
    const r = await this.db.deleteFrom('EcoAuth').where('status', '=', 'pending').where('expiresAt', '<=', new Date()).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  // ── Automation recipes (feature B4): one per (owner, app), keyed by bare owner name ──
  async getAutomationRecipe(this: PostgresKyselyStorage, owner: string, app: string): Promise<EcoAutomationRecipe | null> {
    const r = await this.db.selectFrom('EcoAutomationRecipe').selectAll().where('owner', '=', owner).where('app', '=', app).executeTakeFirst();
    return r ? toAutomationRecipe(r) : null;
  },
  async upsertAutomationRecipe(this: PostgresKyselyStorage, recipe: EcoAutomationRecipe): Promise<EcoAutomationRecipe> {
    const mutable = {
      owner: recipe.owner, app: recipe.app, trigger: jsonb(recipe.trigger), agents: jsonb(recipe.agents),
      organism: recipe.organism ?? null, email: !!recipe.email, requireApproval: !!recipe.requireApproval,
      enabled: recipe.enabled, updatedAt: new Date(recipe.updatedAt),
    };
    const [row] = await this.db.insertInto('EcoAutomationRecipe').values({
      ...mutable, createdAt: new Date(recipe.createdAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).onConflict(oc => oc.columns(['owner', 'app']).doUpdateSet(mutable as never)).returningAll().execute();
    return toAutomationRecipe(row);
  },
  async deleteAutomationRecipe(this: PostgresKyselyStorage, owner: string, app: string): Promise<boolean> {
    const r = await this.db.deleteFrom('EcoAutomationRecipe').where('owner', '=', owner).where('app', '=', app).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
  async listAutomationRecipesByOwner(this: PostgresKyselyStorage, owner: string): Promise<EcoAutomationRecipe[]> {
    return (await this.db.selectFrom('EcoAutomationRecipe').selectAll().where('owner', '=', owner).execute()).map(toAutomationRecipe);
  },
};
