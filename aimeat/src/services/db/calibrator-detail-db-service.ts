/**
 * @file src/services/db/calibrator-detail-db-service.ts
 * @description Purpose-built Application DB Service for the profile Calibrator "project detail" view — the
 *   ONE read behind GET /v1/calibrator/:id/detail. Opening a project fired a 4-request waterfall:
 *   getProject (project + dimensions), listVersions, getVersion(current), and listBatches — each awaited
 *   before the next, and every one a separate memory scan under the SAME `calibrator.{id}.` prefix. This
 *   composes all of it from a SINGLE prefix scan for the owner, partitioning the records client-side by key
 *   sub-prefix (project / dimensions / version.* / batch.*). Single-master: the Calibrator detail mount
 *   only. The individual endpoints stay for interactive re-fetches (post-version-create, live-update batch
 *   reload) and for the template-backfill write, which lives in the route where the default templates do.
 *
 * @structure CalibratorDetailService.overview(gaii, projectId) → { project, dimensions, versions, currentVersion, batches } | null
 * @usage const detail = await createCalibratorDetailService(storage).overview(gaii, id);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Calibrator detail mount's 4-read waterfall into one prefix scan.
 */
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';

interface BatchModel {
  modelId?: string;
  modelLabel?: string;
  step2_analysis?: { overallScore?: number | null };
  [key: string]: unknown;
}

export interface CalibratorDetail {
  project: Record<string, unknown>;
  dimensions: unknown;
  versions: Array<{ version: unknown; changelog: unknown; createdAt: unknown }>;
  currentVersion: unknown;
  batches: Array<Record<string, unknown>>;
}

export class CalibratorDetailService {
  constructor(private readonly storage: Storage) {}

  /**
   * The Calibrator project-detail mount for one owner in a single read scope. Returns null when the project
   * key is absent (the route maps that to 404). The `project` value is returned as stored — the route
   * applies the lazy template backfill (it owns the default-template constants).
   */
  overview(gaii: string, projectId: string): Promise<CalibratorDetail | null> {
    return runInReadScope(async () => {
      const prefix = `calibrator.${projectId}.`;
      const all = await this.storage.listMemory(gaii, { prefix });

      const projectRec = all.find(m => m.key === `${prefix}project`);
      if (!projectRec) return null;
      const project = projectRec.value as Record<string, unknown>;

      const dimensions = all.find(m => m.key === `${prefix}dimensions`)?.value ?? [];

      const versionPrefix = `${prefix}version.`;
      const versionRecs = all.filter(m => m.key.startsWith(versionPrefix));
      const versions = versionRecs
        .map(m => {
          const v = m.value as Record<string, unknown>;
          return { version: v.version, changelog: v.changelog, createdAt: v.createdAt };
        })
        .sort((a, b) => (a.version as number) - (b.version as number));

      const cur = (project.currentVersion as number) || 0;
      const currentVersion = cur > 0
        ? (versionRecs.find(m => m.key === `${versionPrefix}${cur}`)?.value ?? null)
        : null;

      const batchPrefix = `${prefix}batch.`;
      const batches = all
        .filter(m => m.key.startsWith(batchPrefix))
        .map(m => {
          const b = m.value as Record<string, unknown>;
          const models = (b.models as BatchModel[]) || [];
          return {
            batchId: b.batchId,
            createdAt: b.createdAt,
            promptVersion: b.promptVersion,
            status: b.status,
            modelCount: models.length,
            scores: models.map(model => ({
              modelId: model.modelId,
              modelLabel: model.modelLabel,
              overallScore: model.step2_analysis?.overallScore ?? null,
            })),
          };
        })
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

      return { project, dimensions, versions, currentVersion, batches };
    });
  }
}

/** Assemble the Calibrator detail composite over the given storage. */
export function createCalibratorDetailService(storage: Storage): CalibratorDetailService {
  return new CalibratorDetailService(storage);
}
