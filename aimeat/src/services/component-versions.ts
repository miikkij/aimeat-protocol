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
 * @structure splitPinnedName · snapshotExtensionVersion · snapshotCortexVersion ·
 *   resolveExtensionForCall · resolveCortexLib · listVersions · forgetVersions
 * @usage
 *   const { name, version } = splitPinnedName('aimeat-cadence-cortex@1.5.0');
 *   const r = await resolveExtensionForCall(storage, 'btc-price-data@1.2.0');
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (versions, slice 2; brief doc-mtkr34qa1dg1).
 */
import type { Storage, ExtensionRecord, CortexExtensionRecord } from '../storage/interface.js';
import type { ComponentKind, ComponentVersionSummary } from '../storage/types/component-versions.js';

/** "name@1.2.0" → { name, version }; "name" → { name, version: null }. A name never carries an @. */
export function splitPinnedName(raw: string): { name: string; version: string | null } {
  const at = raw.lastIndexOf('@');
  if (at <= 0) return { name: raw, version: null };
  const version = raw.slice(at + 1);
  if (!/^[0-9][A-Za-z0-9.+-]*$/.test(version)) return { name: raw, version: null };
  return { name: raw.slice(0, at), version };
}

/** Keep this extension version as it is stored (secrets stay encrypted, scripts included). */
export async function snapshotExtensionVersion(storage: Storage, record: ExtensionRecord, createdBy: string): Promise<void> {
  await storage.saveComponentVersion({
    kind: 'extension', name: record.name, version: record.version,
    snapshot: {
      version: record.version, description: record.description, author: record.author,
      requiredApis: record.requiredApis, actions: record.actions, limits: record.limits,
      federation: record.federation, instances: record.instances ?? null, config: record.config,
    },
    bytes: 0, createdAt: new Date().toISOString(), createdBy,
  });
}

/** Keep this cortex version: manifest, components and the library files as served. */
export async function snapshotCortexVersion(storage: Storage, record: CortexExtensionRecord, libs: Record<string, string>, createdBy: string): Promise<void> {
  await storage.saveComponentVersion({
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

export type ExtensionCallResolution =
  | { ok: true; ext: ExtensionRecord; name: string; pinned: string | null }
  | { ok: false; name: string; reason: 'extension' | 'version'; pinned: string | null };

/**
 * The record a call at `/v1/ext/<raw>/…` runs against. Bare: the live record. Pinned: the live
 * record's status, config and instances (the operator's settings are not versioned) with the
 * snapshot's actions, limits and required APIs, so the code that runs is the version the caller
 * built against.
 */
export async function resolveExtensionForCall(storage: Storage, raw: string): Promise<ExtensionCallResolution> {
  const { name, version } = splitPinnedName(raw);
  const live = await storage.getExtension(name);
  if (!live) return { ok: false, name, reason: 'extension', pinned: version };
  if (!version || version === live.version) return { ok: true, ext: live, name, pinned: version };
  const kept = await storage.getComponentVersion('extension', name, version);
  if (!kept) return { ok: false, name, reason: 'version', pinned: version };
  const s = kept.snapshot as Partial<ExtensionRecord>;
  return {
    ok: true, name, pinned: version,
    ext: { ...live, version, actions: s.actions ?? live.actions, limits: s.limits ?? live.limits, requiredApis: s.requiredApis ?? live.requiredApis },
  };
}

/** The bytes of one library file at `/v1/cortex/<raw>/libs/<file>`: live, or the pinned snapshot's. */
export async function resolveCortexLib(storage: Storage, raw: string, libFile: string): Promise<
  { ok: true; content: string; name: string; pinned: string | null } | { ok: false; name: string; reason: 'cortex' | 'inactive' | 'version' | 'file' }
> {
  const { name, version } = splitPinnedName(raw);
  const live = await storage.getCortexExtension(name);
  if (!live) return { ok: false, name, reason: 'cortex' };
  if (live.status !== 'active') return { ok: false, name, reason: 'inactive' };
  if (!version || version === live.version) {
    const content = await storage.getCortexLibFile(name, libFile);
    return content === null ? { ok: false, name, reason: 'file' } : { ok: true, content, name, pinned: version };
  }
  const kept = await storage.getComponentVersion('cortex', name, version);
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
