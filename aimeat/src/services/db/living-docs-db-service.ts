/**
 * @file src/services/db/living-docs-db-service.ts
 * @description Purpose-built Application DB Service for the profile **Living Docs** tab — the ONE call
 *   behind GET /v1/living-docs. The tab mounted three requests, TWO of which were identical full owner-memory
 *   scans: listTemplates() and listInstances() each fetched GET /v1/memory and filtered client-side, plus
 *   listOrganisms(member). This reads owner memory ONCE and partitions it server-side into templates
 *   (`living.template.*`) and deployed instances (`organism.{org}.w.{ws}.living.{doc}.latest` records of
 *   type `living-config`), returning only those (not the whole keyspace over the wire), alongside the
 *   organism list. Single-master: the Living Docs tab mount only. The individual reads stay for interactive
 *   re-fetch (save/deploy/delete).
 *
 * @structure LivingDocsService.overview(ownerName, ownerGhii) → { templates, instances, organisms }
 * @usage const ov = await createLivingDocsService(storage).overview(ownerName, ownerGhii);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Living Docs tab's 2 duplicate memory scans + organisms into one.
 */
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';

const TEMPLATE_PREFIX = 'living.template.';
// A deployed living instance's config key: organism.{org}.w.{ws}.living.{docId}.latest (mirrors the
// client's parseConfigKey in public/js/services/living.js).
const CONFIG_KEY_RE = /^organism\.(.+?)\.w\.(.+?)\.living\.([^.]+)\.latest$/;

export interface LivingDocsOverview {
  templates: unknown[];
  instances: Array<{ loc: { orgId: string; wsId: string; docId: string }; config: unknown; updatedAt: string }>;
  organisms: unknown[];
}

export class LivingDocsService {
  constructor(private readonly storage: Storage) {}

  /**
   * The Living Docs tab mount for one owner in a single read scope. Templates are sorted by title;
   * instances (newest first) mirror the client's listInstances partition exactly. Organisms come from the
   * owner's memberships (the deploy-target picker).
   */
  overview(ownerName: string, ownerGhii: string): Promise<LivingDocsOverview> {
    return runInReadScope(async () => {
      const [records, organisms] = await Promise.all([
        this.storage.listMemory(ownerGhii),
        this.storage.listOrganisms({ member: ownerName }),
      ]);

      const templates = records
        .filter(r => typeof r.key === 'string' && r.key.startsWith(TEMPLATE_PREFIX))
        .map(r => r.value)
        .filter(v => v && typeof v === 'object')
        .sort((a, b) => String((a as { title?: unknown }).title || '').localeCompare(String((b as { title?: unknown }).title || '')));

      const instances: LivingDocsOverview['instances'] = [];
      for (const r of records) {
        if (typeof r.key !== 'string') continue;
        const m = CONFIG_KEY_RE.exec(r.key);
        if (m && r.value && (r.value as { type?: unknown }).type === 'living-config') {
          instances.push({ loc: { orgId: m[1], wsId: m[2], docId: m[3] }, config: r.value, updatedAt: r.updatedAt || r.createdAt });
        }
      }
      instances.sort((a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0));

      return { templates, instances, organisms };
    });
  }
}

/** Assemble the Living Docs composite over the given storage. */
export function createLivingDocsService(storage: Storage): LivingDocsService {
  return new LivingDocsService(storage);
}
