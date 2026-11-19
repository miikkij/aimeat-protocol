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
 *   (services/operator/override.ts) asks one operator question on both surfaces.
 *
 *   THE GATES, in order. A source the operator hid is not found for anyone but its owner and the
 *   operator. A source whose audience does not admit the caller (signInGateOf, the read gate's own
 *   question: an app opened to one organism, to signed-in people, or a node with signed-in content
 *   access) refuses everyone but its owner, the operator and the people it admits. A source not open for forking refuses everyone but its owner and the operator. A source
 *   behind an access code needs that code from everyone but its owner and the operator. A paced
 *   source needs a licence on the caller's owner GHII (the coordinate the purchase receipt stored),
 *   for the version copied, from everyone but its owner and the operator. The operator is asked only
 *   where a gate would refuse a caller who is not the owner, so the trail is written only for a fork
 *   that needed the pass. The refusal names the gate; each surface words it.
 * @structure ForkGate · forkSourceFor(storage, config, caller, src)
 * @usage
 *   const gate = await forkSourceFor(storage, config, { owner, gaii, auth: req.auth }, { owner: srcOwner, filename, version });
 *   if (!gate.ok) return refuse(gate.refusal);
 * @version-history
 *   v1.2.0 — 2026-11-19 — Gate `audience`: a forkable app opened only to one organism gave its whole
 *     source to any signed-in account of the node, while the read gate refused them the page. The fork
 *     gate now asks signInGateOf() (services/app/read-gate.ts), the read gate's one decision; owner,
 *     operator and the people the app admits fork as before (feature audit 2026-11-19, 1.1).
 *   v1.1.0 — 2026-11-15 — Gate `access-code`: a source behind an access code needs the code
 *     (caller.accessCode equal to the latest row's accessCode, the read gate's rule) from everyone but
 *     its owner and the operator. A fork copied the protected bytes with no code (E2E audit M093).
 *   v1.0.0 — 2026-11-14 — Initial (structure programme 2026-11, unit 2b part 2, phase B, B9).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppRecord } from '../../storage/interface.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import { operatorOverride, type OperatorAuth } from '../operator/override.js';
import { appIsPaced, appToll } from './pacing.js';
import { currentAppRow } from './served-protection.js';
import { signInGateOf, accountAppReader } from './read-gate.js';

export type ForkRefusal =
    | { gate: 'missing' }
    | { gate: 'hidden' }
    /** The read gate refuses this caller the app: `account` is whether it is an account of this node (403) or not (401). */
    | { gate: 'audience'; account: boolean }
    | { gate: 'not-forkable' }
    | { gate: 'access-code' }
    | { gate: 'purchase-required'; toll: number };

export type ForkGate = { ok: true; source: AppRecord } | { ok: false; refusal: ForkRefusal };

/**
 * The source app when `caller` may fork it. `caller.owner` is the caller's account name, `gaii` its
 * identity (the licence is asked of ownerGhiiOf(gaii)), `auth` the session for the operator's pass,
 * `accessCode` the code the caller sent for an app behind one.
 */
export async function forkSourceFor(
    storage: Storage, config: AimeatConfig,
    caller: { owner: string; gaii: string; auth: OperatorAuth | null | undefined; accessCode?: string | undefined },
    src: { owner: string; filename: string; version?: number | undefined },
): Promise<ForkGate> {
    const source = await storage.getAppByOwnerName(src.owner, src.filename, src.version);
    if (!source) return { ok: false, refusal: { gate: 'missing' } };

    const sameOwner = caller.owner === source.ownerName;
    // The pacing amount is the latest version's, also when an older version is forked: a publish
    // writes it on its new row only (QA audit F10a-01).
    const current = await currentAppRow(storage, source, src.version);
    const paced = appIsPaced(config, current.manifest);
    // The access code is the latest version's, as the read gate takes it (routes/apps/read.ts): a
    // publish writes it on its new row only.
    const codeLocked = !!current.accessCode && current.accessCode !== caller.accessCode;
    // Who may open the app (its `access` setting, or the node's signed-in content access) is the read
    // gate's own question, asked here with no operator pass: the operator is asked once, below.
    const audience = sameOwner ? null
        : await signInGateOf(storage, config, source, current, accountAppReader(caller.auth, caller.owner));
    const isOperator = !sameOwner && (!!source.operatorHidden || !source.forkable || codeLocked || paced || !!audience)
        && await operatorOverride(storage, config, caller.auth, {
            ownerOf: source.ownerName, area: 'app', action: 'fork', subject: src.filename,
        });

    // Mirrors the read gate's 404, so moderation status is not leaked through a fork.
    if (source.operatorHidden && !isOperator && !sameOwner) return { ok: false, refusal: { gate: 'hidden' } };
    // A fork copies the page the app's audience keeps from everybody else, so a caller the read gate
    // refuses (an app opened to one organism, and the caller not in it) is refused here as well.
    if (audience && !isOperator) return { ok: false, refusal: { gate: 'audience', account: audience.account } };
    if (!isOperator && !sameOwner && !source.forkable) return { ok: false, refusal: { gate: 'not-forkable' } };
    // A fork copies the bytes the access code keeps from other people, so it asks the code the read
    // gate asks; the owner and the operator fork without it, as they open the app without it.
    if (codeLocked && !isOperator && !sameOwner) return { ok: false, refusal: { gate: 'access-code' } };
    if (paced && !sameOwner && !isOperator) {
        // The version copied: a single licence covers the version bought (feature-list audit #110).
        const licensed = await storage.hasValidLicense(ownerGhiiOf(caller.gaii), source.ownerGaii, src.filename, undefined, source.versionNumber);
        if (!licensed) return { ok: false, refusal: { gate: 'purchase-required', toll: appToll(current.manifest) } };
    }
    return { ok: true, source };
}
