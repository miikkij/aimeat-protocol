/**
 * @file src/services/operator-override.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator check for an endpoint that otherwise serves only the thing's own owner:
 *   "the caller owns it, or the caller is the node operator". REST routes and services asked the
 *   second half inline as `req.auth.roles.includes('operator')`, which the MCP tools did not ask
 *   (they ask askOperator), so the two surfaces disagreed: the operator's own agent holding
 *   operator:admin was refused on REST and admitted on MCP, and an operator acting in another
 *   person's account left no trace on most routes (secaudit 2026-10, C2).
 *
 *   THE RULE, ruled by Jouni on 2026-10-05: one question on every operator check of both surfaces,
 *   askOperator() (services/operator-principal.ts). The operator in person passes; an agent of the
 *   operator passes while it holds operator:admin ("Agent must be capable of maintaining the system
 *   fully when using operator:admin rights"). A pass in another person's account writes the operator
 *   trail (recordOperatorAction): a usage row in the operator's stream and a line in that person's
 *   account feed ("the operator can do whatever the operator sees necessary ... logged and the user
 *   notified").
 *
 *   TWO FUNCTIONS. isOperatorCaller() answers the question alone, for a flag a service takes and for
 *   a check that is not about another person's thing (a node-wide list, a role that may create).
 *   operatorOverride() is the check for another person's thing, and writes the trail when it admits.
 * @structure OperatorAuth · OperatorAct · isOperatorCaller() · rolesWithOperator() · operatorOverride()
 * @usage
 *   if (board.ownerGaii !== gaii && !(await operatorOverride(storage, config, req.auth,
 *     { ownerOf: board.ownerGaii, area: 'board', action: 'delete', subject: board.name }))) return refuse();
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C2).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { askOperator } from './operator-principal.js';
import { recordOperatorAction } from './operator-access-audit.js';
import { OPERATOR_ADMIN_SCOPE } from '../utils/scope-coverage.js';
import { ownerGhiiOf } from '../utils/gaii.js';

/** The session as a route holds it (`req.auth`), or the same fields a service was given. */
export interface OperatorAuth {
  sub: string;
  owner?: string;
  roles?: readonly string[];
  scopes?: readonly string[];
  federated?: boolean;
  anonymous?: boolean;
}

/** What the operator did in the other person's account, for the trail. */
export interface OperatorAct {
  /** Any principal of the account the thing belongs to: its owner's GHII, a GAII, a bare name. */
  ownerOf: string;
  /** What kind of thing: 'board', 'capability', 'account', 'app', ... */
  area: string;
  /** What was done: 'read', 'update', 'delete', 'export', ... */
  action: string;
  /** The thing's name, for the person's feed. */
  subject?: string;
}

/** The account name behind a principal, as recordOperatorAction needs it in GHII form. */
function ghiiOf(name: string, nodeId: string): string {
  return name.includes('@') ? ownerGhiiOf(name) : `${name}@${nodeId}`;
}

/**
 * Does this session pass an operator check? The operator in person, or something acting for the
 * operator account that holds `word` (operator:admin by default). Never a visitor from another node,
 * never an anonymous session.
 */
export async function isOperatorCaller(
  storage: Storage, auth: OperatorAuth | null | undefined, word: string = OPERATOR_ADMIN_SCOPE,
): Promise<boolean> {
  if (!auth?.sub || auth.anonymous) return false;
  return (await askOperator(storage, {
    sub: auth.sub,
    ...(auth.owner !== undefined ? { owner: auth.owner } : {}),
    ...(auth.roles ? { roles: auth.roles } : {}),
    ...(auth.scopes ? { scopes: auth.scopes } : {}),
    ...(auth.federated !== undefined ? { federated: auth.federated } : {}),
  }, word)).ok;
}

/**
 * The session's roles for a service that rules on `roles.includes('operator')` (the board services):
 * 'operator' is in the list exactly when isOperatorCaller() says yes. The MCP tools build the same
 * list (mcp/boards.ts boardCaller), so a service sees one answer from both surfaces.
 */
export async function rolesWithOperator(
  storage: Storage, auth: OperatorAuth | null | undefined,
): Promise<string[]> {
  const roles = (auth?.roles ?? []).filter((r) => r !== 'operator');
  return (await isOperatorCaller(storage, auth)) ? [...roles, 'operator'] : roles;
}

/**
 * The operator's pass to another person's thing: true when the session passes the operator check,
 * and then the act is written to the operator trail before the caller acts (a thing of the
 * operator's own account writes nothing). The caller asks this only after the ownership test failed.
 */
export async function operatorOverride(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>,
  auth: OperatorAuth | null | undefined, act: OperatorAct,
): Promise<boolean> {
  if (!auth?.sub || auth.anonymous) return false;
  const answer = await askOperator(storage, {
    sub: auth.sub,
    ...(auth.owner !== undefined ? { owner: auth.owner } : {}),
    ...(auth.roles ? { roles: auth.roles } : {}),
    ...(auth.scopes ? { scopes: auth.scopes } : {}),
    ...(auth.federated !== undefined ? { federated: auth.federated } : {}),
  });
  if (!answer.ok) return false;
  await recordOperatorAction(storage, config, {
    operatorGhii: ghiiOf(answer.name, config.nodeId),
    actorGaii: auth.sub.includes('@') ? auth.sub : ghiiOf(auth.sub, config.nodeId),
    ownerOf: ghiiOf(act.ownerOf, config.nodeId),
    area: act.area,
    action: act.action,
    ...(act.subject !== undefined ? { subject: act.subject } : {}),
  });
  return true;
}
