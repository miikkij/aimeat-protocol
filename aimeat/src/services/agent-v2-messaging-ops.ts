/**
 * @file src/services/agent-v2-messaging-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AUTHORISED operations behind Agent v2 messaging: validate, resolve, refuse, then
 *   act. Every door calls these — the REST route, the node MCP tool, the connector tool and the CLI
 *   dispatch — so the fences are written once.
 *
 *   WHY THIS FILE EXISTS AND NOT JUST THE ROUTE. A tool that reaches storage directly is a second
 *   implementation of the same capability, and this repository has already paid for that three
 *   times inside one MCP tool: `aimeat_memory_write` had its schema locks, its write target and its
 *   provenance each fixed once, in one place, while the other surface kept the old behaviour. The
 *   split here is deliberate: agent-v2-messaging.ts is the MECHANISM (store the turn, notify), this
 *   file is the DECISION (may this principal do that, to that recipient), and a door is a shape.
 *
 *   A REFUSAL IS DATA, NOT AN EXCEPTION. Each operation answers `{ ok: false, status, code,
 *   message }`, because the four doors present a refusal four different ways — a status code, an
 *   MCP isError, a CLI exit — and a thrown error would make each of them guess which one this was.
 *
 * @structure OpResult · resolveRecipient() · sendTurn() · listTurns() · getTurn() · setPushTarget()
 *   · listPushTargets() · deletePushTarget()
 * @usage const out = await sendTurn(storage, config, req.auth!, req.body);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V4).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentV2MessageRecord, AgentV2PushConfigRecord } from '../storage/interface.js';
import { resolveIdentity, parseGaiiLoose, isGEAI } from '../utils/gaii.js';
import { validateMessageInput, validatePushConfigInput, publicPushConfig } from '../models/agent-v2-message.js';
import { sendAgentV2Message } from './agent-v2-messaging.js';

/** What every door is authenticated as. The same shape `req.auth` carries. */
export interface Principal {
  sub: string;
  owner: string;
  roles: string[];
}

export type OpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> };

/** The largest page a listing answers with, whatever was asked for. */
const MAX_LIST_LIMIT = 200;

function isOwnerSession(auth: Principal): boolean {
  const roles = auth.roles ?? [];
  return roles.includes('owner') && !roles.includes('agent') && !roles.includes('ecosystem');
}

/**
 * Is `principal` a real principal of `owner` on this node? Three shapes qualify: the owner's own
 * GHII, one of their agents, one of their ecosystem apps.
 *
 * THE OWNER SEGMENT IS CHECKED FIRST, so a principal on somebody else's account is answered as
 * cross-owner rather than as "no such thing" — the second answer is a membership oracle, and this
 * door would otherwise let anyone enumerate another account's agents one guess at a time.
 *
 * And it is a LOOKUP, not a parse: a well-formed identity naming the right owner is not evidence
 * that the principal exists, and a turn addressed to an agent nobody created is a turn nothing will
 * ever read, reported as accepted.
 */
export async function resolveRecipient(
  storage: Storage, nodeId: string, owner: string, principal: string,
): Promise<OpResult<string>> {
  const parsed = parseGaiiLoose(principal);
  if (!parsed.owner) {
    return { ok: false, status: 400, code: 'INVALID_RECIPIENT', message: `${principal} is not an identity this node can address.` };
  }
  if (parsed.owner !== owner) {
    return {
      ok: false, status: 403, code: 'ACCESS_DENIED',
      message: 'This road carries turns between principals of one account. To reach another person use a direct message.',
    };
  }
  const exists = principal === `${owner}@${nodeId}`
    || (isGEAI(principal) ? !!(await storage.getEcosystemApp(principal)) : !!(await storage.getAgent(principal)));
  if (!exists) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: `No principal named ${principal} on this account. List them with GET /v1/agents.` };
  }
  return { ok: true, value: principal };
}

/** Send one turn. The body is whatever the door received, unvalidated. */
export async function sendTurn(
  storage: Storage, config: AimeatConfig, auth: Principal, body: unknown,
): Promise<OpResult<AgentV2MessageRecord>> {
  const parsed = validateMessageInput(body);
  if (!parsed.ok || !parsed.message) {
    return {
      ok: false, status: 400, code: 'INVALID_MESSAGE',
      message: 'This turn cannot be sent as written. Every defect is listed in details.defects; fix them and send it again.',
      details: { defects: parsed.defects },
    };
  }
  const input = parsed.message;
  const recipient = await resolveRecipient(storage, config.nodeId, auth.owner, input.to);
  if (!recipient.ok) return recipient;

  // A taskId is an ADDRESS, so it is checked the same way a recipient is: a turn filed against a
  // task that does not exist is a turn nobody reading that task will ever find, reported as sent.
  if (input.taskId) {
    const task = await storage.getAgentV2Task(auth.owner, input.taskId);
    if (!task) {
      return { ok: false, status: 404, code: 'NOT_FOUND', message: `No task ${input.taskId} on this account.` };
    }
  }

  const message = await sendAgentV2Message(storage, {
    owner: auth.owner,
    from: resolveIdentity(auth, config.nodeId),
    to: input.to,
    role: input.role,
    parts: input.parts,
    contextId: input.contextId,
    taskId: input.taskId,
    metadata: input.metadata,
  });
  return { ok: true, value: message };
}

export interface TurnFilter {
  context_id?: string;
  task_id?: string;
  to?: string;
  from?: string;
  since?: string;
  limit?: number;
}

export async function listTurns(
  storage: Storage, auth: Principal, filter: TurnFilter,
): Promise<OpResult<AgentV2MessageRecord[]>> {
  const raw = Number(filter.limit ?? 50);
  const limit = Number.isFinite(raw) ? Math.min(MAX_LIST_LIMIT, Math.max(1, Math.trunc(raw))) : 50;
  const messages = await storage.listAgentV2Messages(auth.owner, {
    contextId: filter.context_id, taskId: filter.task_id,
    to: filter.to, from: filter.from, since: filter.since, limit,
  });
  return { ok: true, value: messages };
}

export async function getTurn(storage: Storage, auth: Principal, messageId: string): Promise<OpResult<AgentV2MessageRecord>> {
  const message = await storage.getAgentV2Message(auth.owner, messageId);
  if (!message) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'No such turn on this account.' };
  return { ok: true, value: message };
}

export interface PushTargetResult {
  config: ReturnType<typeof publicPushConfig>;
  /** Whether this call created it, so a door can answer 201 rather than 200. */
  created: boolean;
}

/**
 * Register or replace a delivery target.
 *
 * A principal may register one for ITSELF; the account holder may register one for any principal on
 * the account, which is how a person wires up an agent that is not running yet.
 */
export async function setPushTarget(
  storage: Storage, config: AimeatConfig, auth: Principal, body: unknown,
): Promise<OpResult<PushTargetResult>> {
  const parsed = validatePushConfigInput(body);
  if (!parsed.ok || !parsed.config) {
    return {
      ok: false, status: 400, code: 'INVALID_PUSH_CONFIG',
      message: 'This delivery target cannot be registered as written. Every defect is listed in details.defects.',
      details: { defects: parsed.defects },
    };
  }
  const input = parsed.config;
  const self = resolveIdentity(auth, config.nodeId);
  const asked = (body && typeof body === 'object' && typeof (body as Record<string, unknown>).principal === 'string')
    ? ((body as Record<string, string>).principal).trim() : '';
  const target = asked !== '' ? asked : self;

  if (target !== self && !isOwnerSession(auth)) {
    return {
      ok: false, status: 403, code: 'ACCESS_DENIED',
      message: 'A principal may register a delivery target for itself. Registering one for another principal is the account holder’s to do.',
    };
  }
  const recipient = await resolveRecipient(storage, config.nodeId, auth.owner, target);
  if (!recipient.ok) return recipient;

  // A SUPPLIED ID MUST ALREADY BE THIS ACCOUNT'S. The store upserts on the id alone, so a caller
  // naming an id that belongs to somebody else would OVERWRITE their delivery target — a
  // cross-owner write dressed as a configuration change, and the read that would have caught it is
  // exactly the one being skipped.
  const existing = input.id ? await storage.getAgentV2PushConfig(auth.owner, input.id) : null;
  if (input.id && !existing) {
    return {
      ok: false, status: 409, code: 'ID_NOT_AVAILABLE',
      message: 'An id you send must be one already registered on this account. Omit `id` to be assigned one.',
    };
  }

  const now = new Date().toISOString();
  const record: AgentV2PushConfigRecord = {
    id: existing?.id ?? randomUUID(),
    principal: target,
    owner: auth.owner,
    url: input.url,
    token: input.token,
    authSchemes: input.schemes,
    // Omitting credentials on a replace CLEARS them rather than keeping the old secret. A caller
    // that has stopped sending one has said something, and quietly continuing to send the previous
    // secret to a URL they may also have changed is the wrong reading of it.
    authCredentials: input.credentials,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastSuccessAt: existing?.lastSuccessAt ?? null,
    lastFailureAt: null,
    failCount: 0,
    disabledAt: null,
  };
  await storage.upsertAgentV2PushConfig(record);
  return { ok: true, value: { config: publicPushConfig(record), created: !existing } };
}

/**
 * What is registered. An agent sees its own targets; the account holder sees the account's, or one
 * principal's when they name it. An agent naming another principal gets its own back rather than a
 * refusal: "what is registered for somebody else" is not a question this door answers at all.
 */
export async function listPushTargets(
  storage: Storage, config: AimeatConfig, auth: Principal, askedPrincipal?: string,
): Promise<OpResult<ReturnType<typeof publicPushConfig>[]>> {
  const principal = isOwnerSession(auth)
    ? (askedPrincipal && askedPrincipal.trim() !== '' ? askedPrincipal : undefined)
    : resolveIdentity(auth, config.nodeId);
  const configs = await storage.listAgentV2PushConfigs(auth.owner, principal);
  return { ok: true, value: configs.map(publicPushConfig) };
}

export async function deletePushTarget(
  storage: Storage, config: AimeatConfig, auth: Principal, id: string,
): Promise<OpResult<string>> {
  const found = await storage.getAgentV2PushConfig(auth.owner, id);
  if (!found) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'No such delivery target on this account.' };
  if (found.principal !== resolveIdentity(auth, config.nodeId) && !isOwnerSession(auth)) {
    return {
      ok: false, status: 403, code: 'ACCESS_DENIED',
      message: 'That delivery target belongs to another principal on this account.',
    };
  }
  await storage.deleteAgentV2PushConfig(auth.owner, found.id);
  return { ok: true, value: found.id };
}
