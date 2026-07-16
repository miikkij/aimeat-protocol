/**
 * @file src/services/db/memory-tab-db-service.ts
 * @description Purpose-built Application DB Service for the profile Memory tab — the ONE call behind
 *   GET /v1/memory/tab. The tab mounts a 6-request fan-out: agents + owner-scope memory (metadata-only) +
 *   files + consent + sharing-groups + organisms. This composes all six in ONE read scope. The memory
 *   section is METADATA-ONLY (no values — the tab lists keys/sizes and fetches values per-row on expand),
 *   reusing MemoryDbService.listOwnerScopeMeta so a keyspace of thousands of keys lists cheaply. The
 *   memory list is re-fetched interactively (agent filter / archived toggle), so this serves the MOUNT
 *   default; the individual /v1/memory endpoint stays for those. Single-master: the Memory tab mount only.
 *
 * @structure MemoryTabService.overview(ownerName, ownerGhii) → { agents, memory, files, consents, groups, organisms }
 * @usage const m = await createMemoryTabService(config, storage).overview(owner, `${owner}@${nodeId}`);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Memory tab's 6-request fan-out into one composite (meta-only memory).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/uow/unit-of-work.js';
import { LegacyMemoryAdapter } from '../../storage/adapter/legacy-memory-adapter.js';
import { MemoryRepository } from '../../storage/repositories-impl/memory-repository.js';
import { MemoryDbService } from './memory-db-service.js';
import { resolveOwnerIdentities } from './owner-identity.js';
import { visibilityToZone } from '../../routes/memory/shared.js';

export interface MemoryTabOverview {
  agents: unknown[];
  memory: { items: Array<Record<string, unknown>>; total: number; quota: Record<string, number> };
  files: { files: Array<Record<string, unknown>>; total: number };
  consents: { consents: Array<Record<string, unknown>>; total: number };
  groups: { groups: unknown[] };
  organisms: { organisms: unknown[] };
}

export class MemoryTabService {
  private readonly memoryDb: MemoryDbService;
  constructor(private readonly config: AimeatConfig, private readonly storage: Storage) {
    // Assemble the memory service the same way createMemoryDbService does — inline to avoid a circular
    // import through services/db/index.js (which re-exports this file).
    this.memoryDb = new MemoryDbService(new MemoryRepository(new LegacyMemoryAdapter(storage)), {
      nodeId: config.nodeId,
      resolveOwnerIdentities: (owner: string) => resolveOwnerIdentities(storage, config.nodeId, owner),
    });
  }

  /**
   * The Memory tab mount for one owner in a single read scope. The memory section is metadata-only
   * (owner-scope: GHII + agents + eco apps, via MemoryDbService — the same set the standalone endpoint
   * returns), so a large keyspace never loads a single value.
   */
  overview(ownerName: string, ownerGhii: string): Promise<MemoryTabOverview> {
    return runInReadScope(async () => {
      const agents = await this.storage.getAgentsByOwner(ownerName);
      const gaiis = [ownerGhii, ...agents.map(a => a.gaii)];

      const [metaRows, filesByOwner, consents, ownedGroups, memberGroups, organisms] = await Promise.all([
        this.memoryDb.listOwnerScopeMeta(ownerName, {}),
        this.storage.listStorageFilesForOwners(gaiis),
        this.storage.listConsents(ownerGhii),
        this.storage.listSharingGroups(ownerGhii),
        this.storage.listSharingGroupsByMember(ownerGhii),
        this.storage.listOrganisms({ member: ownerName }),
      ]);

      // memory (mirrors GET /v1/memory?include=meta): metadata rows + quota, no values.
      let totalBytes = 0;
      for (const r of metaRows) totalBytes += r.byteSize;
      const memory = {
        items: metaRows.map(r => ({
          key: r.key, owner_gaii: r.ownerGaii, bytes: r.byteSize, visibility: r.visibility,
          zone: visibilityToZone(r.visibility), tags: r.tags, version: r.version,
          flagCount: r.flagCount ?? 0, created_at: r.createdAt, updated_at: r.updatedAt,
        })),
        total: metaRows.length,
        quota: {
          max_keys: this.config.memoryMaxKeysPerAgent, used_keys: metaRows.length,
          max_bytes: this.config.memoryQuotaMb * 1024 * 1024, used_bytes: totalBytes,
        },
      };

      // files (mirrors GET /v1/memory/files owner session: GHII files first, then each agent).
      const fileRows: Array<Record<string, unknown>> = [];
      for (const g of gaiis) {
        for (const f of (filesByOwner[g] ?? [])) {
          fileRows.push({
            key: f.key, owner_gaii: f.ownerGaii, size: f.size, mime_type: f.mimeType,
            visibility: f.visibility, tags: f.tags || [], created_at: f.createdAt,
          });
        }
      }

      // consent (mirrors GET /v1/consent).
      const consentRows = consents.map(c => ({
        id: c.id, data_pattern: c.dataPattern, recipient: c.recipient, purpose: c.purpose,
        scope: c.scope, expires: c.expires, status: c.status, granted_at: c.grantedAt,
        revoked_at: c.revokedAt, metadata: c.metadata,
      }));

      // groups (mirrors GET /v1/groups owner branch: owned + member-of, deduped by id).
      const seen = new Set<string>();
      const groupList = [...ownedGroups, ...memberGroups].filter(g => {
        const id = (g as { id?: string }).id ?? '';
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      return {
        agents,
        memory,
        files: { files: fileRows, total: fileRows.length },
        consents: { consents: consentRows, total: consentRows.length },
        groups: { groups: groupList },
        organisms: { organisms },
      };
    });
  }
}

/** Assemble the Memory tab composite over the given storage. */
export function createMemoryTabService(config: AimeatConfig, storage: Storage): MemoryTabService {
  return new MemoryTabService(config, storage);
}
