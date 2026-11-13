/**
 * @file src/services/capabilities/capability-for.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may reach one capability by its id, and the read. GET /v1/capabilities/:id,
 *   POST /v1/capabilities/:id/invoke and the MCP tools aimeat_capabilities_get and
 *   aimeat_capabilities_invoke each read the record and asked capabilityHiddenFrom
 *   (services/capability-reach.ts), then admitted the operator. The routes asked operatorOverride,
 *   which writes the operator trail, as the operator ruling of 2026-10-05 says every pass into another
 *   person's account does (services/operator-override.ts); the tools asked resolveOperatorAgentName,
 *   which admits the same callers and writes nothing, so an operator reading or running a private
 *   capability over MCP left the person no line on their account feed (structure programme 2026-11,
 *   unit 2b, B10).
 *
 *   THE RULE. A private capability, an unknown visibility word and a capability never published
 *   reach the owner's side and the operator only, and answer everyone else as a missing id does. The
 *   operator's pass writes the trail with `action` (read, invoke).
 * @structure CapabilityReach · capabilityFor(storage, config, reader, id, action)
 * @usage
 *   const found = await capabilityFor(storage, config, { identity: resolve(req), auth: req.auth }, id, 'read');
 *   if (!found.ok) return notFound();
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (structure programme 2026-11, unit 2b part 2, phase B, B10).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, CapabilityRecord } from '../../storage/interface.js';
import { capabilityHiddenFrom } from '../capability-reach.js';
import { operatorOverride, type OperatorAuth } from '../operator-override.js';

export type CapabilityReach = { ok: true; capability: CapabilityRecord } | { ok: false };

/**
 * The capability `id` when `reader` may reach it: open to others, on the owner's side of
 * `reader.identity`, or the operator's pass (which writes the trail). `identity` is null and `auth`
 * absent for a request with no credential.
 */
export async function capabilityFor(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>,
    reader: { identity: string | null; auth: OperatorAuth | null | undefined },
    id: string, action: 'read' | 'invoke',
): Promise<CapabilityReach> {
    const capability = await storage.getCapability(id);
    if (!capability) return { ok: false };
    if (!capabilityHiddenFrom(capability, reader.identity)) return { ok: true, capability };
    const admitted = !!reader.auth && await operatorOverride(storage, config, reader.auth,
        { ownerOf: capability.ownerGhii, area: 'capability', action, subject: capability.name });
    return admitted ? { ok: true, capability } : { ok: false };
}
