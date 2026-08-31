/**
 * @file crew-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Crew operations, once, for every door: read, draft, validate, try, publish,
 *   restore a JSON crew definition on one of the caller's own agents. routes/agent-crew.ts renders
 *   these over HTTP for the Crew tab; mcp/agent-crew.ts renders the same calls for a chat session,
 *   which is how a person builds an agent from their own AI without a browser or this repo. The
 *   storage contract lives in crew-def-store.ts; this file adds who may do what, the questions to
 *   the agent's runtime over the tunnel, and the trial runs the node holds in memory.
 *
 *   WHO MAY. The target is resolved against the CALLER'S OWNER: an owner session reaches every
 *   agent of theirs, and an agent reaches itself and its same-owner siblings (the rule tags and
 *   mode already follow, and what lets a chat session, which is an agent principal, publish). An
 *   app grant is refused for anything that changes the definition: consent to use the account is
 *   not consent to change what an agent is. Scopes stay at the doors: REST gates the writes with
 *   requireScope('memory:write') and MCP registers the tools by the same scope.
 * @structure
 *   - CrewCaller / CrewRefusal / CrewDeps — the contract every door supplies
 *   - resolveCrewAgent() — bare name or GAII → the caller's own agent, or a refusal
 *   - askCrew() — one invoke over the tunnel, every failure named for the person
 *   - crewState / crewValidate / crewTryStart / crewTryPoll / crewTryWait
 *   - crewDraftSave / crewDraftDiscard / crewPublish / crewRestore
 * @usage
 *   const out = await crewPublish({ storage, config }, caller, 'json-demo', doc);
 *   if (!out.ok) return renderRefusal(out);
 * @version-history
 *   v1.0.0 — 2026-08-28 — Extracted from routes/agent-crew.ts so the MCP tools call the same code.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { buildGAII } from '../utils/gaii.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import {
  readCrewState, saveCrewDraft, discardCrewDraft, publishCrewDef, readCrewRevision, crewKeysFor,
  CREW_VERSION_WINDOW, type CrewState,
} from './crew-def-store.js';
import { logger } from '../utils/logger.js';

export interface CrewDeps { storage: Storage; config: AimeatConfig }

/** Who is asking, in the terms every door can supply. */
export interface CrewCaller {
  /** The principal doing this: an owner GHII, or an agent GAII (a chat session is one). */
  principal: string;
  /** The bare owner name behind the session. The target agent has to belong to it. */
  owner: string;
  scopes: string[];
  roles: string[];
  /** Which road this came down, for provenance: 'rest.agent-crew.publish', 'mcp.crew_publish' … */
  pipeline: string;
}

export interface CrewRefusal { ok: false; status: number; code: string; message: string; details?: unknown }

/** A success result without its `ok` flag, for a door that renders the data and its own envelope. */
export function crewData<T extends { ok: true }>(out: T): Omit<T, 'ok'> {
  const copy: Record<string, unknown> = { ...out };
  delete copy.ok;
  return copy as Omit<T, 'ok'>;
}

type Doc = Record<string, unknown>;

/** How long a finished trial stays readable before the node forgets it. Nothing is ever stored. */
const TRY_RESULT_TTL_MS = 15 * 60 * 1000;

interface TryRun {
  id: string;
  agentGaii: string;
  status: 'running' | 'done' | 'failed';
  result: unknown;
  error: { code: string; message: string } | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Trial runs, node-wide, in memory. Shared by every door so a trial started from chat can be polled from the tab. */
const tries = new Map<string, TryRun>();

function sweepTries(): void {
  const cutoff = Date.now() - TRY_RESULT_TTL_MS;
  for (const [id, t] of tries) {
    if (t.finishedAt && Date.parse(t.finishedAt) < cutoff) tries.delete(id);
  }
}

function tryView(run: TryRun) {
  return { try_id: run.id, status: run.status, result: run.result, error: run.error, started_at: run.startedAt, finished_at: run.finishedAt };
}

/** The caller's own agent by bare name or GAII, or a refusal that names the problem. */
export async function resolveCrewAgent(
  deps: CrewDeps, caller: CrewCaller, identifier: string,
): Promise<{ ok: true; agent: AgentRecord } | CrewRefusal> {
  const gaii = identifier.includes('#') ? identifier : buildGAII(identifier, caller.owner, deps.config.nodeId);
  const agent = await deps.storage.getAgent(gaii);
  if (!agent) {
    return { ok: false, status: 404, code: 'AGENT_NOT_FOUND', message: `There is no agent called ${identifier} on your account. Check the name in Profile → Agents.` };
  }
  if (agent.owner !== caller.owner) {
    return { ok: false, status: 403, code: 'ACCESS_DENIED', message: `${identifier} belongs to someone else, so its definition cannot be reached from here. See your own agents in Profile → Agents.` };
  }
  return { ok: true, agent };
}

/** An app grant may use the account; it may not change what an agent is. */
function refuseAppGrant(caller: CrewCaller): CrewRefusal | null {
  if (!caller.roles.includes('app')) return null;
  return {
    ok: false, status: 403, code: 'ACCESS_DENIED',
    message: 'An app cannot change an agent\'s definition. Do it from the Crew tab in Profile → Agents, or from your own AI connected over MCP.',
  };
}

type AskOutcome = { ok: true; result: unknown } | CrewRefusal;

/**
 * Ask the agent's runtime to run `capability` and wait for the answer. Every way this can fail is
 * named for the person: not connected, connected but no runtime collecting calls, too slow.
 */
export async function askCrew(
  config: AimeatConfig, agent: AgentRecord, capability: string, input: unknown, caller: string, timeoutMs: number,
): Promise<AskOutcome> {
  const mgr = getActiveConnectTunnelManager();
  if (!mgr || !mgr.isConnected(agent.gaii)) {
    return {
      ok: false, status: 409, code: 'AGENT_OFFLINE',
      message: `${agent.name} is not connected right now, so it cannot check this definition. Start its runtime (aimeat connect serve) and try again.`,
    };
  }
  try {
    const reply = await mgr.invokeOnPrincipal(agent.gaii, { capability, input, caller }, timeoutMs);
    if (reply.ok) return { ok: true, result: reply.result };
    const r = (reply.result && typeof reply.result === 'object') ? reply.result as { code?: unknown; message?: unknown } : {};
    const code = typeof r.code === 'string' ? r.code : 'CREW_RUNTIME_ERROR';
    if (code === 'NO_HANDLER' || code === 'UNSUPPORTED') {
      return {
        ok: false, status: 409, code: 'CREW_RUNTIME_MISSING',
        message: `${agent.name} is connected, but nothing on its side answers "${capability}" calls. Its runtime has to be the JSON crew runtime (aimeat-crewai 0.22+ with on_invoke); update and restart it, then try again.`,
        details: reply.result,
      };
    }
    return {
      ok: false, status: 502, code: 'CREW_RUNTIME_ERROR',
      message: typeof r.message === 'string' ? r.message : `${agent.name}'s runtime could not complete "${capability}". Check its log and try again.`,
      details: reply.result,
    };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'ECOSYSTEM_TIMEOUT') {
      return {
        ok: false, status: 504, code: 'AGENT_TIMEOUT',
        message: `${agent.name} did not answer within ${Math.round(timeoutMs / 1000)} seconds. Check that its runtime is running and not busy, then try again.`,
      };
    }
    if (e.code === 'ECOSYSTEM_OFFLINE') {
      return { ok: false, status: 409, code: 'AGENT_OFFLINE', message: `${agent.name} went offline before it could answer. Start its runtime and try again.` };
    }
    logger.warn('crew-ops: invoke failed', { agent: agent.gaii, capability, error: String(err) });
    return { ok: false, status: 502, code: 'CREW_RUNTIME_ERROR', message: `Asking ${agent.name} failed: ${e.message ?? String(err)}. Try again in a moment.` };
  }
}

/** The runtime's validation answer, as strings and nothing else — they are shown verbatim. */
function errorsOf(result: unknown): string[] | null {
  const r = (result && typeof result === 'object') ? result as { errors?: unknown } : null;
  if (!r || !Array.isArray(r.errors)) return null;
  return r.errors.filter((e): e is string => typeof e === 'string');
}

function unreadableVerdict(agent: AgentRecord, result: unknown): CrewRefusal {
  return {
    ok: false, status: 502, code: 'CREW_RUNTIME_ERROR',
    message: `${agent.name}'s runtime answered in a shape this node does not understand. Update the runtime and try again.`,
    details: result,
  };
}

/** Everything the Crew tab shows, in one read, plus whether the agent is on the tunnel now. */
export async function crewState(deps: CrewDeps, caller: CrewCaller, identifier: string): Promise<
  | ({ ok: true; agent: string; gaii: string; key: string; online: boolean; version_window: number; try_timeout_ms: number } & CrewState)
  | CrewRefusal
> {
  const target = await resolveCrewAgent(deps, caller, identifier);
  if (!target.ok) return target;
  const { agent } = target;
  const state = await readCrewState(deps.storage, agent);
  const mgr = getActiveConnectTunnelManager();
  return {
    ok: true,
    agent: agent.name,
    gaii: agent.gaii,
    key: crewKeysFor(agent.name).base,
    online: !!mgr && mgr.isConnected(agent.gaii),
    ...state,
    version_window: CREW_VERSION_WINDOW,
    try_timeout_ms: deps.config.crewTryTimeoutMs,
  };
}

/** The runtime's verdict, verbatim. Nothing is stored. */
export async function crewValidate(deps: CrewDeps, caller: CrewCaller, identifier: string, doc: Doc): Promise<
  { ok: true; valid: boolean; errors: string[] } | CrewRefusal
> {
  const target = await resolveCrewAgent(deps, caller, identifier);
  if (!target.ok) return target;
  const asked = await askCrew(deps.config, target.agent, 'crew.validate', { doc }, caller.principal, deps.config.connectTunnelRequestTimeoutMs);
  if (!asked.ok) return asked;
  const errors = errorsOf(asked.result);
  if (!errors) return unreadableVerdict(target.agent, asked.result);
  return { ok: true, valid: errors.length === 0, errors };
}

/** Start ONE trial run on the runtime. Returns at once; the run can take minutes. */
export async function crewTryStart(deps: CrewDeps, caller: CrewCaller, identifier: string, doc: Doc, prompt: string): Promise<
  { ok: true; try_id: string; status: 'running'; started_at: string; timeout_ms: number } | CrewRefusal
> {
  const target = await resolveCrewAgent(deps, caller, identifier);
  if (!target.ok) return target;
  const { agent } = target;
  const mgr = getActiveConnectTunnelManager();
  if (!mgr || !mgr.isConnected(agent.gaii)) {
    return { ok: false, status: 409, code: 'AGENT_OFFLINE', message: `${agent.name} is not connected right now, so it cannot run a trial. Start its runtime (aimeat connect serve) and try again.` };
  }
  sweepTries();
  const run: TryRun = { id: randomUUID(), agentGaii: agent.gaii, status: 'running', result: null, error: null, startedAt: new Date().toISOString(), finishedAt: null };
  tries.set(run.id, run);
  void askCrew(deps.config, agent, 'crew.try', { doc, prompt }, caller.principal, deps.config.crewTryTimeoutMs).then(asked => {
    run.finishedAt = new Date().toISOString();
    if (asked.ok) { run.status = 'done'; run.result = asked.result; }
    else { run.status = 'failed'; run.error = { code: asked.code, message: asked.message }; run.result = asked.details ?? null; }
  });
  return { ok: true, try_id: run.id, status: 'running', started_at: run.startedAt, timeout_ms: deps.config.crewTryTimeoutMs };
}

/** One look at a trial. */
export async function crewTryPoll(deps: CrewDeps, caller: CrewCaller, identifier: string, tryId: string): Promise<
  ({ ok: true } & ReturnType<typeof tryView>) | CrewRefusal
> {
  const target = await resolveCrewAgent(deps, caller, identifier);
  if (!target.ok) return target;
  const run = tries.get(tryId);
  if (!run || run.agentGaii !== target.agent.gaii) {
    return { ok: false, status: 404, code: 'TRY_NOT_FOUND', message: 'That trial is not here any more: results are kept for 15 minutes and never stored. Run the trial again.' };
  }
  return { ok: true, ...tryView(run) };
}

/** Wait up to `waitMs` for a trial to finish, polling once a second. What chat wants: one call, one answer. */
export async function crewTryWait(deps: CrewDeps, caller: CrewCaller, identifier: string, tryId: string, waitMs: number): Promise<
  ({ ok: true } & ReturnType<typeof tryView>) | CrewRefusal
> {
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    const look = await crewTryPoll(deps, caller, identifier, tryId);
    if (!look.ok || look.status !== 'running' || Date.now() >= deadline) return look;
    await new Promise(r => setTimeout(r, Math.min(1000, Math.max(50, deadline - Date.now()))));
  }
}

export async function crewDraftSave(deps: CrewDeps, caller: CrewCaller, identifier: string, doc: Doc): Promise<
  { ok: true; saved: true; savedAt: string } | CrewRefusal
> {
  const target = await resolveCrewAgent(deps, caller, identifier);
  if (!target.ok) return target;
  const app = refuseAppGrant(caller);
  if (app) return app;
  const out = await saveCrewDraft(deps, caller, target.agent, doc);
  if (!out.ok) return out;
  return { ok: true, saved: true, savedAt: (out.record.value as { savedAt?: string }).savedAt ?? out.record.updatedAt };
}

export async function crewDraftDiscard(deps: CrewDeps, caller: CrewCaller, identifier: string): Promise<
  { ok: true; discarded: boolean } | CrewRefusal
> {
  const target = await resolveCrewAgent(deps, caller, identifier);
  if (!target.ok) return target;
  const app = refuseAppGrant(caller);
  if (app) return app;
  return { ok: true, discarded: await discardCrewDraft(deps.storage, target.agent) };
}

/** The shared publish gate: the runtime validates first, and only a clean verdict is written. */
async function validateThenPublish(deps: CrewDeps, caller: CrewCaller, agent: AgentRecord, doc: Doc): Promise<
  { ok: true; published: true; revision: number; publishedAt: string; key: string } | CrewRefusal
> {
  const asked = await askCrew(deps.config, agent, 'crew.validate', { doc }, caller.principal, deps.config.connectTunnelRequestTimeoutMs);
  if (!asked.ok) return asked;
  const errors = errorsOf(asked.result);
  if (!errors) return unreadableVerdict(agent, asked.result);
  if (errors.length > 0) {
    return {
      ok: false, status: 422, code: 'CREW_INVALID',
      message: `${agent.name}'s validator found ${errors.length} problem${errors.length === 1 ? '' : 's'}, so nothing was published. Fix them and publish again.`,
      details: { errors },
    };
  }
  const out = await publishCrewDef(deps, caller, agent, doc);
  if (!out.ok) return out;
  return { ok: true, published: true, revision: out.revision, publishedAt: out.publishedAt, key: out.key };
}

/** Becomes the live definition the runtime reloads — after the runtime itself has accepted it. */
export async function crewPublish(deps: CrewDeps, caller: CrewCaller, identifier: string, doc: Doc) {
  const target = await resolveCrewAgent(deps, caller, identifier);
  if (!target.ok) return target;
  const app = refuseAppGrant(caller);
  if (app) return app;
  return validateThenPublish(deps, caller, target.agent, doc);
}

/**
 * The FIRST definition for an agent that has none, validated by a sibling when the agent itself
 * cannot answer.
 *
 * THE CHICKEN AND EGG THIS EXISTS FOR. `crewPublish` asks the TARGET's own runtime to validate, and
 * that is the right validator: it is the thing that will run the definition. But an agent the
 * basic-agents button just created has no runtime and nothing to load, because what it would load
 * is the definition being published. So the ordinary path answers AGENT_OFFLINE forever, and
 * crew-forge cannot give an agent it just made anything to be.
 *
 * WHY IT IS A SEPARATE DOOR AND NOT A FLAG ON PUBLISH. It refuses an agent that already has a
 * published definition, so it can only ever ADD a first one and never replace one. That is what
 * makes a weaker validator acceptable here: the worst case is a brand-new agent whose first
 * definition a sibling approved, and the owner can see who that was.
 *
 * WHO VALIDATES, in order: the agent itself when it is connected (unchanged from publish, and the
 * best answer); otherwise the sibling named in `validateWith`; otherwise any connected same-owner
 * agent, chosen deterministically so a retry asks the same one. Whoever it was is recorded on the
 * envelope as `validatedBy`, because "checked" and "checked by something else" are different
 * claims. With nothing of this owner's connected at all, the refusal stands as before.
 */
export async function crewSeed(
  deps: CrewDeps, caller: CrewCaller, identifier: string, doc: Doc, validateWith?: string,
): Promise<{ ok: true; seeded: true; revision: number; publishedAt: string; key: string; validatedBy: string } | CrewRefusal> {
  const target = await resolveCrewAgent(deps, caller, identifier);
  if (!target.ok) return target;
  const app = refuseAppGrant(caller);
  if (app) return app;
  const agent = target.agent;

  // Seed means FIRST. An agent that already has one goes through publish, where its own runtime
  // has the say — refusing here is what keeps this door from becoming a way around that.
  const state = await readCrewState(deps.storage, agent);
  if (state.published) {
    return {
      ok: false, status: 409, code: 'ALREADY_DEFINED',
      message: `${agent.name} already has a definition, so this is not a first one. Change it with publish, which asks ${agent.name}'s own runtime first.`,
    };
  }

  const chosen = await chooseSeedValidator(deps, caller, agent, validateWith);
  if (!chosen.ok) return chosen;

  const asked = await askCrew(deps.config, chosen.validator, 'crew.validate', { doc }, caller.principal, deps.config.connectTunnelRequestTimeoutMs);
  if (!asked.ok) return asked;
  const errors = errorsOf(asked.result);
  if (!errors) return unreadableVerdict(chosen.validator, asked.result);
  if (errors.length > 0) {
    return {
      ok: false, status: 422, code: 'CREW_INVALID',
      message: `${chosen.validator.name}'s validator found ${errors.length} problem${errors.length === 1 ? '' : 's'} in this definition, so nothing was written. Fix them and seed again.`,
      details: { errors, validated_by: chosen.validator.gaii },
    };
  }

  const validatedBy = chosen.validator.gaii === agent.gaii ? undefined : chosen.validator.gaii;
  const out = await publishCrewDef(deps, caller, agent, doc, validatedBy);
  if (!out.ok) return out;
  return { ok: true, seeded: true, revision: out.revision, publishedAt: out.publishedAt, key: out.key, validatedBy: chosen.validator.gaii };
}

/** The agent itself when it can answer, else a named sibling, else any connected one. */
async function chooseSeedValidator(
  deps: CrewDeps, caller: CrewCaller, agent: AgentRecord, validateWith?: string,
): Promise<{ ok: true; validator: AgentRecord } | CrewRefusal> {
  const mgr = getActiveConnectTunnelManager();
  if (mgr?.isConnected(agent.gaii)) return { ok: true, validator: agent };

  if (validateWith) {
    const named = await resolveCrewAgent(deps, caller, validateWith);
    if (!named.ok) return named;
    if (!mgr?.isConnected(named.agent.gaii)) {
      return {
        ok: false, status: 409, code: 'AGENT_OFFLINE',
        message: `${named.agent.name} is not connected, so it cannot check this definition. Start its runtime, or leave the validator unset and any connected agent of yours will do it.`,
      };
    }
    return { ok: true, validator: named.agent };
  }

  // Sorted, so a retry asks the same runtime and two attempts cannot disagree for a reason nobody
  // can see. The target is excluded: it was already tried above and is not connected.
  const siblings = (await deps.storage.getAgentsByOwner(caller.owner))
    .filter(a => a.gaii !== agent.gaii && !!mgr?.isConnected(a.gaii))
    .sort((x, y) => x.gaii.localeCompare(y.gaii));
  const validator = siblings[0];
  if (!validator) {
    return {
      ok: false, status: 409, code: 'NO_VALIDATOR',
      message: `${agent.name} has no runtime yet and none of your other agents is connected to check its first definition. Start your connector (aimeat connect serve) and try again.`,
    };
  }
  return { ok: true, validator };
}

/** A kept revision goes back through the same gate and becomes a new revision. */
export async function crewRestore(deps: CrewDeps, caller: CrewCaller, identifier: string, revision: number) {
  const target = await resolveCrewAgent(deps, caller, identifier);
  if (!target.ok) return target;
  const app = refuseAppGrant(caller);
  if (app) return app;
  const kept = await readCrewRevision(deps.storage, target.agent, revision);
  if (!kept) {
    return {
      ok: false as const, status: 404, code: 'REVISION_NOT_FOUND',
      message: `Revision ${revision} of ${target.agent.name}'s definition is not kept any more (the last ${CREW_VERSION_WINDOW} are). Pick one from the list.`,
    };
  }
  return validateThenPublish(deps, caller, target.agent, kept.doc);
}
