/**
 * @file src/services/config-field-def.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape of one tunable config row: what src/services/config-schema.ts lists for
 *   every field. Moved out of config-schema.ts unchanged when that file reached the 800-line ceiling
 *   (config-schema.ts re-exports all three names, so no importer changes).
 * @structure SiteLinkFieldKey · OperatorFieldKey · ConfigFieldDef
 * @usage import type { ConfigFieldDef } from './config-schema.js';
 * @version-history
 *   v1.0.0 — 2026-09-24 — Moved from config-schema.ts (a pure move).
 */

import type { AimeatConfig } from '../config.js';
import type { SiteLinksConfig } from '../config-types-site-links.js';
import type { OperatorConfig } from '../config-types.js';

/**
 * The site links are the one nested group a row may address: `siteLinks.learn` and its siblings.
 * Every reader and writer of a row's value goes through readConfigField / writeConfigField below,
 * which is what lets a row point one level down without each consumer learning to.
 */
export type SiteLinkFieldKey = `siteLinks.${keyof SiteLinksConfig}`;

/** The operator identity block, addressed the same way: `operator.name` and its siblings. */
export type OperatorFieldKey = `operator.${keyof OperatorConfig}`;

export interface ConfigFieldDef {
  /** AimeatConfig property name (e.g. 'welcomeBonus'), or a site link as 'siteLinks.<name>'. */
  key: keyof AimeatConfig | SiteLinkFieldKey | OperatorFieldKey;
  /** Dot-path notation for admin API (e.g. 'morsel_policy.welcome_bonus') */
  dotPath: string;
  /** AIMEAT_* environment variable name */
  envVar: string;
  /** Value type for raw-string parsing */
  type: 'number' | 'boolean' | 'string' | 'float' | 'object';
  /** Validation function */
  validate: (v: unknown) => boolean;
  /** true = cannot be changed after startup */
  immutable: boolean;
  /** Human-readable description */
  description: string;
  /** Valid range hint for numbers (e.g. '0-10000') */
  range?: string;
  /**
   * Admin API display mode:
   * - undefined / 'visible': shown with actual value
   * - 'configured': shown as dotPath_configured boolean (for secrets)
   * - 'hidden': omitted entirely (internal bootstrap fields)
   */
  adminDisplay?: 'visible' | 'configured' | 'hidden';
}
