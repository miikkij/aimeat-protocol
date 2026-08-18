/**
 * @file onboarding-validator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Validates onboarding steps by checking actual system state.
 *   AIMEAT does not trust the agent's word -- every step is verified against
 *   real data (capabilities reported, telemetry received, test task completed, etc.).
 * @structure
 *   - validateStep(stepId, agentGaii, storage, body?) -- validates a single step
 *   - checkAutoSteps(agentGaii, onboarding, storage) -- checks all auto-validatable steps
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 *   v1.1.0 -- 2026-05-28 -- Add validators for publish_commands and publish_config
 *                            (machine-validated by reading agents.{name}.commands and
 *                            agents.config.{name}.* memory keys).
 */

import type { Storage, AgentOnboardingRecord, AgentOnboardingStep } from '../storage/interface.js';
import type { OnboardingStepId } from '../models/agent-onboarding-schemas.js';
import { STEP_SCHEMAS } from '../models/agent-onboarding-schemas.js';
import { OffersDocSchema, type Offer } from '../models/offer-schemas.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { bufferedTelemetryCount } from './telemetry-buffer.js';

export interface StepValidationResult {
  passed: boolean;
  validationMethod: 'automatic' | 'api_call' | 'owner_confirm';
  details?: Record<string, unknown>;
  failureReason?: string;
}

export async function validateStep(
  stepId: OnboardingStepId,
  agentGaii: string,
  storage: Storage,
  body?: Record<string, unknown>,
): Promise<StepValidationResult> {
  switch (stepId) {
    case 'authenticate':
      return validateAuthenticate(agentGaii, storage);
    case 'identify_platform':
      return validateIdentifyPlatform(body);
    case 'install_skill':
      return validateInstallSkill(body);
    case 'report_capabilities':
      return validateCapabilities(agentGaii, storage);
    case 'read_directives':
      return validateReadDirectives(body);
    case 'send_test_message':
      return validateTestMessage(agentGaii, storage);
    case 'configure_delivery':
      return validateDelivery(agentGaii, storage);
    case 'report_telemetry':
      return validateTelemetry(agentGaii, storage);
    case 'accept_test_task':
      return validateAcceptTestTask(agentGaii, storage);
    case 'complete_test_task':
      return validateCompleteTestTask(agentGaii, storage);
    case 'publish_commands':
      return validatePublishCommands(agentGaii, storage);
    case 'publish_config':
      return validatePublishConfig(agentGaii, storage);
    case 'declare_services':
      return validateDeclareServices(body);
    case 'declare_offerings':
      return validateDeclareOfferings(agentGaii, storage);
    case 'make_workflow_compatible':
      return validateMakeWorkflowCompatible(agentGaii, storage);
    case 'price_offer':
      return validatePriceOffer(agentGaii, storage);
    default:
      return { passed: false, validationMethod: 'automatic', failureReason: `Unknown step: ${stepId}` };
  }
}

async function validateAuthenticate(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const agent = await storage.getAgent(agentGaii);
  return {
    passed: agent !== null,
    validationMethod: 'automatic',
    details: agent ? { createdAt: agent.createdAt } : undefined,
    failureReason: agent ? undefined : 'Agent record not found',
  };
}

function validateIdentifyPlatform(body?: Record<string, unknown>): StepValidationResult {
  if (!body) return { passed: false, validationMethod: 'api_call', failureReason: 'No platform data provided' };
  const schema = STEP_SCHEMAS.identify_platform!;
  const result = schema.safeParse(body);
  if (!result.success) {
    return { passed: false, validationMethod: 'api_call', failureReason: result.error.message };
  }
  return {
    passed: true,
    validationMethod: 'api_call',
    details: { platform: (result.data as { platform: string }).platform, platform_version: (result.data as { platform_version?: string }).platform_version },
  };
}

function validateInstallSkill(body?: Record<string, unknown>): StepValidationResult {
  if (!body) return { passed: false, validationMethod: 'api_call', failureReason: 'No install data provided' };
  const schema = STEP_SCHEMAS.install_skill!;
  const result = schema.safeParse(body);
  if (!result.success) {
    return { passed: false, validationMethod: 'api_call', failureReason: result.error.message };
  }
  return {
    passed: true,
    validationMethod: 'api_call',
    details: body,
  };
}

async function validateCapabilities(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const agent = await storage.getAgent(agentGaii);
  const hasTechnical = (agent?.technicalCapabilities?.length ?? 0) > 0;
  const hasDomain = (agent?.domainCapabilities?.length ?? 0) > 0;
  const passed = hasTechnical || hasDomain;
  return {
    passed,
    validationMethod: 'automatic',
    details: { technicalCount: agent?.technicalCapabilities?.length ?? 0, domainCount: agent?.domainCapabilities?.length ?? 0 },
    failureReason: passed ? undefined : 'No capabilities reported. Call PUT /v1/agents/me/capabilities',
  };
}

function validateReadDirectives(body?: Record<string, unknown>): StepValidationResult {
  return {
    passed: true,
    validationMethod: 'api_call',
    details: body,
  };
}

async function validateTestMessage(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const messages = await storage.listMessages(agentGaii, { direction: 'outbound', perPage: 1 });
  const passed = messages.messages.length > 0;
  return {
    passed,
    validationMethod: 'automatic',
    details: { messageCount: messages.messages.length },
    failureReason: passed ? undefined : 'No outbound message found. Send a test message via POST /v1/agents/me/messages',
  };
}

async function validateDelivery(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const agent = await storage.getAgent(agentGaii);
  const hasWebhook = !!(agent?.webhookUrl && agent.webhookEnabled);
  const lastSeenRecently = !!(agent?.lastSeen && (Date.now() - new Date(agent.lastSeen).getTime()) < 10 * 60 * 1000);
  const hasDelivery = hasWebhook || lastSeenRecently;
  const method = hasWebhook ? 'webhook' : lastSeenRecently ? 'polling' : 'none';
  return {
    passed: hasDelivery,
    validationMethod: 'automatic',
    details: { webhookUrl: agent?.webhookUrl, webhookEnabled: agent?.webhookEnabled, deliveryMethod: method },
    failureReason: hasDelivery ? undefined : 'Ensure your polling watchdog is running (agent must be seen within 10 minutes) or register a webhook via PUT /v1/agents/me/webhook.',
  };
}

async function validateTelemetry(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  // Fresh telemetry lives in the in-memory ring (raw events are no longer persisted);
  // fall back to the persisted activity series for telemetry reported in an earlier
  // process lifetime (the daily 'telemetry_events' counter survives restarts/flush).
  let count = bufferedTelemetryCount(agentGaii);
  if (count === 0) {
    const history = await storage.getActivityHistory(agentGaii, { days: 30 });
    count = history
      .filter(r => r.metric === 'telemetry_events')
      .reduce((sum, r) => sum + r.value, 0);
  }
  const passed = count > 0;
  return {
    passed,
    validationMethod: 'automatic',
    details: { eventCount: count },
    failureReason: passed ? undefined : 'No telemetry events received. Report telemetry via POST /v1/agents/me/telemetry',
  };
}

async function validateAcceptTestTask(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const onboarding = await storage.getOnboarding(agentGaii);
  const testTaskId = (onboarding?.steps.find(s => s.id === 'accept_test_task')?.details as Record<string, unknown> | undefined)?.testTaskId as string | undefined;
  if (!testTaskId) {
    return { passed: false, validationMethod: 'automatic', failureReason: 'Start onboarding first to create a test task.' };
  }
  const task = await storage.getAgentTask(testTaskId);
  if (!task) {
    return { passed: false, validationMethod: 'automatic', failureReason: 'Test task missing. Re-run Hello Integration to create a new one.' };
  }
  const hasTodos = (task.todos?.length ?? 0) > 0;
  if (hasTodos && task.status === 'queued') {
    const now = new Date().toISOString();
    await storage.updateAgentTask(testTaskId, { status: 'active', lastEventAt: now, updatedAt: now });
  }
  return {
    passed: hasTodos,
    validationMethod: 'automatic',
    details: { testTaskId, taskId: testTaskId, todoCount: task.todos?.length ?? 0, autoStarted: hasTodos && task.status === 'queued' },
    failureReason: hasTodos ? undefined : 'Propose todos on the test task via PATCH /v1/agents/me/tasks/{id}',
  };
}

async function validateCompleteTestTask(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const onboarding = await storage.getOnboarding(agentGaii);
  const testTaskId = (onboarding?.steps.find(s => s.id === 'accept_test_task')?.details as Record<string, unknown> | undefined)?.testTaskId as string | undefined;
  if (!testTaskId) {
    return { passed: false, validationMethod: 'automatic', failureReason: 'No test task created' };
  }
  const task = await storage.getAgentTask(testTaskId);
  if (!task) {
    return { passed: false, validationMethod: 'automatic', failureReason: 'Test task not found' };
  }
  const passed = task.status === 'done';
  return {
    passed,
    validationMethod: 'automatic',
    details: { taskId: testTaskId, status: task.status },
    failureReason: passed ? undefined : `Test task status is '${task.status}', expected 'done'`,
  };
}

/**
 * publish_commands passes when the agent has written a non-empty
 * `agents.{agentName}.commands` memory entry. Validates the entry exists, has
 * an array value, and at least one entry has the required `{ name, description, category }`
 * shape -- agents that just write `[]` to silence the check fail validation.
 */
async function validatePublishCommands(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const agentName = parseGaiiLoose(agentGaii).agent;
  const key = `agents.${agentName}.commands`;
  const record = await storage.getMemory(agentGaii, key);
  if (!record) {
    return {
      passed: false,
      validationMethod: 'automatic',
      details: { key, found: false },
      failureReason: `Write your owner-facing slash command catalogue to ${key} as a flat array of { name, description, category } before onboarding can complete. See SKILL.md "After Onboarding".`,
    };
  }
  const value = record.value;
  if (!Array.isArray(value) || value.length === 0) {
    return {
      passed: false,
      validationMethod: 'automatic',
      details: { key, found: true, type: typeof value, length: Array.isArray(value) ? value.length : null },
      failureReason: `${key} must be a non-empty array of { name, description, category }. Empty arrays do not count.`,
    };
  }
  const shaped = value.some(v =>
    v && typeof v === 'object' && !Array.isArray(v)
      && typeof (v as Record<string, unknown>).name === 'string'
      && typeof (v as Record<string, unknown>).description === 'string',
  );
  if (!shaped) {
    return {
      passed: false,
      validationMethod: 'automatic',
      details: { key, found: true, length: value.length, shapeOk: false },
      failureReason: `${key} entries must include name and description fields.`,
    };
  }
  return {
    passed: true,
    validationMethod: 'automatic',
    details: { key, count: value.length },
  };
}

/**
 * publish_config passes when the agent has written at least one
 * `agents.config.{agentName}.*` memory entry describing how this runtime is set up.
 */
async function validatePublishConfig(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const agentName = parseGaiiLoose(agentGaii).agent;
  const prefix = `agents.config.${agentName}.`;
  const records = await storage.listMemory(agentGaii, { prefix });
  if (records.length === 0) {
    return {
      passed: false,
      validationMethod: 'automatic',
      details: { prefix, found: 0 },
      failureReason: `Publish at least one runtime/config descriptor under ${prefix}* (e.g. ${prefix}connector) before onboarding can complete. If your setup only uses "aimeat connect serve", describe that accurately.`,
    };
  }
  return {
    passed: true,
    validationMethod: 'automatic',
    details: { prefix, count: records.length, keys: records.map(r => r.key) },
  };
}

/**
 * Reads the agent's published offers (`agents.{name}.offers`) and returns the parsed offer list, or
 * null when the document is missing/invalid. The offers ladder steps below all key off this — they
 * verify real published state, never the agent's word (the AIMEAT onboarding invariant).
 */
async function readPublishedOffers(agentGaii: string, storage: Storage): Promise<Offer[] | null> {
  const agentName = parseGaiiLoose(agentGaii).agent;
  const record = await storage.getMemory(agentGaii, `agents.${agentName}.offers`);
  if (!record) return null;
  const parsed = OffersDocSchema.safeParse(record.value);
  return parsed.success ? parsed.data.offers : null;
}

/**
 * declare_offerings (level 1, optional) — passes when the agent has published at least one offer with
 * the minimum legible shape (id + title + ask). Teaches: an agent becomes findable in the owner's
 * Offers surface by publishing agents.{name}.offers. See docs/building-an-aimeat-compatible-agent.md.
 */
async function validateDeclareOfferings(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const agentName = parseGaiiLoose(agentGaii).agent;
  const key = `agents.${agentName}.offers`;
  const offers = await readPublishedOffers(agentGaii, storage);
  const count = offers?.length ?? 0;
  return {
    passed: count > 0,
    validationMethod: 'automatic',
    details: { key, offerCount: count },
    failureReason: count > 0 ? undefined
      : `Publish at least one offer to ${key} (each with id, title, ask) so the owner can find what this agent does. Optional — see docs/building-an-aimeat-compatible-agent.md.`,
  };
}

/**
 * make_workflow_compatible (level 3, optional) — passes when at least one offer declares the producer
 * /consumer signal contract: success_signal + required_to_function (a Signal or the literal "none") +
 * deliverable.location. Only such offers can be a step in an Agent Workflow.
 */
async function validateMakeWorkflowCompatible(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const offers = await readPublishedOffers(agentGaii, storage);
  const compatible = (offers ?? []).filter(o =>
    o.success_signal !== undefined && o.required_to_function !== undefined && !!o.deliverable?.location,
  );
  return {
    passed: compatible.length > 0,
    validationMethod: 'automatic',
    details: { workflowCompatibleCount: compatible.length, ids: compatible.map(o => o.id) },
    failureReason: compatible.length > 0 ? undefined
      : 'Add success_signal + required_to_function (or "none") + deliverable.location to at least one offer so it can be a workflow step. Optional — see docs/building-an-aimeat-compatible-agent.md §4.',
  };
}

/**
 * price_offer (level 2, optional) — passes when at least one offer is sellable cross-owner: a non-null
 * price + visibility "public" + a callable binding (action_id or webhook_url). Most agents skip this.
 */
async function validatePriceOffer(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const offers = await readPublishedOffers(agentGaii, storage);
  const priced = (offers ?? []).filter(o =>
    o.price != null && o.visibility === 'public'
    && !!(o.callable && (o.callable.action_id || o.callable.webhook_url)),
  );
  return {
    passed: priced.length > 0,
    validationMethod: 'automatic',
    details: { pricedCount: priced.length, ids: priced.map(o => o.id) },
    failureReason: priced.length > 0 ? undefined
      : 'Add price + visibility:"public" + callable (action_id or webhook_url) to at least one offer to sell it to other owners. Optional — see docs/building-an-aimeat-compatible-agent.md §3.',
  };
}

function validateDeclareServices(body?: Record<string, unknown>): StepValidationResult {
  const schema = STEP_SCHEMAS.declare_services!;
  const result = schema.safeParse(body ?? { services: [] });
  if (!result.success) {
    return { passed: false, validationMethod: 'api_call', failureReason: result.error.message };
  }
  return {
    passed: true,
    validationMethod: 'api_call',
    details: body ?? { services: [] },
  };
}

export async function checkAutoSteps(
  agentGaii: string,
  onboarding: AgentOnboardingRecord,
  storage: Storage,
): Promise<AgentOnboardingStep[]> {
  const autoStepIds: OnboardingStepId[] = [
    'authenticate', 'report_capabilities', 'read_directives', 'send_test_message',
    'configure_delivery', 'report_telemetry', 'accept_test_task', 'complete_test_task',
    'publish_commands', 'publish_config',
    // Offers ladder — auto-tick the moment the agent publishes a matching offer (so just writing
    // agents.{name}.offers ticks the step; no separate confirm call needed). Optional → never blocks.
    'declare_offerings', 'make_workflow_compatible', 'price_offer',
  ];

  const updatedSteps = [...onboarding.steps];
  for (const stepId of autoStepIds) {
    const step = updatedSteps.find(s => s.id === stepId);
    if (!step || step.status !== 'pending') continue;

    const result = await validateStep(stepId, agentGaii, storage);
    if (result.passed) {
      step.status = 'passed';
      step.validatedAt = new Date().toISOString();
      step.validationMethod = result.validationMethod;
      step.details = result.details;
    }
  }
  return updatedSteps;
}
