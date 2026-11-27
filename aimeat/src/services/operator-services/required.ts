/**
 * @file src/services/operator-services/required.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A required operator service's agent (`required: true` in agents.operator_services): the
 *   person sees it and can add to it, and only the operator removes or limits it. Decided by the ledger's
 *   proof (./agent-check.ts) and the entry's PRESENT `required`, read at each request, so setting it back
 *   to false returns the person's controls at once. The operator's own controls are not limited.
 *
 *   ONE REFUSAL, asked inside the shared function each path already calls, so a new caller inherits it:
 *   removeAgent (an ordinary removal), the person's own off switch, setAgentStopped (a stop), the
 *   profile-write setters (mode, run mode, the operator configure tool's mode and scopes), the task
 *   start setting, a lowered clearance, narrowOwnAgent, the scope writers (requiredScopeRefusal: a list
 *   that drops a word the entry gave), porting it away, signing out its session, its webhook set by the
 *   owner, the directives' budget_limits, and the runtime-source report (only the agent's own runtime
 *   gives it). Its key (rekey, move, migration, a device authorization or an MCP consent by the person)
 *   is the service's for every service agent, required or not: ./service-key.ts, 403 OPERATOR_SERVICE_KEY.
 *   What the person set BEFORE the entry became required (a stop, a lowered clearance, budget limits)
 *   is put back as the approval set it, by each approval and the sweep (./required-restore.ts).
 *
 *   Classification labels, consents and organism rules are NOT touched: they are the data owner's and
 *   the organisation's rules and keep binding a service, required or not, private read or not.
 *   The agent itself is not refused where it already may act on itself (mode, run mode, webhook).
 *   What stays the person's: seeing it, its activity, adding and taking back their own words, its
 *   instructions and material (directives' purpose, rules, memory areas, resources), its workplace,
 *   the money limits (purchase limit, AI spend), and the erasure of the account.
 *   403 OPERATOR_SERVICE_REQUIRED, with whom to ask.
 * @structure OPERATOR_CONTACT · OPERATOR_SERVICE_REQUIRED_CODE · RequiredRefusal · requiredServiceOf ·
 *   requiredRefusalFor · requiredAgentRefusal · requiredScopeRefusal
 * @usage const refused = await requiredAgentRefusal(storage, config, gaii, 'stopping it');
 * @version-history
 *   v1.2.0 — 2026-11-26 — The header names the runtime-source fence, the restore of what was set before the
 *     entry became required, and what is never touched (operator services review, S10).
 *   v1.1.0 — 2026-11-26 — Rekey, move and migration moved to ./service-key.ts, which refuses them for every
 *     service agent, required or not.
 *   v1.0.0 — 2026-11-26 — Initial (operator services phase 2: required agents).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { parseGAII, localAccountOf, ownerGhiiOf } from '../../utils/gaii.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { isOperatorServiceAgent } from './agent-check.js';
import { entriesNow, isRequired, type ServiceEntryNow } from './entries.js';
import { readLine, type LedgerLine } from './ledger.js';

/** The address that reaches this server's operators, the one the chat notice gives (routes/chat.ts operator_contact). */
export const OPERATOR_CONTACT = 'support@operators';

export const OPERATOR_SERVICE_REQUIRED_CODE = 'OPERATOR_SERVICE_REQUIRED';

export interface RequiredRefusal { ok: false; status: 403; code: typeof OPERATOR_SERVICE_REQUIRED_CODE; message: string }

type Deps = Pick<AimeatConfig, 'nodeId' | 'operatorServices' | 'maxAgentScopes' | 'defaultAgentScopes'>;

/** The required entry and the ledger line behind agent `gaii`, or null when it is not a required service's agent. */
export async function requiredServiceOf(storage: Storage, config: Deps, gaii: string): Promise<{ entry: ServiceEntryNow; line: LedgerLine } | null> {
  const parsed = parseGAII(gaii);
  if (!parsed) return null;
  const entry = entriesNow(config).find((e) => e.id === parsed.agent);
  if (!entry || !isRequired(entry) || !entry.enabled) return null;
  if (!(await isOperatorServiceAgent(storage, config, gaii))) return null;
  const account = localAccountOf(ownerGhiiOf(gaii));
  const line = account ? await readLine(storage, config.nodeId, entry.id, account) : null;
  return line ? { entry, line } : null;
}

export function requiredRefusalFor(entry: Pick<ServiceEntryNow, 'display_name'>, what: string): RequiredRefusal {
  return {
    ok: false, status: 403, code: OPERATOR_SERVICE_REQUIRED_CODE,
    message: `The operator of this node requires ${entry.display_name}, so ${what} is the operator's to decide, not yours. `
      + `You can still see it, read what it did, give it instructions and material, and add permissions of your own to it. Ask the operator with a message to ${OPERATOR_CONTACT}.`,
  };
}

/** The refusal for doing `what` to agent `gaii` (stopping it, removing it, …), or null when it is not required. */
export async function requiredAgentRefusal(storage: Storage, config: Deps, gaii: string, what: string): Promise<RequiredRefusal | null> {
  const r = await requiredServiceOf(storage, config, gaii);
  return r ? requiredRefusalFor(r.entry, what) : null;
}

/**
 * For a write of agent `gaii`'s permission list: the refusal when `next` drops a word the entry gave it
 * and still gives (the line's `given` ∩ the entry's present words), or null. A word the person added
 * themselves may be taken back.
 */
export async function requiredScopeRefusal(storage: Storage, config: Deps, gaii: string, next: readonly string[]): Promise<RequiredRefusal | null> {
  const r = await requiredServiceOf(storage, config, gaii);
  if (!r) return null;
  const entryGiven = (r.line.given ?? r.entry.allowedScopes).filter((w) => r.entry.allowedScopes.includes(w));
  const dropped = entryGiven.filter((w) => !scopeIsCovered(next, w));
  return dropped.length ? requiredRefusalFor(r.entry, `taking away ${dropped.join(', ')}`) : null;
}
