/**
 * @file prompt-defaults.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Hardcoded prompt templates seeded into the prompt management layer.
 * @structure Defines default handbook/system prompt entries and variable placeholders.
 * @usage Imported by prompt routes/services to seed and serve agent-facing guidance.
 * @version-history v1.1.0 -- 2026-05-28 -- Clarify Hello Integration is required AIMEAT onboarding.
 * @version-history v1.1.1 -- 2026-05-28 -- Keep legacy boot sequence wording while using startup checklist guidance.
 * @version-history v1.1.2 -- 2026-05-28 -- Clarify post-onboarding setup uses actual commands, config, and knowledge artifacts.
 * @version-history v1.1.3 -- 2026-05-28 -- Add shared owner-memory tag guidance.
 * @version-history v1.1.4 -- 2026-07-02 -- tier-1-appdev SDK list: add aimeat-markdown (render INTO an
 *   element / renderToString / renderRich), aimeat-organism and aimeat-editor.
 *
 * Variable reference:
 *   {{node_url}}           -- config.baseUrl or req.protocol://req.get('host')
 *   {{node_id}}            -- config.nodeId
 *   {{node_name}}          -- config.nodeName
 *   {{owner_name}}         -- req.auth.owner or ownerName
 *   {{gaii}}               -- req.auth.sub or agent GAII
 *   {{anon_gaii}}          -- shared#anonymous@nodeId
 *   {{anon_chat_id}}       -- anon-{timestamp}#anonymous@nodeId
 *   {{agent_count}}        -- agents.length
 *   {{action_count}}       -- actions.length
 *   {{trust_score}}        -- agent.trustScore
 *   {{morsel_balance}}     -- agent.morselBalance
 *   {{daily_allowance}}    -- config.dailyAllowance
 *   {{agent_name}}         -- parsed agent name from GAII (for URL construction)
 *   {{cortex_extensions}}  -- formatted cortex extension descriptions
 *   {{available_endpoints}} -- formatted endpoint list
 */

export interface PromptSeedEntry {
  id: string;
  group: string;
  name: string;
  description: string;
  content: string;
  variables: string[];
  usedIn: string[];
  /**
   * Optional factory translations, keyed by language tag ('fi'). Seeded ONCE, on first insert —
   * after that the operator owns them and the seeder never touches them again (same rule the
   * content already follows). A prompt with no entry here simply serves `content` everywhere,
   * which is what every prompt did before this field existed.
   */
  locales?: Record<string, string>;
}

// Seed groups are extracted into ./prompt-defaults/* to keep this file within max-file-lines.
import { NOTEBOOK_BUILDER_SEEDS } from './prompt-defaults/notebook-builders.js';
import { TIER_CORE_SEEDS } from './prompt-defaults/tiers-core.js';
import { TIER_EXTENDED_SEEDS } from './prompt-defaults/tiers-extended.js';
import { TIER_MODE_SEEDS } from './prompt-defaults/tiers-modes.js';
import { APP_BUILDER_SEEDS } from './prompt-defaults/app-builders.js';
import { PORTAL_SEEDS } from './prompt-defaults/portal.js';
import { KNOWLEDGE_SEEDS } from './prompt-defaults/knowledge.js';
import { PLATFORM_SEEDS } from './prompt-defaults/platform.js';
import { MANIFEST_ARCHITECT_SEEDS } from './prompt-defaults/manifest-architect.js';
import { PLAYBOOK_SEEDS } from './prompt-defaults/playbooks.js';

export const PROMPT_SEEDS: PromptSeedEntry[] = [
  ...NOTEBOOK_BUILDER_SEEDS,
  ...TIER_CORE_SEEDS,
  ...TIER_EXTENDED_SEEDS,
  ...TIER_MODE_SEEDS,
  ...APP_BUILDER_SEEDS,
  ...PORTAL_SEEDS,
  ...KNOWLEDGE_SEEDS,
  ...PLATFORM_SEEDS,
  ...MANIFEST_ARCHITECT_SEEDS,
  ...PLAYBOOK_SEEDS,
];
