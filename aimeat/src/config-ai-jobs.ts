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
import type { AimeatConfig } from './config-types.js';

export type AiJobConfig = Pick<AimeatConfig,
  'aiJobSlots' | 'aiJobMaxQueued' | 'aiJobMaxPromptBytes' | 'aiJobMaxQueuedPerOwner' | 'aiJobMaxChain' | 'aiJobLogRetentionDays'>;

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
