/**
 * @file agent-task-schemas.ts
 * @description Zod validation schemas for agent task CRUD and lifecycle operations
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 *   v1.1.0 -- 2026-05-29 -- Add 'revision_requested' task status, 'outdated' todo status, and 'revision_requested' event type for the owner-requests-changes-to-proposed-todos flow.
 *   v1.2.0 -- 2026-05-30 -- Raise task description max length 4096 -> 10000 chars (create + update). The agent crew reads task.description as its primary prompt, so this is the field that needs room.
 */
import { z } from 'zod';

const TodoStatusSchema = z.enum(['pending', 'active', 'done', 'failed', 'skipped', 'outdated']);

export const AgentTaskCreateSchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().max(10000).optional().default(''),
  scope: z.array(z.object({
    name: z.string(),
    value: z.string(),
    type: z.enum(['text', 'url', 'memory_key', 'number', 'cron']),
    description: z.string().optional(),
  })).optional().default([]),
  rules: z.array(z.string()).optional().default([]),
  verification: z.object({
    user_expects: z.string(),
    technical_checks: z.array(z.string()),
  }).optional().default({ user_expects: '', technical_checks: [] }),
  resources: z.object({
    knowledge_packages: z.array(z.string()).optional(),
    memory_keys: z.array(z.string()).optional(),
    memory_prefixes: z.array(z.string()).optional(),
  }).optional(),
  todos: z.array(z.object({
    id: z.string(),
    order: z.number(),
    title: z.string(),
    description: z.string().optional().default(''),
    environment: z.enum(['aimeat', 'agent']),
    environment_reason: z.string().optional(),
    verification: z.string().optional().default(''),
    estimate_minutes: z.number().optional(),
    status: TodoStatusSchema.optional().default('pending'),
  })).optional().default([]),
  status: z.enum(['draft', 'queued']).optional().default('draft'),
  parent_task_id: z.string().optional(),
});

export const AgentTaskUpdateSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  description: z.string().max(10000).optional(),
  scope: z.array(z.object({
    name: z.string(),
    value: z.string(),
    type: z.enum(['text', 'url', 'memory_key', 'number', 'cron']),
    description: z.string().optional(),
  })).optional(),
  rules: z.array(z.string()).optional(),
  verification: z.object({
    user_expects: z.string(),
    technical_checks: z.array(z.string()),
  }).optional(),
  resources: z.object({
    knowledge_packages: z.array(z.string()).optional(),
    memory_keys: z.array(z.string()).optional(),
    memory_prefixes: z.array(z.string()).optional(),
  }).optional(),
  todos: z.array(z.object({
    id: z.string(),
    order: z.number(),
    title: z.string(),
    description: z.string().optional().default(''),
    environment: z.enum(['aimeat', 'agent']),
    environment_reason: z.string().optional(),
    verification: z.string().optional().default(''),
    estimate_minutes: z.number().optional(),
    status: TodoStatusSchema.optional().default('pending'),
    completed_at: z.string().optional(),
  })).optional(),
});

export const AgentTaskEventSchema = z.object({
  type: z.enum(['started', 'progress', 'todo_completed', 'todo_failed',
    'memory_write', 'extension_install', 'app_publish',
    'verification', 'completed', 'failed', 'message',
    'revision_requested']),
  message: z.string().min(1).max(4096),
  details: z.record(z.string(), z.unknown()).optional(),
});

// POST /v1/agents/:name/tasks/:id/rate -- peer/owner review of a completed
// task's deliverable. The `context` enum is the quality "dimension"
// (factual/creative/...). For the factual family
// (factual/research/code/summarization) an agent rating must set
// source_grounded=true; the endpoint hard-gates ungrounded agent ratings there
// so stars measure faithfulness, not showiness. Human-owner ratings are exempt.
export const RatingContextSchema = z.enum([
  'factual', 'creative', 'code', 'planning',
  'summarization', 'research', 'communication', 'other',
]);

export const AgentTaskRateSchema = z.object({
  stars: z.number().int().min(1).max(5),
  context: RatingContextSchema,
  comment: z.string().max(2048).optional(),
  source_grounded: z.boolean().optional().default(false),
  unsupported: z.number().int().min(0).optional(),
  evaluated_model: z.string().max(128).optional(),
  // Free-form eval context (temperature, top_p, max_tokens, tokens, cost, ...).
  // Stored on the rating for later slicing; size-capped in the route handler.
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// PATCH /v1/agents/:name/tasks/:id/triage -- owner moves a task between the
// Tasks-tab buckets. 'kept' -> Keep, 'archived' -> Archive, null -> back to the
// default (Recent / auto-archive).
export const AgentTaskTriageSchema = z.object({
  triage: z.enum(['kept', 'archived']).nullable(),
});

export const AgentTaskTodoUpdateSchema = z.object({
  status: TodoStatusSchema,
  completed_at: z.string().optional(),
});

// POST /v1/agents/:name/tasks/:id/request-changes -- owner sends a free-text
// change request about a proposed todo list. The endpoint marks the existing
// todos 'outdated', flips the task to 'revision_requested', appends a
// matching task event, and pushes the message to the agent so it can revise.
export const AgentTaskRequestChangesSchema = z.object({
  message: z.string().min(1).max(4096),
});
