/**
 * @file src/config-ai-jobs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The six AI job settings, extracted from config.ts by pure move when that file
 *   reached the 800-line limit on the day feat/ai-jobs was merged. Values verbatim.
 *
 *   An AI job is a model call with a handle: it queues for a slot, runs on the owner's key and
 *   writes its answer to a memory key. These numbers bound the queue, not the spend: the daily
 *   budget and the per-app quota already are the money, which is why there is deliberately no
 *   per-owner or per-app CONCURRENCY cap here. What each number protects is written beside its
 *   type in config-types-ai.ts.
 * @structure aiJobDefaults() — the six fields, read from the environment with their defaults
 * @usage
 *   import { aiJobDefaults } from './config-ai-jobs.js';
 *   const config = { ...aiJobDefaults(), ... };
 * @version-history
 *   v1.0.0 — 2026-09-05 — Extracted from config.ts (max-file-lines). A pure move.
 */
/**
 * The six fields, named here rather than picked from AimeatConfig: config-types.ts reaches
 * config.ts through the sealing and schema modules, so a type import from it would close a cycle
 * the dependency cruiser refuses. AimeatConfig declares the same six (config-types-ai.ts), and the
 * spread in loadConfig is where the compiler checks they agree.
 */
export interface AiJobConfig {
  aiJobSlots: number;
  aiJobMaxQueued: number;
  aiJobMaxPromptBytes: number;
  aiJobMaxQueuedPerOwner: number;
  aiJobMaxChain: number;
  aiJobLogRetentionDays: number;
}

/** The AI job settings, from the environment. See config-types-ai.ts for what each one protects. */
export function aiJobDefaults(): AiJobConfig {
  return {
    aiJobSlots: parseInt(process.env.AIMEAT_AI_JOB_SLOTS ?? '80', 10),
    aiJobMaxQueued: parseInt(process.env.AIMEAT_AI_JOB_MAX_QUEUED ?? '1000', 10),
    aiJobMaxPromptBytes: parseInt(process.env.AIMEAT_AI_JOB_MAX_PROMPT_BYTES ?? '2097152', 10),
    aiJobMaxQueuedPerOwner: parseInt(process.env.AIMEAT_AI_JOB_MAX_QUEUED_PER_OWNER ?? '200', 10),
    aiJobMaxChain: parseInt(process.env.AIMEAT_AI_JOB_MAX_CHAIN ?? '8', 10),
    aiJobLogRetentionDays: parseInt(process.env.AIMEAT_AI_JOB_LOG_RETENTION_DAYS ?? '30', 10),
  };
}
