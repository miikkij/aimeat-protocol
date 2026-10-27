/**
 * @file src/services/component-address.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner is ADDED to extension and cortex names; every address that worked before
 *   works as before. One place decides what an address names and under which name an install is stored.
 *
 *   WHY. An extension name (/v1/ext/<name>, memory `ext:<name>`, consents `ext:<name>`) and a cortex
 *   name (/v1/cortex/<name>/libs) were node-wide keys. A name an owner uninstalled, or a name the
 *   node had not shipped yet, went to whoever installed it next, and with it every app that loaded
 *   it, every consent that named it and every pinned version number (secaudit2026oct22 leads 589 and
 *   2827; wish wish-cortex-and-extension-names-live-in-the-owner-s-namespace, Jouni 2026-10-25:
 *   "tämä on nyt fixattava!").
 *
 *   THE RULE (Jouni, 2026-10-26: "piti lisätä omistaja johonkin tohon ja pitää toi formaatti
 *   mahdollisimman samana ... eikä nykyiset hajoa").
 *   - An install keeps its bare name, as always, and the same name collisions are refused as always.
 *     Every answer keeps `name` and adds `owner` and `full_name` (withOwnerFields).
 *   - `<owner>/<name>` is the exact address everywhere: the record stored so, or the alias of the
 *     bare record that account holds; `system/<name>` for a shipped one.
 *   - A bare name an uninstall released is written down with its holder (ReleasedComponentName).
 *     Another account's install of it is stored as `<owner>/<name>`, so the apps, consents and
 *     pinned versions that named the old one never reach it; only the holder takes the bare name back.
 *     An install asked for in full (PUT to `<owner>/<name>`) is stored so too.
 *   - A bare address: the bare record; else the caller's own `<caller>/<name>` (managing reads own
 *     first); else the one account that keeps that name under its own, unless the name is retired;
 *     two such accounts answer 409 AMBIGUOUS_NAME, naming both.
 * @structure SYSTEM_NAMESPACE · splitComponentAddress · isNamespacedName · namespacedName ·
 *   shortNameOf · findExtension · findCortex · ownComponent · installNameFor · releaseBareName ·
 *   isLegacyExtensionHead · extensionCallTarget · ownExtensionFileKey · ownExtensionMemoryOwner · placeExtensionInstall ·
 *   placeCortexInstall · settleReclaimed · cortexLibPath · addressSegment · withOwnerFields ·
 *   AmbiguousComponentName · extensionHoldersOf
 * @usage const ext = await findExtension(storage, req.params.name, req.auth?.owner, 'manage');
 * @version-history
 *   v1.2.1 — 2026-10-27 — /v1/ext/<a>/<b>/<action>: the account's `<a>/<b>` takes the call over a bare
 *     extension `<a>` whose instance `<b>` was made after it (secaudit2026oct26,
 *     extensionCallTarget:bare-extension-head-shadows-owner-namespace).
 *   v1.2.0 — 2026-10-26 — The owner is additive: an install keeps its bare name (`<owner>/<name>` only
 *     when asked for in full or when another account released the name), answers keep `name` and add
 *     `owner` and `full_name`, and a bare name the caller has nothing under reaches the one account
 *     that keeps it under its own, or answers 409 AMBIGUOUS_NAME for two (Jouni, 2026-10-26).
 *   v1.1.0 — 2026-10-26 — ownExtensionFileKey and ownExtensionMemoryOwner: the owner's short-name
 *     file key `ext/<name>/...` and memory owner `ext:<name>` of its own extension name the stored
 *     ones, for the readers that try them after the address as written found nothing.
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

/**
 * The released-name row of `name`. A storage that predates the rows (a unit test's double of the
 * storage interface) has none, so every rule reads as for a name never released.
 */
function releasedName(storage: Storage, kind: ComponentKind, name: string): Promise<{ holder: string } | null> {
  return typeof storage.getReleasedComponentName === 'function' ? storage.getReleasedComponentName(kind, name) : Promise.resolve(null);
}

/** A bare name two accounts hold in their own namespaces, with no bare record: the caller names one in full. */
export class AmbiguousComponentName extends Error {
  readonly statusCode = 409;
  /** Read by the global error handler (middleware/fallback-handlers.ts). */
  readonly status = 409;
  readonly code = 'AMBIGUOUS_NAME';
  constructor(readonly short: string, readonly fullNames: string[]) {
    super(`More than one account has "${short}": ${fullNames.join(', ')}. Name the one you mean in full, as <owner>/<name>.`);
  }
}

async function findComponent<T extends { installedBy: string; name: string }>(
  get: Getter<T>, list: () => Promise<T[]>, kind: ComponentKind, storage: Storage,
  address: string, callerOwner: string | null | undefined, reading: BareNameReading,
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
  const found = reading === 'manage' && own
    ? (await own()) ?? await get(address)
    : (await get(address)) ?? (own ? await own() : null);
  if (found || address.includes('/') || address.includes('@')) return found;
  // No bare record and none of the caller's own: the one account that holds the name in its own
  // namespace, as a bare name reached before. A name its holder released stays retired.
  if (await releasedName(storage, kind, address)) return null;
  const holders = (await list()).filter(r => splitComponentAddress(r.name)?.name === address);
  if (holders.length > 1) throw new AmbiguousComponentName(address, holders.map(r => r.name).sort());
  // The listing is lean (no scripts, no lib bodies): the whole record is read by its key.
  return holders[0] ? get(holders[0].name) : null;
}

/**
 * The extension an address names: `<owner>/<name>` (stored, or the alias of a bare record its
 * holder holds), or a bare name: the bare record, then the caller's own `<caller>/<name>` (with
 * `reading: 'manage'`, the caller's own first), then the one account's `<owner>/<name>`. Two such
 * accounts throw AmbiguousComponentName (409).
 */
export function findExtension(
  storage: Storage, address: string, callerOwner?: string | null, reading: BareNameReading = 'call',
): Promise<ExtensionRecord | null> {
  return findComponent(n => storage.getExtension(n), () => leanExtensions(storage), 'extension', storage, address, callerOwner, reading);
}

/** The cortex an address names, by the same rule as findExtension. */
export function findCortex(
  storage: Storage, address: string, callerOwner?: string | null, reading: BareNameReading = 'call',
): Promise<CortexExtensionRecord | null> {
  return findComponent(n => storage.getCortexExtension(n), () => (typeof storage.listCortexExtensions === 'function'
    ? storage.listCortexExtensions({ lean: true }) : Promise.resolve([])), 'cortex', storage, address, callerOwner, reading);
}

/**
 * A record as an answer shows it: `name` is the name its manifest gives, as always, and two fields
 * are added, `owner` (the installing account) and `full_name` (`<owner>/<name>`, the exact address
 * that works everywhere). A record stored under `<owner>/<name>` keeps that key internally.
 */
export function withOwnerFields<T extends { name: string; installedBy?: string }>(rec: T): T & { owner: string; full_name: string } {
  const parts = splitComponentAddress(rec.name);
  const owner = parts?.owner ?? (holds(rec.installedBy, SYSTEM_NAMESPACE) ? SYSTEM_NAMESPACE : String(rec.installedBy ?? ''));
  const name = parts?.name ?? rec.name;
  return { ...rec, name, owner, full_name: owner && OWNER_SEGMENT.test(owner) ? namespacedName(owner, name) : rec.name };
}

/** The full names of the extensions accounts keep under their own name for this short name. */
export async function extensionHoldersOf(storage: Storage, short: string): Promise<string[]> {
  return (await leanExtensions(storage)).filter(r => splitComponentAddress(r.name)?.name === short).map(r => r.name);
}

/** Every extension, without scripts. A storage double without the listing (a unit test's) lists none. */
function leanExtensions(storage: Storage): Promise<ExtensionRecord[]> {
  return typeof storage.listExtensions === 'function' ? storage.listExtensions({ lean: true }) : Promise.resolve([]);
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
  // Asked for in full, in the installer's own namespace: stored so.
  if (parts && !foreignPrefix) return { name: manifestName, shortName, reclaimed: false, foreignPrefix };
  const released = await releasedName(storage, kind, shortName);
  // A bare name another account uninstalled stays retired: the install goes to `<owner>/<name>`, so
  // the apps, consents and memory that named the old one never reach this one.
  if (released && !holds(released.holder, ownerName)) {
    return { name: namespacedName(ownerName, shortName), shortName, reclaimed: false, foreignPrefix };
  }
  return { name: shortName, shortName, reclaimed: !!released, foreignPrefix };
}

/**
 * Where an extension install by `ownerName` lands, and what is already there. The name stays the
 * manifest's bare name, as always; it is `<owner>/<name>` only when the installer asks for it in full
 * or another account released the bare name. `existing` is the record under the name the install
 * would take: the bare record, whoever holds it (the door answers as it always did: 409 for POST,
 * the owner check for an update), or the owner's own `<owner>/<name>`.
 */
export async function placeExtensionInstall(
  storage: Storage, ownerName: string, record: { name: string },
): Promise<{ existing: ExtensionRecord | null }> {
  const placed = await installNameFor(storage, 'extension', ownerName, record.name);
  const existing = (await storage.getExtension(placed.name))
    ?? (placed.name === placed.shortName ? await storage.getExtension(namespacedName(ownerName, placed.shortName)) : null);
  record.name = existing ? existing.name : placed.name;
  return { existing };
}

/**
 * Where a cortex install by `ownerName` lands, by the same rule as placeExtensionInstall.
 * `takenByOther`: the name is held by another account, which the door refuses as it always did. A
 * manifest name with another account's prefix goes into the installer's own namespace, with `warning`.
 */
export async function placeCortexInstall(
  storage: Storage, ownerName: string, ext: { name: string; shortName?: string },
): Promise<{ existing: CortexExtensionRecord | null; takenByOther: boolean; warning: string | null }> {
  const asked = splitComponentAddress(ext.name);
  const foreign = asked && asked.owner !== ownerName;
  const placed = await installNameFor(storage, 'cortex', ownerName, foreign ? namespacedName(ownerName, asked.name) : ext.name);
  const warning = foreign
    ? `The name "${ext.name}" is in the namespace of the account "${asked.owner}". It was installed in your own namespace, as "${placed.name}".`
    : null;
  const existing = (await storage.getCortexExtension(placed.name))
    ?? (placed.name === placed.shortName ? await storage.getCortexExtension(namespacedName(ownerName, placed.shortName)) : null);
  ext.name = existing ? existing.name : placed.name;
  if (foreign) ext.shortName = placed.shortName;
  return { existing, takenByOther: !!existing && !holds(existing.installedBy, ownerName), warning };
}

/** After a new install took a reclaimed bare name: it is no longer released. */
export async function settleReclaimed(storage: Storage, kind: ComponentKind, name: string): Promise<void> {
  if (!isNamespacedName(name) && typeof storage.deleteReleasedComponentName === 'function') await storage.deleteReleasedComponentName(kind, name);
}

/**
 * An uninstall of a bare-named component writes the name down with its holder. A namespaced name
 * needs nothing: nobody else can create a name under another account's prefix.
 */
export async function releaseBareName(storage: Storage, kind: ComponentKind, name: string, holder: string): Promise<void> {
  if (isNamespacedName(name) || name.includes('/') || !holder || typeof storage.recordReleasedComponentName !== 'function') return;
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

/**
 * The stored form of a file key or an extension memory owner that an account writes with the short
 * name of its own extension. An extension's files are stored under `ext/<stored name>/...` and its
 * memory under `ext:<stored name>`, so the owner's `ext/weather/morning.txt` and `ext:weather` for
 * `alice/weather` mean `ext/alice/weather/morning.txt` and `ext:alice/weather`. Answers that form
 * when `ownerName` holds `<ownerName>/<name>`, null otherwise; the caller tries it only after the
 * address as written found nothing, so a bare record keeps its own address.
 */
export async function ownExtensionFileKey(storage: Storage, key: string, ownerName: string): Promise<string | null> {
  const m = /^ext\/([^/]+)\/(.+)$/.exec(key);
  if (!m) return null;
  const own = await ownExtensionNamed(storage, m[1], ownerName);
  return own ? `ext/${own}/${m[2]}` : null;
}

/** As ownExtensionFileKey, for the memory owner `ext:<name>` or `ext:<name>.<instance>`. */
export async function ownExtensionMemoryOwner(storage: Storage, memoryOwner: string, ownerName: string): Promise<string | null> {
  const m = /^ext:([^/.]+)(\..+)?$/.exec(memoryOwner);
  if (!m) return null;
  const own = await ownExtensionNamed(storage, m[1], ownerName);
  return own ? `ext:${own}${m[2] ?? ''}` : null;
}

/** The stored name `<ownerName>/<short>` when that account holds it, else null. */
async function ownExtensionNamed(storage: Storage, short: string, ownerName: string): Promise<string | null> {
  if (!OWNER_SEGMENT.test(ownerName) || short.includes('/')) return null;
  const ext = await storage.getExtension(namespacedName(ownerName, short));
  return ext && ext.installedBy === ownerName ? ext.name : null;
}

/** Is `head` a bare extension name the node knows: installed, or released by its holder? */
export async function isLegacyExtensionHead(storage: Storage, head: string): Promise<boolean> {
  if (await storage.getExtension(head)) return true;
  return (await releasedName(storage, 'extension', head)) !== null;
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
  if (await isLegacyExtensionHead(storage, aName)) {
    if (OWNER_SEGMENT.test(a) && await namespacedCameFirst(storage, a, stripPin(b))) return { extRef: `${a}/${b}` };
    return { extRef: a, instanceId: b };
  }
  if (callerOwner && OWNER_SEGMENT.test(callerOwner) && await storage.getExtension(namespacedName(callerOwner, aName))) {
    return { extRef: a, instanceId: b };
  }
  if (OWNER_SEGMENT.test(a)) return { extRef: `${a}/${b}` };
  return { extRef: a, instanceId: b };
}

/**
 * Does the account `<a>`'s extension `<a>/<b>` take a three-segment call that the bare extension `<a>`
 * could also take as its instance `<b>`? Yes when `<a>/<b>` is installed and the bare extension had no
 * instance `<b>` when it was. A bare extension named like an account, with an instance named like that
 * account's extension added later, took over every call the served SDK sends for it
 * (secaudit2026oct26, extensionCallTarget:bare-extension-head-shadows-owner-namespace). An instance that
 * was there first keeps its address: an update keeps `installedAt` (routes/extensions/crud.ts).
 */
async function namespacedCameFirst(storage: Storage, a: string, b: string): Promise<boolean> {
  const ns = await storage.getExtension(namespacedName(a, b));
  const installed = ns ? Date.parse(ns.installedAt ?? '') : NaN;
  if (!ns || Number.isNaN(installed)) return false;
  const instance = await storage.getExtensionInstance(a, b);
  return !instance || !(Date.parse(instance.createdAt) <= installed);
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
