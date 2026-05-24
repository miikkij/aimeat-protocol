/**
 * @file agent-onboarding-schemas.ts
 * @description Onboarding step definitions and Zod validation schemas for
 *   Hello Integration step confirmation payloads.
 * @structure
 *   - ONBOARDING_STEPS -- constant array defining all 11 steps
 *   - Step-specific confirmation schemas (IdentifyPlatformSchema, etc.)
 *   - createDefaultSteps() -- factory for fresh onboarding step list
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
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
  { id: 'declare_services', order: 11, title: 'Declare Services', description: STEP_DESCRIPTIONS.declare_services, required: false, validationMethod: 'api_call' },
];

export function createDefaultSteps(): AgentOnboardingStep[] {
  return STEP_DEFINITIONS.map(def => ({
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
