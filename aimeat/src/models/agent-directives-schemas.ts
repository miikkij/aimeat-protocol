/**
 * @file agent-directives-schemas.ts
 * @description Zod validation schemas for agent directives CRUD
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */
import { z } from 'zod';

export const AgentDirectivesSchema = z.object({
  purpose: z.string().max(1024).optional().default(''),
  rules: z.array(z.object({
    id: z.string(),
    description: z.string(),
    details: z.string().optional(),
  })).optional().default([]),
  memory_areas: z.array(z.object({
    key_prefix: z.string(),
    description: z.string(),
    schema: z.record(z.string(), z.unknown()).optional(),
    csm_id: z.string().optional(),
  })).optional().default([]),
  resources: z.array(z.object({
    type: z.enum(['knowledge_package', 'memory_key']),
    reference: z.string(),
    description: z.string(),
  })).optional().default([]),
});

export const OwnerAgentDefaultsSchema = z.object({
  rules: z.array(z.object({
    id: z.string(),
    description: z.string(),
    details: z.string().optional(),
  })).optional().default([]),
  default_token_budget: z.number().optional(),
  default_memory_areas: z.array(z.object({
    key_prefix: z.string(),
    description: z.string(),
    schema: z.record(z.string(), z.unknown()).optional(),
    csm_id: z.string().optional(),
  })).optional().default([]),
});
