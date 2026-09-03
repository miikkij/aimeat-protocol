/**
 * @file src/storage/types/component-versions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Kept versions of extensions and cortexes. An app keeps every version it publishes;
 *   an extension or a cortex used to be replaced in place, so an update to a shared cortex changed
 *   every app that loaded it at once. Now every install and update also stores a snapshot under
 *   (kind, name, version), and an address that pins a version (`name@1.2.0`) is served from the
 *   snapshot while the bare address keeps serving the latest.
 * @structure ComponentKind · ComponentVersionRecord · ComponentVersionSummary
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (versions, slice 2; brief doc-mtkr34qa1dg1).
 */

export type ComponentKind = 'extension' | 'cortex';

export interface ComponentVersionRecord {
  kind: ComponentKind;
  name: string;
  /** The manifest's version string, as published. */
  version: string;
  /**
   * Extension: the stored ExtensionRecord (actions with their scripts, limits, requiredApis,
   * config as stored, secrets still encrypted). Cortex: { manifest, components, libs: { file: js } }.
   */
  snapshot: Record<string, unknown>;
  bytes: number;
  createdAt: string;
  createdBy: string;
}

export interface ComponentVersionSummary {
  kind: ComponentKind;
  name: string;
  version: string;
  bytes: number;
  createdAt: string;
  createdBy: string;
}
