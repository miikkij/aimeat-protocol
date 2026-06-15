/**
 * @file ecosystem-app.repository.ts
 * @description Storage interface for the GEAI (ecosystem application) principal and its
 *   "hello integration" handshake — the near-copy of the agent + device-auth repositories, minus
 *   tasks. Implemented by both backends (SQLite + MongoDB/Prisma).
 * @structure EcosystemAppRepository — EcosystemApp CRUD + EcoAuth handshake methods
 * @usage Part of the composed `Storage` interface (storage/interface.ts).
 * @version-history
 *   v1.0.0 — 2026-06-14 — Created for ecosystem-apps foundation (chunk 1).
 *   v1.1.0 — 2026-06-15 — Add automation-recipe CRUD (feature B4): per-(owner, app) rule that
 *     materialises an agent task when the app publishes data on a matching memory key glob.
 */
import type { EcosystemAppRecord, EcoAuthorizationRecord, EcoAutomationRecipe } from '../interface.js';

export interface EcosystemAppRepository {
  // ── GEAI principal records (mirror of the agent CRUD, minus tasks) ──
  createEcosystemApp(app: EcosystemAppRecord): Promise<EcosystemAppRecord>;
  getEcosystemApp(geai: string): Promise<EcosystemAppRecord | null>;
  getEcosystemAppByOwnerAndApp(owner: string, app: string): Promise<EcosystemAppRecord | null>;
  getEcosystemAppsByOwner(owner: string): Promise<EcosystemAppRecord[]>;
  updateEcosystemApp(geai: string, updates: Partial<EcosystemAppRecord>): Promise<EcosystemAppRecord | null>;
  deleteEcosystemApp(geai: string): Promise<boolean>;

  // ── "Hello integration" handshake (mirror of the device-auth repository) ──
  createEcoAuth(req: EcoAuthorizationRecord): Promise<void>;
  getEcoAuthByDeviceCode(deviceCode: string): Promise<EcoAuthorizationRecord | null>;
  getEcoAuthByUserCode(userCode: string): Promise<EcoAuthorizationRecord | null>;
  updateEcoAuth(deviceCode: string, updates: Partial<EcoAuthorizationRecord>): Promise<void>;
  countPendingEcoAuthByOwner(ownerName: string): Promise<number>;
  listPendingEcoAuthByOwner(ownerName: string): Promise<EcoAuthorizationRecord[]>;
  cleanupExpiredEcoAuth(): Promise<number>;

  // ── Automation recipes (feature B4): one per (owner, app), keyed by bare owner name ──
  getAutomationRecipe(owner: string, app: string): Promise<EcoAutomationRecipe | null>;
  upsertAutomationRecipe(recipe: EcoAutomationRecipe): Promise<EcoAutomationRecipe>;
  deleteAutomationRecipe(owner: string, app: string): Promise<boolean>;
  listAutomationRecipesByOwner(owner: string): Promise<EcoAutomationRecipe[]>;
}
