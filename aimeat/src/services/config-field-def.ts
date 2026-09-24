/**
 * @file src/services/config-field-def.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape of one tunable config row: what src/services/config-schema.ts lists for
 *   every field. Moved out of config-schema.ts when that file reached the 800-line ceiling. It
 *   imports nothing: the key's type is a parameter, and config-schema.ts, which already reads the
 *   config types, names it (`ConfigFieldDef`), so this file adds no import cycle.
 * @structure ConfigFieldShape<K>
 * @usage import type { ConfigFieldDef } from './config-schema.js';
 * @version-history
 *   v1.0.0 — 2026-09-24 — Moved from config-schema.ts; the key's type became a parameter.
 */

export interface ConfigFieldShape<K extends string> {
  /** AimeatConfig property name (e.g. 'welcomeBonus'), or a site link as 'siteLinks.<name>'. */
  key: K;
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
