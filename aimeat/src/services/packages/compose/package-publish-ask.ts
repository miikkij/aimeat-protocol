/**
 * @file src/services/packages/compose/package-publish-ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate for a package group (plan doc-mvcn6c7e4e5q, V4): every route and MCP
 *   tool that can give a package the visibility 'public' asks here before it writes, and files the
 *   request here after.
 *
 *   BEFORE THE WRITE. packagePublishGate() answers the visibility to store. Only a change that raises
 *   the group to public asks (isRaiseToPublic): a new group, or a group whose visibility is narrower
 *   now. An agent without publish:public (an app grant too, when the gate covers apps) gets the level
 *   the group had, and a new group lands 'private'; the rest of the change goes ahead.
 *
 *   AFTER THE WRITE. filePackageAsks() files one request per group that was kept back, naming the
 *   group and its newest version, so an approval of a group that has a newer version since is settled
 *   outdated (services/publish-requests/apply-package.ts). A filing that fails (too many waiting) is
 *   a warning on the success answer, never a failure of the write.
 * @structure PackageGate · packagePublishGate · filePackageAsks · packageGateWarnings ·
 *   composeWithPublishGate · composeSetWithPublishGate
 * @usage
 *   const gate = packagePublishGate(ctx, caller, req.auth?.app, visibility, undefined);
 *   if (gate.kind === 'refused') return res.status(gate.status).json(error(...));
 *   const out = await createPackageGroup(..., { ..., visibility: gate.visibility });
 *   const asked = gate.requester ? await filePackageAsks(ctx, owner, gate.requester, [groupId], gate.from) : {};
 * @version-history
 *   v1.1.0 — 2026-10-18 — On a node that shows its content to signed-in accounts only, a group raised
 *     to public is stored at 'members' and the answer carries PUBLIC_IS_SIGNED_IN_HERE
 *     (packageGateWarnings; services/closed-node-level.ts, plan V1.6).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: packages).
 */
import type { CallerContext } from '../../caller-context.js';
import { isRaiseToPublic } from '../../publish-gate.js';
import { closedNodeLevel, type ClosedNodeWarning } from '../../closed-node-level.js';
import { publishAskOf, fileAsk, publishRequestedBody } from '../../publish-requests/ask.js';
import type { PublishRequester, PublishStoreCtx } from '../../publish-requests/store.js';
import {
  composePackageFromApps,
  type PackageComposeCaller, type PackageComposeDeps, type PackageComposeInput, type PackageComposeResult,
} from './package-compose.js';
import { composeSet, type ComposeSetInput, type ComposeSetResult } from './package-compose-set.js';

export type PackageGate =
  | { kind: 'refused'; status: 403; code: string; message: string }
  /**
   * `visibility` is what to store; `requester` is set when a request is to be filed after the write;
   * `warning` when a closed node stores 'members' instead of public (plan V1.6).
   */
  | { kind: 'go'; visibility: unknown; requester: PublishRequester | null; from: string; warning?: ClosedNodeWarning };

/**
 * May this caller give the group the requested visibility? `from` is the group's visibility now,
 * undefined for a group that does not exist yet. On a node that shows its content to signed-in
 * accounts only, a raise to public is 'members' with a warning and asks nothing (closed-node-level.ts).
 */
export function packagePublishGate(
  ctx: PublishStoreCtx, caller: CallerContext, app: string | undefined, requested: unknown, from: string | undefined,
): PackageGate {
  const kept = from ?? 'private';
  const closed = closedNodeLevel(ctx.config, requested, 'members' as const, { from });
  if (closed.warning) return { kind: 'go', visibility: closed.level, requester: null, from: kept, warning: closed.warning };
  if (!isRaiseToPublic(from, requested)) return { kind: 'go', visibility: requested, requester: null, from: kept };
  const ask = publishAskOf(ctx, caller, app);
  if (ask.kind === 'refused') return ask;
  if (ask.kind === 'allowed') return { kind: 'go', visibility: requested, requester: null, from: kept };
  return { kind: 'go', visibility: kept, requester: ask.requester, from: kept };
}

type PublishRequestBody = ReturnType<typeof publishRequestedBody>;
export interface PackageAsked {
  publish_request?: PublishRequestBody;
  /** Every request filed, when one write kept more than one group back (a composed set). */
  publish_requests?: PublishRequestBody[];
  warnings?: Array<{ code: 'PUBLISH_NOT_ASKED'; message: string; group_id: string } | ClosedNodeWarning>;
}

/** The answer fields of a gate that went ahead without a request: the closed node's warning, or nothing. */
export function packageGateWarnings(gate: PackageGate | null | undefined): PackageAsked {
  return gate?.kind === 'go' && gate.warning ? { warnings: [gate.warning] } : {};
}

/**
 * File one request per group kept back. The newest version of each is read here, the one the applier
 * compares against. The first group named is the one `publish_request` answers for.
 */
export async function filePackageAsks(
  ctx: PublishStoreCtx, owner: string, requester: PublishRequester, groupIds: string[], from: string,
): Promise<PackageAsked> {
  const filed: PublishRequestBody[] = [];
  const warnings: NonNullable<PackageAsked['warnings']> = [];
  for (const groupId of groupIds) {
    const newest = (await ctx.storage.listVersions(groupId, 1, 0)).versions[0];
    if (!newest) continue;
    const out = await fileAsk(ctx, owner, requester, {
      kind: 'package',
      target: { group_id: groupId, version: newest.version },
      title: `the package ${newest.name}`,
      name: newest.name,
      change: { field: 'visibility', from, to: 'public' },
    });
    if (out.ok) filed.push(publishRequestedBody(ctx, out));
    else warnings.push({ code: 'PUBLISH_NOT_ASKED', message: `Saved as ${from}, not public: ${out.message}`, group_id: groupId });
  }
  return {
    ...(filed[0] ? { publish_request: filed[0] } : {}),
    ...(filed.length > 1 ? { publish_requests: filed } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}

type Refusal = { ok: false; status: number; code: string; message: string };
const refusalOf = (g: Extract<PackageGate, { kind: 'refused' }>): Refusal => ({ ok: false, status: g.status, code: g.code, message: g.message });

/**
 * composePackageFromApps behind the publish gate, for POST /v1/packages/compose and
 * aimeat_package_compose. A new version keeps the group's visibility (package-compose.ts), so only a
 * new group asks.
 */
export async function composeWithPublishGate(
  deps: PackageComposeDeps, caller: CallerContext, app: string | undefined, who: PackageComposeCaller, input: PackageComposeInput,
): Promise<Refusal | (Extract<PackageComposeResult, { ok: true }> & { asked: PackageAsked })> {
  const exists = typeof input.name === 'string' && (await deps.storage.listVersions(`${input.name}::${who.owner}`, 1, 0)).total > 0;
  const gate = exists ? null : packagePublishGate(deps, caller, app, input.visibility, undefined);
  if (gate?.kind === 'refused') return refusalOf(gate);
  const out = await composePackageFromApps(deps, who, gate ? { ...input, visibility: gate.visibility as string | undefined } : input);
  if (!out.ok) return out;
  const asked = gate?.requester && !out.newVersion
    ? await filePackageAsks(deps, who.owner, gate.requester, [out.package.packageGroupId], gate.from)
    : out.newVersion ? {} : packageGateWarnings(gate);
  return { ...out, asked };
}

/**
 * composeSet behind the publish gate, for POST /v1/packages/compose-set and aimeat_package_compose_set.
 * The visibility applies to the groups the set creates; each one kept back gets its own request, the
 * set's own first. A dry run writes nothing and asks nothing.
 */
export async function composeSetWithPublishGate(
  deps: PackageComposeDeps, caller: CallerContext, app: string | undefined, who: PackageComposeCaller, input: ComposeSetInput,
): Promise<Extract<ComposeSetResult, { ok: false }> | (Extract<ComposeSetResult, { ok: true }> & { asked: PackageAsked })> {
  const gate = input.dryRun === true ? null : packagePublishGate(deps, caller, app, input.visibility ?? 'private', undefined);
  if (gate?.kind === 'refused') return refusalOf(gate);
  const out = await composeSet(deps, who, gate ? { ...input, visibility: gate.visibility as string } : input);
  if (!out.ok || !gate?.requester) return out.ok ? { ...out, asked: packageGateWarnings(gate) } : out;
  const created = [
    ...(out.set.new_version ? [] : [out.set.group_id]),
    ...out.packages.filter(p => !p.new_version).map(p => p.group_id),
  ];
  return { ...out, asked: await filePackageAsks(deps, who.owner, gate.requester, created, gate.from) };
}
