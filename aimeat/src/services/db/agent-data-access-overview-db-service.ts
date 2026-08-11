/**
 * @file src/services/db/agent-data-access-overview-db-service.ts
 * @description Purpose-built Application DB Service for the agent-card **Data Access** subtab — the ONE call
 *   behind GET /v1/agents/:name/data-access/overview. The subtab mounted a 3-request fan-out across three
 *   domains: getDirectives (memory_areas + resources), the agent's memory list, and the agent's skill
 *   links. This composes all three in one read scope AND narrows the memory read to METADATA only
 *   (listMemoryMeta — the tab renders key/visibility/version/dates, never the values, but the old
 *   /v1/memory?agent= read loaded every value). Single-master: the Data Access subtab mount only. The
 *   individual endpoints stay for interactive re-fetch (value expand, live-update).
 *
 * @structure AgentDataAccessOverviewService.overview(agentGaii, owner, agentName) → { directives, memory_keys, skill_links }
 * @usage const ov = await createAgentDataAccessOverviewService(storage, config).overview(gaii, owner, name);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Data Access subtab's 3 reads into one composite (memory = meta-only).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { getAgentSkillLinks } from '../skills.js';

export interface AgentDataAccessOverview {
  directives: {
    memory_areas: Array<Record<string, unknown>>;
    resources: unknown[];
  };
  memory_keys: Array<{ key: string; visibility: string; version: number; created_at: string; updated_at: string }>;
  skill_links: unknown[];
}

export class AgentDataAccessOverviewService {
  constructor(private readonly storage: Storage, private readonly config: AimeatConfig) {}

  /**
   * The Data Access subtab mount for one agent in a single read scope: the directives-derived memory areas
   * + resources, the agent's memory keys (metadata only), and its skill links. Mirrors the leaves the tab
   * consumes from GET /directives, GET /v1/memory?agent=, and GET /skills/links respectively.
   */
  overview(agentGaii: string, owner: string, agentName: string): Promise<AgentDataAccessOverview> {
    return runInReadScope(async () => {
      const [directives, metaRows, skillLinks] = await Promise.all([
        this.storage.getAgentDirectives(agentGaii),
        this.storage.listMemoryMeta(agentGaii, {}),
        getAgentSkillLinks(this.storage, this.config, owner, agentName),
      ]);

      return {
        directives: {
          memory_areas: (directives?.memoryAreas ?? []).map(ma => ({
            key_prefix: ma.keyPrefix, description: ma.description, schema: ma.schema, csm_id: ma.csmId,
          })),
          resources: directives?.resources ?? [],
        },
        memory_keys: metaRows.map(r => ({
          key: r.key, visibility: r.visibility, version: r.version,
          created_at: r.createdAt, updated_at: r.updatedAt,
        })),
        skill_links: skillLinks,
      };
    });
  }
}

/** Assemble the Data Access subtab composite over the given storage. */
export function createAgentDataAccessOverviewService(storage: Storage, config: AimeatConfig): AgentDataAccessOverviewService {
  return new AgentDataAccessOverviewService(storage, config);
}
