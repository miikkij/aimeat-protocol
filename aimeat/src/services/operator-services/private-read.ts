/**
 * @file src/services/operator-services/private-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is the private read of an operator service's agent still granted now (S5)? The word
 *   memory:read-as-owner that an entry gave its agent counts only while the PRESENT setting grants it:
 *   the entry exists, is enabled and usable, names the word with its reason, the account is in the
 *   entry's audience, the operator has not switched the service off for that account, and the line is
 *   live (pending or active). Otherwise the word is dropped from the agent's effective permissions at
 *   each request (auth/effective-scopes.ts withCurrentScopes, the one place every route and the MCP
 *   endpoint read an agent's permissions), so every reader of the word (the memory routes and tools
 *   with owner_scope or ?agent=, history, patch, data products, classification labels, the AI read
 *   viewer, schedules, workflows) answers as for an agent without it: the ordinary visibility rules,
 *   not an error. No sweep is needed for it to bind; the sweep later takes the word off the record.
 *
 *   A word the person added to that agent themselves (not in the line's `given`) follows the ordinary
 *   rules and is kept.
 * @structure privateReadHolds
 * @usage if (!(await privateReadHolds(storage, config, agent))) scopes = scopes.filter(...)
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (operator services review, S5).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord } from '../../storage/interface.js';
import { PRIVATE_READ_WORD } from '../../config/operator-services.js';
import { serviceLineOf } from './agent-check.js';
import { entriesNow, inAudience, privateReadGranted } from './entries.js';

/** False when `agent` holds the private read from an operator service entry that does not grant it now. */
export async function privateReadHolds(storage: Storage, config: AimeatConfig, agent: AgentRecord): Promise<boolean> {
  const s = await serviceLineOf(storage, config, agent.gaii, agent);
  if (!s) return true;
  const entry = entriesNow(config).find((e) => e.id === s.id);
  // What the entry gave; an older line without `given` counts the entry's words as given.
  const given = s.line.given ?? entry?.scopes ?? [];
  if (!given.includes(PRIVATE_READ_WORD)) return true;
  return !!entry && entry.enabled && entry.usable && entry.allowedScopes.includes(PRIVATE_READ_WORD) && privateReadGranted(entry)
    && inAudience(entry, s.account) && !s.line.operator_off && (s.line.state === 'active' || s.line.state === 'pending');
}
