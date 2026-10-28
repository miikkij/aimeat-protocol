/**
 * @file agent-directives-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Zod validation schemas for agent directives CRUD
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 *   v1.1.0 -- 2026-10-27 -- Every string field has a length limit from models/input-limits.ts (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from './input-limits.js';

export const BudgetLimitsSchema = z.object({
  max_tokens_per_task: z.number().int().positive().optional(),
  max_tokens_per_day: z.number().int().positive().optional(),
  max_tasks_per_day: z.number().int().positive().optional(),
  alert_threshold: z.number().int().min(1).max(100).optional(),
}).optional();

export const AgentDirectivesSchema = z.object({
  purpose: z.string().max(1024).optional().default(''),
  rules: z.array(z.object({
    id: z.string().max(INPUT_LIMITS.id),
    description: z.string().max(INPUT_LIMITS.description),
    details: z.string().max(INPUT_LIMITS.text).optional(),
  })).optional().default([]),
  memory_areas: z.array(z.object({
    key_prefix: z.string().max(INPUT_LIMITS.key),
    description: z.string().max(INPUT_LIMITS.description),
    schema: z.record(z.string(), z.unknown()).optional(),
    csm_id: z.string().max(INPUT_LIMITS.id).optional(),
  })).optional().default([]),
  resources: z.array(z.object({
    type: z.enum(['knowledge_package', 'memory_key']),
    reference: z.string().max(INPUT_LIMITS.key),
    description: z.string().max(INPUT_LIMITS.description),
  })).optional().default([]),
  budget_limits: BudgetLimitsSchema,
});

export const OwnerAgentDefaultsSchema = z.object({
  rules: z.array(z.object({
    id: z.string().max(INPUT_LIMITS.id),
    description: z.string().max(INPUT_LIMITS.description),
    details: z.string().max(INPUT_LIMITS.text).optional(),
  })).optional().default([]),
  default_token_budget: z.number().optional(),
  default_memory_areas: z.array(z.object({
    key_prefix: z.string().max(INPUT_LIMITS.key),
    description: z.string().max(INPUT_LIMITS.description),
    schema: z.record(z.string(), z.unknown()).optional(),
    csm_id: z.string().max(INPUT_LIMITS.id).optional(),
  })).optional().default([]),
});
