/**
 * @file src/services/connector-programs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The programs a connector may start for its agents, on the node: what the machine
 *   reports, the owner's question about a program that waits, and the owner's decision either way
 *   (wish-koneen-ohjelmaluettelo-nodeen-sallitut-ja-hyv-ksynt-odottava).
 *
 *   WHY. A connector starts an agent's runner or wake command only when it trusts it
 *   (cli/connect/command-trust.ts), and until now it said so only on the machine's own console. So a
 *   program that came with a folder waited in silence, and neither the owner nor their AI could tell
 *   what a computer may start before planning work on it. Now each agent's connector reports that
 *   agent's programs here, a program that waits asks the owner once, and the owner (or an agent of
 *   theirs that holds agent:write) allows or stops any program, from the page, from chat or over REST.
 *
 *   WHO REPORTS. Only the agent itself, on the connector that holds its socket right now: the node
 *   finds the machine from the live tunnel, never from the request. Another agent cannot write a
 *   report for a machine it is not on.
 *
 *   WHAT A DECISION CAN DO. The node keeps the decision per hash and the machine reads it back. The
 *   machine takes an allowed program into use only when it holds that hash itself, so a report the
 *   node did not get from the machine changes nothing there. A program the machine trusts stops when
 *   the owner says no, and starts again when they say yes.
 * @structure AgentProgramsReport · reportAgentPrograms · setProgramDecision
 * @usage
 *   const out = await reportAgentPrograms(ctx, caller, req.body);            // PUT /v1/agents/:name/programs
 *   const out = await setProgramDecision(ctx, { caller }, id, hash, 'allow'); // PUT /v1/agents/v2/connectors/:id/programs/:hash
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-koneen-ohjelmaluettelo-nodeen-sallitut-ja-hyv-ksynt-odottava).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from './caller-context.js';
import { findConnector, listConnectors, liveConnectorOf, mutateConnector } from './connector-registry.js';
import { programStatusOf, type ProgramAsk, type ProgramSource, type StoredAgentPrograms, type ProgramView } from './connector-programs-view.js';
import { recordProgramDecision } from './connector-program-decision.js';
import { fileAsk, requesterOf } from './publish-requests/ask.js';
import { approveUrl, effectiveState, readPublishRequest } from './publish-requests/store.js';
import { decidePublishRequest, type PublishViewer } from './publish-requests/decide.js';
import { emitChange } from './event-bus.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

type Ctx = { config: AimeatConfig; storage: Storage };
type Fail = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });

const HASH = /^[0-9a-f]{64}$/;
const COMMAND_MAX = 1000;
const SOURCES: readonly ProgramSource[] = ['connected', 'adopted', 'approved'];

/** What one agent's connector reports for it. `hash` null: the agent has no runner and no wake command. */
export interface AgentProgramsReport {
  hash: string | null;
  status: 'allowed' | 'waiting' | null;
  runner: string | null;
  wake: string | null;
  source: ProgramSource | null;
  since: string | null;
}

function parseReport(body: unknown): AgentProgramsReport | Fail {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const text = (v: unknown, name: string): string | null | Fail => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' || v.length > COMMAND_MAX) return fail(400, 'INVALID_INPUT', `${name} is a string of at most ${COMMAND_MAX} characters.`);
    return v;
  };
  if (b.hash === null || b.hash === undefined) return { hash: null, status: null, runner: null, wake: null, source: null, since: null };
  if (typeof b.hash !== 'string' || !HASH.test(b.hash)) return fail(400, 'INVALID_INPUT', 'hash is the 64-character hex hash the connector holds the commands under.');
  if (b.status !== 'allowed' && b.status !== 'waiting') return fail(400, 'INVALID_INPUT', "status is 'allowed' or 'waiting'.");
  const runner = text(b.runner, 'runner');
  if (runner && typeof runner === 'object') return runner;
  const wake = text(b.wake, 'wake');
  if (wake && typeof wake === 'object') return wake;
  if (!runner && !wake) return fail(400, 'INVALID_INPUT', 'A report with a hash names a runner, a wake command or both.');
  const source = b.status === 'allowed' && SOURCES.includes(b.source as ProgramSource) ? b.source as ProgramSource : null;
  const since = b.status === 'allowed' && typeof b.since === 'string' && !Number.isNaN(Date.parse(b.since)) ? new Date(b.since).toISOString() : null;
  return { hash: b.hash, status: b.status, runner: runner as string | null, wake: wake as string | null, source, since };
}

/** The commands of a report as one line a person reads. */
const commandLine = (p: Pick<StoredAgentPrograms, 'runner' | 'wake'>) => [p.runner, p.wake].filter(Boolean).join(' · ').slice(0, 200);

/** File the owner's question about a program that waits, unless one already waits for it. */
async function askOwner(ctx: Ctx, caller: CallerContext, installId: string, agent: string, p: StoredAgentPrograms): Promise<string | null> {
  const machine = (await listConnectors(ctx, caller.owner)).find(c => c.id === installId)?.name ?? installId;
  const command = commandLine(p);
  const filed = await fileAsk(ctx, caller.owner, requesterOf(ctx, caller), {
    kind: 'connector-program',
    target: { owner: caller.owner, connector: installId, hash: p.hash },
    title: `a program on the computer ${machine}`,
    name: command,
    change: { field: 'connector.program', from: 'waiting', to: 'allowed' },
    approval: {
      approver: 'owner',
      asks: `let the computer ${machine} start ${command} for ${agent}`,
      why: `The computer ${machine} starts a program for an agent only when you allowed it, and this one came with the settings on that computer without anybody connecting it there. If you allow it, ${agent} starts working with it at the computer's next connection. If you do not, it does not run.`,
      approve_scope: 'agent:write',
      change: { link: '/v1/home?computers=1', key: 'approval_change.computer_programs' },
      i18n: { key: 'approval_connector_program', vars: { computer: machine, agent, command } },
    },
  });
  if (!filed.ok) {
    logger.warn('Connector programs: the question to the owner could not be filed', { owner: caller.owner, connector: installId, code: filed.code });
    return null;
  }
  return filed.request.id;
}

/**
 * An agent's connector reports that agent's programs. Stored on the connector that holds the
 * agent's socket now; a program that waits and has no answer and no open question asks the owner.
 * Answers the owner's decision on the reported hash, which the connector acts on.
 */
export async function reportAgentPrograms(ctx: Ctx, caller: CallerContext, body: unknown): Promise<{ ok: true; answer: Record<string, unknown> } | Fail> {
  const agent = caller.kind === 'agent' ? parseGAII(caller.principal)?.agent : undefined;
  if (!agent) return fail(403, 'ACCESS_DENIED', 'An agent reports the programs of the computer it runs on itself.');
  const report = parseReport(body);
  if ('ok' in report) return report;
  const installId = liveConnectorOf(caller.owner, caller.principal);
  if (!installId) return fail(409, 'NOT_ON_A_CONNECTOR', 'This agent is not on a connected computer right now, so there is no computer to report for.');

  const now = new Date().toISOString();
  type Stored = 'cleared' | { p: StoredAgentPrograms; ask: ProgramAsk | undefined };
  const stored = await mutateConnector<Stored>(ctx, caller.owner, installId, (rec) => {
    const programs = { ...(rec.programs ?? {}) };
    if (!report.hash) {
      delete programs[agent];
      rec.programs = programs;
      return { write: true, result: 'cleared' };
    }
    const p: StoredAgentPrograms = { hash: report.hash, status: report.status!, runner: report.runner, wake: report.wake, source: report.source, since: report.since, reported_at: now };
    programs[agent] = p;
    rec.programs = programs;
    const asks = { ...(rec.program_asks ?? {}) };
    // A "yes" the machine has acted on is spent; a "no" stays, because it may be newer than the machine's trust.
    if (p.status === 'allowed' && asks[p.hash]?.decision !== 'declined') delete asks[p.hash];
    rec.program_asks = asks;
    return { write: true, result: { p, ask: asks[p.hash] } };
  });
  if (stored === null) return fail(409, 'NOT_ON_A_CONNECTOR', 'The computer this agent runs on could not be recorded. Try again in a moment.');
  emitChange('agents');
  if (stored === 'cleared') return { ok: true, answer: { connector: installId, hash: null, decision: null } };

  let ask = stored.ask;
  if (stored.p.status === 'waiting' && !ask?.decision) {
    const open = ask?.request_id ? await readPublishRequest(ctx.storage, caller.ownerGhii, ask.request_id) : null;
    if (!open || effectiveState(open) !== 'awaiting_owner') {
      const requestId = await askOwner(ctx, caller, installId, agent, stored.p);
      if (requestId) {
        ask = { decision: null, decided_at: null, request_id: requestId };
        await mutateConnector(ctx, caller.owner, installId, (rec) => {
          rec.program_asks = { ...(rec.program_asks ?? {}), [stored.p.hash]: rec.program_asks?.[stored.p.hash]?.decision ? rec.program_asks[stored.p.hash] : ask! };
          return { write: true, result: null };
        });
      }
    }
  }
  const { status, applied } = programStatusOf(stored.p, ask);
  return {
    ok: true,
    answer: {
      connector: installId, hash: stored.p.hash, status, applied,
      decision: ask?.decision ?? null, decided_at: ask?.decided_at ?? null,
      request_id: status === 'waiting' ? ask?.request_id ?? null : null,
      ...(status === 'waiting' ? { approve_url: approveUrl(ctx.config.baseUrl) } : {}),
    },
  };
}

/**
 * The owner, or an agent of theirs that holds agent:write, allows or stops the programs under
 * `hash` on one connector, named by its id or its name. A question that waits for the same programs
 * is answered with the same decision, so the notice and the page agree.
 */
export async function setProgramDecision(
  ctx: Ctx, viewer: PublishViewer, connector: string, hash: string, decision: unknown,
): Promise<{ ok: true; programs: ProgramView[] } | Fail> {
  const caller = viewer.caller;
  if (caller.kind !== 'owner' && caller.kind !== 'agent') return fail(403, 'ACCESS_DENIED', 'This is for the account holder and their own agents.');
  if (!caller.has('agent:write')) return fail(403, 'SCOPE_DENIED', 'Scope "agent:write" is required to allow or stop a program on a computer.');
  if (decision !== 'allow' && decision !== 'deny') return fail(400, 'INVALID_INPUT', "decision is 'allow' or 'deny'.");
  const hit = await findConnector(ctx, caller.owner, connector);
  if (hit === 'ambiguous') return fail(409, 'AMBIGUOUS_CONNECTOR', 'More than one of your computers has that name. Name it by its id.');
  if (!hit) return fail(404, 'NOT_FOUND', 'You have no such computer.');
  const rows = (hit.programs ?? []).filter(p => p.hash === hash);
  if (!rows.length) return fail(404, 'NOT_FOUND', 'That computer reports no program under that hash. aimeat_connector_list shows the programs and their hashes.');

  const waitingRequest = rows.find(p => p.request_id)?.request_id;
  if (waitingRequest) {
    const out = await decidePublishRequest(ctx, viewer, waitingRequest, decision === 'allow' ? 'approve' : 'decline');
    if (!out.ok && out.status !== 409 && out.status !== 404) return out;
    // A request that was settled meanwhile falls through to the direct decision.
  }
  if (!waitingRequest || (await stillUndecided(ctx, caller.owner, hit.id, hash, decision))) {
    const done = await recordProgramDecision(ctx, caller.owner, hit.id, hash, decision === 'allow' ? 'allowed' : 'declined');
    if (!done) return fail(404, 'NOT_FOUND', 'That computer reports no program under that hash any more.');
  }
  const after = (await listConnectors(ctx, caller.owner)).find(c => c.id === hit.id);
  return { ok: true, programs: (after?.programs ?? []).filter(p => p.hash === hash) };
}

/** True when the decision asked for is not yet recorded (a request that could not be decided). */
async function stillUndecided(ctx: Ctx, owner: string, installId: string, hash: string, decision: 'allow' | 'deny'): Promise<boolean> {
  const want = decision === 'allow' ? 'allowed' : 'declined';
  const current = await mutateConnector(ctx, owner, installId, rec => ({ write: false, result: rec.program_asks?.[hash]?.decision ?? null }));
  return current !== want;
}
