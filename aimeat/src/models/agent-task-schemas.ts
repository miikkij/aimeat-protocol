/**
 * @file agent-task-schemas.ts
 * @description Zod validation schemas for agent task CRUD and lifecycle operations
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */
import { z } from 'zod';

export const AgentTaskCreateSchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().max(4096).optional().default(''),
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
    status: z.enum(['pending', 'active', 'done', 'failed', 'skipped']).optional().default('pending'),
  })).optional().default([]),
  status: z.enum(['draft', 'queued']).optional().default('draft'),
  parent_task_id: z.string().optional(),
});

export const AgentTaskUpdateSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  description: z.string().max(4096).optional(),
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
    status: z.enum(['pending', 'active', 'done', 'failed', 'skipped']).optional().default('pending'),
    completed_at: z.string().optional(),
  })).optional(),
});

export const AgentTaskEventSchema = z.object({
  type: z.enum(['started', 'progress', 'todo_completed', 'todo_failed',
    'memory_write', 'extension_install', 'app_publish',
    'verification', 'completed', 'failed', 'message']),
  message: z.string().min(1).max(4096),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const AgentTaskTodoUpdateSchema = z.object({
  status: z.enum(['pending', 'active', 'done', 'failed', 'skipped']),
  completed_at: z.string().optional(),
});
