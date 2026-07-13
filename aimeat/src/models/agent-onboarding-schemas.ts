/**
 * @file agent-onboarding-schemas.ts
 * @description Onboarding step definitions and Zod validation schemas for
 *   Hello Integration step confirmation payloads.
 * @structure
 *   - ONBOARDING_STEPS -- constant array defining all onboarding steps
 *   - Step-specific confirmation schemas (IdentifyPlatformSchema, etc.)
 *   - createDefaultSteps() -- factory for fresh onboarding step list
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 *   v1.1.0 -- 2026-05-28 -- Add publish_commands + publish_config as required
 *                            post-onboarding steps (machine-validated by reading
 *                            agents.{name}.commands and agents.config.{name}.*
 *                            memory). Closes the gap where agents skipped the
 *                            "After Onboarding" SKILL.md section.
 *   v1.2.0 -- 2026-05-29 -- Mode-aware step lists: task-runner agents get a
 *                            reduced 5-step flow (auth + platform + skill +
 *                            capabilities + config) -- they have no interactive
 *                            command surface, never send messages, and don't run
 *                            test tasks. Other modes keep the full 13-step list.
 *   v1.3.0 -- 2026-06-09 -- Add 'workstation' mode: a node-visiting agent that
 *                            lives in the user's own environment (VSCode, Claude
 *                            Desktop) and uses MCP directly. It is not node-resident
 *                            -- no runtime config, slash commands, telemetry, or
 *                            task queue -- so it gets the narrowest 4-step flow
 *                            (auth + platform + capabilities + directives).
 *   v1.4.0 -- 2026-06-30 -- Add StepHowTo + STEP_HOWTO + getStepHowTo: the authoritative
 *                            machine-readable stepId -> {tool, args} map a connector drives
 *                            from (instead of fabricating aimeat_onboarding_<stepId>). Frozen
 *                            and pinned by the contract-freeze test.
 */

import { z } from 'zod';
import type { AgentOnboardingStep } from '../storage/interface.js';

export const ONBOARDING_STEP_IDS = [
  'authenticate',
  'identify_platform',
  'install_skill',
  'report_capabilities',
  'read_directives',
  'send_test_message',
  'configure_delivery',
  'report_telemetry',
  'accept_test_task',
  'complete_test_task',
  'publish_commands',
  'publish_config',
  'declare_services',
  'declare_offerings',
  'make_workflow_compatible',
  'price_offer',
] as const;

export type OnboardingStepId = typeof ONBOARDING_STEP_IDS[number];

interface StepDefinition {
  id: OnboardingStepId;
  order: number;
  title: string;
  description: string;
  required: boolean;
  validationMethod: 'automatic' | 'api_call' | 'owner_confirm';
}

// Step descriptions are i18n-ized: locales/{lang}.json -> agentOnboarding.stepDescriptions.{id}
// English fallbacks here match the en.json values for API responses.
const STEP_DESCRIPTIONS: Record<string, string> = {
  authenticate: 'agentOnboarding.stepDescriptions.authenticate',
  identify_platform: 'agentOnboarding.stepDescriptions.identify_platform',
  install_skill: 'agentOnboarding.stepDescriptions.install_skill',
  report_capabilities: 'agentOnboarding.stepDescriptions.report_capabilities',
  read_directives: 'agentOnboarding.stepDescriptions.read_directives',
  send_test_message: 'agentOnboarding.stepDescriptions.send_test_message',
  configure_delivery: 'agentOnboarding.stepDescriptions.configure_delivery',
  report_telemetry: 'agentOnboarding.stepDescriptions.report_telemetry',
  accept_test_task: 'agentOnboarding.stepDescriptions.accept_test_task',
  complete_test_task: 'agentOnboarding.stepDescriptions.complete_test_task',
  publish_commands: 'agentOnboarding.stepDescriptions.publish_commands',
  publish_config: 'agentOnboarding.stepDescriptions.publish_config',
  declare_services: 'agentOnboarding.stepDescriptions.declare_services',
  declare_offerings: 'agentOnboarding.stepDescriptions.declare_offerings',
  make_workflow_compatible: 'agentOnboarding.stepDescriptions.make_workflow_compatible',
  price_offer: 'agentOnboarding.stepDescriptions.price_offer',
};

const STEP_DEFINITIONS: StepDefinition[] = [
  { id: 'authenticate', order: 1, title: 'Authenticate', description: STEP_DESCRIPTIONS.authenticate, required: true, validationMethod: 'automatic' },
  { id: 'identify_platform', order: 2, title: 'Identify Platform', description: STEP_DESCRIPTIONS.identify_platform, required: true, validationMethod: 'api_call' },
  { id: 'install_skill', order: 3, title: 'Install Skill Bundle', description: STEP_DESCRIPTIONS.install_skill, required: true, validationMethod: 'api_call' },
  { id: 'report_capabilities', order: 4, title: 'Report Capabilities', description: STEP_DESCRIPTIONS.report_capabilities, required: true, validationMethod: 'automatic' },
  { id: 'read_directives', order: 5, title: 'Read Directives', description: STEP_DESCRIPTIONS.read_directives, required: true, validationMethod: 'api_call' },
  { id: 'send_test_message', order: 6, title: 'Send Test Message', description: STEP_DESCRIPTIONS.send_test_message, required: true, validationMethod: 'automatic' },
  { id: 'configure_delivery', order: 7, title: 'Configure Delivery', description: STEP_DESCRIPTIONS.configure_delivery, required: true, validationMethod: 'automatic' },
  { id: 'report_telemetry', order: 8, title: 'Report Telemetry', description: STEP_DESCRIPTIONS.report_telemetry, required: true, validationMethod: 'automatic' },
  { id: 'accept_test_task', order: 9, title: 'Accept Test Task', description: STEP_DESCRIPTIONS.accept_test_task, required: true, validationMethod: 'automatic' },
  { id: 'complete_test_task', order: 10, title: 'Complete Test Task', description: STEP_DESCRIPTIONS.complete_test_task, required: true, validationMethod: 'automatic' },
  { id: 'publish_commands', order: 11, title: 'Publish Slash Commands', description: STEP_DESCRIPTIONS.publish_commands, required: true, validationMethod: 'automatic' },
  { id: 'publish_config', order: 12, title: 'Publish Runtime Config', description: STEP_DESCRIPTIONS.publish_config, required: true, validationMethod: 'automatic' },
  { id: 'declare_services', order: 13, title: 'Declare Services', description: STEP_DESCRIPTIONS.declare_services, required: false, validationMethod: 'api_call' },
  // ── Offers ladder (all optional, all auto-validated by reading agents.{name}.offers; each teaches
  //    one level from docs/building-an-aimeat-compatible-agent.md). An agent that publishes no offers
  //    leaves these pending → marked 'skipped' at completion; they never block readiness. ──
  { id: 'declare_offerings', order: 14, title: 'Declare Offerings', description: STEP_DESCRIPTIONS.declare_offerings, required: false, validationMethod: 'automatic' },
  { id: 'make_workflow_compatible', order: 15, title: 'Make an Offer Workflow-Compatible', description: STEP_DESCRIPTIONS.make_workflow_compatible, required: false, validationMethod: 'automatic' },
  { id: 'price_offer', order: 16, title: 'Price an Offer', description: STEP_DESCRIPTIONS.price_offer, required: false, validationMethod: 'automatic' },
];

export type StepActor = 'agent' | 'server';

/**
 * Machine-readable "how to complete this step" descriptor. This is THE authoritative
 * stepId -> {tool, args} contract a connector drives from, instead of fabricating a
 * non-existent `aimeat_onboarding_<stepId>` tool. Surfaced per-step (as `howTo`) and as a
 * top-level `step_guide` in both the REST GET /onboarding and MCP aimeat_onboarding_status
 * payloads via services/onboarding-guide.ts.
 */
export interface StepHowTo {
  /** Who performs the action: the agent calls a tool, or the server validates passively. */
  actor: StepActor;
  /** true when the server auto-ticks this step by reading real state (checkAutoSteps or /start),
   *  with no dedicated confirm call. false for the four api_call confirm steps. */
  automatic: boolean;
  /** Mirrors StepDefinition.required: true when this step gates onboarding completion. */
  gatesCompletion: boolean;
  validationMethod: 'automatic' | 'api_call' | 'owner_confirm';
  /** Exact MCP tool the agent calls to complete this step, or null for passive/server steps.
   *  There is NO aimeat_onboarding_<stepId> tool beyond the five named here -- for every other
   *  step the agent calls the real tool below, NEVER a fabricated onboarding-prefixed name. */
  tool: string | null;
  /** Local-connector convenience that maps to the same effect (e.g. the offers ladder can be
   *  published with aimeat_offers_publish instead of a raw aimeat_memory_write). */
  toolAlias?: string;
  /** Underlying REST route for non-MCP clients; null for passive steps. */
  restEndpoint: { method: 'GET' | 'POST' | 'PUT' | 'PATCH'; path: string } | null;
  /** Copyable argument template. `{name}` and `{test_task_id}` are both substituted server-side at
   *  emit time ({test_task_id} from the accept_test_task step's details.testTaskId; also mirrored in
   *  hints.test_task_id). The placeholder only survives when no test task exists yet. */
  args?: Record<string, unknown>;
  /** For tool === null steps: the condition under which the server auto-passes the step. */
  passiveNote?: string;
}

/**
 * The frozen stepId -> howTo table. `gatesCompletion` and `validationMethod` MUST stay in
 * lockstep with STEP_DEFINITIONS (asserted by the contract-freeze test in
 * test/e2e-agent-onboarding.ts). Renaming any tool/step id is a contract break -- the same
 * test pins the 16 step ids and the 5 aimeat_onboarding_* tool names.
 */
export const STEP_HOWTO: Readonly<Record<OnboardingStepId, StepHowTo>> = Object.freeze({
  authenticate: {
    actor: 'server', automatic: true, gatesCompletion: true, validationMethod: 'automatic',
    tool: null, restEndpoint: null,
    passiveNote: 'Auto-passed when the agent record exists; granted at POST /v1/agents/{name}/onboarding/start.',
  },
  identify_platform: {
    actor: 'agent', automatic: false, gatesCompletion: true, validationMethod: 'api_call',
    tool: 'aimeat_onboarding_identify_platform',
    restEndpoint: { method: 'POST', path: '/v1/agents/{name}/onboarding/step/identify_platform' },
    args: { platform: 'claude', platform_version: '' },
  },
  install_skill: {
    actor: 'agent', automatic: false, gatesCompletion: true, validationMethod: 'api_call',
    tool: 'aimeat_onboarding_confirm_skill_installed',
    restEndpoint: { method: 'POST', path: '/v1/agents/{name}/onboarding/step/install_skill' },
    args: { platform: 'generic', version: 'local' },
  },
  report_capabilities: {
    actor: 'agent', automatic: true, gatesCompletion: true, validationMethod: 'automatic',
    tool: 'aimeat_agent_capabilities_report',
    restEndpoint: { method: 'PUT', path: '/v1/agents/me/capabilities' },
    args: { technical: [{ name: 'web-research', type: 'skill' }], domain: ['news'] },
  },
  read_directives: {
    actor: 'agent', automatic: false, gatesCompletion: true, validationMethod: 'api_call',
    tool: 'aimeat_onboarding_confirm_directives_read',
    restEndpoint: { method: 'POST', path: '/v1/agents/{name}/onboarding/step/read_directives' },
    args: { confirmed: true },
  },
  send_test_message: {
    actor: 'agent', automatic: true, gatesCompletion: true, validationMethod: 'automatic',
    tool: 'aimeat_message_send',
    restEndpoint: { method: 'POST', path: '/v1/agents/me/messages' },
    args: { content: 'Hello Integration test message from {name}.' },
  },
  configure_delivery: {
    actor: 'server', automatic: true, gatesCompletion: true, validationMethod: 'automatic',
    tool: null, restEndpoint: null,
    passiveNote: 'Auto-passes when a webhook is registered OR the agent was seen within 10 minutes (polling). Keep your watchdog running, or PUT /v1/agents/me/webhook.',
  },
  report_telemetry: {
    actor: 'agent', automatic: true, gatesCompletion: true, validationMethod: 'automatic',
    tool: 'aimeat_agent_telemetry_report',
    restEndpoint: { method: 'POST', path: '/v1/agents/me/telemetry' },
    args: { type: 'agent_report', data: { status: 'healthy' } },
  },
  accept_test_task: {
    actor: 'agent', automatic: true, gatesCompletion: true, validationMethod: 'automatic',
    tool: 'aimeat_task_propose_todos',
    restEndpoint: { method: 'PATCH', path: '/v1/agents/me/tasks/{test_task_id}' },
    args: { task_id: '{test_task_id}', todos: [{ title: 'Complete the onboarding test task', verification: 'Task status becomes done' }] },
  },
  complete_test_task: {
    actor: 'agent', automatic: true, gatesCompletion: true, validationMethod: 'automatic',
    tool: 'aimeat_task_complete',
    restEndpoint: { method: 'POST', path: '/v1/agents/me/tasks/{test_task_id}/complete' },
    args: { task_id: '{test_task_id}', message: 'Onboarding test task complete' },
  },
  publish_commands: {
    actor: 'agent', automatic: true, gatesCompletion: true, validationMethod: 'automatic',
    tool: 'aimeat_memory_write',
    restEndpoint: { method: 'POST', path: '/v1/memory' },
    args: { key: 'agents.{name}.commands', value: [{ name: '/status', description: 'Report current status', category: 'meta' }] },
  },
  publish_config: {
    actor: 'agent', automatic: true, gatesCompletion: true, validationMethod: 'automatic',
    tool: 'aimeat_memory_write',
    restEndpoint: { method: 'POST', path: '/v1/memory' },
    args: { key: 'agents.config.{name}.connector', value: { runtime: 'crewai', delivery: 'polling' } },
  },
  declare_services: {
    actor: 'agent', automatic: false, gatesCompletion: false, validationMethod: 'api_call',
    tool: 'aimeat_onboarding_declare_services',
    restEndpoint: { method: 'POST', path: '/v1/agents/{name}/onboarding/step/declare_services' },
    args: { services: [] },
  },
  declare_offerings: {
    actor: 'agent', automatic: true, gatesCompletion: false, validationMethod: 'automatic',
    tool: 'aimeat_memory_write', toolAlias: 'aimeat_offers_publish',
    restEndpoint: { method: 'POST', path: '/v1/memory' },
    args: { key: 'agents.{name}.offers', value: { version: 1, offers: [{ id: 'example', title: 'Example offer', ask: 'Plain-language invite describing what this agent does.' }] } },
  },
  make_workflow_compatible: {
    actor: 'agent', automatic: true, gatesCompletion: false, validationMethod: 'automatic',
    tool: 'aimeat_memory_write', toolAlias: 'aimeat_offers_publish',
    restEndpoint: { method: 'POST', path: '/v1/memory' },
    args: { key: 'agents.{name}.offers', value: { version: 1, offers: [{
      id: 'example', title: 'Example offer', ask: 'Plain-language invite describing what this agent does.',
      success_signal: { kind: 'deterministic', key: 'agents.{name}.out.example', op: 'exists' },
      required_to_function: 'none',
      deliverable: { format: 'document', location: { key: 'agents.{name}.out.example' } },
    }] } },
  },
  price_offer: {
    actor: 'agent', automatic: true, gatesCompletion: false, validationMethod: 'automatic',
    tool: 'aimeat_memory_write', toolAlias: 'aimeat_offers_publish',
    restEndpoint: { method: 'POST', path: '/v1/memory' },
    args: { key: 'agents.{name}.offers', value: { version: 1, offers: [{
      id: 'example', title: 'Example offer', ask: 'Plain-language invite describing what this agent does.',
      price: { morsels: 10, unit: 'per-call' }, visibility: 'public', callable: { action_id: 'example-action' },
    }] } },
  },
});

export function getStepHowTo(stepId: string): StepHowTo | undefined {
  return (STEP_HOWTO as Record<string, StepHowTo>)[stepId];
}

/**
 * Steps included when a task-runner agent is onboarded. Task-runners have no
 * interactive command surface (no slash commands), never send chat messages,
 * and don't declare interactive services -- those steps are skipped. But the
 * test-task pair (accept + complete) is KEPT: a task-runner whose entire
 * purpose is to execute queued tasks should not be marked "ready" until its
 * subprocess has actually executed a real test task end-to-end. The onboarding
 * test task IS the smoke test for task-runner agents -- it proves the runner
 * block in config.yaml is wired correctly, the subprocess starts, and stdout
 * round-trips back as the deliverable. publish_commands is still skipped
 * because task-runners have no command surface.
 */
const TASK_RUNNER_STEP_IDS: ReadonlyArray<OnboardingStepId> = [
  'authenticate',
  'identify_platform',
  'install_skill',
  'report_capabilities',
  'accept_test_task',
  'complete_test_task',
  'publish_config',
];

/**
 * Steps included when a workstation agent is onboarded. A workstation agent
 * (VSCode, Claude Desktop) lives in the user's own environment and visits the
 * node through MCP as one tool among many -- it is NOT node-resident. It has no
 * runtime config to publish, no slash-command surface, no delivery channel or
 * telemetry it can report, and never sits on the node task queue. So everything
 * that assumes a node-resident runtime is dropped, leaving only the proof of
 * who it is and what it can do: authenticate, identify the platform, report
 * capabilities, and confirm it read the node directives. The MCP round-trip the
 * agent already made to authenticate + report capabilities IS its smoke test --
 * no separate test task is created (unlike task-runner).
 */
const WORKSTATION_STEP_IDS: ReadonlyArray<OnboardingStepId> = [
  'authenticate',
  'identify_platform',
  'report_capabilities',
  'read_directives',
];

export type AgentMode = 'autonomous' | 'interactive' | 'task-runner' | 'coordinator' | 'workstation';

/**
 * Build the Hello Integration step list for a new onboarding record. The
 * `mode` parameter selects which subset of STEP_DEFINITIONS applies:
 *
 *   - 'task-runner'                       -> TASK_RUNNER_STEP_IDS (7 steps)
 *   - 'workstation'                       -> WORKSTATION_STEP_IDS (4 steps)
 *   - 'autonomous' / 'interactive' /
 *     'coordinator' / undefined (default) -> full 13-step list
 *
 * Order numbers are preserved from STEP_DEFINITIONS so the UI keeps a stable
 * progression label even when steps are filtered out.
 */
export function createDefaultSteps(mode?: AgentMode): AgentOnboardingStep[] {
  let allowed: Set<OnboardingStepId> | null = null;
  if (mode === 'task-runner') allowed = new Set<OnboardingStepId>(TASK_RUNNER_STEP_IDS);
  else if (mode === 'workstation') allowed = new Set<OnboardingStepId>(WORKSTATION_STEP_IDS);
  return STEP_DEFINITIONS
    .filter(def => !allowed || allowed.has(def.id))
    .map(def => ({
      id: def.id,
      order: def.order,
      title: def.title,
      description: def.description,
      status: 'pending' as const,
      required: def.required,
      validationMethod: def.validationMethod,
    }));
}

export const IdentifyPlatformSchema = z.object({
  platform: z.string().min(1).max(50),
  platform_version: z.string().max(50).optional(),
});

export const InstallSkillSchema = z.object({
  version: z.string().min(1).max(50),
  platform: z.string().min(1).max(50),
});

export const ReadDirectivesSchema = z.object({
  confirmed: z.boolean().optional().default(true),
});

export const DeclareServicesSchema = z.object({
  services: z.array(z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
  })).default([]),
});

export const STEP_SCHEMAS: Partial<Record<OnboardingStepId, z.ZodType>> = {
  identify_platform: IdentifyPlatformSchema,
  install_skill: InstallSkillSchema,
  read_directives: ReadDirectivesSchema,
  declare_services: DeclareServicesSchema,
};

export function getStepDefinition(stepId: string): StepDefinition | undefined {
  return STEP_DEFINITIONS.find(s => s.id === stepId);
}
