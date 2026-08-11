/**
 * @file src/storage/providers/postgres-kysely/methods/identity.ts
 * @description Identity domain for the Postgres+Kysely backend: owners, agents, GHIIs, and token
 *   revocation — translated from the Prisma implementations against the same Owner / Agent / Ghii /
 *   RevokedToken tables. These are the methods the server's anonymous-identity bootstrap and the
 *   register→token→request path exercise. Mappers are module-local (row → *Record).
 * @version-history
 *   2026-07-19 — model/modelDetectedBy: indicative primary-LLM attribution on agents (AppDev KB Phase 3)
 *   v1.2.0 — 2026-07-26 — Password lockout actually persists: updateGHII stops deleting
 *     passwordFailedAttempts/passwordLockedUntil as "not columns" (migration 0013 adds them) and
 *     toGHIIRecord projects them, so config.passwordLockoutAttempts can engage. An empty update is a
 *     no-op returning the current row instead of invalid SQL.
 *   v1.1.0 — 2026-07-16 — Add getGHIIsByGhiis batch (Phase 3): many GHII records by ghii in one query.
 *   v1.0.0 — 2026-07-15 — Phase 5: owner/agent/ghii/auth-revoke on Postgres+Kysely.
 */
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { AgentRecord, GHIIRecord, OwnerRecord } from '../../../interface.js';
import type { Agent, Ghii, Owner } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb, dbError } from '../helpers.js';
import { deleteOwnerCascade, cascadeDeleteIdentityData } from './owner-cascade.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoOpt = (t: Date | string | null | undefined): string | undefined => (t == null ? undefined : iso(t));
const arr = (a: string[] | null | undefined): string[] | undefined => (a && a.length ? a : undefined);

function toOwnerRecord(r: Selectable<Owner>): OwnerRecord {
  return { name: r.name, displayName: r.displayName ?? undefined, publicKey: r.publicKey, roles: r.roles ?? [], createdAt: iso(r.createdAt) };
}

function toAgentRecord(r: Selectable<Agent>): AgentRecord {
  return {
    name: r.name, owner: r.owner, gaii: r.gaii, displayName: r.displayName ?? undefined, description: r.description ?? undefined,
    capabilities: r.capabilities ?? [], publicKey: r.publicKey, trustScore: r.trustScore, morselBalance: r.morselBalance,
    defaultScopes: arr(r.defaultScopes), allowedOrigins: arr(r.allowedOrigins), federate: r.federate ?? false,
    technicalCapabilities: (r.technicalCapabilities ?? undefined) as AgentRecord['technicalCapabilities'],
    domainCapabilities: (r.domainCapabilities ?? undefined) as AgentRecord['domainCapabilities'],
    languages: (r.languages ?? undefined) as AgentRecord['languages'],
    activityStats: (r.activityStats ?? undefined) as AgentRecord['activityStats'],
    modulesLoaded: (r.modulesLoaded ?? undefined) as AgentRecord['modulesLoaded'],
    agentLimitations: (r.agentLimitations ?? undefined) as AgentRecord['agentLimitations'],
    webhookUrl: r.webhookUrl ?? undefined, webhookSecret: r.webhookSecret ?? undefined, webhookEnabled: r.webhookEnabled ?? false,
    webhookLastSuccess: isoOpt(r.webhookLastSuccess), webhookLastFailure: isoOpt(r.webhookLastFailure), webhookFailCount: r.webhookFailCount ?? 0,
    platform: r.platform ?? undefined, platformVersion: r.platformVersion ?? undefined, platformDetectedBy: (r.platformDetectedBy ?? undefined) as AgentRecord['platformDetectedBy'],
    model: r.model ?? undefined, modelDetectedBy: (r.modelDetectedBy ?? undefined) as AgentRecord['modelDetectedBy'],
    tags: arr(r.tags), mode: (r.mode ?? 'interactive') as AgentRecord['mode'], maxConcurrentTasks: r.maxConcurrentTasks ?? 1,
    dailySpendLimit: r.dailySpendLimit ?? undefined,
    scheduleConstraintDefaults: (r.scheduleConstraintDefaults ?? undefined) as AgentRecord['scheduleConstraintDefaults'],
    createdAt: iso(r.createdAt), lastSeen: iso(r.lastSeen),
  };
}

function toGHIIRecord(r: Selectable<Ghii>): GHIIRecord {
  return {
    username: r.username, nodeId: r.nodeId, ghii: r.ghii, displayName: r.displayName, bio: r.bio ?? undefined, avatar: r.avatar ?? undefined,
    locale: r.locale ?? undefined, passwordHash: r.passwordHash ?? undefined, verificationLevel: r.verificationLevel as GHIIRecord['verificationLevel'],
    ownerName: r.ownerName, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
    totpSecret: r.totpSecret ?? undefined, totpEnabled: r.totpEnabled ?? false, totpBackupCodes: arr(r.totpBackupCodes),
    totpLastUsedAt: r.totpLastUsedAt ?? undefined, totpLastUsedCode: r.totpLastUsedCode ?? undefined,
    totpFailedAttempts: r.totpFailedAttempts ?? undefined, totpLockedUntil: r.totpLockedUntil ?? undefined,
    // Password lockout state. Absent from this projection until 2026-07-26, so even a fixed write
    // would have read back "no failed attempts" and the lockout still could not engage.
    passwordFailedAttempts: r.passwordFailedAttempts ?? undefined, passwordLockedUntil: r.passwordLockedUntil ?? undefined,
    emailHash: r.emailHash ?? undefined, emailVerifiedAt: r.emailVerifiedAt ?? undefined, verificationMethod: (r.verificationMethod ?? undefined) as GHIIRecord['verificationMethod'],
    magicLinkEnabled: r.magicLinkEnabled ?? undefined, notificationEmail: r.notificationEmail ?? undefined,
    lastLoginAt: r.lastLoginAt ?? undefined, loginCount: r.loginCount ?? undefined, verifiedAttributes: arr(r.verifiedAttributes),
    verificationIssuer: r.verificationIssuer ?? undefined, verificationCredentialHash: r.verificationCredentialHash ?? undefined,
    ftnVerified: r.ftnVerified ?? undefined, googleSub: r.googleSub ?? undefined,
    externalIdentities: (r.externalIdentities ?? undefined) as GHIIRecord['externalIdentities'],
    trustScore: r.trustScore ?? undefined, morselBalance: r.morselBalance ?? undefined, allowedOrigins: arr(r.allowedOrigins),
  };
}

export const identityMethods = {
  // ── Owners ──
  async createOwner(this: PostgresKyselyStorage, owner: OwnerRecord): Promise<OwnerRecord> {
    const [row] = await this.db.insertInto('Owner').values({
      name: owner.name, displayName: owner.displayName ?? null, publicKey: owner.publicKey,
      roles: owner.roles ?? [], createdAt: new Date(owner.createdAt),
    }).returningAll().execute();
    return toOwnerRecord(row);
  },
  async getOwner(this: PostgresKyselyStorage, name: string): Promise<OwnerRecord | null> {
    const r = await this.db.selectFrom('Owner').selectAll().where('name', '=', name).executeTakeFirst();
    return r ? toOwnerRecord(r) : null;
  },
  async listOwners(this: PostgresKyselyStorage): Promise<OwnerRecord[]> {
    return (await this.db.selectFrom('Owner').selectAll().execute()).map(toOwnerRecord);
  },
  async updateOwner(this: PostgresKyselyStorage, name: string, updates: Partial<OwnerRecord>): Promise<OwnerRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.displayName !== undefined) data.displayName = updates.displayName;
    if (updates.publicKey !== undefined) data.publicKey = updates.publicKey;
    if (updates.roles !== undefined) data.roles = updates.roles;
    if (Object.keys(data).length === 0) return this.getOwner(name);
    const rows = await this.db.updateTable('Owner').set(data).where('name', '=', name).returningAll().execute();
    return rows[0] ? toOwnerRecord(rows[0]) : null;
  },
  /**
   * Erase an owner and everything owner-scoped underneath, in ONE transaction. Until 2026-08-11 this
   * cleared five tables where SQLite cleared forty-one and still returned true, so on the production
   * backend a deleted account left its work, disputes, wallet ledger, board posts, files, consents,
   * telemetry, OAuth tokens and push subscriptions behind. The table list now lives in
   * ./owner-cascade.ts next to the SQLite one it mirrors.
   */
  async deleteOwner(this: PostgresKyselyStorage, name: string): Promise<boolean> {
    try {
      return await this.db.transaction().execute(trx => deleteOwnerCascade(trx, name));
    } catch (err) { throw dbError('deleteOwner', err); }
  },

  // ── Agents ──
  async createAgent(this: PostgresKyselyStorage, a: AgentRecord): Promise<AgentRecord> {
    const [row] = await this.db.insertInto('Agent').values({
      name: a.name, owner: a.owner, gaii: a.gaii, displayName: a.displayName ?? null, description: a.description ?? null,
      capabilities: a.capabilities ?? [], publicKey: a.publicKey, trustScore: a.trustScore, morselBalance: a.morselBalance,
      allowedOrigins: a.allowedOrigins ?? [], defaultScopes: a.defaultScopes ?? ['*'], federate: a.federate ?? false,
      technicalCapabilities: jsonb(a.technicalCapabilities ?? null), domainCapabilities: jsonb(a.domainCapabilities ?? null),
      activityStats: jsonb(a.activityStats ?? null), modulesLoaded: jsonb(a.modulesLoaded ?? null),
      agentLimitations: jsonb(a.agentLimitations ?? null), languages: jsonb(a.languages ?? null),
      mode: a.mode ?? 'interactive', maxConcurrentTasks: a.maxConcurrentTasks ?? 1, dailySpendLimit: a.dailySpendLimit ?? null,
      scheduleConstraintDefaults: jsonb(a.scheduleConstraintDefaults ?? null), webhookUrl: a.webhookUrl ?? null,
      webhookSecret: a.webhookSecret ?? null, webhookEnabled: a.webhookEnabled ?? false,
      webhookLastSuccess: a.webhookLastSuccess ? new Date(a.webhookLastSuccess) : null,
      webhookLastFailure: a.webhookLastFailure ? new Date(a.webhookLastFailure) : null, webhookFailCount: a.webhookFailCount ?? 0,
      platform: a.platform ?? null, platformVersion: a.platformVersion ?? null, platformDetectedBy: a.platformDetectedBy ?? null,
      model: a.model ?? null, modelDetectedBy: a.modelDetectedBy ?? null,
      tags: a.tags ?? [], createdAt: new Date(a.createdAt), lastSeen: new Date(a.lastSeen),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).returningAll().execute();
    return toAgentRecord(row);
  },
  async getAgent(this: PostgresKyselyStorage, gaii: string): Promise<AgentRecord | null> {
    const r = await this.db.selectFrom('Agent').selectAll().where('gaii', '=', gaii).executeTakeFirst();
    return r ? toAgentRecord(r) : null;
  },
  async getAgentByName(this: PostgresKyselyStorage, name: string, _nodeId: string): Promise<AgentRecord | null> {
    const r = await this.db.selectFrom('Agent').selectAll().where('name', '=', name).executeTakeFirst();
    return r ? toAgentRecord(r) : null;
  },
  // ORDER BY is load-bearing, not tidiness: callers take agents[0] as "the" agent (the home card),
  // and an unordered Postgres scan returns heap order, which changes whenever a row is UPDATEd —
  // and a throttled lastSeen touch IS an update. The home therefore showed a different agent after
  // each heartbeat, with nobody having done anything. createdAt then gaii, matching sqlite.
  async getAgentsByOwner(this: PostgresKyselyStorage, owner: string): Promise<AgentRecord[]> {
    return (await this.db.selectFrom('Agent').selectAll().where('owner', '=', owner)
      .orderBy('createdAt', 'asc').orderBy('gaii', 'asc').execute()).map(toAgentRecord);
  },
  async getAgentsByOwners(this: PostgresKyselyStorage, owners: string[]): Promise<Record<string, AgentRecord[]>> {
    const out: Record<string, AgentRecord[]> = {};
    if (owners.length === 0) return out;
    for (const o of owners) out[o] = [];
    const rows = (await this.db.selectFrom('Agent').selectAll().where('owner', 'in', owners)
      .orderBy('createdAt', 'asc').orderBy('gaii', 'asc').execute()).map(toAgentRecord);
    for (const a of rows) (out[a.owner] ??= []).push(a);
    return out;
  },
  async listAgents(this: PostgresKyselyStorage): Promise<AgentRecord[]> {
    return (await this.db.selectFrom('Agent').selectAll().execute()).map(toAgentRecord);
  },
  async updateAgent(this: PostgresKyselyStorage, gaii: string, updates: Partial<AgentRecord>): Promise<AgentRecord | null> {
    // Json columns must be wrapped with jsonb(); Date columns need Date coercion. Everything else passes
    // through. Build the SET map from only the keys present so a partial update touches nothing extra.
    const jsonCols = new Set(['technicalCapabilities', 'domainCapabilities', 'activityStats', 'modulesLoaded', 'agentLimitations', 'languages', 'scheduleConstraintDefaults']);
    const dateCols = new Set(['createdAt', 'lastSeen', 'webhookLastSuccess', 'webhookLastFailure']);
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) continue;
      if (jsonCols.has(k)) data[k] = jsonb((v ?? null) as Parameters<typeof jsonb>[0]);
      else if (dateCols.has(k)) data[k] = v == null ? null : new Date(v as string);
      else data[k] = v;
    }
    if (Object.keys(data).length === 0) return this.getAgent(gaii);
    try {
      const rows = await this.db.updateTable('Agent').set(data as never).where('gaii', '=', gaii).returningAll().execute();
      return rows[0] ? toAgentRecord(rows[0]) : null;
    } catch (err) { throw dbError('updateAgent', err); }
  },
  /** Same cascade as deleteOwner, for one agent — matching SQLite, which has always run the full
   *  cascade here. This cleared only Memory until 2026-08-11, so disconnecting an agent left its
   *  tasks, messages, telemetry, directives, OAuth tokens and webhook log behind. */
  async deleteAgent(this: PostgresKyselyStorage, gaii: string): Promise<boolean> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        await cascadeDeleteIdentityData(trx, gaii);
        const r = await trx.deleteFrom('Agent').where('gaii', '=', gaii).executeTakeFirst();
        return Number(r.numDeletedRows ?? 0) > 0;
      });
    } catch (err) { throw dbError('deleteAgent', err); }
  },

  // ── GHIIs ──
  async createGHII(this: PostgresKyselyStorage, r: GHIIRecord): Promise<GHIIRecord> {
    try {
      const [row] = await this.db.insertInto('Ghii').values({
        username: r.username, nodeId: r.nodeId, ghii: r.ghii, displayName: r.displayName, bio: r.bio ?? null, avatar: r.avatar ?? null,
        locale: r.locale ?? null, passwordHash: r.passwordHash ?? null, verificationLevel: r.verificationLevel, ownerName: r.ownerName,
        totpSecret: r.totpSecret ?? null, totpEnabled: r.totpEnabled ?? false, totpBackupCodes: r.totpBackupCodes ?? [],
        totpLastUsedAt: r.totpLastUsedAt ?? null, totpLastUsedCode: r.totpLastUsedCode ?? null, totpFailedAttempts: r.totpFailedAttempts ?? 0,
        totpLockedUntil: r.totpLockedUntil ?? null, emailHash: r.emailHash ?? null, emailVerifiedAt: r.emailVerifiedAt ?? null,
        notificationEmail: r.notificationEmail ?? null, verificationMethod: r.verificationMethod ?? null, magicLinkEnabled: r.magicLinkEnabled ?? false,
        lastLoginAt: r.lastLoginAt ?? null, loginCount: r.loginCount ?? 0, verifiedAttributes: r.verifiedAttributes ?? [],
        verificationIssuer: r.verificationIssuer ?? null, verificationCredentialHash: r.verificationCredentialHash ?? null,
        ftnVerified: r.ftnVerified ?? false, googleSub: r.googleSub ?? null, externalIdentities: jsonb(r.externalIdentities ?? null),
        trustScore: r.trustScore ?? null, morselBalance: r.morselBalance ?? null, allowedOrigins: r.allowedOrigins ?? [],
        createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any).returningAll().execute();
      return toGHIIRecord(row);
    } catch (e) {
      if ((e as { code?: string })?.code === '23505') throw new Error('GHII_TAKEN', { cause: e });   // unique violation
      throw e;
    }
  },
  async getGHIIsByGhiis(this: PostgresKyselyStorage, ghiis: string[]): Promise<Record<string, GHIIRecord>> {
    if (ghiis.length === 0) return {};
    const rows = await this.db.selectFrom('Ghii').selectAll().where('ghii', 'in', ghiis).execute();
    const out: Record<string, GHIIRecord> = {};
    for (const r of rows) { const rec = toGHIIRecord(r); out[rec.ghii] = rec; }
    return out;
  },

  async getGHII(this: PostgresKyselyStorage, ghii: string): Promise<GHIIRecord | null> {
    const r = await this.db.selectFrom('Ghii').selectAll().where('ghii', '=', ghii).executeTakeFirst();
    return r ? toGHIIRecord(r) : null;
  },
  async getGHIIByOwner(this: PostgresKyselyStorage, ownerName: string): Promise<GHIIRecord | null> {
    const r = await this.db.selectFrom('Ghii').selectAll().where('ownerName', '=', ownerName).executeTakeFirst();
    return r ? toGHIIRecord(r) : null;
  },
  async deleteGHII(this: PostgresKyselyStorage, ghii: string): Promise<boolean> {
    const r = await this.db.deleteFrom('Ghii').where('ghii', '=', ghii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
  async getGHIIByEmailHash(this: PostgresKyselyStorage, emailHash: string): Promise<GHIIRecord | null> {
    const r = await this.db.selectFrom('Ghii').selectAll().where('emailHash', '=', emailHash).executeTakeFirst();
    return r ? toGHIIRecord(r) : null;
  },
  async getGHIIsByEmailHash(this: PostgresKyselyStorage, emailHash: string): Promise<GHIIRecord[]> {
    const rows = await this.db.selectFrom('Ghii').selectAll().where('emailHash', '=', emailHash).execute();
    return rows.map(toGHIIRecord);
  },
  async getGHIIByGoogleSub(this: PostgresKyselyStorage, googleSub: string): Promise<GHIIRecord | null> {
    const r = await this.db.selectFrom('Ghii').selectAll().where('googleSub', '=', googleSub).executeTakeFirst();
    return r ? toGHIIRecord(r) : null;
  },
  async getGHIIByExternalId(this: PostgresKyselyStorage, provider: string, sub: string): Promise<GHIIRecord | null> {
    // Google keeps its indexed mirror column; all providers also live in the externalIdentities JSON map.
    if (provider === 'google') {
      const byMirror = await this.db.selectFrom('Ghii').selectAll().where('googleSub', '=', sub).executeTakeFirst();
      if (byMirror) return toGHIIRecord(byMirror);
    }
    const r = await this.db.selectFrom('Ghii').selectAll().where(sql<boolean>`"externalIdentities"->>${provider} = ${sub}`).executeTakeFirst();
    return r ? toGHIIRecord(r) : null;
  },
  async listGHIIs(this: PostgresKyselyStorage, opts?: { q?: string; level?: number }): Promise<GHIIRecord[]> {
    let query = this.db.selectFrom('Ghii').selectAll();
    if (opts?.q) {
      const like = '%' + opts.q + '%';
      query = query.where(eb => eb.or([
        eb(sql`"username"`, 'ilike', like), eb(sql`"displayName"`, 'ilike', like), eb(sql`"bio"`, 'ilike', like),
      ]));
    }
    if (opts?.level !== undefined) query = query.where('verificationLevel', '>=', opts.level);
    return (await query.execute()).map(toGHIIRecord);
  },
  async updateGHII(this: PostgresKyselyStorage, ghii: string, updates: Partial<GHIIRecord>): Promise<GHIIRecord | null> {
    try {
      const data = { ...updates } as Record<string, unknown>;
      // `passwordFailedAttempts` / `passwordLockedUntil` USED to be deleted here as "not columns".
      // That is how the brute-force lockout came to be dead: on a wrong password the UPDATE had
      // nothing left to set, the resulting error was swallowed into null, and the route answered a
      // clean 401 while the counter stayed at zero forever. Migration 0013 adds both columns (their
      // totp equivalents were always there). See also the empty-update guard below.
      delete data.semantic;   // not a column
      if (data.createdAt) data.createdAt = new Date(data.createdAt as string);
      if (data.updatedAt) data.updatedAt = new Date(data.updatedAt as string);
      if ('externalIdentities' in data) data.externalIdentities = jsonb((data.externalIdentities ?? null) as Parameters<typeof jsonb>[0]);   // Json column
      // An UPDATE with no columns is invalid SQL, and "update nothing" is not a failure. Answer it
      // the way a successful no-op update would: with the current row.
      if (Object.keys(data).length === 0) return this.getGHII(ghii);
      const rows = await this.db.updateTable('Ghii').set(data as never).where('ghii', '=', ghii).returningAll().execute();
      return rows[0] ? toGHIIRecord(rows[0]) : null;
    } catch (err) { throw dbError('updateGHII', err); }
  },

  // ── Token revocation (RevokedToken) ──
  async revokeToken(this: PostgresKyselyStorage, tokenHash: string, expiresAt: number): Promise<void> {
    await this.db.insertInto('RevokedToken').values({ tokenHash, expiresAt })
      .onConflict(oc => oc.column('tokenHash').doUpdateSet({ expiresAt })).execute();
  },
  async isTokenRevoked(this: PostgresKyselyStorage, tokenHash: string): Promise<boolean> {
    const r = await this.db.selectFrom('RevokedToken').select('id').where('tokenHash', '=', tokenHash).executeTakeFirst();
    return !!r;
  },
  async cleanExpiredRevocations(this: PostgresKyselyStorage): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const r = await this.db.deleteFrom('RevokedToken').where('expiresAt', '<', now).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
