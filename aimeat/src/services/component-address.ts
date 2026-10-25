/**
 * @file src/services/component-address.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extension and cortex names live in the owner's namespace. One place decides what an
 *   address names and under which name a new install is stored.
 *
 *   WHY. An extension name (/v1/ext/<name>, memory `ext:<name>`, consents `ext:<name>`) and a cortex
 *   name (/v1/cortex/<name>/libs) were node-wide keys. A name an owner uninstalled, or a name the
 *   node had not shipped yet, went to whoever installed it next, and with it every app that loaded
 *   it, every consent that named it and every pinned version number (secaudit2026oct22 leads 589 and
 *   2827; wish wish-cortex-and-extension-names-live-in-the-owner-s-namespace, Jouni 2026-10-25:
 *   "tämä on nyt fixattava!").
 *
 *   THE RULE.
 *   - A new install is stored as `<owner>/<name>`: the installing account, one slash, the name the
 *     manifest gives. Only that account can create a name under its own prefix.
 *   - A name stored bare before that (or shipped by the node) stays the record's key, so memory,
 *     consents, schedules, versions and published apps keep their address. `<holder>/<name>` is an
 *     alias for it, and `system/<name>` for a shipped one.
 *   - A bare name an uninstall released is written down with its holder (ReleasedComponentName).
 *     Only that holder installs under it again; for everybody else it stays retired.
 *   - A bare address names the bare record when there is one: that is what a published app, a
 *     capability or an offering meant by it, and nobody can create a bare name any more. Without one,
 *     it names the signed-in caller's own `<caller>/<name>`, so an install made today keeps answering
 *     to the name its author typed. A caller managing their own things reads their own first.
 * @structure SYSTEM_NAMESPACE · splitComponentAddress · isNamespacedName · namespacedName ·
 *   shortNameOf · findExtension · findCortex · ownComponent · installNameFor · releaseBareName ·
 *   isLegacyExtensionHead · extensionCallTarget · placeExtensionInstall ·
 *   placeCortexInstall · settleReclaimed · cortexLibPath · addressSegment
 * @usage const ext = await findExtension(storage, req.params.name, req.auth?.owner, 'manage');
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (owner namespaces wish; secaudit2026oct22 leads 589 and 2827).
 */
import type { Storage, ExtensionRecord, CortexExtensionRecord, CapabilityRecord } from '../storage/interface.js';
import type { ComponentKind } from '../storage/types/component-versions.js';

/** The namespace of what the node ships: bundled cortexes (system@<node>) and built-in extensions (system). */
export const SYSTEM_NAMESPACE = 'system';

/** An account name as the node writes it: lowercase letters, digits and inner hyphens. */
const OWNER_SEGMENT = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

/** `<owner>/<name>` → its two parts; anything else (a bare name, two slashes, an empty half) → null. */
export function splitComponentAddress(address: string): { owner: string; name: string } | null {
  const slash = address.indexOf('/');
  if (slash <= 0 || slash !== address.lastIndexOf('/')) return null;
  const owner = address.slice(0, slash);
  const name = address.slice(slash + 1);
  if (!name || !OWNER_SEGMENT.test(owner)) return null;
  return { owner, name };
}

export const isNamespacedName = (name: string): boolean => splitComponentAddress(name) !== null;
export const namespacedName = (owner: string, name: string): string => `${owner}/${name}`;
/** The name without its owner prefix: what the manifest calls it. */
export const shortNameOf = (name: string): string => splitComponentAddress(name)?.name ?? name;

/** Does `installedBy` hold names in the namespace `owner`? `system` is the node itself. */
function holds(installedBy: string | undefined, owner: string): boolean {
  if (!installedBy) return false;
  if (owner === SYSTEM_NAMESPACE) return installedBy === SYSTEM_NAMESPACE || installedBy.startsWith(`${SYSTEM_NAMESPACE}@`);
  return installedBy === owner;
}

type Getter<T> = (name: string) => Promise<T | null>;

/**
 * How a bare name is read. 'call' (the default) is every read and call: the bare record first,
 * because that is what a published app, a capability or an offering meant by it, then the
 * caller's own `<caller>/<name>`. 'manage' is the caller managing their own things (activate,
 * remove, configure, export): their own first, then the bare record, whose permission check still
 * decides.
 */
export type BareNameReading = 'call' | 'manage';

async function findComponent<T extends { installedBy: string }>(
  get: Getter<T>, address: string, callerOwner: string | null | undefined, reading: BareNameReading,
): Promise<T | null> {
  const parts = splitComponentAddress(address);
  if (parts) {
    const stored = await get(address);
    if (stored) return stored;
    // The alias: a bare record reached through its holder's namespace.
    const bare = await get(parts.name);
    return bare && holds(bare.installedBy, parts.owner) ? bare : null;
  }
  const own = callerOwner && OWNER_SEGMENT.test(callerOwner) ? () => get(namespacedName(callerOwner, address)) : null;
  if (reading === 'manage' && own) return (await own()) ?? get(address);
  return (await get(address)) ?? (own ? own() : null);
}

/**
 * The extension an address names: `<owner>/<name>` (stored, or the alias of a bare record its
 * holder holds), or a bare name: the bare record, then the caller's own `<caller>/<name>` (with
 * `reading: 'manage'`, the caller's own first). Without a caller only the stored key and the alias
 * count.
 */
export function findExtension(
  storage: Storage, address: string, callerOwner?: string | null, reading: BareNameReading = 'call',
): Promise<ExtensionRecord | null> {
  return findComponent(n => storage.getExtension(n), address, callerOwner, reading);
}

/** The cortex an address names, by the same rule as findExtension. */
export function findCortex(
  storage: Storage, address: string, callerOwner?: string | null, reading: BareNameReading = 'call',
): Promise<CortexExtensionRecord | null> {
  return findComponent(n => storage.getCortexExtension(n), address, callerOwner, reading);
}

/** The record this owner already has under this short name: `<owner>/<name>`, or a bare `<name>` they hold. */
export async function ownComponent<T extends { installedBy: string }>(
  get: Getter<T>, ownerName: string, shortName: string,
): Promise<T | null> {
  const own = await get(namespacedName(ownerName, shortName));
  if (own) return own;
  const bare = await get(shortName);
  return bare && holds(bare.installedBy, ownerName) ? bare : null;
}

/**
 * The name a NEW install by `ownerName` is stored under, from the name its manifest gives. A
 * manifest name `<owner>/<name>` is read as `<name>` when `<owner>` is the installer; another
 * account's prefix is answered with `foreignPrefix` so the door decides (an extension refuses, a
 * cortex moves into the installer's namespace with a warning). A bare name this owner released is
 * theirs again (`reclaimed`), so a DELETE followed by a POST keeps every published address.
 */
export async function installNameFor(
  storage: Storage, kind: ComponentKind, ownerName: string, manifestName: string,
): Promise<{ name: string; shortName: string; reclaimed: boolean; foreignPrefix: string | null }> {
  const parts = splitComponentAddress(manifestName);
  const foreignPrefix = parts && parts.owner !== ownerName ? parts.owner : null;
  const shortName = parts ? parts.name : manifestName;
  const released = await storage.getReleasedComponentName(kind, shortName);
  if (released && holds(released.holder, ownerName)) return { name: shortName, shortName, reclaimed: true, foreignPrefix };
  return { name: namespacedName(ownerName, shortName), shortName, reclaimed: false, foreignPrefix };
}

/**
 * Where an extension install by `ownerName` lands. The record's `name` is the manifest's name; this
 * sets it to the stored name: the owner's existing extension of that name (`existing`, which the door
 * refuses or updates in place), else a reclaimed bare name, else `<owner>/<name>`.
 */
export async function placeExtensionInstall(
  storage: Storage, ownerName: string, record: { name: string },
): Promise<{ existing: ExtensionRecord | null }> {
  const short = shortNameOf(record.name);
  const existing = await ownComponent(n => storage.getExtension(n), ownerName, short);
  if (existing) { record.name = existing.name; return { existing }; }
  record.name = (await installNameFor(storage, 'extension', ownerName, short)).name;
  return { existing: null };
}

/**
 * Where a cortex install by `ownerName` lands, by the same rule as placeExtensionInstall. A cortex
 * name could carry a slash before 2026-10-25 with any prefix, so the manifest may name another
 * account's prefix: the cortex goes into the installer's own namespace and `warning` says so. A
 * record stored under `<owner>/<name>` before that by another account (`takenByOther`) keeps it.
 */
export async function placeCortexInstall(
  storage: Storage, ownerName: string, ext: { name: string; shortName?: string },
): Promise<{ existing: CortexExtensionRecord | null; takenByOther: boolean; warning: string | null }> {
  const placed = await installNameFor(storage, 'cortex', ownerName, ext.name);
  const warning = placed.foreignPrefix
    ? `The name "${ext.name}" is in the namespace of the account "${placed.foreignPrefix}". It was installed in your own namespace, as "${namespacedName(ownerName, placed.shortName)}".`
    : null;
  const stored = await storage.getCortexExtension(namespacedName(ownerName, placed.shortName));
  if (stored && !holds(stored.installedBy, ownerName)) {
    ext.name = stored.name;
    return { existing: null, takenByOther: true, warning };
  }
  const existing = stored ?? await ownComponent(n => storage.getCortexExtension(n), ownerName, placed.shortName);
  ext.name = existing ? existing.name : placed.name;
  ext.shortName = placed.shortName;
  return { existing, takenByOther: false, warning };
}

/** After a new install took a reclaimed bare name: it is no longer released. */
export async function settleReclaimed(storage: Storage, kind: ComponentKind, name: string): Promise<void> {
  if (!isNamespacedName(name)) await storage.deleteReleasedComponentName(kind, name);
}

/**
 * An uninstall of a bare-named component writes the name down with its holder. A namespaced name
 * needs nothing: nobody else can create a name under another account's prefix.
 */
export async function releaseBareName(storage: Storage, kind: ComponentKind, name: string, holder: string): Promise<void> {
  if (isNamespacedName(name) || name.includes('/') || !holder) return;
  await storage.recordReleasedComponentName({ kind, name, holder, releasedAt: new Date().toISOString() });
}

/**
 * The capability an app tool's `action_id` binds, read for the app's owner. A capability of an
 * extension is keyed `ext:<stored name>:<action>`; an owner who writes their own extension's bare
 * name (`ext:weather:run` for `alice/weather`) still means their own, so a bare id that finds no
 * capability is tried once more with the owner's own extension of that name.
 */
export async function findBackingCapability(storage: Storage, actionId: string, ownerName: string): Promise<CapabilityRecord | null> {
  const direct = await storage.getCapability(actionId);
  if (direct) return direct;
  const m = /^ext:([^:/]+):([^:]+)$/.exec(actionId);
  if (!m) return null;
  const own = await findExtension(storage, m[1], ownerName, 'manage');
  return own && own.name !== m[1] ? storage.getCapability(`ext:${own.name}:${m[2]}`) : null;
}

/** Is `head` a bare extension name the node knows: installed, or released by its holder? */
export async function isLegacyExtensionHead(storage: Storage, head: string): Promise<boolean> {
  if (await storage.getExtension(head)) return true;
  return (await storage.getReleasedComponentName('extension', head)) !== null;
}

/**
 * What `/v1/ext/<a>/<b>/<action>` calls. The path was the instance form (`<name>/<instance>`) before
 * names carried an owner, and it is also the literal form of `<owner>/<name>`, so the order matters:
 * (1) an extension `<a>` the node knows by that key (installed, or a bare name released), with
 * instance `<b>`, so an old instance address keeps its meaning and never moves to an account
 * named `<a>`; (2) the caller's own extension `<a>` with instance `<b>`; (3) the extension
 * `<a>/<b>`. `<a>` and `<b>` may carry a pinned version (`name@1.2.0`).
 */
export async function extensionCallTarget(
  storage: Storage, a: string, b: string, callerOwner?: string | null,
): Promise<{ extRef: string; instanceId?: string }> {
  const aName = stripPin(a);
  if (await isLegacyExtensionHead(storage, aName)) return { extRef: a, instanceId: b };
  if (callerOwner && OWNER_SEGMENT.test(callerOwner) && await storage.getExtension(namespacedName(callerOwner, aName))) {
    return { extRef: a, instanceId: b };
  }
  if (OWNER_SEGMENT.test(a)) return { extRef: `${a}/${b}` };
  return { extRef: a, instanceId: b };
}

function stripPin(raw: string): string {
  const at = raw.lastIndexOf('@');
  return at > 0 ? raw.slice(0, at) : raw;
}

/**
 * The name as one id segment, for ids derived from it that travel in a path of their own (a cortex's
 * board and action ids, `cortex-<name>-<component>`): `alice/recipes` becomes `alice-recipes`, a bare
 * name stays as it was, so an id an older activation made keeps its value. Two cortexes of one
 * account can still derive one id; a board of another account is refused at activation
 * (routes/cortex/activation.ts foreignBoardRefusal).
 */
export const idStemOf = (name: string): string => name.replace('/', '-');

/** One URL path segment for a name: a namespaced name encoded as one segment (`alice%2Fweather`). */
export const addressSegment = (name: string): string => encodeURIComponent(name);

/**
 * The served address of one library file. A namespaced cortex is written with its two segments
 * (`/v1/cortex/<owner>/<name>/libs/<file>`), which no other route has; a bare one as before.
 */
export function cortexLibPath(name: string, file: string, version?: string | null): string {
  const pin = version ? `@${version}` : '';
  const parts = splitComponentAddress(name);
  const head = parts ? `${encodeURIComponent(parts.owner)}/${encodeURIComponent(parts.name)}` : encodeURIComponent(name);
  return `/v1/cortex/${head}${pin}/libs/${file}`;
}
