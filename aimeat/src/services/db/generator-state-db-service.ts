/**
 * @file src/services/db/generator-state-db-service.ts
 * @description Purpose-built Application DB Service for the Generator **project dashboard** mount — the ONE
 *   memory read behind GET /v1/generator/:projectId/state. Opening a generator project fired an 11-request
 *   waterfall, of which EIGHT were separate owner-scope memory scans under the SAME `generator.{id}.`
 *   prefix: getProject, getInterviewSpec, loadAllComponents (component.* + spec.*), getPendingEdit, then
 *   getComponentStatuses re-ran loadAllComponents (component.* + spec.* AGAIN), plus a cleanup scan. This
 *   folds all of those into a SINGLE prefix scan partitioned by key sub-prefix. The three cross-domain
 *   live-registry reads the status check needs (extensions / cortex / apps) stay separate requests — a
 *   different subsystem, same boundary discipline as the ledger / skill-bundle slices → the mount goes
 *   11→4. Single-master: the Generator dashboard mount only. Individual /v1/memory reads stay as fallback +
 *   interactive re-fetch (save, live-update).
 *
 * @structure GeneratorStateService.state(ownerGhii, projectId) → { project, interviewSpec, pendingEdit, componentItems, specItems } | null
 * @usage const st = await createGeneratorStateService(storage).state(ownerGhii, projectId);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Generator dashboard's 8 memory scans into one prefix scan.
 */
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/uow/unit-of-work.js';

interface RawItem { key: string; value: unknown; version: number }

export interface GeneratorState {
  project: RawItem;
  interviewSpec: RawItem | null;
  pendingEdit: RawItem | null;
  componentItems: RawItem[];
  specItems: RawItem[];
}

export class GeneratorStateService {
  constructor(private readonly storage: Storage) {}

  /**
   * The Generator dashboard mount for one owner project in a single read scope. Reads across the owner's
   * identities (GHII + agents), mirroring the dashboard's `owner_scope=true` reads — generator data may be
   * created by the owner's generator agent (device auth), so a single-GHII read would miss it. Returns null
   * when the project key is absent (the route maps that to 404). Raw records are returned {key, value,
   * version} so the dashboard parses/merges them with its existing (unchanged) transform logic; version is
   * preserved for the optimistic-lock writes the editor makes.
   */
  state(ownerName: string, ownerGhii: string, projectId: string): Promise<GeneratorState | null> {
    return runInReadScope(async () => {
      const prefix = `generator.${projectId}.`;
      const agents = await this.storage.getAgentsByOwner(ownerName);
      const gaiis = [ownerGhii, ...agents.map(a => a.gaii)];
      const records = await this.storage.listMemoryForOwners(gaiis, { prefix });

      const pick = (key: string): RawItem | null => {
        const r = records.find(m => m.key === key);
        return r ? { key: r.key, value: r.value, version: r.version } : null;
      };
      const project = pick(`${prefix}project`);
      if (!project) return null;

      const componentPrefix = `${prefix}component.`;
      const specPrefix = `${prefix}spec.`;
      const raw = (r: { key: string; value: unknown; version: number }): RawItem => ({ key: r.key, value: r.value, version: r.version });

      return {
        project,
        interviewSpec: pick(`${prefix}interview-spec`),
        pendingEdit: pick(`${prefix}pending-edit`),
        componentItems: records.filter(m => m.key.startsWith(componentPrefix)).map(raw),
        specItems: records.filter(m => m.key.startsWith(specPrefix)).map(raw),
      };
    });
  }
}

/** Assemble the Generator dashboard state composite over the given storage. */
export function createGeneratorStateService(storage: Storage): GeneratorStateService {
  return new GeneratorStateService(storage);
}
