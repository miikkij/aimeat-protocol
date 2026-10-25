/**
 * @file src/services/owner-lifecycle.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Deactivating and reactivating an owner account, as ONE operation (BR-04). This is
 *   the state between "active" and "erased" that the platform never had: the account and its
 *   knowledge remain, but nothing acting in its name authenticates and nothing new is minted.
 *   An organisation's identity provider needs exactly this — a person leaves, the directory says
 *   so, and their agents, tokens and app grants stop within the same request.
 *
 *   ORDER MATTERS: the flag is written FIRST, inside the transaction, so a crash mid-revocation
 *   leaves an account that refuses at the auth chokepoints (middleware asks `disabledAt` on every
 *   request) rather than one that looks active with half its credentials dead. The per-step
 *   tolerance mirrors owner-erasure.ts: a broken subsystem must not make an account impossible to
 *   deactivate, and what did not clear is reported rather than hidden.
 *
 *   WHAT EACH STEP ENDS: session rows carry the bare owner name for the owner's browser logins,
 *   the agents' 90-day device-auth JWTs, ecosystem-app tokens and /v1/auth/token mints alike, so
 *   revokeAllSessions(owner) ends all four families. PATs are resolved from storage per request,
 *   so the revoked flag is immediate. App-grant access tokens are asked per request via
 *   appGrantRevoked(). MCP OAuth tokens carry NO session row (issueJWT with two args) — those die
 *   at the ownerDisabled() chokepoint, and their refresh tokens are deleted here per agent GAII.
 *   Live connect-tunnel sockets were verified only at upgrade, so they are closed explicitly.
 *
 *   Reactivation clears the flag and nothing else: credentials revoked by deactivation stay dead,
 *   which is the difference between "the person is back" and "their old tokens are back".
 *
 *   BACKGROUND WORK carries no credential, so no step here touches it. The scheduler fire, the
 *   workflow trigger start and the unattended extension run ask the flag themselves
 *   (services/account-deactivated.ts) and skip while it is set; nothing is deleted, so reactivation
 *   resumes them (secaudit2026oct22).
 *
 * @structure
 *   - OwnerLifecycleResult: what was ended, so the caller can claim it truthfully
 *   - deactivateOwner(storage, name, by): flag + revoke everything, one transaction
 *   - reactivateOwner(storage, name): clear the flag
 *   - resolveOperatorAgentName / OPERATOR_AGENT_REFUSAL: re-exported from operator-principal.ts
 * @usage const result = await deactivateOwner(storage, 'alice', 'operator-bob');
 * @version-history
 *   2026-10-25 -- The header says where background work asks the flag (services/account-deactivated.ts; secaudit2026oct22).
 *   v1.3.0 — 2026-10-16 — Each tolerant step runs in a savepoint, and the flag is read back after the
 *     commit: on PostgreSQL one rejected statement had turned the COMMIT into a silent rollback of the
 *     flag and every revocation while the caller was told the account was disabled (QA audit E6-01).
 *   2026-10-16 — The operator's disable and enable acts take the actor and write the operator trail
 *     (recordOperatorAction): a usage row, a log line and a line on the person's feed, so a disabled and
 *     re-enabled account keeps a record of both and of who did them (QA audit E2-04).
 *   v1.2.0 — 2026-09-24 — The operator question moved to services/operator-principal.ts, which asks
 *     it of the PRINCIPAL on every door; resolveOperatorAgentName and OPERATOR_AGENT_REFUSAL are
 *     re-exported from there, and resolveOperatorName, which asked the account alone, is gone.
 *   v1.1.0 — 2026-09-24 — resolveOperatorAgentName and OPERATOR_AGENT_REFUSAL: an operator tool asks
 *     the account role first and then the exact word the operator ticked for this agent (security
 *     audit A8-1). The account role alone had armed every agent an operator connected.
 *   v1.0.0 — 2026-08-23 — Initial implementation (BR-04 phase 0).
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import type { AimeatConfig } from '../config.js';
import { recordOperatorAction } from './operator-access-audit.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { inSavepoint } from './tolerant-step.js';

// The operator tools import the question from here; its one home is operator-principal.ts.
export { resolveOperatorAgentName, OPERATOR_AGENT_REFUSAL } from './operator-principal.js';

export interface OwnerLifecycleResult {
  sessionsRevoked: number;
  patsRevoked: number;
  grantsRevoked: number;
  /** Steps that did NOT complete (label per failed step); empty when everything cleared. */
  incomplete: string[];
}

/** Run one revocation step, recording a failure instead of letting it block the deactivation. The
 *  savepoint is what makes "continuing" true on PostgreSQL: without it the first statement the
 *  database rejected marked the transaction failed, and the COMMIT undid the flag and every
 *  revocation while this function returned normally (QA audit E6-01). */
async function step(storage: Storage, label: string, fn: () => Promise<void>, incomplete: string[]): Promise<void> {
  try {
    await inSavepoint(storage, fn);
  } catch (err) {
    incomplete.push(label);
    logger.warn('deactivateOwner: step failed, continuing', { step: label, error: String(err) });
  }
}

/**
 * Deactivate an owner: set the flag, then end every credential family acting in their name.
 * The caller has already decided this is allowed (operator door or SCIM with a managedBy match).
 * Throws if the owner does not exist. Idempotent: deactivating a deactivated account re-runs the
 * revocations (harmless) and keeps the ORIGINAL disabledAt.
 */
export async function deactivateOwner(storage: Storage, name: string, by: string): Promise<OwnerLifecycleResult> {
  const owner = await storage.getOwner(name);
  if (!owner) throw new Error(`Owner not found: ${name}`);

  const incomplete: string[] = [];
  let sessionsRevoked = 0;
  let patsRevoked = 0;
  let grantsRevoked = 0;

  await storage.transaction(async () => {
    // 1. The flag, FIRST. From this write on, the auth middleware refuses every request in this
    //    owner's name regardless of how the steps below fare.
    if (!owner.disabledAt) {
      await storage.updateOwner(name, { disabledAt: new Date().toISOString(), disabledBy: by });
    }

    // 2. Session rows: owner logins, agent device-auth JWTs, ecosystem apps, /v1/auth/token.
    await step(storage, 'sessions', async () => { sessionsRevoked = await storage.revokeAllSessions(name); }, incomplete);

    // 3. PATs — resolved from storage per request, so revoked means now.
    await step(storage, 'pats', async () => {
      for (const pat of await storage.listPats(name)) {
        if (await storage.revokePat(pat.id, name)) patsRevoked++;
      }
    }, incomplete);

    // 4. App grants — their access tokens are asked per request via appGrantRevoked().
    await step(storage, 'app_grants', async () => {
      for (const grant of await storage.listAppGrantsByOwner(name)) {
        if (grant.revoked) continue;
        await storage.updateAppGrant(grant.grantId, { revoked: true });
        grantsRevoked++;
      }
    }, incomplete);

    // 5. In-flight device authorizations: an approval mid-flight must not mint a fresh 90-day JWT
    //    for a deactivated account.
    await step(storage, 'device_auth', async () => { await storage.deleteDeviceAuthByOwner(name); }, incomplete);

    //    Same reasoning for an unspent Agent v2 enrolment grant: it is a live permission to hand a
    //    daemon credentials in this account's name, and deactivation has to end it too.
    await step(storage, 'agent_enrolment_grants', async () => { await storage.deleteAgentEnrolmentGrantsByOwner(name); }, incomplete);

    // 6. MCP OAuth refresh tokens are keyed by agent GAII and have no by-owner delete.
    await step(storage, 'mcp_oauth_refresh', async () => {
      for (const agent of await storage.getAgentsByOwner(name)) {
        await storage.deleteOAuthRefreshTokensByGaii(agent.gaii);
      }
    }, incomplete);
  });

  // The flag is what every auth chokepoint asks, so the caller may say "disabled" only when it is
  // stored. Read it back after the commit: a COMMIT the database executed as a rollback returns no
  // error, and this read is what turns that into one instead of a false success (QA audit E6-01).
  const after = await storage.getOwner(name);
  if (!after?.disabledAt) {
    throw new Error(`The account ${name} could not be deactivated: the change did not reach the database. Nothing was revoked; try again, and if it repeats, check the database log.`);
  }

  // 7. Live connect-tunnel sockets verified their bearer only at upgrade — close them now.
  //    Outside the transaction: a socket close is not a storage write and cannot roll back.
  try {
    getActiveConnectTunnelManager()?.closeForOwner(name);
  } catch (err) {
    incomplete.push('tunnels');
    logger.warn('deactivateOwner: tunnel close failed', { owner: name, error: String(err) });
  }

  return { sessionsRevoked, patsRevoked, grantsRevoked, incomplete };
}

/**
 * Reactivate a deactivated owner. Clears the flag only: every credential revoked by deactivation
 * stays revoked, so the person signs in fresh and their agents reconnect through device
 * authorization as usual.
 */
export async function reactivateOwner(storage: Storage, name: string): Promise<void> {
  const owner = await storage.getOwner(name);
  if (!owner) throw new Error(`Owner not found: ${name}`);
  if (!owner.disabledAt) return;
  await storage.updateOwner(name, { disabledAt: null, disabledBy: null });
}

export type OperatorLifecycleResult =
  | { ok: true; result?: OwnerLifecycleResult }
  | { ok: false; status: number; code: string; message: string };

/** Who did an operator act, for the operator trail: the operator in person, or their agent. */
export interface OperatorTrail {
  config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>;
  /** The exact principal that acted (resolveIdentity of the caller). */
  actorGaii: string;
}

async function writeTrail(storage: Storage, trail: OperatorTrail | undefined, by: string, target: string, action: 'disable' | 'enable'): Promise<void> {
  if (!trail) return;
  await recordOperatorAction(storage, trail.config, {
    operatorGhii: `${by}@${trail.config.nodeId}`, actorGaii: trail.actorGaii,
    ownerOf: `${target}@${trail.config.nodeId}`, area: 'account', action,
  });
}

/** The operator's disable act with ITS two refusals — never yourself, and the target must exist —
 *  shared by the HTTP route and the MCP tool. */
export async function deactivateOwnerByOperator(storage: Storage, target: string, by: string, trail?: OperatorTrail): Promise<OperatorLifecycleResult> {
  if (target === by) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'You cannot deactivate your own account' };
  if (!(await storage.getOwner(target))) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Owner not found: ${target}` };
  const result = await deactivateOwner(storage, target, by);
  await writeTrail(storage, trail, by, target, 'disable');
  return { ok: true, result };
}

/** The operator's enable act, same shape. `by` is the operator's account name, for the trail. */
export async function reactivateOwnerByOperator(storage: Storage, target: string, by?: string, trail?: OperatorTrail): Promise<OperatorLifecycleResult> {
  if (!(await storage.getOwner(target))) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Owner not found: ${target}` };
  await reactivateOwner(storage, target);
  if (by) await writeTrail(storage, trail, by, target, 'enable');
  return { ok: true };
}
