/**
 * @file src/services/config-schema-visibility.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config rows for visibility and visitors (config-visibility.ts): one switch per
 *   layer, so which tier carries which layer can be decided without touching the code. Its own file
 *   because config-schema.ts is near the line ceiling; spread into the schema where the other
 *   visitor settings stand.
 * @structure VISIBILITY_CONFIG_FIELDS
 * @usage import { VISIBILITY_CONFIG_FIELDS } from './config-schema-visibility.js';
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial: visibility.ai (layer A).
 */
import type { VisibilityConfig } from '../config-visibility.js';
import type { ConfigFieldShape } from './config-field-def.js';

export const VISIBILITY_CONFIG_FIELDS: ConfigFieldShape<keyof VisibilityConfig>[] = [
  { key: 'aiVisibilityEnabled', dotPath: 'visibility.ai', envVar: 'AIMEAT_AI_VISIBILITY', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Count, for every owner, where the people who open their pages and apps came from (an AI answer, search, social, another site), which AIs fetched what, who read the discovery files, and which purchases followed. Counts only: no address, cookie or visitor id, so no consent banner is needed. Each owner can switch it off for their own place; off here is off for everybody' },
];
