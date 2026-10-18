/**
 * @file src/services/scope-list-swap.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Change one agent's, ecosystem app's or app grant's scope list without losing a word
 *   another writer put there meanwhile. The boot steps read every principal, computed the words to add
 *   and wrote the whole list back, so two steps (or two node processes) writing one principal at once,
 *   or an owner's edit landing between a step's read and its write, lost one side's words. Here the
 *   write is conditional on the list that was read (storage setAgentScopesIf, setEcosystemAppScopesIf,
 *   setAppGrantScopesIf: one conditional UPDATE, since these rows carry no version column); on a
 *   conflict the principal is read again and the change is worked out again from what is stored now.
 *   A storage without the conditional method writes as before.
 * @structure ScopeListTarget · changeScopeList(storage, target, listed, change)
 * @usage
 *   const next = await changeScopeList(storage, { kind: 'agent', id: agent.gaii }, agent.defaultScopes,
 *     held => { const missing = wordsFor(held); return missing.length ? [...held, ...missing] : null; });
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (check:atomic-writes, the boot migration sites).
 */
import type { Storage } from '../storage/interface.js';
import { CAS_ATTEMPTS } from './record-cas.js';

/** Whose list: an agent by GAII, an ecosystem app by GEAI, an app grant by grant id. */
export interface ScopeListTarget { kind: 'agent' | 'ecosystem-app' | 'app-grant'; id: string }

/** The principal's stored list, read again after a conflict; undefined when it is gone or has no list. */
async function readList(storage: Storage, t: ScopeListTarget): Promise<readonly string[] | undefined> {
  if (t.kind === 'agent') return (await storage.getAgent(t.id))?.defaultScopes;
  if (t.kind === 'ecosystem-app') return (await storage.getEcosystemApp(t.id))?.scopes;
  const grant = await storage.getAppGrant(t.id);
  return grant && !grant.revoked ? grant.scopes : undefined;
}

/** Write `next` if the stored list is still `held`; true when written. */
async function swap(storage: Storage, t: ScopeListTarget, held: readonly string[], next: string[]): Promise<boolean> {
  if (t.kind === 'agent') {
    if (storage.setAgentScopesIf) return storage.setAgentScopesIf(t.id, held, next);
    await storage.updateAgent(t.id, { defaultScopes: next });
    return true;
  }
  if (t.kind === 'ecosystem-app') {
    if (storage.setEcosystemAppScopesIf) return storage.setEcosystemAppScopesIf(t.id, held, next);
    await storage.updateEcosystemApp(t.id, { scopes: next });
    return true;
  }
  if (storage.setAppGrantScopesIf) return storage.setAppGrantScopesIf(t.id, held, next);
  await storage.updateAppGrant(t.id, { scopes: next });
  return true;
}

/**
 * Apply `change` to the principal's scope list, starting from `listed` (the list the caller already
 * read), and write the result only over that same list. `change` answers the new list, or null to write
 * nothing; it may run more than once, so it depends only on the list it is given. Answers
 * `{ before, after }` for the list that was written, or null when nothing was written (no change, no
 * list, or the principal is gone).
 */
export async function changeScopeList(
  storage: Storage, target: ScopeListTarget, listed: readonly string[] | null | undefined,
  change: (held: readonly string[]) => string[] | null,
): Promise<{ before: readonly string[]; after: string[] } | null> {
  let held = listed;
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    if (!Array.isArray(held)) return null;
    const next = change(held);
    if (!next) return null;
    if (await swap(storage, target, held, next)) return { before: held, after: next };
    held = await readList(storage, target);
  }
  throw new Error(`${target.kind} ${target.id}: its scope list changed under every one of ${CAS_ATTEMPTS} attempts; the next start tries again`);
}
