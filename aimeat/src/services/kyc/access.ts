/**
 * @file src/services/kyc/access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may do what with an organism's customer due diligence, decided once for REST and MCP.
 *
 *   WHEN IT IS ON AT ALL. Only on an obliged organism of a node that lets organisms be obliged: the
 *   operator's setting compliance.aml_mode is `owners` or `node`, and the organism has stored its
 *   declaration (the compliance document `aml`, Compliance page section 13). Otherwise every call
 *   answers KYC_NOT_ENABLED and says which of the two is missing.
 *
 *   ROLES, from the organism's KYC settings (store.ts) and its membership:
 *   - officer: the compliance officer and deputy (AMLR art. 11). Everything, and the only readers of a
 *     suspicion report (art. 73: nobody else may learn of it, the customer least of all).
 *   - staff: the members who do the due diligence: read and write cards, mark a suspicion.
 *   - manager: the organism's creator or admin: the settings, and the cards as staff.
 *   An agent acts with its person's role on cards (chat is the first way in), never on a report, and
 *   never on a human decision: approving a high-risk customer, deciding a screening hit, or extending
 *   a hold is made by the person in person. A visitor from another node gets nothing.
 * @structure KycError · KycRole · KycContext · kycContext() · requireCards · requireOfficer · requireInPerson
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { OrganismRecord } from '../../storage/types/organisms-federation.js';
import type { CallerContext } from '../caller-context.js';
import { amlMode, readAmlDeclarations } from '../aml/gate.js';
import { agentBarred } from '../organism/agent-access.js';
import { readSettings, safeKeyPart } from './store.js';
import type { KycSettings } from './contract.js';

export class KycError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export type KycRole = 'officer' | 'staff' | 'manager' | 'none';

export interface KycDeps { storage: Storage; config: AimeatConfig }

export interface KycContext {
  org: string;
  organism: OrganismRecord;
  settings: KycSettings;
  role: KycRole;
  /** The caller acts as an agent (or app) of its person, not the person in person. */
  agent: boolean;
  /** Who writes, as recorded on a version: the principal (GHII, or the agent's GAII). */
  by: string;
}

/** The organism's KYC context for this caller; refuses when KYC is not on for it. */
export async function kycContext(deps: KycDeps, caller: CallerContext, org: string): Promise<KycContext> {
  if (!safeKeyPart(org)) throw new KycError(400, 'INVALID_ORGANISM', 'Not an organism id.');
  if (caller.visitor) throw new KycError(403, 'KYC_VISITOR', 'A session from another node does not reach customer due diligence here.');
  const organism = await deps.storage.getOrganism(org);
  if (!organism) throw new KycError(404, 'ORGANISM_NOT_FOUND', 'No such organism.');
  const mode = amlMode(deps.config);
  if (mode !== 'owners' && mode !== 'node') {
    throw new KycError(403, 'KYC_NOT_ENABLED',
      'Customer due diligence is off on this server: its operator has not let organisms be obliged entities (setting compliance.aml_mode). '
      + 'Ask the operator (support@operators) to set it to "owners" if this organism does obliged work here.');
  }
  const declared = (await readAmlDeclarations(deps.storage, deps.config.nodeId))
    .some(d => d.scope.kind === 'organism' && d.scope.organismId === org);
  if (!declared) {
    throw new KycError(403, 'KYC_NOT_ENABLED',
      'This organism has not declared itself an obliged entity. Record its declaration first (aimeat_compliance_register_write, part "aml", '
      + 'or PUT /v1/compliance/docs/aml with the organism scope): the legal person, its business id, sector and compliance officer.');
  }
  if (agentBarred(organism, caller.principal)) throw new KycError(403, 'AGENT_NOT_ADMITTED', 'This organism admits only the agents it lists, and this agent is not on the list.');
  const settings = await readSettings(deps.storage, deps.config.nodeId, org);
  const member = await deps.storage.getMembership(org, caller.owner);
  const active = !!member && member.status === 'active';
  const ghii = caller.ownerGhii;
  let role: KycRole = 'none';
  if (active && settings.officers.includes(ghii)) role = 'officer';
  else if (active && settings.staff.includes(ghii)) role = 'staff';
  else if (active && (member.role === 'creator' || member.role === 'admin')) role = 'manager';
  return { org, organism, settings, role, agent: !caller.isPerson, by: caller.principal };
}

/** Cards: read and write. Officers, staff and managers, and their agents. */
export function requireCards(ctx: KycContext): void {
  if (ctx.role === 'none') {
    throw new KycError(403, 'KYC_NOT_STAFF',
      'Only active members of the organism who are its compliance officers, its due diligence staff or its admins reach its customer cards. An admin adds the person as a member first, then names them in the KYC settings.');
  }
}

/** Suspicion reports: the officers in person, never an agent (AMLR art. 73). */
export function requireOfficer(ctx: KycContext): void {
  if (ctx.role !== 'officer') throw new KycError(403, 'KYC_NOT_OFFICER', 'Only the compliance officer and the deputy read and write suspicion reports.');
  if (ctx.agent) throw new KycError(403, 'KYC_OFFICER_IN_PERSON', 'A suspicion report is read and written by the officer in person, never by an agent or an app.');
}

/** A decision a person makes in person: an agent may prepare it, not make it. */
export function requireInPerson(ctx: KycContext, what: string): void {
  if (ctx.agent) throw new KycError(403, 'KYC_DECISION_IN_PERSON', `${what} is a person's decision: make it in person on the customer card, or ask the person to.`);
}

/** The settings: an admin of the organism, or an officer, in person. */
export function requireSettings(ctx: KycContext): void {
  if (ctx.role !== 'manager' && ctx.role !== 'officer') throw new KycError(403, 'KYC_NOT_MANAGER', 'Only an admin of the organism or its compliance officer changes the KYC settings.');
  requireInPerson(ctx, 'Changing who does customer due diligence');
}
