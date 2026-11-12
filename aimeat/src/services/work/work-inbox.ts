/**
 * @file src/services/work/work-inbox.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The work waiting on a provider: pending, accepted or in progress. GET /v1/work/inbox
 *   and aimeat_work_inbox both read it here (CLAUDE.md, Backend: one capability, one implementation);
 *   each surface keeps its own scope gate and its own item shape.
 *
 *   `actingFor` is the owner name of a person reading in person: their own work, their agents' and
 *   their ecosystem apps' are then read in ONE providerGaii IN (…) query over
 *   services/db/owner-identity.ts identitiesActingFor. Without it, the provider's own work only.
 * @structure listPendingWork · PENDING_WORK_STATUSES
 * @usage const pending = await listPendingWork(storage, { principal: me, actingFor: ownerName });
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial (structure programme unit 2): moved out of routes/work.ts and
 *     mcp/core-work.ts unchanged.
 */
import type { Storage, WorkRecord } from '../../storage/interface.js';
import { identitiesActingFor } from '../db/owner-identity.js';

/** The statuses that put a work item in its provider's inbox. */
export const PENDING_WORK_STATUSES = ['pending', 'accepted', 'in_progress'];

/** The work waiting on `principal`, or on everything the person `actingFor` acts through. */
export async function listPendingWork(
    storage: Storage, provider: { principal: string; actingFor?: string },
): Promise<WorkRecord[]> {
    const items = provider.actingFor !== undefined
        ? await storage.listWorkByProviders(await identitiesActingFor(storage, provider.actingFor, provider.principal))
        : await storage.listWorkByProvider(provider.principal);
    return items.filter(w => PENDING_WORK_STATUSES.includes(w.status));
}
