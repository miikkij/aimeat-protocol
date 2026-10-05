/**
 * @file src/storage/providers/sqlite/methods/ecosystem.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/ecosystem.ts (ecosystemMethods), so a
 *   fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure ecosystemMethods
 * @usage Object.assign(SqliteStorage.prototype, ecosystemMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 17 methods (createEcosystemApp, getEcosystemApp, getEcosystemAppByOwnerAndApp, …)
 *     moved here from federation-oauth.ts so the file mirrors postgres-kysely/methods/ecosystem.ts (secaudit
 *     2026-10, M8).
 */
import type { EcosystemAppRecord, EcoAuthorizationRecord, EcoAutomationRecipe } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import * as ecosystemAppRepo from '../repos/ecosystem-app.js';

export const ecosystemMethods = {

  // ── Ecosystem Applications (GEAI) + hello-integration handshake ──
  async createEcosystemApp(this: SqliteStorage, app: EcosystemAppRecord): Promise<EcosystemAppRecord> {
    return ecosystemAppRepo.createEcosystemApp(this.db, app);
  },
  async getEcosystemApp(this: SqliteStorage, geai: string): Promise<EcosystemAppRecord | null> {
    return ecosystemAppRepo.getEcosystemApp(this.db, geai);
  },
  async getEcosystemAppByOwnerAndApp(this: SqliteStorage, owner: string, app: string): Promise<EcosystemAppRecord | null> {
    return ecosystemAppRepo.getEcosystemAppByOwnerAndApp(this.db, owner, app);
  },
  async getEcosystemAppsByOwner(this: SqliteStorage, owner: string): Promise<EcosystemAppRecord[]> {
    return ecosystemAppRepo.getEcosystemAppsByOwner(this.db, owner);
  },
  async updateEcosystemApp(this: SqliteStorage, geai: string, updates: Partial<EcosystemAppRecord>): Promise<EcosystemAppRecord | null> {
    return ecosystemAppRepo.updateEcosystemApp(this.db, geai, updates);
  },
  async deleteEcosystemApp(this: SqliteStorage, geai: string): Promise<boolean> {
    return ecosystemAppRepo.deleteEcosystemApp(this.db, geai);
  },
  async createEcoAuth(this: SqliteStorage, req: EcoAuthorizationRecord): Promise<void> {
    return ecosystemAppRepo.createEcoAuth(this.db, req);
  },
  async getEcoAuthByDeviceCode(this: SqliteStorage, deviceCode: string): Promise<EcoAuthorizationRecord | null> {
    return ecosystemAppRepo.getEcoAuthByDeviceCode(this.db, deviceCode);
  },
  async getEcoAuthByUserCode(this: SqliteStorage, userCode: string): Promise<EcoAuthorizationRecord | null> {
    return ecosystemAppRepo.getEcoAuthByUserCode(this.db, userCode);
  },
  async updateEcoAuth(this: SqliteStorage, deviceCode: string, updates: Partial<EcoAuthorizationRecord>): Promise<void> {
    return ecosystemAppRepo.updateEcoAuth(this.db, deviceCode, updates);
  },
  async countPendingEcoAuthByOwner(this: SqliteStorage, ownerName: string): Promise<number> {
    return ecosystemAppRepo.countPendingEcoAuthByOwner(this.db, ownerName);
  },
  async listPendingEcoAuthByOwner(this: SqliteStorage, ownerName: string): Promise<EcoAuthorizationRecord[]> {
    return ecosystemAppRepo.listPendingEcoAuthByOwner(this.db, ownerName);
  },
  async cleanupExpiredEcoAuth(this: SqliteStorage): Promise<number> {
    return ecosystemAppRepo.cleanupExpiredEcoAuth(this.db);
  },
  async getAutomationRecipe(this: SqliteStorage, owner: string, app: string): Promise<EcoAutomationRecipe | null> {
    return ecosystemAppRepo.getAutomationRecipe(this.db, owner, app);
  },
  async upsertAutomationRecipe(this: SqliteStorage, recipe: EcoAutomationRecipe): Promise<EcoAutomationRecipe> {
    return ecosystemAppRepo.upsertAutomationRecipe(this.db, recipe);
  },
  async deleteAutomationRecipe(this: SqliteStorage, owner: string, app: string): Promise<boolean> {
    return ecosystemAppRepo.deleteAutomationRecipe(this.db, owner, app);
  },
  async listAutomationRecipesByOwner(this: SqliteStorage, owner: string): Promise<EcoAutomationRecipe[]> {
    return ecosystemAppRepo.listAutomationRecipesByOwner(this.db, owner);
  },
};
