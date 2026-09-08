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
 *   crewaimeat's own override store already uses, so the runtime resolves them with the code it has.
 *   A `model` carries `api_key_env`, the NAME of an environment variable on that machine. No
 *   credential is stored here, and this service refuses one that looks like a key.
 *
 *   THE CATALOGUE IS THE RUNTIME'S TOO. It publishes `crews.llm.catalog` at start; this reads it so
 *   the page can offer what exists rather than a free-text box, and a live `crew.menu` supersedes it
 *   whenever the agent is connected.
 * @structure CrewMenu · crewMenu() · readLlmChoice() · writeLlmChoice()
 * @usage const menu = await crewMenu(deps, caller, 'news-watcher');
 * @version-history
 *   v1.0.0 — 2026-09-09 — Initial: the drift between this node's copy of the tool menu and the
 *     runtime's own, and the owner's model choice for an agent.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { askCrew, resolveCrewAgent, type CrewCaller, type CrewRefusal } from './crew-ops.js';
import { writeMemoryRecord } from './memory-write.js';
import { logger } from '../utils/logger.js';

/** The owner's key for a default that covers every agent they have. */
export const LLM_DEFAULT_KEY = 'crews.llm.default';
/** Where the runtime publishes what this machine can reach. */
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
}

interface Deps { config: AimeatConfig; storage: Storage }

/** A stored choice the runtime can resolve, or null. The same two shapes on both sides. */
export function validChoice(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.kind === 'profile' && typeof v.profile === 'string' && v.profile.trim()) return v;
  if (v.kind === 'model' && v.provider && typeof v.provider === 'object') return v;
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

/**
 * Set (or clear, with `null`) the model choice for one agent, or for every agent when `agentName` is
 * null. Written through writeMemoryRecord so it carries the same provenance and limits as every
 * other record in the owner's namespace.
 */
export async function writeLlmChoice(
  deps: Deps, caller: CrewCaller, agentName: string | null, choice: unknown,
): Promise<{ ok: true; key: string; cleared: boolean } | CrewRefusal> {
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
      message: "A choice is either {kind:'profile', profile:'<name>'} or {kind:'model', label, provider}.",
    };
  }
  if (valid.kind === 'model') {
    const problem = looksLikeASecret(valid.provider as Record<string, unknown>);
    if (problem) return { ok: false, status: 400, code: 'SECRET_IN_CHOICE', message: problem };
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
  return { ok: true, key, cleared: false };
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

  const choice = await readLlmChoice(deps, caller.owner, target.agent.name);

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
        },
      };
    }
  }

  // Offline, or a runtime that predates crew.menu. The catalogue it published at its last start is
  // the next best thing, and it is a plain memory record.
  const cat = await readOwnerValue(deps, caller.owner, LLM_CATALOG_KEY) as
    { profiles?: unknown; models?: unknown } | null;
  return {
    ok: true,
    menu: {
      source: cat ? 'catalog' : 'none',
      tools: [],
      profiles: Array.isArray(cat?.profiles) ? cat!.profiles as string[] : [],
      models: Array.isArray(cat?.models) ? cat!.models as Array<Record<string, unknown>> : [],
      choice,
    },
  };
}
