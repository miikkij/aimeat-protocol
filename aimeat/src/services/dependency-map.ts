/**
 * @file src/services/dependency-map.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The dependency map, read from the source. An app that loads a cortex writes
 *   `/v1/cortex/<name>/libs/<file>` into its HTML; an app or a cortex library that calls an extension
 *   writes `/v1/ext/<name>/<action>`. Both survive minification, both are what the node actually
 *   serves, and neither needs anyone to keep a list, so this service reads them at publish and
 *   install time and replaces the source's edges as a set. The app manifest's `usesCortex` is
 *   merged in as a declared edge. A pinned address (`<name>@1.2.0`) records the version; a bare
 *   one records null, meaning "the latest, whatever that is" — which is the thing the version
 *   slice makes visible.
 *
 *   Every surface that answers "who uses this" (the extension and cortex lists, the app list's
 *   `requires`, GET /v1/dependencies, the MCP tools) reads the same rows through the same two
 *   functions, so they cannot disagree.
 * @structure extractDependencies · refreshAppDependencies · refreshCortexDependencies ·
 *   forgetDependencies · backfillDependencyMap · dependentsOf · requirementsOf · dependencyIndex
 * @usage
 *   await refreshAppDependencies(storage, { ownerName, filename, versionNumber, mimeType, data, manifest });
 *   const { apps, cortexes } = await dependentsOf(storage, 'extension', 'prh-api');
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (dependency map, slice 1; brief doc-mtkr34qa1dg1).
 *   v1.1.0 — 2026-09-03 — Library packs join the map: an app carrying a pack's include path
 *     (`/v1/libs/aimeat-auth.js`, `/lib/phaser@4.min.js`) gets a 'pack' edge, the marker row carries
 *     the scan generation, and the boot backfill re-reads sources scanned by an older generation
 *     once. For the Libraries page's "who uses it" (design canvas "AIMEAT Kirjastot-sivu").
 */
import type { Storage } from '../storage/interface.js';
import type { AppManifest } from '../storage/interface.js';
import type { DependencyEdge, DependencyFromKind, DependencyToKind } from '../storage/types/dependencies.js';
import { logger } from '../utils/logger.js';
import { getLibraryPacks } from '../data/library-packs.js';

export interface Dep { name: string; version: string | null; via: 'source' | 'manifest' }
export interface ExtractedDependencies { cortex: Dep[]; extensions: Dep[]; packs: Dep[] }

/**
 * The scan generation. Bumped when the scan learns to see something new (2: library packs), so the
 * boot backfill re-reads every source scanned by an older generation exactly once.
 */
export const SCAN_MARKER = 'scan:2';

/**
 * A library pack is recognised by the path of its include line with the origin stripped:
 * `/v1/libs/aimeat-auth.js`, `/lib/phaser@4.min.js`, `/lib/daisyui@5.css`. Cortex-kind packs are
 * left out here because the cortex address form already records them as cortex edges. Computed
 * once; the registry is static.
 */
let packNeedles: Array<{ id: string; paths: string[] }> | null = null;
function packNeedlesOnce(): Array<{ id: string; paths: string[] }> {
  if (packNeedles) return packNeedles;
  packNeedles = getLibraryPacks()
    .filter(p => p.kind !== 'cortex')
    .map(p => ({
      id: p.id,
      paths: p.include
        .map(line => (line.match(/(?:src|href)="(?:\{\{BASE_URL\}\}|https?:\/\/[^/"]+)?(\/[^"]+)"/) ?? [])[1])
        .filter((path): path is string => typeof path === 'string' && path.length > 1),
    }))
    .filter(p => p.paths.length > 0);
  return packNeedles;
}

// A cortex name may carry one slash ("owner/name"), an extension name never does. The version,
// when pinned, follows an @ and runs to the next slash or quote. `%2F` is a slash a caller encoded.
const CORTEX_RE = /\/v1\/cortex\/((?:[A-Za-z0-9._-]+(?:%2F|\/))?[A-Za-z0-9._-]+)(?:@([0-9][A-Za-z0-9.+-]*))?\/(?:libs|prompts|ontology|export)(?:[/?"'`\s)]|$)/g;
const EXT_RE = /\/v1\/ext\/([A-Za-z0-9._-]+)(?:@([0-9][A-Za-z0-9.+-]*))?\//g;

/** Read the addresses out of one source text. Deduplicated by name; a pinned version wins over a bare mention. */
export function extractDependencies(text: string, declaredCortex: string[] = []): ExtractedDependencies {
  const cortex = new Map<string, Dep>();
  const extensions = new Map<string, Dep>();
  const keep = (map: Map<string, Dep>, name: string, version: string | null, via: Dep['via']) => {
    const prev = map.get(name);
    if (!prev || (prev.version === null && version !== null) || (prev.via === 'manifest' && via === 'source')) {
      map.set(name, { name, version: version ?? prev?.version ?? null, via });
    }
  };
  for (const m of text.matchAll(CORTEX_RE)) {
    const name = m[1].replace(/%2F/g, '/');
    if (name.includes('${') || name.includes('{{')) continue;   // a template, not an address
    keep(cortex, name, m[2] ?? null, 'source');
  }
  for (const m of text.matchAll(EXT_RE)) {
    keep(extensions, m[1], m[2] ?? null, 'source');
  }
  for (const name of declaredCortex) {
    if (typeof name === 'string' && /^[A-Za-z0-9._/-]+$/.test(name)) keep(cortex, name, null, 'manifest');
  }
  // Library packs: a source that carries any of the pack's include paths uses the pack. The path
  // is exact, so `/lib/phaser@3.min.js` and `/lib/phaser@4.min.js` are two different packs.
  const packs: Dep[] = [];
  for (const p of packNeedlesOnce()) {
    if (p.paths.some(path => text.includes(path))) packs.push({ name: p.id, version: null, via: 'source' });
  }
  return { cortex: [...cortex.values()], extensions: [...extensions.values()], packs };
}

function edgesOf(fromKind: DependencyFromKind, fromRef: string, fromVersion: string, found: ExtractedDependencies): DependencyEdge[] {
  const now = new Date().toISOString();
  const edges: DependencyEdge[] = [
    ...found.cortex.map(d => ({ fromKind, fromRef, fromVersion, toKind: 'cortex' as DependencyToKind, toName: d.name, toVersion: d.version, via: d.via, updatedAt: now })),
    ...found.extensions.map(d => ({ fromKind, fromRef, fromVersion, toKind: 'extension' as DependencyToKind, toName: d.name, toVersion: d.version, via: d.via, updatedAt: now })),
    ...found.packs.map(d => ({ fromKind, fromRef, fromVersion, toKind: 'pack' as DependencyToKind, toName: d.name, toVersion: d.version, via: d.via, updatedAt: now })),
  ];
  // The marker: scanned by THIS generation of the scan. Without it the backfill would read this
  // source on every boot; with an older generation's marker it is read once more, then not again.
  edges.push({ fromKind, fromRef, fromVersion, toKind: 'none', toName: SCAN_MARKER, toVersion: null, via: 'source', updatedAt: now });
  return edges;
}

export const appRef = (ownerName: string, filename: string): string => `${ownerName}/${filename}`;

/** Re-read an app version's dependencies from its bytes and replace its edges. HTML and JS only. */
export async function refreshAppDependencies(storage: Storage, app: {
  ownerName: string; filename: string; versionNumber: number; mimeType: string; data: Buffer | Uint8Array; manifest?: AppManifest;
}): Promise<ExtractedDependencies> {
  const isText = /html|javascript|json|text/i.test(app.mimeType);
  const text = isText ? Buffer.from(app.data).toString('utf8') : '';
  const found = extractDependencies(text, app.manifest?.usesCortex ?? []);
  await storage.replaceDependencyEdges('app', appRef(app.ownerName, app.filename), edgesOf('app', appRef(app.ownerName, app.filename), String(app.versionNumber), found));
  return found;
}

/** Re-read a cortex's library files for extension calls and replace its edges. */
export async function refreshCortexDependencies(storage: Storage, name: string, version: string, libs: Record<string, string>): Promise<ExtractedDependencies> {
  const found = extractDependencies(Object.values(libs).join('\n'));
  found.cortex = [];   // a cortex loading another cortex is not a thing the address form expresses
  found.packs = [];    // a library file mentioning a pack path is documentation, not a load
  await storage.replaceDependencyEdges('cortex', name, edgesOf('cortex', name, version, found));
  return found;
}

/** The source is gone (app or cortex deleted): drop its edges. */
export async function forgetDependencies(storage: Storage, fromKind: DependencyFromKind, fromRef: string): Promise<void> {
  await storage.deleteDependencyEdges(fromKind, fromRef);
}

/**
 * Scan every app and cortex the CURRENT scan generation has never seen. Runs at boot, in the
 * background, once per source: a source carrying this generation's marker is skipped, so a steady
 * node does no work here. A new node with 147 apps reads them once; a node scanned by an older
 * generation (before the scan saw library packs) reads them once more.
 */
export async function backfillDependencyMap(storage: Storage): Promise<{ apps: number; cortexes: number }> {
  const seen = new Set((await storage.listDependencyEdges({ toKind: 'none', toName: SCAN_MARKER })).map(e => `${e.fromKind}:${e.fromRef}`));
  let apps = 0;
  let cortexes = 0;
  const { apps: list } = await storage.listApps({ limit: 10000, offset: 0 });
  for (const a of list) {
    if (seen.has(`app:${appRef(a.ownerName, a.filename)}`)) continue;
    const full = await storage.getAppByOwnerName(a.ownerName, a.filename);
    if (!full) continue;
    await refreshAppDependencies(storage, full);
    apps++;
  }
  for (const c of await storage.listCortexExtensions({})) {
    if (seen.has(`cortex:${c.name}`)) continue;
    const libs: Record<string, string> = {};
    for (const comp of c.components) {
      if (comp.type !== 'lib') continue;
      const content = await storage.getCortexLibFile(c.name, comp.filename);
      if (content !== null) libs[comp.filename] = content;
    }
    await refreshCortexDependencies(storage, c.name, c.version, libs);
    cortexes++;
  }
  if (apps || cortexes) logger.info('Dependency map backfilled', { apps, cortexes });
  return { apps, cortexes };
}

/* ── Reading the map ─────────────────────────────────────────────────────────────────────────── */

export interface DependantApp { owner: string; filename: string; version: string; pinned: string | null; via: 'source' | 'manifest' }
export interface DependantCortex { name: string; version: string; pinned: string | null }
export interface Dependants { apps: DependantApp[]; cortexes: DependantCortex[] }

function splitAppRef(ref: string): { owner: string; filename: string } {
  const i = ref.indexOf('/');
  return { owner: ref.slice(0, i), filename: ref.slice(i + 1) };
}

/** Who uses one cortex, extension or library pack. */
export async function dependentsOf(storage: Storage, toKind: 'cortex' | 'extension' | 'pack', toName: string): Promise<Dependants> {
  const edges = await storage.listDependencyEdges({ toKind, toName });
  return groupDependants(edges);
}

function groupDependants(edges: DependencyEdge[]): Dependants {
  const apps: DependantApp[] = [];
  const cortexes: DependantCortex[] = [];
  for (const e of edges) {
    if (e.fromKind === 'app') apps.push({ ...splitAppRef(e.fromRef), version: e.fromVersion, pinned: e.toVersion, via: e.via });
    else cortexes.push({ name: e.fromRef, version: e.fromVersion, pinned: e.toVersion });
  }
  return { apps, cortexes };
}

export interface Requirements {
  cortex: Array<{ name: string; pinned: string | null; via: 'source' | 'manifest' }>;
  extensions: Array<{ name: string; pinned: string | null }>;
  /** Library packs (SDK, vendored, bundle) the source includes; cortex-kind packs are under `cortex`. */
  packs: Array<{ name: string }>;
}

/** What one app (or one cortex) needs. */
export async function requirementsOf(storage: Storage, fromKind: DependencyFromKind, fromRef: string): Promise<Requirements> {
  const edges = await storage.listDependencyEdges({ fromKind, fromRef });
  return {
    cortex: edges.filter(e => e.toKind === 'cortex').map(e => ({ name: e.toName, pinned: e.toVersion, via: e.via })),
    extensions: edges.filter(e => e.toKind === 'extension').map(e => ({ name: e.toName, pinned: e.toVersion })),
    packs: edges.filter(e => e.toKind === 'pack').map(e => ({ name: e.toName })),
  };
}

/**
 * The whole map in one read, for a list that wants "used by" on every row: dependants by cortex
 * name and by extension name, and requirements by app ref. One query, then maps.
 */
export async function dependencyIndex(storage: Storage): Promise<{
  byCortex: Map<string, Dependants>; byExtension: Map<string, Dependants>; byPack: Map<string, Dependants>; byApp: Map<string, Requirements>;
}> {
  const edges = await storage.listDependencyEdges();
  const byCortex = new Map<string, DependencyEdge[]>();
  const byExtension = new Map<string, DependencyEdge[]>();
  const byPack = new Map<string, DependencyEdge[]>();
  const byApp = new Map<string, Requirements>();
  for (const e of edges) {
    if (e.toKind === 'cortex') (byCortex.get(e.toName) ?? byCortex.set(e.toName, []).get(e.toName)!).push(e);
    else if (e.toKind === 'extension') (byExtension.get(e.toName) ?? byExtension.set(e.toName, []).get(e.toName)!).push(e);
    else if (e.toKind === 'pack') (byPack.get(e.toName) ?? byPack.set(e.toName, []).get(e.toName)!).push(e);
    if (e.fromKind === 'app') {
      const r = byApp.get(e.fromRef) ?? { cortex: [], extensions: [], packs: [] };
      if (e.toKind === 'cortex') r.cortex.push({ name: e.toName, pinned: e.toVersion, via: e.via });
      else if (e.toKind === 'extension') r.extensions.push({ name: e.toName, pinned: e.toVersion });
      else if (e.toKind === 'pack') r.packs.push({ name: e.toName });
      byApp.set(e.fromRef, r);
    }
  }
  const group = (m: Map<string, DependencyEdge[]>) => new Map([...m].map(([k, v]) => [k, groupDependants(v)]));
  return { byCortex: group(byCortex), byExtension: group(byExtension), byPack: group(byPack), byApp };
}

/**
 * The app refs a viewer may be told about: every listed app (not parked, not hidden by the
 * operator) plus the viewer's own, which is exactly what the app listing shows that viewer. A
 * dependant that is somebody's parked app is still counted, but its name is not handed out.
 * `viewerGhii` is the viewer's owner GHII (owner@node), the same key the listing takes.
 */
export async function visibleAppRefs(storage: Storage, viewerGhii?: string): Promise<{ visible: Set<string> }> {
  const { apps } = await storage.listApps({ limit: 10000, offset: 0, ...(viewerGhii ? { viewerGhii } : {}) });
  const visible = new Set<string>();
  for (const a of apps) visible.add(appRef(a.ownerName, a.filename));
  return { visible };
}

/** The shape every list row carries: counts over everyone, names only for what the viewer may see. */
export function usedBySummary(d: Dependants | undefined, visible: Set<string>): { apps: number; cortexes: number; app_names: string[]; cortex_names: string[] } {
  if (!d) return { apps: 0, cortexes: 0, app_names: [], cortex_names: [] };
  const names = d.apps.filter(a => visible.has(appRef(a.owner, a.filename))).map(a => `${a.owner}/${a.filename}`);
  return { apps: d.apps.length, cortexes: d.cortexes.length, app_names: names.slice(0, 8), cortex_names: d.cortexes.map(c => c.name).slice(0, 8) };
}
