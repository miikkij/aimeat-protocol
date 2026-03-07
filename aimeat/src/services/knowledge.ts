import type { Storage } from '../storage/interface.js';
import { KNOWLEDGE_PACKAGER_HUMAN_PROMPT } from '../prompts/knowledge-packager-human.js';
import { KNOWLEDGE_PACKAGER_AGENT_PROMPT } from '../prompts/knowledge-packager-agent.js';

/** Seed the knowledge packager prompt templates into memory if they don't exist.
 *  Called once at server startup. Uses the first owner's agent GAII as the owner. */
export async function seedKnowledgeTemplates(storage: Storage, systemGaii: string): Promise<void> {
  const now = new Date().toISOString();

  const humanKey = 'templates/knowledge-packager-human';
  const agentKey = 'templates/knowledge-packager-agent';

  const existingHuman = await storage.getMemory(systemGaii, humanKey);
  if (!existingHuman) {
    await storage.setMemory({
      key: humanKey,
      ownerGaii: systemGaii,
      value: KNOWLEDGE_PACKAGER_HUMAN_PROMPT,
      visibility: 'public',
      tags: ['template', 'knowledge', 'prompt', 'human'],
      ttlHours: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  const existingAgent = await storage.getMemory(systemGaii, agentKey);
  if (!existingAgent) {
    await storage.setMemory({
      key: agentKey,
      ownerGaii: systemGaii,
      value: KNOWLEDGE_PACKAGER_AGENT_PROMPT,
      visibility: 'public',
      tags: ['template', 'knowledge', 'prompt', 'agent'],
      ttlHours: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}
