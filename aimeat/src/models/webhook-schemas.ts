/**
 * @file webhook-schemas.ts
 * @description Zod validation schemas for AIMEAT webhook v1 payloads.
 *   These schemas define the vendor contract for webhook event payloads.
 *   All field names use snake_case. Breaking changes require a version bump.
 *
 * @maintenance Adding a field to an existing webhook event:
 *   1. New OPTIONAL fields are non-breaking -- add to the Zod schema, no version bump
 *   2. Update the example payload in this file's JSDoc
 *   3. Update Appendix A in the design spec
 *   4. Skill bundle SKILL.md does NOT need updating (agents ignore unknown fields)
 *   5. NEVER rename, remove, or retype an existing field -- that is a breaking change
 *      requiring version bump (see versioning rules in the design spec)
 *
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation, 7 event types (v1 locked)
 */
import { z } from 'zod';

export const WEBHOOK_VERSION = 1;

export const WEBHOOK_EVENTS = [
  'task.queued',
  'task.approved',
  'task.updated',
  'task.paused',
  'message.inbound',
  'directive.updated',
  'onboarding.step',
] as const;

export type WebhookEventType = typeof WEBHOOK_EVENTS[number];

const WebhookEnvelopeBase = z.object({
  version: z.literal(WEBHOOK_VERSION),
  event: z.enum(WEBHOOK_EVENTS),
  timestamp: z.string().datetime(),
  node_id: z.string(),
  agent_gaii: z.string(),
});

export const TaskQueuedPayload = WebhookEnvelopeBase.extend({
  event: z.literal('task.queued'),
  data: z.object({
    task_id: z.string(),
    title: z.string(),
    description: z.string().optional().default(''),
    has_todos: z.boolean(),
    todo_count: z.number().int(),
    scope_summary: z.array(z.string()).optional().default([]),
    created_at: z.string().datetime(),
  }),
});

export const TaskApprovedPayload = WebhookEnvelopeBase.extend({
  event: z.literal('task.approved'),
  data: z.object({
    task_id: z.string(),
    title: z.string(),
    status: z.literal('active'),
    todo_count: z.number().int(),
    pending_todo_count: z.number().int(),
    approved_at: z.string().datetime(),
  }),
});

export const TaskUpdatedPayload = WebhookEnvelopeBase.extend({
  event: z.literal('task.updated'),
  data: z.object({
    task_id: z.string(),
    title: z.string(),
    status: z.string(),
    changed_fields: z.array(z.enum([
      'title', 'description', 'scope', 'rules', 'todos',
      'verification', 'resources', 'status',
    ])),
    todo_count: z.number().int(),
    pending_todo_count: z.number().int(),
    updated_at: z.string().datetime(),
  }),
});

export const TaskPausedPayload = WebhookEnvelopeBase.extend({
  event: z.literal('task.paused'),
  data: z.object({
    task_id: z.string(),
    title: z.string(),
    status: z.literal('paused'),
    paused_at: z.string().datetime(),
  }),
});

export const MessageInboundPayload = WebhookEnvelopeBase.extend({
  event: z.literal('message.inbound'),
  data: z.object({
    message_id: z.string(),
    thread_id: z.string(),
    linked_task_id: z.string().nullable(),
    preview: z.string().max(200),
    has_proposed_task: z.boolean(),
    created_at: z.string().datetime(),
  }),
});

export const DirectiveUpdatedPayload = WebhookEnvelopeBase.extend({
  event: z.literal('directive.updated'),
  data: z.object({
    changed_sections: z.array(z.enum([
      'purpose', 'rules', 'memory_areas', 'resources',
    ])),
    rule_count: z.number().int(),
    memory_area_count: z.number().int(),
    resource_count: z.number().int(),
    updated_at: z.string().datetime(),
  }),
});

export const OnboardingStepPayload = WebhookEnvelopeBase.extend({
  event: z.literal('onboarding.step'),
  data: z.object({
    step_id: z.string(),
    step_order: z.number().int(),
    step_title: z.string(),
    action: z.enum(['needed', 'passed', 'failed']),
    message: z.string().optional(),
    onboarding_progress: z.number().int(),
    onboarding_total: z.number().int(),
  }),
});

export const WebhookPayloadSchema = z.discriminatedUnion('event', [
  TaskQueuedPayload,
  TaskApprovedPayload,
  TaskUpdatedPayload,
  TaskPausedPayload,
  MessageInboundPayload,
  DirectiveUpdatedPayload,
  OnboardingStepPayload,
]);

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

export function buildWebhookEnvelope(
  event: WebhookEventType,
  nodeId: string,
  agentGaii: string,
  data: Record<string, unknown>,
): WebhookPayload {
  return {
    version: WEBHOOK_VERSION,
    event,
    timestamp: new Date().toISOString(),
    node_id: nodeId,
    agent_gaii: agentGaii,
    data,
  } as WebhookPayload;
}
