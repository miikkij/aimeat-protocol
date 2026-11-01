/**
 * @file src/services/ai/node-openrouter-key.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's own OpenRouter key as everything that pays with it or speaks about it reads
 *   it: the configured key, and none on a node set up with the own-key choice (ai.region_mode own;
 *   Jouni, 2026-11-01). There each person brings their own key and answers for it, so a shared key
 *   left in the configuration pays for nothing and the pages do not claim one. A file of its own,
 *   with no imports, because providers.ts and openrouter-region.ts both read it and import each other.
 * @structure nodeOpenRouterKey(config)
 * @usage const key = nodeOpenRouterKey(config); if (!key) return null;
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (Jouni, 2026-11-01).
 */
import type { AimeatConfig } from '../../config.js';

/** The node's OpenRouter key, trimmed; '' when there is none or the node is set up with the own-key choice. */
export function nodeOpenRouterKey(config: Pick<AimeatConfig, 'openrouterInstanceKey' | 'aiRegionMode'>): string {
  if ((config.aiRegionMode ?? '').trim() === 'own') return '';
  return (config.openrouterInstanceKey ?? '').trim();
}
