/**
 * @file agent-message-schemas.ts
 * @description Zod validation schemas for agent message creation and status updates
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 */

import { z } from 'zod';

export const AgentMessageCreateSchema = z.object({
  content: z.string().min(1).max(10000),
  direction: z.enum(['inbound', 'outbound']),
  thread_id: z.string().uuid().optional(),
  linked_task_id: z.string().uuid().optional(),
  metadata: z.object({
    tokens_used: z.number().optional(),
    processing_ms: z.number().optional(),
    proposed_task: z.object({
      title: z.string().min(1).max(256),
      description: z.string().max(5000),
    }).optional(),
  }).optional(),
});

export const AgentMessageStatusSchema = z.object({
  status: z.enum(['processing', 'delivered', 'error']),
});
