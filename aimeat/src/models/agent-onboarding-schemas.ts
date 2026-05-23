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

const STEP_DEFINITIONS: StepDefinition[] = [
  { id: 'authenticate', order: 1, title: 'Authenticate', description: 'Agent is authenticated via device auth', required: true, validationMethod: 'automatic' },
  { id: 'identify_platform', order: 2, title: 'Identify Platform', description: 'Determine which AI platform the agent runs on', required: true, validationMethod: 'api_call' },
  { id: 'install_skill', order: 3, title: 'Install Skill Bundle', description: 'Skill bundle installed and version reported', required: true, validationMethod: 'api_call' },
  { id: 'report_capabilities', order: 4, title: 'Report Capabilities', description: 'PUT /capabilities called with non-empty data', required: true, validationMethod: 'automatic' },
  { id: 'read_directives', order: 5, title: 'Read Directives', description: 'GET /directives called, agent confirms reading', required: true, validationMethod: 'api_call' },
  { id: 'send_test_message', order: 6, title: 'Send Test Message', description: 'POST /messages proves the message channel works', required: true, validationMethod: 'automatic' },
  { id: 'configure_delivery', order: 7, title: 'Configure Delivery', description: 'Webhook registered OR MCP detected OR polling confirmed', required: true, validationMethod: 'automatic' },
  { id: 'report_telemetry', order: 8, title: 'Report Telemetry', description: 'At least one telemetry event with non-zero data', required: true, validationMethod: 'automatic' },
  { id: 'accept_test_task', order: 9, title: 'Accept Test Task', description: 'Agent proposes todos for the test task', required: true, validationMethod: 'automatic' },
  { id: 'complete_test_task', order: 10, title: 'Complete Test Task', description: 'Agent executes and completes the test task', required: true, validationMethod: 'automatic' },
  { id: 'declare_services', order: 11, title: 'Declare Services', description: 'Agent declares offered services (optional)', required: false, validationMethod: 'api_call' },
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
