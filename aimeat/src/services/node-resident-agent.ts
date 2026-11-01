/**
 * @file src/services/node-resident-agent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which agents the node runs itself, and the connect-your-AI proof that leaves them out.
 *   The place's own chat and the basic agents every account starts with call MCP from the start, so
 *   their calls and their writes are the node talking to itself, never the person connecting an AI of
 *   their own. The first-MCP-call marker (mcp-agent-admission.ts) and the hello_mcp proof (home-state,
 *   open-items) both ask here. A leaf module, so those services can share it without an import cycle.
 * @structure isNodeResidentAgent(agent) · hasHelloMcpProof(storage, nodeId, owner)
 * @usage import { isNodeResidentAgent, hasHelloMcpProof } from './node-resident-agent.js';
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial: either signal had ticked "connect your AI" on a place where no
 *     outside AI was connected (aimeat-commercial-1c, test lane).
 */
import type { Storage } from '../storage/interface.js';
import { CHAT_AGENT_NAME } from './chat-agent.js';
import { getOwnerScopeMemory } from './owner-memory.js';
import { HELLO_MCP_KEY } from './hello-mcp.js';

/** The tag of the basic agents created with the account (data/basic-agents.ts). */
const BASIC_AGENT_TAG = 'crew.basic';

/** The place's own chat (services/chat-agent.ts) or a basic agent. */
export function isNodeResidentAgent(agent: { name: string; tags?: readonly string[] | null }): boolean {
    return agent.name === CHAT_AGENT_NAME || (Array.isArray(agent.tags) && agent.tags.includes(BASIC_AGENT_TAG));
}

/**
 * Whether the person proved a connection of their own: the proof key `onboarding.hello_mcp`, written
 * by the person or by an AI they connected. A copy a node-resident agent wrote does not count.
 */
export async function hasHelloMcpProof(storage: Storage, nodeId: string, owner: string): Promise<boolean> {
    return !!(await getOwnerScopeMemory(storage, nodeId, owner, HELLO_MCP_KEY, { skipAgent: isNodeResidentAgent }));
}
