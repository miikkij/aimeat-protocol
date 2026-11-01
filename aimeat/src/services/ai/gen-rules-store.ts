/**
 * @file gen-rules-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the generation rules' inputs live and how they are read and written: the
 *   operator's levels (`ai.gen_rules`, AIMEAT_AI_GEN_RULES, the Config tab) and the owner's
 *   `ai.policy.gen-rules` memory record. The registry and the decision are services/ai/gen-rules.ts.
 *
 *   ONE WRITER. setOwnerGenRules() is what PUT /v1/ai/gen-rules and `aimeat_ai_gen_rules_set` both
 *   call. The owner in person writes at once; an agent of theirs proposes and then confirms with the
 *   token the proposal returned, so the owner sees the change in between (the pattern of the model
 *   policy, policy-store.ts). The key is under the reserved `ai.policy.` prefix, so no app and no
 *   delegated write reaches it through the memory API.
 *
 *   THE NODE'S LEVELS AT MINT TIME. Provenance is minted on some forty write paths that carry no
 *   config (services/ai-provenance.ts), and each of them must record the rules in force for an image
 *   or a video that arrives. bindGenRulesConfig() keeps a reference to the node's live config object
 *   (the Config tab changes it in place), set once when the gen-rules router mounts at start.
 * @structure
 *   - GEN_RULES_KEY — the owner's record
 *   - bindGenRulesConfig(), nodeGenRuleModes() — the operator's levels
 *   - readOwnerGenRulesRecord() — the owner's record
 *   - genRulesForCall() — the decision for one generation call
 *   - arrivalGenRuleMarks() — the marks for an image or video a writer brought in
 *   - setOwnerGenRules() — owner writes; an agent proposes and confirms
 *   - genRulesView() — what GET /v1/ai/gen-rules and the MCP tool show
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-image-and-video-generation-people-only-in-an-artistic-non-ph).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { AiMediaKind } from '../../models/ai-provenance-schemas.js';
import { isGEAI, parseGAII } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { emitChange } from '../event-bus.js';
import { updateRecord } from '../record-cas.js';
import { mintConfirmToken, verifyConfirmToken, ConfirmTokenError } from '../operator-confirm.js';
import { AiCompletionError } from './errors.js';
import {
  GEN_RULES, GEN_RULE_MEDIA, arrivalMarks, directiveText, isGenRuleMedia,
  normaliseOwnerGenRules, parseNodeGenRules, readOwnerGenRules, resolveGenRules, ruleStanding,
  type GenRuleBypass, type GenRuleCaller, type GenRuleDecision, type GenRuleMark, type GenRuleMedium,
  type NodeGenRuleMode, type OwnerGenRules,
} from './gen-rules.js';

/** The owner's generation rules. Under the reserved `ai.policy.` prefix (utils/reserved-keys.ts). */
export const GEN_RULES_KEY = 'ai.policy.gen-rules';

let boundConfig: Pick<AimeatConfig, 'aiGenRules'> | null = null;
let modesCache: { raw: string; modes: Record<string, NodeGenRuleMode> } | null = null;

/** Keep the node's live config object, for the mint paths that carry none. Called at start. */
export function bindGenRulesConfig(config: Pick<AimeatConfig, 'aiGenRules'>): void {
  boundConfig = config;
}

/**
 * The operator's level per rule. Parsed once per distinct value. A malformed entry is left out and
 * logged; the Config tab refuses one, so only an environment value can carry it.
 */
export function nodeGenRuleModes(config?: Pick<AimeatConfig, 'aiGenRules'>): Record<string, NodeGenRuleMode> {
  const raw = (config ?? boundConfig)?.aiGenRules ?? '';
  if (modesCache?.raw === raw) return modesCache.modes;
  const { modes, problems } = parseNodeGenRules(raw);
  if (problems.length) logger.warn('[ai] AIMEAT_AI_GEN_RULES has entries the node left out', { problems });
  modesCache = { raw, modes };
  return modes;
}

export async function readOwnerGenRulesRecord(storage: Storage, ownerGhii: string): Promise<OwnerGenRules> {
  return readOwnerGenRules((await storage.getMemory(ownerGhii, GEN_RULES_KEY))?.value);
}

/**
 * The decision for one generation call. Throws 403 GEN_RULE_BYPASS_REFUSED before anything is
 * spent when the bypass is not the caller's to ask or the rule is required.
 */
export async function genRulesForCall(
  storage: Storage, config: AimeatConfig, ownerGhii: string, medium: GenRuleMedium,
  caller: GenRuleCaller, bypass?: GenRuleBypass,
): Promise<GenRuleDecision> {
  const decision = resolveGenRules({
    medium, nodeModes: nodeGenRuleModes(config), owner: await readOwnerGenRulesRecord(storage, ownerGhii), caller,
    ...(bypass ? { bypass } : {}),
  });
  if (decision.refused) {
    throw new AiCompletionError('GEN_RULE_BYPASS_REFUSED', 403, decision.refused.message, { rule: decision.refused.rule });
  }
  return decision;
}

/**
 * The marks for an image or a video a writer brought in (made elsewhere): each rule in force is
 * `declared` when the writer said it followed it, `unknown` otherwise, `bypassed` under an exception
 * of the owner's for that agent. Undefined for any other medium, or when no rule is in force.
 */
export async function arrivalGenRuleMarks(
  storage: Storage, input: { ownerGhii: string; principal: string; mediaKind?: AiMediaKind; rulesFollowed?: readonly string[] },
): Promise<GenRuleMark[] | undefined> {
  if (!isGenRuleMedia(input.mediaKind)) return undefined;
  const agent = isGEAI(input.principal) ? undefined : parseGAII(input.principal)?.agent;
  const decision = resolveGenRules({
    medium: input.mediaKind, nodeModes: nodeGenRuleModes(), owner: await readOwnerGenRulesRecord(storage, input.ownerGhii),
    caller: { ownerInPerson: false, ...(agent ? { agent } : {}) },
  });
  const marks = arrivalMarks(decision, input.rulesFollowed);
  return marks.length ? marks : undefined;
}

/** Who changes the owner's rules: the owner in person, or an agent of theirs proposing and confirming. */
export type GenRulesActor = { kind: 'owner' } | { kind: 'agent'; principal: string; confirmToken?: string };

export type GenRulesSetResult =
  | { mode: 'applied'; gen_rules: OwnerGenRules }
  | { mode: 'proposal'; current: OwnerGenRules; proposed: OwnerGenRules; confirm_token: string; expires_in_seconds: number; instructions: string };

const GEN_RULES_ACTION = 'ai_gen_rules';

function invalid(verb: string, problems: Array<{ field: string; message: string }>): AiCompletionError {
  return new AiCompletionError('GEN_RULES_INVALID', 400,
    `The generation rules were not ${verb}: ${problems.map(p => `${p.field} ${p.message}`).join('; ')}.`, { problems });
}

/**
 * The record a change would leave: `rules` is merged into the stored choices (null removes one, so
 * the rule follows the node again), `exceptions` when given replaces the list. A rule the node
 * requires cannot be switched off or exempted, and saying so is a problem, not a silent no-op.
 */
function nextRecord(current: OwnerGenRules, change: Record<string, unknown>, modes: Record<string, NodeGenRuleMode>): OwnerGenRules {
  const parsed = normaliseOwnerGenRules(change);
  if ('problems' in parsed) throw invalid('saved', parsed.problems);
  const removed = change.rules && typeof change.rules === 'object'
    ? Object.entries(change.rules as Record<string, unknown>).filter(([, v]) => v === null).map(([k]) => k) : [];
  const rules = { ...current.rules, ...parsed.record.rules };
  for (const id of removed) delete rules[id];
  const exceptions = change.exceptions !== undefined ? parsed.record.exceptions : current.exceptions;
  const problems: Array<{ field: string; message: string }> = [];
  for (const [id, on] of Object.entries(rules)) {
    if (!on && modes[id] === 'required') problems.push({ field: `rules.${id}`, message: 'is required by this node and cannot be switched off' });
  }
  exceptions.forEach((e, i) => {
    if (modes[e.rule] === 'required') problems.push({ field: `exceptions[${i}]`, message: `cannot exempt "${e.rule}": this node requires it` });
  });
  if (problems.length) throw invalid('saved', problems);
  return { rules, exceptions };
}

async function writeOwnerGenRules(storage: Storage, config: AimeatConfig, ownerGhii: string, change: Record<string, unknown>): Promise<OwnerGenRules> {
  const modes = nodeGenRuleModes(config);
  const stored = await updateRecord(storage, ownerGhii, GEN_RULES_KEY, v => readOwnerGenRules(v),
    (cur): OwnerGenRules => ({ ...nextRecord(cur, change, modes), updatedAt: new Date().toISOString() }),
    { tag: 'ai', tags: ['ai', 'policy', 'gen-rules'] });
  emitChange('memory', ownerGhii);
  return stored;
}

/**
 * Change the owner's generation rules. The owner in person writes at once. An agent proposes first
 * and gets a token bound to the exact change; the same call again with the token applies it, within
 * ten minutes. An app never reaches this: the route refuses it.
 */
export async function setOwnerGenRules(
  storage: Storage, config: AimeatConfig, ownerGhii: string, change: unknown, actor: GenRulesActor,
): Promise<GenRulesSetResult> {
  if (!change || typeof change !== 'object' || Array.isArray(change)) {
    throw invalid('saved', [{ field: 'gen_rules', message: 'must be an object { rules?, exceptions? }' }]);
  }
  const body = change as Record<string, unknown>;
  if (actor.kind === 'owner') return { mode: 'applied', gen_rules: await writeOwnerGenRules(storage, config, ownerGhii, body) };

  const current = await readOwnerGenRulesRecord(storage, ownerGhii);
  // Validated now, so a proposal the confirm step would refuse is never shown to the owner.
  const proposed = nextRecord(current, body, nodeGenRuleModes(config));
  if (!actor.confirmToken) {
    return {
      mode: 'proposal', current, proposed,
      confirm_token: await mintConfirmToken(actor.principal, GEN_RULES_ACTION, body),
      expires_in_seconds: 600,
      instructions: 'Show this change to the owner. To apply EXACTLY this change, call again with the same gen_rules plus confirm_token. Any change to gen_rules invalidates the token.',
    };
  }
  try {
    await verifyConfirmToken(actor.confirmToken, actor.principal, GEN_RULES_ACTION, body);
  } catch (e) {
    if (e instanceof ConfirmTokenError) throw new AiCompletionError(e.code, 403, e.message);
    throw e;
  }
  return { mode: 'applied', gen_rules: await writeOwnerGenRules(storage, config, ownerGhii, body) };
}

export interface GenRuleView {
  id: string;
  version: number;
  media: readonly GenRuleMedium[];
  summary: string;
  /** The operator's level. */
  node: NodeGenRuleMode;
  /** The owner's own choice, or null when the rule follows the node. */
  owner: boolean | null;
  /** In force for the owner's calls, before exceptions and bypasses. */
  on: boolean;
  /** The node requires it: no switch-off, no exception, no bypass. */
  required: boolean;
  directive: Readonly<Record<GenRuleMedium, string>>;
}

/**
 * What GET /v1/ai/gen-rules and the MCP tool show: every rule with its levels, the owner's
 * exceptions, and for the caller the directive text per medium, which an agent or an app composing
 * a prompt for an outside model puts in it.
 */
export async function genRulesView(storage: Storage, config: AimeatConfig, ownerGhii: string, caller: GenRuleCaller): Promise<{
  rules: GenRuleView[]; exceptions: OwnerGenRules['exceptions']; updatedAt: string | null;
  for_caller: Record<GenRuleMedium, { rules: string[]; directive: string }>;
}> {
  const modes = nodeGenRuleModes(config);
  const owner = await readOwnerGenRulesRecord(storage, ownerGhii);
  const rules = GEN_RULES.map((r): GenRuleView => {
    const s = ruleStanding(r, modes, owner);
    return {
      id: r.id, version: r.version, media: r.media, summary: r.summary, node: modes[r.id] ?? 'off',
      owner: owner.rules[r.id] ?? null, on: s.on, required: s.required, directive: r.directive,
    };
  });
  const forCaller = {} as Record<GenRuleMedium, { rules: string[]; directive: string }>;
  for (const medium of GEN_RULE_MEDIA) {
    const d = resolveGenRules({ medium, nodeModes: modes, owner, caller });
    forCaller[medium] = { rules: d.given.map(r => r.id), directive: directiveText(d.given, medium) };
  }
  return { rules, exceptions: owner.exceptions, updatedAt: owner.updatedAt ?? null, for_caller: forCaller };
}
