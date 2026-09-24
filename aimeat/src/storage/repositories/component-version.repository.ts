/**
 * @file src/storage/repositories/component-version.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-backend-agnostic interface for kept extension and cortex versions
 *   (types/component-versions.ts). A version is kept ONCE: saving a (kind, name, version) that is
 *   already kept writes nothing, whatever the new snapshot holds, because `name@version` is an
 *   address apps pin and what it serves must not change under them.
 * @structure ComponentVersionRepository: saveComponentVersion · listComponentVersions ·
 *   getComponentVersion · deleteComponentVersions
 * @version-history
 *   v1.1.0 — 2026-09-24 — saveComponentVersion never replaces a kept version and says whether it
 *     stored this one (secaudit 2026-09, A6-7). It was an upsert, so re-publishing a version string
 *     replaced the snapshot a pinned address serves.
 *   v1.0.0 — 2026-09-03 — Initial (versions, slice 2).
 */
import type { ComponentKind, ComponentVersionRecord, ComponentVersionSummary } from '../types/component-versions.js';

export interface ComponentVersionRepository {
  /** Keep a version. True when this call stored it; false when that (kind, name, version) was
   *  already kept, in which case nothing is written. A kept version is never replaced. */
  saveComponentVersion(record: ComponentVersionRecord): Promise<boolean>;
  /** Newest first, without the snapshot bodies. */
  listComponentVersions(kind: ComponentKind, name: string): Promise<ComponentVersionSummary[]>;
  getComponentVersion(kind: ComponentKind, name: string, version: string): Promise<ComponentVersionRecord | null>;
  /** The component is gone: drop its history. Returns the number of rows removed. */
  deleteComponentVersions(kind: ComponentKind, name: string): Promise<number>;
}
