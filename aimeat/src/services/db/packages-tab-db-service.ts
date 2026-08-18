/**
 * @file src/services/db/packages-tab-db-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Purpose-built Application DB Service for the profile Packages tab — the ONE call behind
 *   GET /v1/packages/tab. The tab mounts a 4-request fan-out: installed instances + the owner's packages
 *   + newest template listings (three LOCAL reads) plus a cross-node federation-templates call. This
 *   folds the THREE local reads into one read scope; the federation section stays on its own best-effort
 *   outbound call (a composite must not make cross-node HTTP that could slow/fail the local view). Each
 *   section is returned in its source endpoint's payload shape. Single-master: the Packages tab mount.
 *
 * @structure PackagesTabService.overview(owner) → { instances, packages, templates }
 * @usage const p = await createPackagesTabService(storage).overview(owner);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Packages tab's 3 local reads into one composite (federation stays separate).
 */
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';

export interface PackagesOverview {
  instances: { instances: unknown[]; total: number };
  packages: { packages: unknown[]; total: number };
  templates: { templates: unknown[]; total: number };
}

export class PackagesTabService {
  constructor(private readonly storage: Storage) {}

  /**
   * The Packages tab mount for one owner in a single read scope. Mirrors the three local endpoints the
   * tab fans out on load (their default params): installed instances, the owner's own packages (author =
   * owner, so private ones are included), and the newest listed templates.
   */
  overview(owner: string): Promise<PackagesOverview> {
    return runInReadScope(async () => {
      const [inst, pkg, tpl] = await Promise.all([
        this.storage.listInstances({ owner, status: 'installed', limit: 50, offset: 0 }),
        // author === owner → visibility left unset so the owner sees their own private packages too
        // (mirrors GET /v1/packages when author matches the authed owner).
        this.storage.listPackages({ author: owner, status: 'published', limit: 50, offset: 0 }),
        this.storage.listTemplateListings({ sort: 'newest', status: 'listed', limit: 20, offset: 0 }),
      ]);
      return {
        instances: { instances: inst.instances, total: inst.total },
        packages: { packages: pkg.packages, total: pkg.total },
        templates: { templates: tpl.listings, total: tpl.total },
      };
    });
  }
}

/** Assemble the Packages tab composite over the given storage. */
export function createPackagesTabService(storage: Storage): PackagesTabService {
  return new PackagesTabService(storage);
}
