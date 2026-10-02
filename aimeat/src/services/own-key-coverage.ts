/**
 * @file src/services/own-key-coverage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an owner's own AI key pays for on this node, and what it does not.
 *
 *   WHY. GET /v1/chat/status answered `has_own_key: true` next to `pays: "node"`, and the AI page said
 *   "everything here that asks the AI in your name spends your key". Both were read as "my key is in
 *   use". Measured on a hosted node on 2026-10-02 with a test key read back at OpenRouter: a chat turn
 *   and an agent task both spent the node's key and the owner's key spent nothing.
 *
 *   THE ANSWER IS A FACT OF THIS NODE'S CONFIGURATION, not of one call:
 *   - `node_ai`: every AI call the node makes in the owner's name (apps, scheduled jobs, workflows,
 *     voice and images) is keyed by prepareAiCall, and the owner's own key comes before the node's.
 *   - `agent_calls_via_node`: an agent that asks the AI through this node (/v1/ai/*, /v1/llm, the MCP
 *     AI tools) is paid by its owner (agent-ai-keys.ts aiPayerOf): its own key, the owner's, the node's.
 *   - `chat`: on the node route the chat's model calls go through /v1/llm with the person's chat
 *     token, so the same order applies. On the shared chat key (AIMEAT_GOOSE_PROVIDER_API_KEY) the
 *     operator's key pays for every turn and the own key is never asked.
 *   - `agent_runtimes`: covered only when every agent's runtime reported that its crew thinks through
 *     this node (aimeat_agent_runtime_report `llm: 'node'`). A crew on its machine's key calls its
 *     model itself (agent-ai-keys.ts: the node never sends a key to an agent); on a hosted node that
 *     machine is the node's own container, whose environment only the fleet sets. A crew on the node
 *     road sends its calls to /v1/llm with its own token, and the node picks the key (Development
 *     note doc-muqrcqbt1fzx). `agents` lists each agent with the road it reported.
 *
 *   `pays` in /v1/chat/status stays the per-call answer (who pays the chat's next turn); this is the
 *   standing answer to "what does my key reach here".
 * @structure OwnKeyPart · OwnKeyGapReason · AgentRoad · OwnKeyCoverage ·
 *   ownKeyCoverageOf(config, set, agents) · agentRoadsOf(storage, gaii) · hasOwnAiKey(storage, gaii) ·
 *   ownKeyCoverage(storage, config, gaii)
 * @usage
 *   const own_key = await ownKeyCoverage(storage, config, gaii);
 *   res.json(success(config.nodeId, { has_own_key: own_key.set, own_key }));
 * @version-history
 *   v1.2.0 — 2026-10-02 — `agents` lists only agents that have a runtime: enrolled (a key pinned at
 *     enrolment) or one that reported its runtime. The `app` principal and a v1 MCP agent run no
 *     crew, and the one named `app` sat in the list with llm null on every hosted place, so
 *     `agent_runtimes` could never be covered there.
 *   v1.1.0 — 2026-10-02 — `agents`: each agent's crew road from its runtime report; `agent_runtimes`
 *     is covered when every agent thinks through the node.
 *   v1.0.0 — 2026-10-02 — Initial. Served by GET /v1/chat/status and GET /v1/ai/capabilities
 *     (aimeat_ai_capabilities), and read by the chat's status line and the AI page.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { AgentRecord } from '../storage/types/identity.js';
import { chatUsesSharedKey } from './goose-env.js';
import { ownerKeyIds, PROVIDER_KEY_PREFIX } from './ai/provider-store.js';
import { CHAT_AGENT_NAME } from './chat-agent.js';
import { localAccountOf } from '../utils/gaii.js';

/** A part of the node that can spend AI on the owner's behalf. */
export type OwnKeyPart = 'node_ai' | 'agent_calls_via_node' | 'chat' | 'agent_runtimes';

/**
 * Why the own key does not reach a part.
 * - `shared_chat_key`: the operator set one key for every chat turn, outside the metering.
 * - `runtime_uses_machine_key`: an agent's crew calls its model with the key of the machine it runs on.
 */
export type OwnKeyGapReason = 'shared_chat_key' | 'runtime_uses_machine_key';

/** One of the owner's agents and where its crew's model calls go, as its runtime reported it. */
export interface AgentRoad {
  agent: string;
  /** `node`: through this node's /v1/llm, so the own key reaches it. `machine`: its own machine's key.
   *  null: the runtime has not said, which is read as `machine` (the crew's default). */
  llm: 'node' | 'machine' | null;
}

export interface OwnKeyCoverage {
  /** Whether the owner has a key of their own: the legacy OpenRouter key or a key on one of their providers. */
  set: boolean;
  /** The parts an own key pays for on this node, before the node's key. */
  covers: OwnKeyPart[];
  /** The parts it never reaches here, each with the reason. */
  not_covered: Array<{ part: OwnKeyPart; reason: OwnKeyGapReason }>;
  /** The owner's agents with a crew road each (aimeat_agent_runtime_report `llm`). The chat agent is
   *  not listed: its road is the `chat` part. */
  agents: AgentRoad[];
}

/**
 * The coverage for this node's configuration and the owner's agents. Pure: `set` and the agents'
 * roads are passed in. `agent_runtimes` is covered only when every agent reported the node road: one
 * crew still on its machine's key is a part the own key does not reach, and `agents` names which.
 */
export function ownKeyCoverageOf(
  config: Pick<AimeatConfig, 'gooseProviderApiKey'>, set: boolean, agents: AgentRoad[] = [],
): OwnKeyCoverage {
  const shared = chatUsesSharedKey(config);
  const crewsOnNode = agents.length > 0 && agents.every(a => a.llm === 'node');
  return {
    set,
    covers: [
      'node_ai', 'agent_calls_via_node',
      ...(shared ? [] : ['chat' as const]),
      ...(crewsOnNode ? ['agent_runtimes' as const] : []),
    ],
    not_covered: [
      ...(shared ? [{ part: 'chat' as const, reason: 'shared_chat_key' as const }] : []),
      ...(crewsOnNode ? [] : [{ part: 'agent_runtimes' as const, reason: 'runtime_uses_machine_key' as const }]),
    ],
    agents,
  };
}

/**
 * An agent that has a runtime to report: one enrolled (its key pinned, so a connector serves it) or
 * one whose runtime has reported. The `app` principal that signs an app in, a v1 agent that speaks
 * over MCP from a desktop and the chat agent run no crew, so they have no road to report.
 */
export function hasRuntime(agent: Pick<AgentRecord, 'name' | 'enrolledAt' | 'runtimeSource'>): boolean {
  return agent.name !== CHAT_AGENT_NAME && (!!agent.enrolledAt || !!agent.runtimeSource);
}

/** The owner's agents that have a runtime, and the road each one reported. */
export async function agentRoadsOf(storage: Storage, gaii: string): Promise<AgentRoad[]> {
  const owner = localAccountOf(gaii);
  if (!owner) return [];
  const agents = await storage.getAgentsByOwner(owner);
  return agents
    .filter(hasRuntime)
    .map(a => ({ agent: a.name, llm: a.runtimeSource?.llm ?? null }));
}

const encryptedIn = (value: unknown): boolean => {
  const e = (value as { encrypted?: unknown } | undefined)?.encrypted;
  return typeof e === 'string' && e.length > 0;
};

/**
 * Whether the owner holds a key of their own: the legacy record, or a key on one of their providers.
 *
 * A provider key marked `legacy` is a copy of the legacy record (provider-store.ts syncLegacyProvider)
 * and is removed only on the next providers read, so it counts only through the legacy record itself:
 * otherwise a key the owner had just deleted would still read as set.
 */
export async function hasOwnAiKey(storage: Storage, gaii: string): Promise<boolean> {
  const legacy = await storage.getMemory(gaii, 'openrouter.apikey');
  if (encryptedIn(legacy?.value)) return true;
  for (const id of await ownerKeyIds(storage, gaii)) {
    const rec = await storage.getMemory(gaii, `${PROVIDER_KEY_PREFIX}${id}`);
    if (encryptedIn(rec?.value) && (rec?.value as { legacy?: unknown }).legacy !== true) return true;
  }
  return false;
}

/** The whole answer for one owner. `gaii` is the payer: the owner, also when an agent asks. */
export async function ownKeyCoverage(storage: Storage, config: AimeatConfig, gaii: string): Promise<OwnKeyCoverage> {
  const [set, agents] = await Promise.all([hasOwnAiKey(storage, gaii), agentRoadsOf(storage, gaii)]);
  return ownKeyCoverageOf(config, set, agents);
}
