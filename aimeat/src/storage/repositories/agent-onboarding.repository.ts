/**
 * @file agent-onboarding.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interface for agent onboarding records (Hello Integration)
 * @version-history
 *   v1.2.0 -- 2026-11-09 -- getOnboardingMany: the home state read one record per agent (80 reads at
 *     79 agents, one round trip each on PostgreSQL).
 *   v1.1.0 -- 2026-09-09 -- listOnboardingByOwner deleted: no caller.
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 */

import type { AgentOnboardingRecord } from '../interface.js';

export interface AgentOnboardingRepository {
  createOnboarding(record: AgentOnboardingRecord): Promise<AgentOnboardingRecord>;
  getOnboarding(agentGaii: string): Promise<AgentOnboardingRecord | null>;
  /** The onboarding records of many agents in one read; an agent without one is absent from the list. */
  getOnboardingMany(agentGaiis: readonly string[]): Promise<AgentOnboardingRecord[]>;
  updateOnboarding(agentGaii: string, updates: Partial<AgentOnboardingRecord>): Promise<AgentOnboardingRecord | null>;
  deleteOnboarding(agentGaii: string): Promise<boolean>;
  listOnboardingByStatus(status: string): Promise<AgentOnboardingRecord[]>;
}
