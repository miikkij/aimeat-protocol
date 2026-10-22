/**
 * @file src/services/datapackage/publish-ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate for a data package (plan doc-mvcn6c7e4e5q, V4): POST /v1/datapackages
 *   and aimeat_datapackage_publish ask here before they publish, and file the request here after.
 *
 *   A publish is public when it names no visibility, so it raises the package to public whenever the
 *   pointer is narrower now or there is none yet (isRaiseToPublic). On an ask the version is published
 *   at the audience the package had, and a first version 'private': the bytes land, a consumer the
 *   audience admits reads them, and the request names the version. The approval gives that version
 *   the audience 'public' through setVersionAudience (./version-audience.ts), the function a publish
 *   of the same bytes as public calls.
 *
 *   ctx.datapackage.publish (./ext-capability.ts) and the workflow datapackage step ask the same
 *   decision through datapackageGateOf, about the principals behind the run
 *   (services/publish-actors.ts), because they reach publishPackage with no request to ask.
 * @structure DatapackageGate · datapackagePublishGate · datapackageGateOf · fileDatapackageAsk
 * @usage
 *   const gate = await datapackagePublishGate(deps, caller, app, ownerGhii, name, body.visibility);
 *   if (gate.kind === 'refused') → 403
 *   const out = await publishPackage(deps, ownerGhii, { ...input, visibility: gate.visibility }, producedBy);
 *   const asked = gate.requester && out.ok ? await fileDatapackageAsk(deps, owner, gate.requester, ownerGhii, name, out.contentHash, gate.from) : {};
 * @version-history
 *   v1.3.0 — 2026-10-22 — datapackageGateOf: the decision with the gate's answer supplied by the
 *     caller, for the extension capability and the workflow step (secaudit 2026-10, v68).
 *     datapackagePublishGate calls it with the request's caller object, unchanged.
 *   v1.2.0 — 2026-10-18 — On a node that shows its content to signed-in accounts only, a publish that
 *     raises the package to public (named, or visibility.datapackage_default) is stored at 'members'
 *     and the gate answers `warning` PUBLIC_IS_SIGNED_IN_HERE (services/closed-node-level.ts, plan V1.6).
 *   v1.1.0 — 2026-10-18 — A publish that names no visibility asks about visibility.datapackage_default
 *     (code default public; plan V5.6), and the gate answers the level it decided.
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: data packages).
 */
import type { CallerContext } from '../caller-context.js';
import { isRaiseToPublic } from '../publish-gate.js';
import { publishAskOf, fileAsk, publishRequestedBody, type PublishAsk } from '../publish-requests/ask.js';
import type { PublishRequester, PublishStoreCtx } from '../publish-requests/store.js';
import { readPointer } from './version-audience.js';
import { datapackageVisibilityDefault } from '../content-defaults.js';
import { closedNodeLevel, type ClosedNodeWarning } from '../closed-node-level.js';

export type DatapackageGate =
  | { kind: 'refused'; status: 403; code: string; message: string }
  /** `warning`: a closed node stores 'members' instead of public (closed-node-level.ts, plan V1.6). */
  | { kind: 'go'; visibility: string | undefined; requester: PublishRequester | null; from: string; warning?: ClosedNodeWarning };

/** May this caller publish the package at the requested visibility (visibility.datapackage_default when not named)? */
export async function datapackagePublishGate(
  ctx: PublishStoreCtx, caller: CallerContext, app: string | undefined, ownerGhii: string, name: string, requested: string | undefined,
): Promise<DatapackageGate> {
  return datapackageGateOf(ctx, () => publishAskOf(ctx, caller, app), ownerGhii, name, requested);
}

/**
 * The same decision, with the publish gate's answer supplied by the caller. The extension capability
 * and the workflow step ask it about the principals behind an unattended or sandboxed publish
 * (services/publish-actors.ts askActors), where there is no request whose caller object could be asked.
 * `askOf` runs only for a raise to public, as the request doors ask.
 */
export async function datapackageGateOf(
  ctx: PublishStoreCtx, askOf: () => PublishAsk, ownerGhii: string, name: string, requested: string | undefined,
): Promise<DatapackageGate> {
  const pointer = typeof name === 'string' && name ? await readPointer(ctx, ownerGhii, name) : null;
  // A pointer with a version and no visibility is a public package's (./audience.ts).
  const from = pointer?.contentHash ? (pointer.visibility ?? 'public') : undefined;
  const kept = from ?? 'private';
  // No visibility named: the node's starting level (plan V5.6), decided before the gate is asked.
  const level = requested ?? datapackageVisibilityDefault(ctx.config);
  // A closed node publishes a raise to public (named or the default) at 'members', and asks nothing.
  const closed = closedNodeLevel(ctx.config, level, 'members' as const, { from });
  if (closed.warning) return { kind: 'go', visibility: closed.level, requester: null, from: kept, warning: closed.warning };
  if (!isRaiseToPublic(from, level)) return { kind: 'go', visibility: level, requester: null, from: kept };
  const ask = askOf();
  if (ask.kind === 'refused') return ask;
  if (ask.kind === 'allowed') return { kind: 'go', visibility: level, requester: null, from: kept };
  return { kind: 'go', visibility: kept, requester: ask.requester, from: kept };
}

/** File the request for the version just published. A filing that fails is a warning on the success answer. */
export async function fileDatapackageAsk(
  ctx: PublishStoreCtx, owner: string, requester: PublishRequester, ownerGhii: string, name: string, contentHash: string, from: string,
): Promise<{ publish_request?: ReturnType<typeof publishRequestedBody>; warnings?: Array<{ code: 'PUBLISH_NOT_ASKED'; message: string }> }> {
  const filed = await fileAsk(ctx, owner, requester, {
    kind: 'datapackage',
    target: { owner: ownerGhii, name, version: contentHash },
    title: `the data package ${name}`,
    name,
    change: { field: 'visibility', from, to: 'public' },
  });
  if (filed.ok) return { publish_request: publishRequestedBody(ctx, filed) };
  return { warnings: [{ code: 'PUBLISH_NOT_ASKED', message: `Published as ${from}, not public: ${filed.message}` }] };
}
