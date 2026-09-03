/**
 * @file src/storage/types/dependencies.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The dependency map: which app loads which cortex and calls which extension, and
 *   which cortex library calls which extension. Read from the SOURCE at publish and install time
 *   (services/dependency-map.ts), never written by hand, so the map is only ever as true as the
 *   bytes being served. One row per edge; a marker row (toKind 'none') says a source was scanned
 *   and used nothing, which is how the boot backfill tells "never scanned" from "needs nothing".
 * @structure DependencyEdge · DependencyFromKind · DependencyToKind · DependencyEdgeFilter
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (dependency map, slice 1).
 *   v1.1.0 — 2026-09-03 — 'pack' edges (library packs matched by include path) and the scan
 *     generation on the marker row, so the Libraries page can say who uses a library.
 */

/** Who depends: an app (fromRef "owner/filename") or a cortex (fromRef its name). */
export type DependencyFromKind = 'app' | 'cortex';
/**
 * What is depended on: a cortex, a server extension, or a library pack (an SDK, vendored or bundle
 * pack from the registry, matched by its include path); 'none' marks a scanned source with no
 * dependencies, and its toName carries the scan generation ('scan:2') so a later, wider scan can
 * tell an old scan from a current one.
 */
export type DependencyToKind = 'cortex' | 'extension' | 'pack' | 'none';

export interface DependencyEdge {
  fromKind: DependencyFromKind;
  /** App: "owner/filename". Cortex: its name. */
  fromRef: string;
  /** The version of the source that was scanned: an app's version number, a cortex's manifest version. */
  fromVersion: string;
  toKind: DependencyToKind;
  /** The cortex or extension name; '' on the marker row. */
  toName: string;
  /** The version pinned in the address (`name@1.2.0`), or null when the source takes the latest. */
  toVersion: string | null;
  /** 'source' = read from the bytes; 'manifest' = declared in the app manifest (usesCortex). */
  via: 'source' | 'manifest';
  updatedAt: string;
}

export interface DependencyEdgeFilter {
  fromKind?: DependencyFromKind;
  fromRef?: string;
  toKind?: DependencyToKind;
  toName?: string;
}
