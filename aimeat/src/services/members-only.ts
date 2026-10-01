/**
 * @file members-only.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The members-only stance of an app, asked by every route that charges for a call before
 *   it charges. An app whose carry plan says `access: members-only` serves its members and nobody
 *   else, money or no money (services/app-members.ts AppCarryPlan). The raw extension paywall asked
 *   this before its till opened, but the routes that charge UPSTREAM of it did not: the checkout,
 *   the MCP app-tool route, the REST app-tool route and an extension buying from another extension
 *   settled first, then reached the paywall with an internal pass that skipped the question. A paying
 *   non-member was charged and served.
 *
 *   The stance belongs to the extension that does the work, through the app it names in its
 *   `config.app` (resolveGatedApp). A product sold on top of it (an app-tool, a checkout item) asks
 *   about that extension, so the question has one answer whichever route sold the call.
 * @structure resolveGatedApp(ext) · membersOnlyRefusal(storage, ext, callerGaii) ·
 *   membersOnlyRefusalForCapability(storage, capabilityId, callerGaii) · MEMBERS_ONLY_MESSAGE
 * @usage
 *   const refused = await membersOnlyRefusalForCapability(storage, tool.action_id, buyer);
 *   if (refused) throw new CommerceError('MEMBERS_ONLY', 403, MEMBERS_ONLY_MESSAGE);
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial (wish-members-only-refuses-a-non-member-before-checkout-or-a-contr).
 *     resolveGatedApp moved here from routes/extensions/permissions.ts unchanged, so a service and the
 *     commerce layer can ask it without importing a route module; permissions.ts re-exports it.
 */
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { getCarryPlan, getMember } from './app-members.js';

/** What the caller is told, on every route. Nothing has been charged when it is said. */
export const MEMBERS_ONLY_MESSAGE =
  'This is open to approved members only, so there is nothing to buy here yet. Ask the owner '
  + 'for access; nothing is charged for asking, and you have not been charged for this call.';

/**
 * Which app does this extension gate, if any — and only when the extension's installer owns it.
 *
 * An extension declares the app whose membership it enforces with `config: { app: owner/file.html }`,
 * and the node then reads that app's roster on the extension's behalf: `caller.member` and
 * `isAppOwner` on the invoke path, and the carry plan on the paywall path. The value comes from the
 * installer's manifest, and nothing compared its owner half against `installedBy` — so an extension
 * could name somebody else's app and be told, per call, what role the caller holds on a roster that
 * is deliberately private, and be carried under that app owner's plan.
 *
 * The install route refuses a mismatch outright (routes/extensions/manifest.ts). This is the runtime
 * half, for records written before that gate existed: a mismatched value is read as no gating rather
 * than as gating somebody else's app. All 8 extensions declaring `app` on aimeat.io name their own
 * installer's app, so nothing in production changes behaviour.
 */
export function resolveGatedApp(ext: { config?: Record<string, unknown>; installedBy: string }): string | null {
  const declared = typeof ext.config?.app === 'string' ? ext.config.app : null;
  if (!declared) return null;
  const appOwner = (declared.split('/')[0] ?? '').toLowerCase();
  // installedBy is a bare owner name, but accept a GHII/GAII form defensively.
  const installer = localAccountName(ext.installedBy.toLowerCase());
  return appOwner === installer ? declared : null;
}

/**
 * Is this caller refused by the app's members-only stance? Null when the extension gates no app, the
 * app is not members-only, the caller is the app's owner (or one of their agents), or the caller is a
 * member. Otherwise the app it refuses on behalf of.
 * @param storage node storage
 * @param ext the extension that does the work
 * @param callerGaii the paying principal, in any identity form
 */
export async function membersOnlyRefusal(
  storage: Storage, ext: Pick<ExtensionRecord, 'config' | 'installedBy'>, callerGaii: string,
): Promise<{ appId: string } | null> {
  const appId = resolveGatedApp(ext);
  if (!appId) return null;
  if (localAccountName(callerGaii).toLowerCase() === localAccountName(ext.installedBy).toLowerCase()) return null;
  const plan = await getCarryPlan(storage, appId);
  if (plan?.access !== 'members-only') return null;
  return (await getMember(storage, appId, callerGaii)) ? null : { appId };
}

/**
 * The same question asked about a capability, for a route that sells a capability rather than an
 * extension action (an app-tool binding, a checkout item). A capability that is not backed by an
 * extension, or names one that no longer exists, has no stance.
 * @param storage node storage
 * @param capabilityId the capability the product is bound to
 * @param callerGaii the paying principal
 */
export async function membersOnlyRefusalForCapability(
  storage: Storage, capabilityId: string | null | undefined, callerGaii: string,
): Promise<{ appId: string } | null> {
  if (!capabilityId) return null;
  const cap = await storage.getCapability(capabilityId);
  if (!cap || cap.source?.type !== 'extension') return null;
  const extName = String(cap.source.ref ?? '').split(':')[1];
  if (!extName) return null;
  const ext = await storage.getExtension(extName);
  return ext ? membersOnlyRefusal(storage, ext, callerGaii) : null;
}
