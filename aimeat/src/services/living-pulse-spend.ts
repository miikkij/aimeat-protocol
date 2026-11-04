/**
 * @file src/services/living-pulse-spend.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whose permission the unattended living-document pulse spends the owner's AI under, and
 *   the owner's one press when that principal may not use the owner's AI itself.
 *
 *   WHY. The pulse calls completeForOwner, the owner's key and AI allowance, for every due config it
 *   finds (services/living-pulse.ts). POST /v1/ai/complete asks an agent or an app for ai:use first; a
 *   config is an ordinary memory record, so an app signed in with the default permissions (no ai:use)
 *   wrote one into a workspace of the owner and the next pulse spent the owner's AI for it
 *   (secaudit2026oct31w2 round 10, f-2026aug-ai-paths-3). The same holds for an agent without ai:use;
 *   AIMEAT's model doing a goal's work asks the same question of such an agent (goals-model-spend.ts).
 *
 *   WHO SPENDS. A config an agent or an ecosystem app holds in its own namespace: that holder. A config
 *   in the owner's own namespace: its latest writer of this owner from the memory write tally (an app
 *   grant is recorded as `eco:<app>#<owner>@<node>`, data-map/tally-writer.ts). The owner's own latest
 *   save, a config with no tally row, and a writer holding ai:use spend as before.
 *
 *   THE ONE PRESS (services/approval-standard.ts). The pulse does not call the model for the config
 *   (the ledger says `derive-waiting`, the config's status carries `ai_spend_request`), and a request
 *   of kind `living-ai-spend` asks the owner in plain words; an agent of the owner holding ai:use may
 *   answer. Allow (publish-requests/apply-living-ai-spend.ts): that writer may spend for this config,
 *   and the next pulse runs as before. Don't allow, or no answer before the request expires: the
 *   pulse keeps not calling the model for that writer's config, and does not ask again. The owner's own
 *   save of the config, or ai:use given to the writer, lets it run.
 *
 *   THE RECORD is service-owned (utils/reserved-keys.ts `living-spend-hold.`), one per config in the
 *   owner's GHII namespace: { spenders: { <principal>: { allowedAt?, declinedAt?, waiting? } } }.
 * @structure LIVING_SPEND_HOLD_PREFIX · LIVING_AI_SCOPE · livingSpendHoldKey · pulseSpender ·
 *   spenderMayUseAi · livingSpendHold · allowLivingSpend
 * @usage
 *   const held = await livingSpendHold(deps, ownerGhii, holder, configKey, title);   // before the model is called
 *   if (held) { ...skip the derive, note held.requestId... }
 * @version-history
 *   v1.1.0 -- 2026-11-02 -- A member of another account who published over the owner's config is its
 *     latest writer (the publish records the publisher in the tally), and such a writer never spends the
 *     owner's AI without the owner's one press; the living pulse reads and asks nothing for it until
 *     then (spenderOfOtherAccount; secaudit2026nov02d round 13,
 *     publishDraft:cross-account-living-config-outside-pulse-spend-tally).
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit2026oct31w2 round 10, f-2026aug-ai-paths-3).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { appSlug, isGEAI, isSameOwner, localAccountName, parseGAII, parseGaiiLoose } from '../utils/gaii.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { logger } from '../utils/logger.js';
import { flushWriteTallyBuffer } from './data-map/write-tally-buffer.js';
import { updateRecord, UNCHANGED } from './record-cas.js';
import { fileAsk } from './publish-requests/ask.js';
import { readPublishRequest, effectiveState } from './publish-requests/store.js';

/** The record, in the owner's GHII namespace. Service-owned (utils/reserved-keys.ts). */
export const LIVING_SPEND_HOLD_PREFIX = 'living-spend-hold.';
/** The word an agent or an app needs to use the owner's AI itself (auth/ai-gate.ts). */
export const LIVING_AI_SCOPE = 'ai:use';

type Deps = { storage: Storage; config: AimeatConfig };
interface SpenderState { allowedAt?: string; declinedAt?: string; waiting?: { requestId: string; at: string } }
interface Hold { spenders: Record<string, SpenderState> }

export const livingSpendHoldKey = (configKey: string): string => `${LIVING_SPEND_HOLD_PREFIX}${configKey}`;
const parseHold = (v: unknown): Hold => {
  const s = (v && typeof v === 'object' ? (v as { spenders?: unknown }).spenders : null);
  return { spenders: s && typeof s === 'object' ? { ...(s as Record<string, SpenderState>) } : {} };
};
const ownerGhiiOf = (deps: Deps, holder: string) => `${localAccountName(holder)}@${deps.config.nodeId}`;

/** An agent or app principal of `owner` on this node: `name#owner@node` or `eco:name#owner@node`. */
function ownPrincipal(principal: string, owner: string, nodeId: string): boolean {
  if (!principal.includes('#')) return false;
  const p = parseGaiiLoose(principal);
  return p.owner === owner && p.node === nodeId;
}

/**
 * The principal whose permission a config's AI spend runs under, or null for the owner's own. An
 * agent- or app-held config: its holder. A config in the owner's namespace: its latest writer in the
 * write tally when that is not the owner: an agent or app of the owner, or a member of another
 * account who published over the config in a shared workspace (services/organism-gate.ts records
 * the publisher; secaudit2026nov02d round 13).
 */
export async function pulseSpender(deps: Deps, holder: string, key: string): Promise<string | null> {
  if (holder.includes('#')) return holder;
  await flushWriteTallyBuffer();
  const rows = await deps.storage.listMemoryWriteTally({ ownerGaii: holder, key });
  const latest = rows.reduce<typeof rows[number] | null>((a, r) => (!a || r.lastAt > a.lastAt ? r : a), null);
  return !latest || latest.writerPrincipal === holder ? null : latest.writerPrincipal;
}

/** True when `spender` is a principal of another account than the config's holder (or of another node). */
export function spenderOfOtherAccount(deps: Deps, holder: string, spender: string): boolean {
  return !(spender === holder || ownPrincipal(spender, localAccountName(holder), deps.config.nodeId)
    || (!spender.includes('#') && isSameOwner(spender, holder)));
}

/**
 * Does `spender` hold ai:use now: an agent by its record, an ecosystem app by its record, an app grant
 * by its live grants. A principal of another account than `holder` never does: its words reach its own
 * account's AI, not this owner's.
 */
export async function spenderMayUseAi(deps: Deps, spender: string, holder?: string): Promise<boolean> {
  if (holder && spenderOfOtherAccount(deps, holder, spender)) return false;
  if (isGEAI(spender)) {
    const eco = await deps.storage.getEcosystemApp(spender).catch((err: unknown) => {
      logger.warn('living pulse: the ecosystem app record was not read; its app grants decide', { spender, error: String(err) });
      return null;
    });
    if (eco) return (eco.status === 'approved' || eco.status === 'active') && scopeIsCovered(eco.scopes, LIVING_AI_SCOPE);
    // An app grant is named by the slug of its app (callerPrincipal): any live grant of the owner for an
    // app of that slug holding ai:use lets it spend, as that app could call POST /v1/ai/complete itself.
    const slug = parseGaiiLoose(spender).agent;
    const grants = await deps.storage.listAppGrantsByOwner(localAccountName(spender));
    return grants.some(g => !g.revoked && appSlug(g.app) === slug && scopeIsCovered(g.scopes, LIVING_AI_SCOPE));
  }
  if (parseGAII(spender)) return scopeIsCovered((await deps.storage.getAgent(spender))?.defaultScopes ?? [], LIVING_AI_SCOPE);
  return true;
}

async function writeHold(deps: Deps, ownerGhii: string, configKey: string, mutate: (cur: Hold) => Hold | typeof UNCHANGED): Promise<void> {
  await updateRecord(deps.storage, ownerGhii, livingSpendHoldKey(configKey), parseHold, mutate, { tag: 'living', visibility: 'private' });
}

/** The name a person reads for a writer: an agent's or an app's own name, never the whole identity. */
const nameOf = (principal: string) => parseGaiiLoose(principal).agent || localAccountName(principal) || principal;

/**
 * Whether the pulse must not call the model for this config now. null: it may (the owner's own, a
 * writer with ai:use, or one the owner allowed). Otherwise the request that asks the owner (filed now
 * when none waits), or `declined` when the owner said no. Never throws: a failure reads as held.
 */
export async function livingSpendHold(
  deps: Deps, holder: string, configKey: string, title: string,
): Promise<{ requestId: string | null; declined: boolean } | null> {
  try {
    const spender = await pulseSpender(deps, holder, configKey);
    if (!spender || await spenderMayUseAi(deps, spender, holder)) return null;
    const ownerGhii = ownerGhiiOf(deps, holder);
    const hold = parseHold((await deps.storage.getMemory(ownerGhii, livingSpendHoldKey(configKey)))?.value);
    const state = hold.spenders[spender] ?? {};
    if (state.allowedAt) return null;
    if (state.declinedAt) return { requestId: null, declined: true };
    if (state.waiting) {
      const request = await readPublishRequest(deps.storage, ownerGhii, state.waiting.requestId);
      const now = request ? effectiveState(request) : 'outdated';
      if (now === 'approved') return null;
      if (now === 'awaiting_owner') return { requestId: state.waiting.requestId, declined: false };
      // Declined, expired or gone: the owner's answer is no, and the pulse does not ask again.
      await writeHold(deps, ownerGhii, configKey, cur => ({ spenders: { ...cur.spenders, [spender]: { declinedAt: new Date().toISOString() } } }));
      return { requestId: null, declined: true };
    }
    const who = nameOf(spender);
    const kind = isGEAI(spender) ? 'app' : spender.includes('#') ? 'agent' : 'person';
    const filed = await fileAsk(deps, localAccountName(holder), { principal: spender, kind, sub: spender }, {
      kind: 'living-ai-spend',
      target: { key: configKey, holder, spender },
      title: `the living document "${title}" refreshing itself with your AI`,
      name: title,
      change: { field: 'living.ai.spend', from: null, to: 'allowed' },
      approval: {
        approver: 'owner',
        asks: `let the living document "${title}" refresh itself with your AI, at your cost`,
        why: `${who} set up this living document, and ${who} does not have the permission to use your AI, so it may not spend your AI allowance or your key itself. `
          + 'If you do not allow it, the document is not refreshed by the AI. Nothing is spent.',
        approve_scope: LIVING_AI_SCOPE,
        i18n: { key: 'approval_living_ai_spend', vars: { writer: who, document: title } },
      },
    });
    if (!filed.ok) return { requestId: null, declined: false };
    const requestId = filed.request.id;
    await writeHold(deps, ownerGhii, configKey, cur => ({ spenders: { ...cur.spenders, [spender]: { waiting: { requestId, at: new Date().toISOString() } } } }));
    return { requestId, declined: false };
  } catch (err) {
    logger.warn('living pulse: whether the config may use the owner\'s AI could not be decided; the model is not called', { key: configKey, error: String(err) });
    return { requestId: null, declined: false };
  }
}

/** The owner allowed `spender` to spend for this config (apply-living-ai-spend.ts). */
export async function allowLivingSpend(deps: Deps, holder: string, configKey: string, spender: string, requestId: string): Promise<boolean> {
  const ownerGhii = ownerGhiiOf(deps, holder);
  if (!(await deps.storage.getMemory(holder, configKey))) return false;
  let changed = false;
  await writeHold(deps, ownerGhii, configKey, cur => {
    const s = cur.spenders[spender];
    if (s?.allowedAt) return UNCHANGED;
    if (s?.waiting && s.waiting.requestId !== requestId) return UNCHANGED;
    changed = true;
    return { spenders: { ...cur.spenders, [spender]: { allowedAt: new Date().toISOString() } } };
  });
  return changed;
}
