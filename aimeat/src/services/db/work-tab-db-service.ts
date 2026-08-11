/**
 * @file src/services/db/work-tab-db-service.ts
 * @description Purpose-built Application DB Service for the profile **Work** tab — the ONE call behind
 *   GET /v1/work/overview. The tab mounted two sequential requests (GET /v1/work/inbox + GET /v1/work/sent),
 *   each of which, for an owner session, resolved the owner's agents (getAgentsByOwner) and ran a batched
 *   provider/requester IN-query. This composes both in one read scope, resolving the owner's agents ONCE
 *   and running the provider + requester reads together. Single-master: the Work tab mount only. The
 *   individual endpoints stay for interactive re-fetch (accept/reject/deliver/rate).
 *
 * @structure WorkTabService.overview(isOwnerSession, ownerName, sub) → { inbox, sent }
 * @usage const ov = await createWorkTabService(storage).overview(isOwner, ownerName, req.auth.sub);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Work tab's inbox + sent reads into one composite.
 */
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';

const OPEN_INBOX_STATUSES = ['pending', 'accepted', 'in_progress'];

export interface WorkOverview {
  inbox: Array<Record<string, unknown>>;
  sent: Array<Record<string, unknown>>;
}

export class WorkTabService {
  constructor(private readonly storage: Storage) {}

  /**
   * The Work tab mount for one caller in a single read scope. Owner sessions see work across all their
   * agents (one provider IN-query + one requester IN-query, agents resolved once); an agent session sees
   * only its own. Sub-object shapes mirror GET /v1/work/inbox and /v1/work/sent exactly.
   */
  overview(isOwnerSession: boolean, ownerName: string, sub: string): Promise<WorkOverview> {
    return runInReadScope(async () => {
      let providerItems: Awaited<ReturnType<typeof this.storage.listWorkByProvider>>;
      let requesterItems: Awaited<ReturnType<typeof this.storage.listWorkByRequester>>;

      if (isOwnerSession) {
        const agents = await this.storage.getAgentsByOwner(ownerName);
        const gaiis = agents.map(a => a.gaii);
        [providerItems, requesterItems] = await Promise.all([
          gaiis.length ? this.storage.listWorkByProviders(gaiis) : Promise.resolve([]),
          gaiis.length ? this.storage.listWorkByRequesters(gaiis) : Promise.resolve([]),
        ]);
      } else {
        [providerItems, requesterItems] = await Promise.all([
          this.storage.listWorkByProvider(sub),
          this.storage.listWorkByRequester(sub),
        ]);
      }

      const pending = providerItems.filter(w => OPEN_INBOX_STATUSES.includes(w.status));
      return {
        inbox: pending.map(w => ({
          tracking_code: w.trackingCode, status: w.status, action_id: w.actionId,
          requester_gaii: w.requesterGaii, cost: w.cost, ttl_expires_at: w.ttlExpiresAt, created_at: w.createdAt,
        })),
        sent: requesterItems.map(w => ({
          tracking_code: w.trackingCode, status: w.status, action_id: w.actionId,
          provider_gaii: w.providerGaii, cost: w.cost, rating: w.rating, ttl_expires_at: w.ttlExpiresAt, created_at: w.createdAt,
        })),
      };
    });
  }
}

/** Assemble the Work tab composite over the given storage. */
export function createWorkTabService(storage: Storage): WorkTabService {
  return new WorkTabService(storage);
}
