/**
 * @file src/services/usage/usage-settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The usage meter's windows and batch sizes, read from the running config. The archive
 *   job, the rollup and the usage reads are called with storage only, so the config is bound here once
 *   at start (server-bootstrap/process-buffers.ts) and each run reads the current value: a value saved
 *   on the admin Config tab is used from the next run. They read process.env directly until
 *   2026-10-25, so the Config tab could neither show nor change them.
 * @structure UsageSettings · bindUsageSettings(config) · usageSettings()
 * @usage const { usageHotDays } = usageSettings();
 * @version-history
 *   2026-11-25 — mcpToolAnswerChars, the limit the rollup counts an answer against (mcp.tool_answer_chars).
 *   v1.0.0 — 2026-10-25 — Initial.
 */
import type { RuntimeConfig } from '../../config/runtime.js';
import type { NodeLimitsConfig } from '../../config/node-limits.js';
import { TOOL_ANSWER_CHARS_DEFAULT } from '../../models/answer-budget.js';

export type UsageSettings = Pick<RuntimeConfig, 'usageHotDays' | 'usageHourRollupDays' | 'usageArchiveBatch' | 'usageRollupBatch' | 'usageRollupPasses'>
  & Pick<NodeLimitsConfig, 'mcpToolAnswerChars'>;

/** The loader's defaults, for a process that never bound a config (a unit test, a CLI command). */
const DEFAULTS: UsageSettings = { usageHotDays: 90, usageHourRollupDays: 30, usageArchiveBatch: 2_000, usageRollupBatch: 5_000, usageRollupPasses: 20, mcpToolAnswerChars: TOOL_ANSWER_CHARS_DEFAULT };

let bound: UsageSettings | null = null;

/** Bind the running config. Its fields are read on each call, so a change made on the Config tab counts. */
export function bindUsageSettings(config: UsageSettings): void { bound = config; }

export function usageSettings(): UsageSettings {
  if (!bound) return DEFAULTS;
  return {
    usageHotDays: bound.usageHotDays,
    usageHourRollupDays: bound.usageHourRollupDays,
    usageArchiveBatch: Math.max(1, bound.usageArchiveBatch),
    usageRollupBatch: Math.max(1, bound.usageRollupBatch),
    usageRollupPasses: Math.max(1, bound.usageRollupPasses),
    mcpToolAnswerChars: bound.mcpToolAnswerChars,
  };
}
