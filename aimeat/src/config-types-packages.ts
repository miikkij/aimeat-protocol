/**
 * @file src/config-types-packages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The packages and templates settings, mixed into AimeatConfig. Moved out of
 *   config-types.ts unchanged when that file reached the 800-line ceiling, in the change that added
 *   the install set read at start-up.
 * @structure PackagesConfig
 * @usage import type { PackagesConfig } from './config-types-packages.js';
 * @version-history
 *   v1.2.0 — 2026-10-02 — packagePeerCap: the most packages-only peers a repository registers.
 *   v1.1.0 — 2026-09-28 — installSetPath and installSetSecretsPath: the install set a new node
 *     applies at start-up (services/install-set-startup.ts).
 *   v1.0.0 — 2026-09-28 — Moved from config-types.ts (a pure move).
 */

export interface PackagesConfig {
  // Packages & Templates
  packagesEnabled: boolean;
  packageCreateRole: 'operator' | 'owner';
  packageMaxSizeMb: number;
  packageMaxComponents: number;
  packageMaxPerAuthor: number;
  templatesEnabled: boolean;
  templateReviewsEnabled: boolean;
  templateDiscussionsEnabled: boolean;
  packageFederationEnabled: boolean;
  packageFederationAutoAccept: boolean;
  /** Package repository role: a private package also reaches entitled peer nodes (package-entitlements.ts). */
  packageRepository: boolean;
  /**
   * The most packages-only peers a repository registers (package-peer-limits.ts): a grant, a sale or a
   * named seller beyond it is refused, and the operator is told once. Finding F of the package sale design.
   */
  packagePeerCap: number;
  /**
   * A JSON file holding an install set this node applies at start-up (install-set-startup.ts), or
   * null. Applying again creates nothing twice, so the file may stay in place across restarts.
   */
  installSetPath: string | null;
  /** A JSON file of the secret config values for that set, `{ <group id>: { <component id>: { <field>: value } } }`, or null. */
  installSetSecretsPath: string | null;
}
