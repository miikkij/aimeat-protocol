/**
 * @file src/services/db/knowledge-tab-db-service.ts
 * @description Purpose-built Application DB Service for the profile **Knowledge** tab — the ONE call behind
 *   GET /v1/knowledge/tab for the tab's OWNER-scoped data: the owner's knowledge packages (a memory read)
 *   + their consents (from which the tab derives which packages are federated). Composes both in one read
 *   scope. Two other mount reads stay SEPARATE by the same boundary discipline used elsewhere (ledger / EE
 *   / federation): public package DISCOVERY (`/v1/knowledge/discover`, cross-user best-effort) and the
 *   per-organism shared-package list (`/v1/knowledge/organism/:id`, a heavy node-wide consent+manifest scan
 *   — a future `listKnowledgeForOrgs` primitive, not a mount composite). Single-master: the Knowledge tab
 *   mount only. The individual endpoints stay for interactive re-fetch (import/delete/federate).
 *
 * @structure KnowledgeTabService.overview(ownerGaii) → { packages, consents }
 * @usage const ov = await createKnowledgeTabService(storage).overview(resolve(req));
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Knowledge tab's owner packages + consents into one composite.
 */
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';

export interface KnowledgeOverview {
  packages: Array<Record<string, unknown>>;
  consents: Array<Record<string, unknown>>;
}

export class KnowledgeTabService {
  constructor(private readonly storage: Storage) {}

  /**
   * The Knowledge tab's owner-scoped mount for one owner in a single read scope: the owner's knowledge
   * packages (memory, `packages/` prefix tagged `knowledge-package`, values included — the tab renders each
   * manifest) + the consent list (the tab extracts the `federation` consents on `packages/…/*` to mark
   * which packages are shared). Both mirror GET /v1/memory and GET /v1/consent respectively.
   */
  overview(ownerGaii: string): Promise<KnowledgeOverview> {
    return runInReadScope(async () => {
      const [pkgRecords, consents] = await Promise.all([
        this.storage.listMemory(ownerGaii, { prefix: 'packages/', tags: ['knowledge-package'] }),
        this.storage.listConsents(ownerGaii),
      ]);

      return {
        packages: pkgRecords.map(r => ({
          key: r.key, value: r.value, owner_gaii: r.ownerGaii, visibility: r.visibility,
          version: r.version, tags: r.tags, created_at: r.createdAt, updated_at: r.updatedAt,
        })),
        consents: consents.map(c => ({
          id: c.id, data_pattern: c.dataPattern, recipient: c.recipient, purpose: c.purpose,
          scope: c.scope, expires: c.expires, status: c.status, granted_at: c.grantedAt,
          revoked_at: c.revokedAt, metadata: c.metadata,
        })),
      };
    });
  }
}

/** Assemble the Knowledge tab composite over the given storage. */
export function createKnowledgeTabService(storage: Storage): KnowledgeTabService {
  return new KnowledgeTabService(storage);
}
