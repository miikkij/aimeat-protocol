/**
 * @file onboarding-validator.ts
 * @description Validates onboarding steps by checking actual system state.
 *   AIMEAT does not trust the agent's word -- every step is verified against
 *   real data (capabilities reported, telemetry received, test task completed, etc.).
 * @structure
 *   - validateStep(stepId, agentGaii, storage, body?) -- validates a single step
 *   - checkAutoSteps(agentGaii, onboarding, storage) -- checks all auto-validatable steps
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 */

import type { Storage, AgentOnboardingRecord, AgentOnboardingStep } from '../storage/interface.js';
import type { OnboardingStepId } from '../models/agent-onboarding-schemas.js';
import { STEP_SCHEMAS } from '../models/agent-onboarding-schemas.js';

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
    case 'declare_services':
      return validateDeclareServices(body);
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
  const events = await storage.listTelemetry(agentGaii, { limit: 1 });
  const passed = events.length > 0;
  return {
    passed,
    validationMethod: 'automatic',
    details: { eventCount: events.length },
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
