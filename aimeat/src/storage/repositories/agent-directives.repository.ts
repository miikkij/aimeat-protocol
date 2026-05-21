/**
 * @file agent-directives.repository.ts
 * @description Repository interface for agent directives and owner-level agent defaults
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import type { AgentDirectivesRecord, OwnerAgentDefaults } from '../interface.js';

export interface AgentDirectivesRepository {
  getAgentDirectives(agentGaii: string): Promise<AgentDirectivesRecord | null>;
  upsertAgentDirectives(record: AgentDirectivesRecord): Promise<AgentDirectivesRecord>;
  deleteAgentDirectives(agentGaii: string): Promise<boolean>;

  getOwnerAgentDefaults(ownerGaii: string): Promise<OwnerAgentDefaults | null>;
  upsertOwnerAgentDefaults(record: OwnerAgentDefaults): Promise<OwnerAgentDefaults>;
}
