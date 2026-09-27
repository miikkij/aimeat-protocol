/**
 * @file src/services/db/work-tab-db-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Purpose-built Application DB Service for the profile **Work** tab — the ONE call behind
 *   GET /v1/work/overview. The tab mounted two sequential requests (GET /v1/work/inbox + GET /v1/work/sent),
 *   each of which, for an owner session, resolved the owner's agents (getAgentsByOwner) and ran a batched
 *   provider/requester IN-query. This composes both in one read scope, resolving the owner's agents ONCE
 *   and running the provider + requester reads together. Single-master: the Work tab mount only. The
 *   individual endpoints stay for interactive re-fetch (accept/reject/deliver/rate).
 *
 * @structure WorkTabService.overview(isOwnerSession, ownerName, caller) → { inbox, sent }
 * @usage const ov = await createWorkTabService(storage).overview(isOwner, ownerName, resolveIdentity(req.auth, nodeId));
 * @version-history
 *   v1.1.0 — 2026-09-26 — The caller is the resolved identity, and an owner session's tab reads the
 *     person's own GHII beside their agents', where the work on an action they published is.
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
   * The Work tab mount for one caller in a single read scope. `caller` is the resolved identity
   * (resolveIdentity): a person's GHII, an agent's GAII. Owner sessions see their own work and the
   * work of all their agents (one provider IN-query + one requester IN-query, agents resolved once);
   * an agent session sees only its own. Sub-object shapes mirror GET /v1/work/inbox and
   * /v1/work/sent exactly.
   */
  overview(isOwnerSession: boolean, ownerName: string, caller: string): Promise<WorkOverview> {
    return runInReadScope(async () => {
      let providerItems: Awaited<ReturnType<typeof this.storage.listWorkByProvider>>;
      let requesterItems: Awaited<ReturnType<typeof this.storage.listWorkByRequester>>;

      if (isOwnerSession) {
        const agents = await this.storage.getAgentsByOwner(ownerName);
        const identities = [caller, ...agents.map(a => a.gaii)];
        [providerItems, requesterItems] = await Promise.all([
          this.storage.listWorkByProviders(identities),
          this.storage.listWorkByRequesters(identities),
        ]);
      } else {
        [providerItems, requesterItems] = await Promise.all([
          this.storage.listWorkByProvider(caller),
          this.storage.listWorkByRequester(caller),
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
