/**
 * @file src/services/component-versions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Kept versions of extensions and cortexes, and the pinned address. Every install and
 *   update stores a snapshot under (kind, name, version); `name@1.2.0` in an address resolves to
 *   that snapshot, and a bare `name` to the live record, so an app built against one version keeps
 *   running it while the same cortex or extension moves on for everyone else. The dependency map
 *   (services/dependency-map.ts) records which version an app pinned, which is how a list can say
 *   "3 apps use 1.4, the latest is 1.5".
 *
 *   A KEPT VERSION IS IMMUTABLE. `name@1.2.0` is an address an app is built against, and a cortex
 *   lib at a pinned address is served `immutable`, so a browser keeps it for a year. What it serves
 *   is the code first kept under that version, for good: the store never replaces a kept version, a
 *   deploy that brings other code under one is refused before it writes (keptVersionRefusal), and a
 *   pinned address reads the kept snapshot even when the pin names the live version.
 * @structure splitPinnedName · isPinnableVersion · snapshotExtensionVersion · snapshotCortexVersion ·
 *   servedCortexLibs · extensionCodeOf · cortexCodeOf · versionExistsRefusal · keptVersionRefusal ·
 *   cortexLibsAfterDeploy · nextFreeVersion · resolveExtensionForCall · resolveCortexLib ·
 *   listVersions · forgetVersions · backfillComponentVersions
 * @usage
 *   const { name, version } = splitPinnedName('aimeat-cadence-cortex@1.5.0');
 *   const r = await resolveExtensionForCall(storage, 'btc-price-data@1.2.0');
 *   const refusal = await keptVersionRefusal(storage, 'extension', name, record.version, extensionCodeOf(record));
 * @version-history
 *   v1.1.0 — 2026-09-24 — A kept version is immutable (secaudit 2026-09, A6-7). Saving an existing
 *     (kind, name, version) replaced its snapshot, and a pinned call at the live version ran the live
 *     record, so a redeploy or an action PATCH under an unchanged version changed what every caller
 *     pinned to it ran. The store now keeps a version once; keptVersionRefusal() refuses other code
 *     under a kept version before a deploy writes, with one wording for every door; the resolvers read
 *     the kept snapshot for every pin; nextFreeVersion() is the new version a PATCH takes.
 *   v1.0.0 — 2026-09-03 — Initial (versions, slice 2; brief doc-mtkr34qa1dg1).
 */
import type { Storage, ExtensionRecord, CortexExtensionRecord } from '../storage/interface.js';
import type { ComponentKind, ComponentVersionSummary } from '../storage/types/component-versions.js';
import { stableStringify } from '../utils/stable-json.js';

/** A version an address can pin: a digit first, then letters, digits, dots, plus and minus. */
const PINNABLE_VERSION = /^[0-9][A-Za-z0-9.+-]*$/;

/** Can `name@<version>` address this version? */
export function isPinnableVersion(version: string): boolean {
  return PINNABLE_VERSION.test(version);
}

/** "name@1.2.0" → { name, version }; "name" → { name, version: null }. A name never carries an @. */
export function splitPinnedName(raw: string): { name: string; version: string | null } {
  const at = raw.lastIndexOf('@');
  if (at <= 0) return { name: raw, version: null };
  const version = raw.slice(at + 1);
  if (!isPinnableVersion(version)) return { name: raw, version: null };
  return { name: raw.slice(0, at), version };
}

/**
 * Keep this extension version as it is stored (secrets stay encrypted, scripts included). True when
 * this call kept it, false when the version was already kept: a kept version is never replaced.
 */
export async function snapshotExtensionVersion(storage: Storage, record: ExtensionRecord, createdBy: string): Promise<boolean> {
  return storage.saveComponentVersion({
    kind: 'extension', name: record.name, version: record.version,
    snapshot: {
      version: record.version, description: record.description, author: record.author,
      requiredApis: record.requiredApis, actions: record.actions, limits: record.limits,
      federation: record.federation, instances: record.instances ?? null, config: record.config,
    },
    bytes: 0, createdAt: new Date().toISOString(), createdBy,
  });
}

/** Keep this cortex version: manifest, components and the library files as served. Never replaces. */
export async function snapshotCortexVersion(storage: Storage, record: CortexExtensionRecord, libs: Record<string, string>, createdBy: string): Promise<boolean> {
  return storage.saveComponentVersion({
    kind: 'cortex', name: record.name, version: record.version,
    snapshot: { version: record.version, manifest: record.manifest, components: record.components, libs },
    bytes: 0, createdAt: new Date().toISOString(), createdBy,
  });
}

/** The library files a cortex serves right now, read back from storage. */
export async function servedCortexLibs(storage: Storage, record: CortexExtensionRecord): Promise<Record<string, string>> {
  const libs: Record<string, string> = {};
  for (const comp of record.components) {
    if (comp.type !== 'lib') continue;
    const content = await storage.getCortexLibFile(record.name, comp.filename);
    if (content !== null) libs[comp.filename] = content;
  }
  return libs;
}

/**
 * What a pinned extension address runs: the parts of a record a pinned call takes from the kept
 * snapshot (resolveExtensionForCall). Canonical JSON, because Postgres jsonb does not keep key
 * order and the same code must not read as different code. Config, status and instances are the
 * operator's settings, which are not versioned, so they are not in it.
 */
export function extensionCodeOf(r: Partial<Pick<ExtensionRecord, 'actions' | 'limits' | 'requiredApis'>>): string {
  return stableStringify({ actions: r.actions ?? [], limits: r.limits ?? null, requiredApis: r.requiredApis ?? [] });
}

/** What a pinned cortex address serves: its library files, by filename. */
export function cortexCodeOf(libs: Record<string, string> | undefined): string {
  return stableStringify(libs ?? {});
}

export interface KeptVersionRefusal { status: 409; code: 'VERSION_EXISTS'; message: string }

/** The answer to a change that would land under a version already kept. One wording for every door. */
export function versionExistsRefusal(kind: ComponentKind, name: string, version: string): KeptVersionRefusal {
  return {
    status: 409, code: 'VERSION_EXISTS',
    message: `Version ${version} of ${kind} "${name}" is already kept with other code, and an app that pins ${name}@${version} runs exactly that code. Give the change a new version number and deploy it again.`,
  };
}

/**
 * Refuse a deploy that would bring other code under a version already kept.
 *
 * `code` is the deploy's own extensionCodeOf / cortexCodeOf. Null when the version is not kept yet,
 * or is kept with exactly this code: the same bytes again are a no-op, not a conflict. Asked before
 * the deploy writes anything, because the store keeps the first snapshot whatever comes after, and a
 * deploy that went ahead would leave the live record and the kept version disagreeing about what
 * the same version number means.
 */
export async function keptVersionRefusal(
  storage: Storage, kind: ComponentKind, name: string, version: string, code: string,
): Promise<KeptVersionRefusal | null> {
  const kept = await storage.getComponentVersion(kind, name, version);
  if (!kept) return null;
  const keptCode = kind === 'extension'
    ? extensionCodeOf(kept.snapshot as Partial<ExtensionRecord>)
    : cortexCodeOf((kept.snapshot as { libs?: Record<string, string> }).libs);
  return keptCode === code ? null : versionExistsRefusal(kind, name, version);
}

/**
 * The library files a cortex will serve once a deploy lands: for each lib component the new manifest
 * names, the bytes the deploy brings, else the bytes already stored under that filename. The same set
 * a redeploy keeps after its swap, worked out before it, so a refusal comes before the first byte.
 * `currentLibs` saves the reads when the caller already holds the stored bytes.
 */
export async function cortexLibsAfterDeploy(
  storage: Storage, name: string, components: CortexExtensionRecord['components'],
  newLibs: Record<string, string>, currentLibs?: Record<string, string>,
): Promise<Record<string, string>> {
  const libs: Record<string, string> = {};
  for (const comp of components) {
    if (comp.type !== 'lib') continue;
    const content = newLibs[comp.filename] ?? currentLibs?.[comp.filename] ?? await storage.getCortexLibFile(name, comp.filename);
    if (typeof content === 'string') libs[comp.filename] = content;
  }
  return libs;
}

/** Raise the last number in a version by one: 1.1.0 → 1.1.1, 2 → 3, 1.0.0-rc.1 → 1.0.0-rc.2. A
 *  version that ends in no number gets `.1`. */
function bumpVersion(version: string): string {
  const m = /^(.*?)(\d+)(\D*)$/.exec(version);
  if (!m) return `${version}.1`;
  return `${m[1]}${(BigInt(m[2]) + 1n).toString()}${m[3]}`;
}

/**
 * The first version after `current` that is not kept yet. A changed action script is a new version
 * (PATCH /v1/extensions/:name/actions/:actionId), and when the caller names none, this is it.
 */
export async function nextFreeVersion(storage: Storage, kind: ComponentKind, name: string, current: string): Promise<string> {
  const kept = new Set((await storage.listComponentVersions(kind, name)).map(v => v.version));
  let next = bumpVersion(current);
  while (kept.has(next)) next = bumpVersion(next);
  return next;
}

export type ExtensionCallResolution =
  | { ok: true; ext: ExtensionRecord; name: string; pinned: string | null }
  | { ok: false; name: string; reason: 'extension' | 'version'; pinned: string | null };

/**
 * The record a call at `/v1/ext/<raw>/…` runs against. Bare: the live record. Pinned: the live
 * record's status, config and instances (the operator's settings are not versioned) with the kept
 * snapshot's actions, limits and required APIs, so the code that runs is the version the caller
 * built against. The snapshot is read even when the pin names the live version: a pin means the
 * code kept under that version, not whatever the live record holds today. Only a version with no
 * snapshot at all, which a record older than kept versions can have, falls back to the live record,
 * and only at the live version.
 */
export async function resolveExtensionForCall(storage: Storage, raw: string): Promise<ExtensionCallResolution> {
  const { name, version } = splitPinnedName(raw);
  const live = await storage.getExtension(name);
  if (!live) return { ok: false, name, reason: 'extension', pinned: version };
  if (!version) return { ok: true, ext: live, name, pinned: version };
  const kept = await storage.getComponentVersion('extension', name, version);
  if (!kept) {
    return version === live.version
      ? { ok: true, ext: live, name, pinned: version }
      : { ok: false, name, reason: 'version', pinned: version };
  }
  const s = kept.snapshot as Partial<ExtensionRecord>;
  return {
    ok: true, name, pinned: version,
    ext: { ...live, version, actions: s.actions ?? live.actions, limits: s.limits ?? live.limits, requiredApis: s.requiredApis ?? live.requiredApis },
  };
}

/**
 * The bytes of one library file at `/v1/cortex/<raw>/libs/<file>`: live, or the pinned version's
 * kept snapshot. A pinned address is served `immutable`, so the snapshot is read for every pin, the
 * live version's included; only a version with no snapshot at all falls back to the live file.
 */
export async function resolveCortexLib(storage: Storage, raw: string, libFile: string): Promise<
  { ok: true; content: string; name: string; pinned: string | null } | { ok: false; name: string; reason: 'cortex' | 'inactive' | 'version' | 'file' }
> {
  const { name, version } = splitPinnedName(raw);
  const live = await storage.getCortexExtension(name);
  if (!live) return { ok: false, name, reason: 'cortex' };
  if (live.status !== 'active') return { ok: false, name, reason: 'inactive' };
  const kept = version ? await storage.getComponentVersion('cortex', name, version) : null;
  if (!version || (!kept && version === live.version)) {
    const content = await storage.getCortexLibFile(name, libFile);
    return content === null ? { ok: false, name, reason: 'file' } : { ok: true, content, name, pinned: version };
  }
  if (!kept) return { ok: false, name, reason: 'version' };
  const libs = (kept.snapshot as { libs?: Record<string, string> }).libs ?? {};
  const content = libs[libFile];
  return content === undefined ? { ok: false, name, reason: 'file' } : { ok: true, content, name, pinned: version };
}

export async function listVersions(storage: Storage, kind: ComponentKind, name: string): Promise<ComponentVersionSummary[]> {
  return storage.listComponentVersions(kind, name);
}

export async function forgetVersions(storage: Storage, kind: ComponentKind, name: string): Promise<void> {
  await storage.deleteComponentVersions(kind, name);
}

/**
 * Boot: every extension and cortex installed before versions were kept gets its CURRENT version
 * snapshotted once, so a pinned address answers for everything on the node and the page's "kept"
 * line is never empty. One that already has any version is left alone, so a steady node does no
 * work here beyond two listings.
 */
export async function backfillComponentVersions(storage: Storage): Promise<{ extensions: number; cortexes: number }> {
  let extensions = 0;
  let cortexes = 0;
  for (const ext of await storage.listExtensions()) {
    if ((await storage.listComponentVersions('extension', ext.name)).length) continue;
    await snapshotExtensionVersion(storage, ext, ext.installedBy || 'backfill');
    extensions++;
  }
  for (const cx of await storage.listCortexExtensions()) {
    if ((await storage.listComponentVersions('cortex', cx.name)).length) continue;
    await snapshotCortexVersion(storage, cx, await servedCortexLibs(storage, cx), cx.installedBy || 'backfill');
    cortexes++;
  }
  return { extensions, cortexes };
}
