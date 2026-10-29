/**
 * @file src/storage/types/component-versions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Kept versions of extensions and cortexes. An app keeps every version it publishes;
 *   an extension or a cortex used to be replaced in place, so an update to a shared cortex changed
 *   every app that loaded it at once. Now every install and update also stores a snapshot under
 *   (kind, name, version), and an address that pins a version (`name@1.2.0`) is served from the
 *   snapshot while the bare address keeps serving the latest.
 * @structure ComponentKind · ComponentVersionRecord · ComponentVersionSummary · ReleasedComponentNameRecord ·
 *   FREED_RELEASE_PREFIX · isFreedRelease
 * @version-history
 *   2026-10-29 — FREED_RELEASE_PREFIX and isFreedRelease: a name freed by account erasure or the held-name
 *     settlement (secaudit2026oct26 round 8c).
 *   2026-10-25 — ReleasedComponentNameRecord: a bare name released by uninstall and the account that
 *     held it (owner namespaces wish, secaudit2026oct22).
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

/**
 * A bare extension or cortex name an uninstall released. Names are stored as `<owner>/<name>` since
 * 2026-10-25; a bare name is one stored before that, or a shipped one. Only `holder` may install
 * under the bare name again (services/component-address.ts).
 */
export interface ReleasedComponentNameRecord {
  kind: ComponentKind;
  name: string;
  /** The account that held the name: an installedBy value (a bare account name, or `system@<node>`). */
  holder: string;
  releasedAt: string;
}

/**
 * The holder prefix of a name freed by account erasure or the operator's held-name settlement:
 * `freed:<erasure pseudonym>`, which no account matches. Such a row records that the holder changed and
 * leaves the name free for the next install; an uninstall's row retires it instead
 * (services/component-address.ts, services/cortex-holder-change.ts; secaudit2026oct26 round 8c).
 */
export const FREED_RELEASE_PREFIX = 'freed:';

/** Was this name freed by an erasure or a settlement, rather than released by an uninstall? */
export function isFreedRelease(row: { holder: string }): boolean {
  return row.holder.startsWith(FREED_RELEASE_PREFIX);
}
