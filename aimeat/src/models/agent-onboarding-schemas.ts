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
];

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

export type AgentMode = 'autonomous' | 'interactive' | 'task-runner' | 'coordinator';

/**
 * Build the Hello Integration step list for a new onboarding record. The
 * `mode` parameter selects which subset of STEP_DEFINITIONS applies:
 *
 *   - 'task-runner'                       -> TASK_RUNNER_STEP_IDS (7 steps)
 *   - 'autonomous' / 'interactive' /
 *     'coordinator' / undefined (default) -> full 13-step list
 *
 * Order numbers are preserved from STEP_DEFINITIONS so the UI keeps a stable
 * progression label even when steps are filtered out.
 */
export function createDefaultSteps(mode?: AgentMode): AgentOnboardingStep[] {
  const allowed = mode === 'task-runner' ? new Set<OnboardingStepId>(TASK_RUNNER_STEP_IDS) : null;
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
