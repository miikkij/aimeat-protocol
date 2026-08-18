/**
 * @file src/services/prompt-defaults/notebook-builders.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extracted from prompt-defaults.ts (max-file-lines). Builders group — notebook placement classifier/planner/distributor + living-document author.
 * @structure Exports a PromptSeedEntry[] slice of PROMPT_SEEDS, verbatim (same names/values/order).
 * @usage Imported and spread by prompt-defaults.ts into PROMPT_SEEDS.
 * @version-history v1.0.0 — 2026-07-13 — Extracted from prompt-defaults.ts
 */

import type { PromptSeedEntry } from '../prompt-defaults.js';
import { NOTEBOOK_CLASSIFY_TEMPLATE } from '../notebook-classify-prompt.js';
import { NOTEBOOK_PLAN_TEMPLATE } from '../notebook-plan-prompt.js';
import { NOTEBOOK_DISTRIBUTE_TEMPLATE } from '../notebook-distribute-prompt.js';
import { LIVING_AUTHOR_TEMPLATE } from '../living-author-prompt.js';

export const NOTEBOOK_BUILDER_SEEDS: PromptSeedEntry[] = [
  // ═══════════════════════════════════════════════════════════════════
  // Group: builders — notebook placement classifier (code-owned, re-synced from seed)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 'notebook-classify',
    group: 'builders',
    name: 'Notebook Placement Classifier',
    description: 'Files a free-text notebook note into the right organism → workspace → document space and drafts a clean document. Used by POST /v1/librarian/classify.',
    content: NOTEBOOK_CLASSIFY_TEMPLATE,
    variables: ['structure', 'note'],
    usedIn: ['/v1/librarian/classify'],
  },
  {
    id: 'notebook-plan',
    group: 'builders',
    name: 'Notebook Enrichment Planner',
    description: 'Reasons over a free-text notebook note and proposes an ordered plan of enrichment steps (reason / assess own material) to expand it before filing. Used by POST /v1/librarian/plan.',
    content: NOTEBOOK_PLAN_TEMPLATE,
    variables: ['structure', 'note'],
    usedIn: ['/v1/librarian/plan'],
  },
  {
    id: 'notebook-distribute',
    group: 'builders',
    name: 'Notebook Distributor',
    description: 'Splits a (typically enriched) notebook note into self-contained chunks and files each into its own best organism → workspace → document space. Used by POST /v1/librarian/distribute.',
    content: NOTEBOOK_DISTRIBUTE_TEMPLATE,
    variables: ['structure', 'note'],
    usedIn: ['/v1/librarian/distribute'],
  },
  {
    id: 'living-author',
    group: 'builders',
    name: 'Living Document Author',
    description: 'Designs a reusable living-document template (title + charter + sections, with suggested agents) from a user\'s plain-language need. Used by POST /v1/living/author.',
    content: LIVING_AUTHOR_TEMPLATE,
    variables: ['need', 'capabilities'],
    usedIn: ['/v1/living/author'],
  },
];
