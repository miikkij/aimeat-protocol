/**
 * @file src/services/decide/rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's DECISION RULES: where they are kept, who may run one, and how an agent
 *   proposes one without creating anything.
 *
 *   ONE RECORD PER RULE, `decide.rules.<id>`, in the owner's namespace under the reserved `decide.`
 *   prefix (utils/reserved-keys.ts). Reserved on purpose: the server changes what it DOES because of
 *   what it finds here (the bands decide whether an agent acts), so no app grant and no generic
 *   memory door may write it. The writers are the owner's routes and the owner's approval of a
 *   proposal, both past the memory gate. No new table.
 *
 *   THE `use` LOCK IS ENFORCED HERE, so every door that runs a rule gets it: the REST route, the MCP
 *   tool and a run over many records all call ruleForCaller(). `agent` admits the owner's agents,
 *   `app` admits the owner's apps, `both` admits either. The owner in person may run any of their
 *   rules: it is their definition, and trying it is how they tune it.
 *
 *   THE VERSION is bumped when the questions change, and only then. A threshold or a band is tuning:
 *   every decision records the thresholds and bands it was compared with, so tuning needs no
 *   version. A changed question is a different measurement, and the quality numbers of the old and
 *   the new must not be read as one series.
 *
 *   A PROPOSAL CREATES NOTHING. An agent's proposal is validated exactly as a rule is, stored as
 *   `decide.proposals.<id>` and put on the owner's open-items list, the way aimeat_agent_propose
 *   does it. The owner's press creates the rule. A settled proposal is deleted: the rule carries who
 *   proposed it, and a declined one has nothing left to say.
 *
 *   HOW MANY. At most MAX_RULES rules and MAX_PROPOSALS waiting proposals per owner, so neither can
 *   eat the owner's key budget.
 * @structure
 *   RULE_PREFIX · RuleCallerKind · listRules · getRule · putRule · deleteRule · ruleForCaller ·
 *   rulesRunnableBy · proposeRule · listRuleProposals · approveRuleProposal · declineRuleProposal
 * @usage
 *   const rule = await ruleForCaller(storage, caller.gaii, 'send-reply', callerKind(caller));
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial: decision rules on the node.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { upsertPrivateRecord } from '../private-record.js';
import { emitChange } from '../event-bus.js';
import { addItem, closeItem, getItem } from '../open-items.js';
import { logger } from '../../utils/logger.js';
import { DEFAULT_DECIDE_LIMITS } from './limits.js';
import { DecideError } from './errors.js';
import { canonicalJson } from '../attestation.js';
import { validateRule, RULE_ID_RE, type DecisionRule, type DecisionRuleInput, type RuleProblem } from './rule-validate.js';

export const RULE_PREFIX = 'decide.rules.';
export const RULE_PROPOSAL_PREFIX = 'decide.proposals.';
const MAX_RULES = 100;
const MAX_PROPOSALS = 20;

/** Who is asking to run a rule. The owner in person is not held to the `use` lock. */
export type RuleCallerKind = 'owner' | 'agent' | 'app';

const ruleKey = (id: string): string => `${RULE_PREFIX}${id}`;
const proposalKey = (id: string): string => `${RULE_PROPOSAL_PREFIX}${id}`;

function limitsOf(config: AimeatConfig) {
  return { ...DEFAULT_DECIDE_LIMITS, maxRequestTokens: config.decideMaxRequestTokens, maxChoiceOptions: config.decideMaxChoiceOptions };
}

function invalid(problems: RuleProblem[]): DecideError {
  return new DecideError('INVALID_RULE', 400, problems.map(p => p.message).join(' '), { problems });
}

function asRule(value: unknown): DecisionRule | null {
  const v = value as DecisionRule | undefined;
  return v && v.spec === 'aimeat.decision-rule/v1' && typeof v.id === 'string' ? v : null;
}

/** Every rule the owner has, by title. */
export async function listRules(storage: Storage, ownerGhii: string): Promise<DecisionRule[]> {
  const rows = await storage.listMemory(ownerGhii, { prefix: RULE_PREFIX });
  return rows.map(r => asRule(r.value)).filter((r): r is DecisionRule => !!r)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getRule(storage: Storage, ownerGhii: string, id: string): Promise<DecisionRule | null> {
  if (!RULE_ID_RE.test(id)) return null;
  return asRule((await storage.getMemory(ownerGhii, ruleKey(id)))?.value);
}

/**
 * Create or replace a rule. The id in the path wins over one in the body, so a PUT to one address
 * cannot write another. Returns the stored rule, with its version.
 */
export async function putRule(
  storage: Storage, config: AimeatConfig, ownerGhii: string, id: string, raw: unknown,
  meta: { proposedBy?: string } = {},
): Promise<{ rule: DecisionRule; created: boolean }> {
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>), id } : raw;
  const v = validateRule(body, limitsOf(config));
  if (!v.rule) throw invalid(v.problems);

  const existing = await getRule(storage, ownerGhii, id);
  if (!existing && (await storage.listMemoryMeta(ownerGhii, { prefix: RULE_PREFIX })).length >= MAX_RULES) {
    throw new DecideError('TOO_MANY_RULES', 409, `An account holds at most ${MAX_RULES} decision rules. Delete one you no longer use.`);
  }
  const now = new Date().toISOString();
  const questionsChanged = !!existing && canonicalJson(existing.questions) !== canonicalJson(v.rule.questions);
  const rule: DecisionRule & { proposedBy?: string } = {
    spec: 'aimeat.decision-rule/v1',
    ...v.rule,
    version: existing ? existing.version + (questionsChanged ? 1 : 0) : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...((existing as { proposedBy?: string } | null)?.proposedBy ?? meta.proposedBy
      ? { proposedBy: (existing as { proposedBy?: string } | null)?.proposedBy ?? meta.proposedBy } : {}),
  };
  await upsertPrivateRecord(storage, ownerGhii, ruleKey(id), rule, ['decide', 'rule']);
  emitChange('ai-decisions', ownerGhii);
  return { rule, created: !existing };
}

export async function deleteRule(storage: Storage, ownerGhii: string, id: string): Promise<boolean> {
  if (!(await getRule(storage, ownerGhii, id))) return false;
  await storage.deleteMemory(ownerGhii, ruleKey(id));
  emitChange('ai-decisions', ownerGhii);
  return true;
}

/** True when the rule's `use` lets this kind of caller run it. The owner in person always may. */
export function useAllows(rule: Pick<DecisionRuleInput, 'use'>, kind: RuleCallerKind): boolean {
  return kind === 'owner' || rule.use === 'both' || rule.use === kind;
}

/**
 * The rule a caller named, or the refusal. 404 for a rule that is not there, 403 for one this kind
 * of caller may not run, with the sentence that says who may.
 */
export async function ruleForCaller(
  storage: Storage, ownerGhii: string, id: string, kind: RuleCallerKind,
): Promise<DecisionRule> {
  const rule = await getRule(storage, ownerGhii, id);
  if (!rule) {
    throw new DecideError('RULE_NOT_FOUND', 404,
      `There is no decision rule '${String(id).slice(0, 80)}' on this account. aimeat_decide_rules (GET /v1/ai/decide/rules) lists the ones you may run.`);
  }
  if (!useAllows(rule, kind)) {
    throw new DecideError('RULE_NOT_FOR_CALLER', 403, rule.use === 'agent'
      ? `The owner made the rule '${rule.id}' for their agents only, so an app may not run it. The owner changes that in AI settings, Decision model.`
      : `The owner made the rule '${rule.id}' for their apps only, so an agent may not run it. The owner changes that in AI settings, Decision model.`);
  }
  return rule;
}

/** The rules this kind of caller may run, in the short form a tool lists: what each one decides. */
export async function rulesRunnableBy(
  storage: Storage, ownerGhii: string, kind: RuleCallerKind,
): Promise<Array<Pick<DecisionRule, 'id' | 'title' | 'decides' | 'sends' | 'use' | 'gate' | 'version'>>> {
  return (await listRules(storage, ownerGhii)).filter(r => useAllows(r, kind))
    .map(({ id, title, decides, sends, use, gate, version }) => ({ id, title, decides, sends, use, gate, version }));
}

// ── proposals ────────────────────────────────────────────────────────────────

export interface RuleProposal {
  id: string;
  rule: DecisionRuleInput;
  /** Why this rule should exist, in the proposer's words. This is what the owner reads. */
  reason: string;
  proposed_by: string;
  proposed_at: string;
  /** The open-items row this proposal put on the owner's list, so settling can close it. */
  item_id: string | null;
}

/**
 * An agent (or the owner's chat) proposes a rule. Validated as a rule is, so the owner is never asked
 * to approve something the node would then refuse. Creates no rule.
 */
export async function proposeRule(
  storage: Storage, config: AimeatConfig, ownerGhii: string, proposer: string,
  input: { rule: unknown; reason: unknown },
): Promise<{ proposal: RuleProposal; alreadyWaiting: boolean }> {
  const v = validateRule(input.rule, limitsOf(config));
  if (!v.rule) throw invalid(v.problems);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 10 || reason.length > 1000) {
    throw new DecideError('INVALID_BODY', 400, 'reason: say in a sentence the owner can decide from why this rule should exist (10 to 1000 characters).');
  }
  if (await getRule(storage, ownerGhii, v.rule.id)) {
    throw new DecideError('RULE_EXISTS', 409,
      `A rule '${v.rule.id}' already exists. Propose it under another id, or ask the owner to edit the one they have.`);
  }
  const waiting = await listRuleProposals(storage, ownerGhii);
  const same = waiting.find(p => p.rule.id === v.rule!.id);
  if (same) return { proposal: same, alreadyWaiting: true };
  if (waiting.length >= MAX_PROPOSALS) {
    throw new DecideError('TOO_MANY_PROPOSALS', 409, `${MAX_PROPOSALS} rule proposals are already waiting for the owner. Ask them to settle some first.`);
  }

  const proposal: RuleProposal = {
    id: randomUUID(), rule: v.rule, reason, proposed_by: proposer, proposed_at: new Date().toISOString(), item_id: null,
  };
  const item = await addItem(storage, ownerGhii, {
    title: `Approve a decision rule: ${v.rule.title} — ${reason}`.slice(0, 200),
    kind: 'decision',
    origin: proposer,
    object: { type: 'decision-rule-proposal', id: proposal.id },
    by: proposer === ownerGhii ? 'person' : 'ai',
  });
  proposal.item_id = item?.id ?? null;
  await upsertPrivateRecord(storage, ownerGhii, proposalKey(proposal.id), proposal, ['decide', 'rule-proposal']);
  emitChange('ai-decisions', ownerGhii);
  emitChange('open-items', ownerGhii);
  logger.info('[decide] rule proposed', { owner: ownerGhii, rule: v.rule.id, by: proposer, item: proposal.item_id });
  return { proposal, alreadyWaiting: false };
}

export async function listRuleProposals(storage: Storage, ownerGhii: string): Promise<RuleProposal[]> {
  const rows = await storage.listMemory(ownerGhii, { prefix: RULE_PROPOSAL_PREFIX });
  return rows.map(r => r.value as unknown as RuleProposal)
    .filter(p => p && typeof p.id === 'string' && !!p.rule)
    .sort((a, b) => b.proposed_at.localeCompare(a.proposed_at));
}

async function settle(storage: Storage, ownerGhii: string, proposal: RuleProposal): Promise<void> {
  await storage.deleteMemory(ownerGhii, proposalKey(proposal.id));
  if (proposal.item_id) {
    // Best effort: the decision is made above, and a stale row on a list is a smaller problem than
    // a failed approval.
    try {
      if (await getItem(storage, ownerGhii, proposal.item_id)) await closeItem(storage, ownerGhii, proposal.item_id, 'person');
    } catch (err) {
      logger.warn('[decide] could not close the owner list item of a rule proposal', { owner: ownerGhii, proposal: proposal.id, error: String(err) });
    }
  }
  emitChange('ai-decisions', ownerGhii);
  emitChange('open-items', ownerGhii);
}

async function readProposal(storage: Storage, ownerGhii: string, id: string): Promise<RuleProposal | null> {
  const v = (await storage.getMemory(ownerGhii, proposalKey(id)))?.value as unknown as RuleProposal | undefined;
  return v && typeof v.id === 'string' && v.rule ? v : null;
}

/** The owner's press: the rule is created now, and not before. Null when there is no such proposal. */
export async function approveRuleProposal(
  storage: Storage, config: AimeatConfig, ownerGhii: string, id: string,
): Promise<DecisionRule | null> {
  const proposal = await readProposal(storage, ownerGhii, id);
  if (!proposal) return null;
  if (await getRule(storage, ownerGhii, proposal.rule.id)) {
    throw new DecideError('RULE_EXISTS', 409, `A rule '${proposal.rule.id}' was created since this was proposed. Decline the proposal, or delete the rule first.`);
  }
  const { rule } = await putRule(storage, config, ownerGhii, proposal.rule.id, proposal.rule, { proposedBy: proposal.proposed_by });
  await settle(storage, ownerGhii, proposal);
  return rule;
}

export async function declineRuleProposal(storage: Storage, ownerGhii: string, id: string): Promise<boolean> {
  const proposal = await readProposal(storage, ownerGhii, id);
  if (!proposal) return false;
  await settle(storage, ownerGhii, proposal);
  return true;
}
