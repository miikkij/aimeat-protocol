/**
 * @file src/services/app/fork-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a caller may fork one app, and the source read. POST
 *   /v1/apps/:owner/:filename/fork and the MCP tool aimeat_app_fork each read the source and asked
 *   their own three gates before forkApp (services/app/lifecycle.ts) copied it. The route admitted the
 *   source's owner to an app the operator hid and asked operatorOverride wherever a gate would refuse;
 *   the tool refused a hidden source to everybody, its owner included, and held that "agents are never
 *   operators here", so the operator's agent holding operator:admin was refused on a source the route
 *   let it fork (structure programme 2026-11, unit 2b, B9). The operator ruling of 2026-10-05
 *   (services/operator-override.ts) asks one operator question on both surfaces.
 *
 *   THE GATES, in order. A source the operator hid is not found for anyone but its owner and the
 *   operator. A source not open for forking refuses everyone but its owner and the operator. A paced
 *   source needs a licence on the caller's owner GHII (the coordinate the purchase receipt stored),
 *   for the version copied, from everyone but its owner and the operator. The operator is asked only
 *   where a gate would refuse a caller who is not the owner, so the trail is written only for a fork
 *   that needed the pass. The refusal names the gate; each surface words it.
 * @structure ForkGate · forkSourceFor(storage, config, caller, src)
 * @usage
 *   const gate = await forkSourceFor(storage, config, { owner, gaii, auth: req.auth }, { owner: srcOwner, filename, version });
 *   if (!gate.ok) return refuse(gate.refusal);
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (structure programme 2026-11, unit 2b part 2, phase B, B9).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppRecord } from '../../storage/interface.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import { operatorOverride, type OperatorAuth } from '../operator-override.js';
import { appIsPaced, appToll } from './pacing.js';
import { currentAppRow } from './served-protection.js';

export type ForkRefusal =
    | { gate: 'missing' }
    | { gate: 'hidden' }
    | { gate: 'not-forkable' }
    | { gate: 'purchase-required'; toll: number };

export type ForkGate = { ok: true; source: AppRecord } | { ok: false; refusal: ForkRefusal };

/**
 * The source app when `caller` may fork it. `caller.owner` is the caller's account name, `gaii` its
 * identity (the licence is asked of ownerGhiiOf(gaii)), `auth` the session for the operator's pass.
 */
export async function forkSourceFor(
    storage: Storage, config: AimeatConfig,
    caller: { owner: string; gaii: string; auth: OperatorAuth | null | undefined },
    src: { owner: string; filename: string; version?: number | undefined },
): Promise<ForkGate> {
    const source = await storage.getAppByOwnerName(src.owner, src.filename, src.version);
    if (!source) return { ok: false, refusal: { gate: 'missing' } };

    const sameOwner = caller.owner === source.ownerName;
    // The pacing amount is the latest version's, also when an older version is forked: a publish
    // writes it on its new row only (QA audit F10a-01).
    const current = await currentAppRow(storage, source, src.version);
    const paced = appIsPaced(config, current.manifest);
    const isOperator = !sameOwner && (!!source.operatorHidden || !source.forkable || paced)
        && await operatorOverride(storage, config, caller.auth, {
            ownerOf: source.ownerName, area: 'app', action: 'fork', subject: src.filename,
        });

    // Mirrors the read gate's 404, so moderation status is not leaked through a fork.
    if (source.operatorHidden && !isOperator && !sameOwner) return { ok: false, refusal: { gate: 'hidden' } };
    if (!isOperator && !sameOwner && !source.forkable) return { ok: false, refusal: { gate: 'not-forkable' } };
    if (paced && !sameOwner && !isOperator) {
        // The version copied: a single licence covers the version bought (feature-list audit #110).
        const licensed = await storage.hasValidLicense(ownerGhiiOf(caller.gaii), source.ownerGaii, src.filename, undefined, source.versionNumber);
        if (!licensed) return { ok: false, refusal: { gate: 'purchase-required', toll: appToll(current.manifest) } };
    }
    return { ok: true, source };
}
