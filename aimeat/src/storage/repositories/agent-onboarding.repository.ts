/**
 * @file agent-onboarding.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interface for agent onboarding records (Hello Integration)
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 */

import type { AgentOnboardingRecord } from '../interface.js';

export interface AgentOnboardingRepository {
  createOnboarding(record: AgentOnboardingRecord): Promise<AgentOnboardingRecord>;
  getOnboarding(agentGaii: string): Promise<AgentOnboardingRecord | null>;
  updateOnboarding(agentGaii: string, updates: Partial<AgentOnboardingRecord>): Promise<AgentOnboardingRecord | null>;
  deleteOnboarding(agentGaii: string): Promise<boolean>;
  listOnboardingByOwner(owner: string): Promise<AgentOnboardingRecord[]>;
  listOnboardingByStatus(status: string): Promise<AgentOnboardingRecord[]>;
}
