/**
 * @file src/services/package-approvals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the owner approved a package install to do, and which of the owner's apps came
 *   from a package (package sale design, phase 2: T1, T2, T7).
 *
 *   THE APPROVAL. An install records the capability summary it was made with
 *   (package-capabilities.ts): its hash, its items, when and by whom. The owner pressing install in
 *   person is the approval; an agent installing a package with code in it needs packages:install-code
 *   or files a request the owner approves. An update whose items include one the approval did not is
 *   a widening: the nightly update leaves it for the owner, and an agent without the word files a
 *   request. One record per install, in the system namespace `package-approvals`, the pattern of
 *   `package-update-notices`: no principal can address it, so nothing but the install and update
 *   code paths writes it.
 *
 *   AN INSTALL MADE BEFORE APPROVALS EXISTED has no record. Its baseline is the capability summary of
 *   the version it is on: what it already does is what it was allowed to do.
 *
 *   A PACKAGE'S APP IS NOT THE OWNER'S OWN APP. The silent sign-in bridge approves an owner's own app
 *   for whatever permissions it asks, because publishing it was the owner's decision. An app a package
 *   installed is somebody else's code under the owner's name, so packageAppOf() names it and the
 *   bridge asks for consent like for any other app.
 * @structure NS_PACKAGE_APPROVALS · INSTALL_CODE_SCOPE · codeInstallRefusal() · InstallApproval ·
 *   recordApproval() · approvalOf() · forgetApproval() · approvedItems() · isOwnPackage() · installedFromPackage()
 * @version-history
 *   v1.1.0 — 2026-10-05 — isOwnPackage: only a package written on this node is the installer's own
 *     (secaudit 2026-10, PKG-5).
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 2).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, PackageInstanceRecord, PackageComponentType, PackageRecord } from '../storage/interface.js';
import { packageCapabilities, type CapabilitySummary } from './package-capabilities.js';
import { ownerBypassesScopes, scopeIsCovered } from '../utils/scope-coverage.js';

export const NS_PACKAGE_APPROVALS = 'package-approvals';

/** The word an agent or an app needs to install code without asking the owner each time. */
export const INSTALL_CODE_SCOPE = 'packages:install-code';

type WordRefusal = { status: 403; code: 'SCOPE_DENIED' | 'FORBIDDEN'; message: string; missing: string[] };

/**
 * Two refusals of the same act as one: a refusal no word can lift (FORBIDDEN, or none missing) wins;
 * otherwise the missing words are joined, so one request asks the owner for everything at once.
 */
export function combinedRefusal(...refusals: Array<WordRefusal | null>): WordRefusal | null {
  const present = refusals.filter((r): r is WordRefusal => r !== null);
  if (present.length === 0) return null;
  const final = present.find(r => r.code !== 'SCOPE_DENIED' || r.missing.length === 0);
  if (final) return final;
  return {
    status: 403, code: 'SCOPE_DENIED',
    missing: [...new Set(present.flatMap(r => r.missing))],
    message: present.map(r => r.message).join(' '),
  };
}

/**
 * Why this caller may not install (or update to) a package that carries code without the owner, or
 * null. The owner in person approves by pressing install. An agent or an app grant needs
 * packages:install-code; without it the refusal names the word, and the install doors file a request
 * the owner approves (package-install-requests.ts). An ecosystem app installs no code at all.
 * `widened`, for an update: only the items the update adds count, and none means nothing to approve.
 */
export function codeInstallRefusal(
  summary: Pick<CapabilitySummary, 'carriesCode'>,
  caller: { roles: string[]; scopes: string[]; federated?: boolean },
  widened?: string[],
): { status: 403; code: 'SCOPE_DENIED' | 'FORBIDDEN'; message: string; missing: string[] } | null {
  if (widened ? widened.length === 0 : !summary.carriesCode) return null;
  if (ownerBypassesScopes(caller)) return null;
  if (caller.roles.includes('ecosystem')) {
    return { status: 403, code: 'FORBIDDEN', missing: [], message: 'This package carries code, and an ecosystem app does not install code into the owner\'s account.' };
  }
  if (scopeIsCovered(caller.scopes ?? [], INSTALL_CODE_SCOPE)) return null;
  const what = widened
    ? `This version adds what the owner has not approved (${widened.slice(0, 6).join(', ')}${widened.length > 6 ? ', …' : ''}).`
    : 'This package carries code: an app, an extension, a browser library or instructions for the owner\'s AI.';
  return {
    status: 403, code: 'SCOPE_DENIED', missing: [INSTALL_CODE_SCOPE],
    message: `${what} Doing that without the owner takes "${INSTALL_CODE_SCOPE}", which this session does not hold, so it waits for the owner to approve what the package can do.`,
  };
}

export interface InstallApproval {
  instanceId: string;
  /** sha256 of the approved capability items (package-capabilities.ts). */
  hash: string;
  items: string[];
  /** The package version the approval was given for. */
  version: string;
  approvedAt: string;
  /** Who approved: the owner's GHII, or the agent holding packages:install-code that installed. */
  approvedBy: string;
}

/** Record what an install or an update was approved to do. */
export async function recordApproval(
  storage: Storage, instanceId: string, summary: Pick<CapabilitySummary, 'hash' | 'items'>, version: string, approvedBy: string,
): Promise<void> {
  const now = new Date().toISOString();
  const prev = await storage.getMemory(NS_PACKAGE_APPROVALS, instanceId);
  const value: InstallApproval = { instanceId, hash: summary.hash, items: summary.items, version, approvedAt: now, approvedBy };
  await storage.setMemory({
    key: instanceId, ownerGaii: NS_PACKAGE_APPROVALS, value,
    visibility: 'private', tags: ['package-approval'], ttlHours: null,
    version: prev ? prev.version + 1 : 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
  });
}

export async function approvalOf(storage: Storage, instanceId: string): Promise<InstallApproval | null> {
  const rec = await storage.getMemory(NS_PACKAGE_APPROVALS, instanceId);
  const v = rec?.value as InstallApproval | undefined;
  return v && Array.isArray(v.items) ? v : null;
}

export async function forgetApproval(storage: Storage, instanceId: string): Promise<void> {
  await storage.deleteMemory(NS_PACKAGE_APPROVALS, instanceId);
}

/**
 * The items an install is allowed: its approval, or for an install made before approvals existed,
 * what the version it is on already does.
 */
export async function approvedItems(
  storage: Storage, config: AimeatConfig, instance: PackageInstanceRecord,
): Promise<string[]> {
  const approval = await approvalOf(storage, instance.id);
  if (approval) return approval.items;
  const current = await storage.getPackage(instance.packageRecordId);
  return current ? packageCapabilities(current.components, config, instance.owner).items : [];
}

/**
 * Where a package comes from, for the person deciding whether to install it (package sale design,
 * T5). A package pulled from another node is owned here by whoever pulled it, so its real author and
 * the node that signed it are read from `upstream`, with whether the signature was checked.
 */
export function packageSourceOf(pkg: PackageRecord, nodeId: string): {
  author: string; author_ghii: string; origin_node: string;
  upstream: { node: string; url: string; group_id: string; version: string; verified: boolean; verified_at: string | null } | null;
} {
  const up = pkg.upstream;
  return {
    author: up ? up.authorGhii : pkg.author,
    author_ghii: up ? up.authorGhii : pkg.authorGhii,
    origin_node: up ? up.node : nodeId,
    upstream: up
      ? { node: up.node, url: up.url, group_id: up.groupId, version: up.version, verified: !!up.verifiedAt, verified_at: up.verifiedAt }
      : null,
  };
}

/**
 * Whether the installer is this package's author, which makes its apps approved at install. Only a
 * package written on this node counts: a pulled one or a signed ZIP carries its author from the
 * other node's descriptor (`upstream.authorGhii`), which that node writes as it likes, so it named
 * the installer and skipped the consent screen (secaudit 2026-10, PKG-5).
 */
export function isOwnPackage(pkg: PackageRecord, installerGhii: string): boolean {
  return !pkg.upstream && pkg.authorGhii === installerGhii;
}

/**
 * Whether an app grant target ("owner/file.html") is an app a package installed for that owner. The
 * silent bridge then treats it as somebody else's app and asks for consent (design T2). A portfolio
 * target, or one in another shape, is never a package's app.
 */
export async function isPackageApp(storage: Storage, owner: string, grantTarget: string): Promise<boolean> {
  const slash = grantTarget.indexOf('/');
  if (slash < 1 || grantTarget.slice(0, slash) !== owner) return false;
  return (await installedFromPackage(storage, owner, 'app', grantTarget.slice(slash + 1))) !== null;
}

/** The owner's install a component came from, or null for one the owner made themselves. */
export async function installedFromPackage(
  storage: Storage, owner: string, type: PackageComponentType, registeredAs: string,
): Promise<{ instanceId: string; packageGroupId: string } | null> {
  const { instances } = await storage.listInstances({ owner, limit: 1000 });
  for (const inst of instances) {
    if (inst.status === 'removed') continue;
    if (inst.installedComponents.some(c => c.type === type && c.registeredAs === registeredAs)) {
      return { instanceId: inst.id, packageGroupId: inst.packageGroupId };
    }
  }
  return null;
}
