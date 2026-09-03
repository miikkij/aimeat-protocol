/**
 * @file src/storage/repositories/component-version.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-backend-agnostic interface for kept extension and cortex versions
 *   (types/component-versions.ts). Save is an upsert on (kind, name, version): publishing the same
 *   version string again replaces that snapshot, the way republishing an app version would.
 * @structure ComponentVersionRepository: saveComponentVersion · listComponentVersions ·
 *   getComponentVersion · deleteComponentVersions
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (versions, slice 2).
 */
import type { ComponentKind, ComponentVersionRecord, ComponentVersionSummary } from '../types/component-versions.js';

export interface ComponentVersionRepository {
  saveComponentVersion(record: ComponentVersionRecord): Promise<void>;
  /** Newest first, without the snapshot bodies. */
  listComponentVersions(kind: ComponentKind, name: string): Promise<ComponentVersionSummary[]>;
  getComponentVersion(kind: ComponentKind, name: string, version: string): Promise<ComponentVersionRecord | null>;
  /** The component is gone: drop its history. Returns the number of rows removed. */
  deleteComponentVersions(kind: ComponentKind, name: string): Promise<number>;
}
