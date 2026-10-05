/**
 * @file src/models/tool-input-vocabulary.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The word lists and limits a tool's input schema states, kept where both the tool
 *   catalog and the code that acts on them can import them (secaudit 2026-10, M3). The catalog
 *   imports nothing above utils/ and models/, and each of these lived in a service or a route
 *   module, so they moved here unchanged and the module they came from re-exports them.
 * @structure OWNER_REPORTS · FLAG_TARGET_TYPES · FLAG_REASONS · OVERVIEW_SECTIONS · BENEFICIARIES_MAX ·
 *   MEMORY_LIST_MAX_LIMIT · FONT_KINDS
 * @usage import { FLAG_REASONS } from '../models/tool-input-vocabulary.js';
 * @version-history
 *   v1.0.0 — 2026-10-05 — Moved from services/usage/usage-read.ts, services/moderation-flags.ts,
 *     services/appdev-overview.ts, commerce/beneficiary-split.ts, routes/memory/shared.ts and
 *     services/themes/font-registry.ts (secaudit 2026-10, M3).
 */

/** Reports an owner may ask about their OWN usage. Every cut here carries ownerGhii (services/usage/usage-read.ts). */
export const OWNER_REPORTS: Record<string, string> = {
  day: 'llm.owner',
  model: 'llm.owner.model',
  app: 'llm.owner.app',
  agent: 'llm.actor',
  tool: 'call.owner.tool',
  surface: 'call.owner.surface',
  'apps-used': 'call.owner.app',
  activity: 'call.owner',
  sold: 'call.provider.coordinate',
};

/**
 * What a moderation flag may point at, and why (services/moderation-flags.ts). `ai_provenance` takes
 * a record id because that is the identifier a reader actually holds.
 */
export const FLAG_TARGET_TYPES = ['memory', 'board_post', 'action', 'agent', 'app', 'ai_provenance'] as const;
export const FLAG_REASONS = ['unreliable', 'inappropriate', 'illegal', 'spam', 'other', 'undisclosed_ai'] as const;

/** The sections of aimeat_appdev_overview (services/appdev-overview.ts). */
export const OVERVIEW_SECTIONS = [
    'apps', 'library_packs', 'app_templates', 'skills',
    'pitfalls_curated', 'pitfalls_learned', 'template_proposals',
] as const;

/** How many beneficiary rows one split may carry, static and dynamic together (commerce/beneficiary-split.ts). */
export const BENEFICIARIES_MAX = 32;

/** The most memory entries one list returns (routes/memory/shared.ts). */
export const MEMORY_LIST_MAX_LIMIT = 1000;

/** The generic family an added font face falls back to, named as CSS names it (services/themes/font-registry.ts). */
export const FONT_KINDS = ['sans-serif', 'serif', 'monospace', 'cursive'] as const;
