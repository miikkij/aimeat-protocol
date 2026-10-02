/**
 * @file src/services/crew-menu.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an agent's runtime can actually do, asked instead of copied: the tool names its
 *   interpreter resolves, and the model profiles the machine it runs on can reach. Plus the owner's
 *   own model choice, which is a memory record and is read and written like one.
 *
 *   WHY ASK. This node kept a hand-written list of tool ids in three places — the Crew tab's picker,
 *   the MCP tool description, and the crew-def gate — against crewaimeat's TOOL_REGISTRY, which is
 *   the thing that actually resolves them. Measured 2026-09-08: the picker offered ten where the
 *   runtime resolved twelve, so `app_tools` and `crew_registry` existed and could not be chosen. A
 *   list you do not own can only ever be behind. `crew.menu` is the runtime answering for itself;
 *   the served list stays as the fallback for an agent that is offline or on an older runtime.
 *
 *   THE CHOICE IS A MEMORY RECORD, not a table and not a new door. Two keys in the OWNER's own
 *   namespace, which is where their own tools already read and write:
 *
 *     crews.llm.default     the default for every agent this owner has
 *     crews.llm.<agent>     one agent's own, when it differs
 *
 *   Each holds `{kind:'profile', profile}` or `{kind:'model', label, provider}` — the two shapes
 *   crewaimeat's own override store already uses, so the runtime resolves them with the code it has —
 *   or `{kind:'node', role?}`, which sends the crew's model calls through this node's /v1/llm.
 *   A `model` carries `api_key_env`, the NAME of an environment variable on that machine. No
 *   credential is stored here, and this service refuses one that looks like a key, a variable that is
 *   not a provider key, and an address that is not public https (crew-llm-guard.ts).
 *
 *   THE CATALOGUE IS THE RUNTIME'S TOO. It publishes `crews.llm.catalog` at start, into the AGENT's
 *   own namespace; this reads it so the page can offer what exists rather than a free-text box, and a
 *   live `crew.menu` supersedes it whenever the agent is connected. The agent's own namespace, because
 *   `crews.llm.` is a reserved prefix in the owner's: an agent writing there needs
 *   memory:write-reserved, which also reaches openrouter.settings and commerce.psp, and no publisher
 *   should hold that for a list of model names. A forged catalogue there is read only for the agent
 *   that wrote it, which already decides what its own runtime calls. It also gives each agent its own
 *   copy, where one owner key had agents on different machines overwrite each other's list.
 * @structure CrewMenu · crewMenu() · readLlmChoice() · effectiveLlmChoice() · writeLlmChoice()
 * @usage const menu = await crewMenu(deps, caller, 'news-watcher');
 * @version-history
 *   v1.4.0 — 2026-10-02 — effectiveLlmChoice(): thinking through the node is the default for an agent
 *     holding ai:use when the node has a key to pay with, and an owner default of `node` skips an
 *     agent without ai:use (Jouni, 2026-10-02). GET /v1/agents/:name/crew/llm answers it for the
 *     runtime; the menu carries it as `effective`.
 *   v1.3.0 — 2026-10-02 — A `model` choice is refused unless its api_key_env is a provider key variable
 *     and every address in it is public https (crew-llm-guard.ts): a saved choice could send any secret
 *     in the crew's environment to any address. A third shape, `{kind:'node', role?}`: the crew thinks
 *     through this node's /v1/llm, which picks the model and the key (Jouni, 2026-10-02).
 *   v1.2.0 — 2026-09-28 — writeLlmChoice warns when the owner's model policy leaves the model out; it
 *     still saves, because the crew runs on its own machine (System 2 plan, V5).
 *   v1.1.0 — 2026-09-16 — The catalogue is read from the agent's own namespace. In the owner's it could
 *     not be published without memory:write-reserved, so hosted runtimes got SCOPE_DENIED.
 *   v1.0.0 — 2026-09-09 — Initial: the drift between this node's copy of the tool menu and the
 *     runtime's own, and the owner's model choice for an agent.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { askCrew, resolveCrewAgent, type CrewCaller, type CrewRefusal } from './crew-ops.js';
import { writeMemoryRecord } from './memory-write.js';
import { logger } from '../utils/logger.js';
import { loadPolicyDecision } from './ai/policy-gate.js';
import { isAllowed, parseModelRef } from './ai/policy.js';
import { canonicalModelKey } from './ai/catalog/equivalence.js';
import { AiCompletionError } from './ai/errors.js';
import { crewChoiceProblem } from './crew-llm-guard.js';
import { prepareAiCall } from './ai-completion.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import type { AgentRecord } from '../storage/types/identity.js';

/** The owner's key for a default that covers every agent they have. */
export const LLM_DEFAULT_KEY = 'crews.llm.default';
/** Where the runtime publishes what this machine can reach, in the agent's own namespace. */
export const LLM_CATALOG_KEY = 'crews.llm.catalog';
/** One agent's own choice. */
export const llmKeyFor = (agent: string) => `crews.llm.${agent}`;

export interface CrewMenuTool { id: string; purpose: string }
export interface CrewMenu {
  /** 'runtime' when the agent answered, 'catalog' when only its last published catalogue was read. */
  source: 'runtime' | 'catalog' | 'none';
  tools: CrewMenuTool[];
  profiles: string[];
  models: Array<Record<string, unknown>>;
  /** What is chosen for this agent now, and whether it is the agent's own or the owner's default. */
  choice: { scope: 'agent' | 'default'; value: Record<string, unknown> } | null;
  /** What the runtime uses: the stored choice, this node's default, or the machine's (effectiveLlmChoice). */
  effective: EffectiveLlmChoice;
}

export interface EffectiveLlmChoice {
  /** The choice the runtime uses, or null: the machine's own providers decide. */
  value: Record<string, unknown> | null;
  /** Where it came from: the agent's own record, the owner's default, or this node's default. */
  scope: 'agent' | 'default' | 'node' | null;
  /** Who pays a node choice that applies: the agent's own key, the owner's own, or the node's. */
  key_source?: 'agent' | 'own' | 'node';
  /** One sentence for a log line or the agent's page: why this answer. */
  why: string;
}

interface Deps { config: AimeatConfig; storage: Storage }

/** The longest AI role id a `node` choice may name; /v1/llm refuses a longer one (readCallRole). */
const ROLE_MAX_CHARS = 300;

/**
 * A stored choice the runtime can resolve, or null. Three shapes:
 * - `{kind:'profile', profile}` and `{kind:'model', label, provider}`: crewaimeat's own override store.
 * - `{kind:'node', role?}`: the crew thinks through this node's /v1/llm with the agent's own token, and
 *   the node picks the model and the key (the agent's own, the owner's own, then the node's from the
 *   allowance). `role` is one of the owner's AI roles, sent in the X-AIMEAT-AI-Role header. Development
 *   note doc-muqrcqbt1fzx (2026-10-02).
 */
export function validChoice(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.kind === 'profile' && typeof v.profile === 'string' && v.profile.trim()) return v;
  if (v.kind === 'model' && v.provider && typeof v.provider === 'object') return v;
  if (v.kind === 'node' && (v.role === undefined || (typeof v.role === 'string' && v.role.trim().length > 0 && v.role.length <= ROLE_MAX_CHARS))) {
    return { kind: 'node', ...(typeof v.role === 'string' ? { role: v.role.trim() } : {}), ...(typeof v.label === 'string' ? { label: v.label.slice(0, 120) } : {}) };
  }
  return null;
}

/**
 * A provider block may name the ENVIRONMENT VARIABLE that holds a key and must never carry the key
 * itself. Checked here rather than trusted, because this record is written from a browser and read
 * by a process that will happily use whatever it finds.
 */
export function looksLikeASecret(provider: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(provider)) {
    if (k === 'api_key_env') continue;
    if (/(api_?key|secret|token|password)/i.test(k) && typeof v === 'string' && v.trim()) {
      return `${k} looks like a credential. Name the environment variable in api_key_env instead; the key stays on the machine that runs the agent.`;
    }
  }
  return null;
}

async function readOwnerValue(deps: Deps, owner: string, key: string): Promise<unknown> {
  const rec = await deps.storage.getMemory(`${owner}@${deps.config.nodeId}`, key);
  return rec?.value ?? null;
}

/** What is chosen for `agentName` right now: its own record first, then the owner's default. */
export async function readLlmChoice(deps: Deps, owner: string, agentName: string): Promise<CrewMenu['choice']> {
  const own = validChoice(await readOwnerValue(deps, owner, llmKeyFor(agentName)));
  if (own) return { scope: 'agent', value: own };
  const shared = validChoice(await readOwnerValue(deps, owner, LLM_DEFAULT_KEY));
  if (shared) return { scope: 'default', value: shared };
  return null;
}

/** Whether a text call for this agent would find a key, a provider and a model now. Nothing is spent. */
async function nodePaysFor(deps: Deps, agent: AgentRecord): Promise<{ ok: true; source: 'agent' | 'own' | 'node' } | { ok: false; reason: string }> {
  try {
    const plan = await prepareAiCall(deps.storage, deps.config, `${agent.owner}@${deps.config.nodeId}`, {
      op: 'text', capability: 'text', caller: 'agent', agent: agent.name, appId: 'llm-proxy',
    });
    return { ok: true, source: plan.keyScope };
  } catch (e) {
    if (e instanceof AiCompletionError) return { ok: false, reason: e.code };
    throw e;
  }
}

/**
 * The choice that applies to `agent`'s crew now: the answer of GET /v1/agents/:name/crew/llm, which
 * the runtime reads, and the menu's `effective`.
 *
 * THE RULE (Jouni, 2026-10-02). Thinking through the node is the default for every agent that holds
 * ai:use, when the node has a key to pay with: the place's own key or the owner's own key (the
 * agent's own key counts too). Without one, the machine the agent runs on uses its own key, as
 * before. A stored choice wins: the agent's own first, then the owner's default.
 *
 * ONE EXCEPTION, THE CASE THAT CAME UP. An owner default of `{kind:'node'}` does not apply to an agent
 * that cannot use it. The fleet writes that default for every new place, and an agent without ai:use
 * (the CADENCE crm agent declares none) would be refused on its first model call and fail every task;
 * it gets the machine's key instead. An agent's OWN node choice is the owner's explicit word about
 * that agent and stays.
 *
 * "PAYS" IS THE DECISION A CALL MAKES: prepareAiCall plans a text call for this agent as /v1/llm would,
 * and spends nothing. A second copy of the key rules here would drift from the real one.
 */
export async function effectiveLlmChoice(deps: Deps, agent: AgentRecord): Promise<EffectiveLlmChoice> {
  const stored = await readLlmChoice(deps, agent.owner, agent.name);
  if (stored?.scope === 'agent') return { value: stored.value, scope: 'agent', why: 'The owner chose this for the agent.' };
  if (stored && stored.value.kind !== 'node') return { value: stored.value, scope: 'default', why: 'The owner\'s default for every agent.' };

  // From here the answer is the node or the machine, and the node needs two things whether the
  // owner's default named it or nothing did: the word to call /v1/llm, and something that pays.
  if (!scopeIsCovered(agent.defaultScopes ?? [], 'ai:use')) {
    return { value: null, scope: null, why: 'The agent does not hold ai:use, so it thinks with the machine\'s own key.' };
  }
  const pays = await nodePaysFor(deps, agent);
  if (!pays.ok) {
    return { value: null, scope: null, why: `This node has no key to pay for the agent's model calls (${pays.reason}), so it thinks with the machine's own key.` };
  }
  return stored
    ? { value: stored.value, scope: 'default', key_source: pays.source, why: 'The owner\'s default: think through this node.' }
    : { value: { kind: 'node' }, scope: 'node', key_source: pays.source, why: 'Nothing is chosen, the agent holds ai:use and this node has a key, so it thinks through this node.' };
}

/**
 * Set (or clear, with `null`) the model choice for one agent, or for every agent when `agentName` is
 * null. Written through writeMemoryRecord so it carries the same provenance and limits as every
 * other record in the owner's namespace.
 */
export async function writeLlmChoice(
  deps: Deps, caller: CrewCaller, agentName: string | null, choice: unknown,
): Promise<{ ok: true; key: string; cleared: boolean; warning?: string } | CrewRefusal> {
  const key = agentName ? llmKeyFor(agentName) : LLM_DEFAULT_KEY;

  if (choice === null || choice === undefined) {
    await deps.storage.deleteMemory(`${caller.owner}@${deps.config.nodeId}`, key);
    logger.info('LLM choice cleared', { event: 'crew.llm_cleared', owner: caller.owner, key });
    return { ok: true, key, cleared: true };
  }

  const valid = validChoice(choice);
  if (!valid) {
    return {
      ok: false, status: 400, code: 'INVALID_CHOICE',
      message: "A choice is {kind:'node', role?:'<AI role id>'} (think through this node, which picks the model and the key), {kind:'profile', profile:'<name>'} or {kind:'model', label, provider}.",
    };
  }
  if (valid.kind === 'model') {
    const problem = looksLikeASecret(valid.provider as Record<string, unknown>);
    if (problem) return { ok: false, status: 400, code: 'SECRET_IN_CHOICE', message: problem };
    // Refuse before writing: which variable the crew sends as its key, and where (crew-llm-guard.ts).
    const unsafe = await crewChoiceProblem(valid.provider);
    if (unsafe) return { ok: false, status: 400, code: 'UNSAFE_CHOICE', message: unsafe };
  }

  const ownerGhii = `${caller.owner}@${deps.config.nodeId}`;
  const out = await writeMemoryRecord({ storage: deps.storage, config: deps.config }, {
    principal: caller.principal,
    // THE OWNER'S NAMESPACE, whoever pressed. The runtime reads these with an owner-scope lookup, so
    // a copy in an agent's own namespace would be written happily and read by nobody.
    targetGaii: ownerGhii,
    scopes: caller.scopes,
    roles: caller.roles,
  }, {
    key,
    value: { ...valid, updatedAt: new Date().toISOString() },
    visibility: 'owner',
    tags: ['llm-choice'],
    ownerScoped: true,
    pipeline: caller.pipeline,
  });
  if (!out.ok) return { ok: false, status: out.status ?? 400, code: out.code ?? 'WRITE_FAILED', message: out.message ?? 'The choice could not be saved.' };
  logger.info('LLM choice set', { event: 'crew.llm_set', owner: caller.owner, key, kind: valid.kind });
  const warning = valid.kind === 'model' ? await policyWarning(deps, ownerGhii, agentName, valid.provider as Record<string, unknown>) : null;
  return { ok: true, key, cleared: false, ...(warning ? { warning } : {}) };
}

/**
 * A warning, never a refusal, when the owner's model policy leaves the crew's model out (plan 07,
 * section 6): the crew runs on its own machine with its own key, so the node cannot stop the call,
 * only say that it breaks the owner's rule. A crew that calls the node's /v1/llm is held to the
 * policy there.
 */
async function policyWarning(deps: Deps, ownerGhii: string, agentName: string | null, provider: Record<string, unknown>): Promise<string | null> {
  const model = typeof provider.model === 'string' ? provider.model.trim() : '';
  if (!model) return null;
  try {
    const { decision } = await loadPolicyDecision(deps.storage, deps.config, ownerGhii, {
      capability: 'text', caller: 'agent', ...(agentName ? { agent: agentName } : {}),
    });
    if (decision.allowed === 'any') return null;
    // A reference names its type; a bare id is compared with the id part of every allowed reference.
    const bare = (ref: string) => canonicalModelKey(parseModelRef(ref).id);
    const ok = model.includes(':') ? isAllowed(decision, model) : decision.allowed.some(ref => bare(ref) === canonicalModelKey(model));
    if (ok) return null;
    return `The owner's model policy does not allow ${model} for this agent. The choice is saved, because the crew runs on its own machine; `
      + `models the policy allows: ${decision.allowed.slice(0, 8).join(', ')}${decision.allowed.length > 8 ? ', …' : ''}.`;
  } catch (e) {
    // An empty intersection of rules is its own refusal elsewhere; here it is only a warning.
    return e instanceof AiCompletionError ? e.message : null;
  }
}

/**
 * What this agent's runtime offers, and what is chosen for it.
 *
 * Asks the runtime when it is connected; falls back to the catalogue it published at its last start,
 * so a page opened while the fleet is down still shows real names rather than an empty picker. The
 * `source` field says which, because "the menu is empty" and "nobody has ever told us" are different
 * answers and the person deserves to know which one they are looking at.
 */
export async function crewMenu(deps: Deps, caller: CrewCaller, identifier: string): Promise<
  { ok: true; menu: CrewMenu } | CrewRefusal
> {
  const target = await resolveCrewAgent(deps, caller, identifier);
  if (!target.ok) return target;

  const [choice, effective] = await Promise.all([
    readLlmChoice(deps, caller.owner, target.agent.name), effectiveLlmChoice(deps, target.agent),
  ]);

  const asked = await askCrew(
    deps.config, target.agent, 'crew.menu', {}, caller.principal, deps.config.connectTunnelRequestTimeoutMs,
  );
  if (asked.ok) {
    const r = (asked.result ?? {}) as { tools?: unknown; llm?: { profiles?: unknown; models?: unknown } };
    const tools = Array.isArray(r.tools)
      ? r.tools.filter((t): t is CrewMenuTool => !!t && typeof (t as CrewMenuTool).id === 'string')
      : [];
    if (tools.length > 0) {
      return {
        ok: true,
        menu: {
          source: 'runtime',
          tools,
          profiles: Array.isArray(r.llm?.profiles) ? r.llm!.profiles as string[] : [],
          models: Array.isArray(r.llm?.models) ? r.llm!.models as Array<Record<string, unknown>> : [],
          choice,
          effective,
        },
      };
    }
  }

  // Offline, or a runtime that predates crew.menu. The catalogue it published at its last start is
  // the next best thing, and it is a plain memory record under the agent itself.
  const catRec = await deps.storage.getMemory(target.agent.gaii, LLM_CATALOG_KEY);
  const cat = (catRec?.value ?? null) as { profiles?: unknown; models?: unknown } | null;
  return {
    ok: true,
    menu: {
      source: cat ? 'catalog' : 'none',
      tools: [],
      profiles: Array.isArray(cat?.profiles) ? cat!.profiles as string[] : [],
      models: Array.isArray(cat?.models) ? cat!.models as Array<Record<string, unknown>> : [],
      choice,
      effective,
    },
  };
}
