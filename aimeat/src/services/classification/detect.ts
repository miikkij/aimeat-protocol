/**
 * @file src/services/classification/detect.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detection rules, run on a piece of content's text with no model (TARGET-082 V3,
 *   spec §7: rules always run first). Nothing here reads storage or calls anything.
 *
 *   A keyword rule's pattern is comma-separated words, matched whole and case-insensitively. A regex
 *   rule is a pattern with its flags. A classifier rule is a description for the Content Classifier
 *   and never matches here. A rule applies only where its scope says (content kind, organism,
 *   workspace, key prefix), and only when the label it asks for is an active label of the policy:
 *   a rule whose label was retired matches nothing, because setting a retired label is refused. The
 *   answer is the most sensitive label any matching rule asks for.
 *
 *   A REGEX RULE CANNOT STOP THE NODE (review of 2026-09-29). It sees at most REGEX_TEXT characters
 *   of the text; a pattern that fails the static check (regex-safety.ts unsafeRegexReason) is not
 *   compiled; and each match runs with a time limit (testWithin), at most RULE_MS for one rule and
 *   ITEM_MS for all of one item's regex rules. A rule that reaches its limit counts as no match and
 *   is logged once per rule; past ITEM_MS the item's remaining rules are skipped. Keyword rules are
 *   built here from escaped words, so they cannot backtrack; they read up to MAX_TEXT, and their time
 *   counts against the same item, account and node limits as regex time (2026-10-25).
 *   ONE SCOPE CANNOT HOLD THE NODE EITHER (2026-09-30). The item limits bound one write, not a loop
 *   of them: rules that reach their limit on every write, written in an owner's own layer, blocked
 *   the event loop about a second per write. Each account (an owner, with the organisms the caller
 *   names as theirs) has SCOPE_MS_PER_MINUTE of rule time per minute; past it, its rules are skipped
 *   until the minute is over, logged once, and the run says `deferred` so the item is matched again
 *   later (classifier.ts).
 * @structure RuleHit · RuleRun · REGEX_TEXT · ruleApplies() · matchRules() · runRules() · resetRegexBudgets()
 * @usage const { hit, deferred } = runRules(policy, target, text, { budgetKey }); if (hit) await setLabel(deps, ruleActor, target, { label: hit.label });
 * @version-history
 *   v1.5.0 — 2026-10-25 — secaudit2026oct22: keyword rule time counts against the item, account and
 *     node budgets (keyword-rules-no-time-limit); runRules takes the account an organism belongs to as
 *     its budget key, and reports `deferred` when a budget skipped a rule (node-regex-budget-starvation).
 *     matchRules is runRules' hit.
 *   v1.4.0 — 2026-10-18 — A container (organism, workspace, board, app) is matched only by a rule
 *     whose appliesTo.kinds names it, on its name and description (plan doc-mvdipuyqraas, L1.6).
 *   v1.3.0 — 2026-10-05 — The budget of personal content is its owner's, whichever agent holds it,
 *     and the node has a cap of its own (NODE_MS_PER_MINUTE): an owner with many agents multiplied
 *     the budget (secaudit 2026-10, DATA-1).
 *   v1.2.0 — 2026-09-30 — A regex time budget per scope per minute (SCOPE_MS_PER_MINUTE), so one
 *     owner's slow rules cannot block the node write after write (TARGET-082 second review, S4).
 *   v1.1.1 — 2026-09-30 — Time limits 500 ms per rule and 1000 ms per item: a loaded CPU reached 100 ms on a safe rule.
 *   v1.1.0 — 2026-09-29 — Review fixes: regex rules see 20 000 characters, an unsafe pattern is not
 *     compiled, each match has a time limit, a rule for a retired label is skipped, and the g and y
 *     flags no longer carry lastIndex from one text to the next.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V3. Initial.
 */
import type { ContentLabelTarget } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import type { ClassificationPolicy, ClassificationRule } from './defaults.js';
import { scopeOrganism } from './policy.js';
import { testWithin, unsafeRegexReason } from './regex-safety.js';

export interface RuleHit {
  label: string;
  rank: number;
  rules: string[];
}

/** The most text a keyword rule reads. */
const MAX_TEXT = 200_000;
/** The most text a regex rule reads. */
export const REGEX_TEXT = 20_000;
/**
 * The time limit of one regex rule on one item, and the budget of all of one item's regex rules: a
 * rule starts only while the item has budget left. Generous on purpose: a limit reached counts as
 * no match, so a limit a GC pause or a busy CPU can reach would leave sensitive content unlabelled.
 * What they bound is the worst case, about RULE_MS + ITEM_MS of blocked event loop per item.
 */
// Raised from 100 and 200 ms on 2026-09-30: under a loaded CPU a safe rule reached the limit and
// an IBAN stayed unlabelled. The static check refuses the patterns that blow up; this is the backstop.
const RULE_MS = 500;
const ITEM_MS = 1000;
/**
 * The regex time one scope (an owner, or an organism) may spend per minute across all its items. A
 * safe pattern costs a fraction of a millisecond, so ordinary writes never come near it; a pattern
 * that reaches its time limit on every write stops blocking every other request on the node once
 * its scope has spent this, and the scope's items are matched by their keyword rules alone until
 * the minute is over (TARGET-082 second review, S4).
 */
const SCOPE_MS_PER_MINUTE = 3000;
/**
 * The regex time the whole node may spend per minute, whoever spends it: a quarter of each minute.
 * Many owners, each within their own budget, could otherwise still hold the event loop between them
 * (secaudit 2026-10, DATA-1).
 */
const NODE_MS_PER_MINUTE = 15_000;
const NODE_BUDGET = '\u0000node';
const scopeSpent = new Map<string, { since: number; ms: number }>();

/**
 * Whose budget an item's regex time comes from: an organism's own, and for personal content the
 * OWNER's, whichever of their agents holds it. Keyed by the item's own scope, every agent of one
 * owner had a budget of its own, so one owner multiplied it by their number of agents
 * (secaudit 2026-10, DATA-1).
 */
function budgetKeyOf(scope: string, account?: string): string {
  // The caller names the account an organism belongs to (classifier.ts budgetAccountOf), so one
  // account's organisms share one budget; each organism was a budget key of its own, and five of
  // them spent the node's minute for every other owner (secaudit2026oct22).
  if (account) return ownerGhiiOf(account);
  return scopeOrganism(scope) ? scope : ownerGhiiOf(scope);
}

function spentOf(key: string, cap: number, now: number): number {
  const s = scopeSpent.get(key);
  if (!s || now - s.since >= 60_000) return cap;
  return cap - s.ms;
}

function scopeLeft(key: string, now: number): number {
  return Math.min(spentOf(key, SCOPE_MS_PER_MINUTE, now), spentOf(NODE_BUDGET, NODE_MS_PER_MINUTE, now));
}

function charge(key: string, ms: number, now: number): void {
  const s = scopeSpent.get(key);
  if (!s || now - s.since >= 60_000) {
    if (scopeSpent.size > 10_000) scopeSpent.clear();
    scopeSpent.set(key, { since: now, ms });
  } else {
    s.ms += ms;
  }
}

function chargeScope(key: string, ms: number, now: number): void {
  charge(key, ms, now);
  charge(NODE_BUDGET, ms, now);
}

/** Forget what each scope spent. For tests. */
export function resetRegexBudgets(): void {
  scopeSpent.clear();
}

/** The containers, which a rule matches only when its scope names them (defaults.ts RuleScope). */
const CONTAINERS: ReadonlySet<string> = new Set(['organism', 'workspace', 'board', 'app']);

/** Whether `rule` applies to `target` at all, before its pattern is tried. */
export function ruleApplies(rule: ClassificationRule, target: ContentLabelTarget): boolean {
  if (!rule.enabled || rule.kind === 'classifier') return false;
  const s = rule.appliesTo;
  // A container's name and description meet only a rule written for that kind of container.
  if (CONTAINERS.has(target.kind)) return !!s?.kinds?.includes(target.kind) && (!s.organismId || scopeOrganism(target.scope) === s.organismId);
  if (!s) return true;
  if (s.kinds?.length && !s.kinds.includes(target.kind)) return false;
  if (s.organismId && scopeOrganism(target.scope) !== s.organismId) return false;
  if (s.ws && !target.key.includes(`.w.${s.ws}.`) && !target.key.startsWith(`${s.ws}/`)) return false;
  if (s.keyPrefix && !target.key.startsWith(s.keyPrefix)) return false;
  return true;
}

/** Rule ids already logged, so a rule that keeps failing says so once per process. */
const saidOnce = new Set<string>();
function sayOnce(ruleId: string, what: string, detail: Record<string, unknown>): void {
  const k = `${what}\u0000${ruleId}`;
  if (saidOnce.has(k)) return;
  if (saidOnce.size > 1000) saidOnce.clear();
  saidOnce.add(k);
  logger.warn(`classification: detection rule ${ruleId} ${what}`, detail);
}

const compiled = new Map<string, RegExp | null>();
function patternOf(rule: ClassificationRule): RegExp | null {
  const k = `${rule.kind}\u0000${rule.flags}\u0000${rule.pattern}`;
  if (!compiled.has(k)) {
    let re: RegExp | null;
    try {
      if (rule.kind === 'regex') {
        const why = unsafeRegexReason(rule.pattern, rule.flags);
        if (why) sayOnce(rule.id, 'is not run: its pattern ' + why, {});
        // g and y would carry lastIndex from one text to the next; a match needs neither.
        re = why ? null : new RegExp(rule.pattern, (rule.flags ?? '').replace(/[gy]/g, ''));
      } else {
        const words = rule.pattern.split(',').map(w => w.trim()).filter(Boolean)
          .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        re = words.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`, 'iu') : null;
      }
    // eslint-disable-next-line aimeat/no-silent-catch -- a rule that does not compile matches nothing; storing it was refused already
    } catch {
      // A pattern that does not compile was refused when the policy was stored (levels.ts); one
      // stored before that check matches nothing rather than failing every write.
      re = null;
    }
    if (compiled.size > 2000) compiled.clear();
    compiled.set(k, re);
  }
  return compiled.get(k) ?? null;
}

/** What one pass of the rules over an item found, and whether a budget skipped any rule. */
export interface RuleRun {
  hit: RuleHit | null;
  /**
   * A rule was skipped because the item's time or its account's or the node's minute was used up.
   * The item is not finished: classifier.ts classifyText puts it in the queue for a later pass, where
   * it was left unlabelled before (secaudit2026oct22, node-regex-budget-starvation).
   */
  deferred: boolean;
}

/** The most sensitive label the matching rules ask for, or null when none matches. */
export function matchRules(policy: ClassificationPolicy, target: ContentLabelTarget, text: string): RuleHit | null {
  return runRules(policy, target, text).hit;
}

/**
 * Run the rules over one item. Keyword and regex rules both spend the item's time and the budget of
 * its account and of the node: keyword rules read up to MAX_TEXT, and 500 of them of 1000 characters
 * held the event loop 300 to 750 ms per write with no budget at all (secaudit2026oct22,
 * keyword-rules-no-time-limit). A keyword rule is built from escaped words, so it cannot backtrack
 * and runs without the vm time limit; only its time is counted. `budgetKey` names the account an
 * organism belongs to; without it an organism is its own key, as before.
 */
export function runRules(policy: ClassificationPolicy, target: ContentLabelTarget, text: string, opts: { budgetKey?: string } = {}): RuleRun {
  const body = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  const regexBody = body.length > REGEX_TEXT ? body.slice(0, REGEX_TEXT) : body;
  const key = budgetKeyOf(target.scope, opts.budgetKey);
  // Only an active label: setting a retired one is refused (LABEL_UNKNOWN), which would fail the item.
  const rank = new Map(policy.labels.filter(l => l.status === 'active').map(l => [l.id, l.rank]));
  let best: RuleHit | null = null;
  let spent = 0;
  let deferred = false;
  for (const rule of policy.rules) {
    if (!ruleApplies(rule, target)) continue;
    const r = rank.get(rule.minLabel);
    if (r === undefined) continue;
    const re = patternOf(rule);
    if (!re) continue;
    if (spent >= ITEM_MS) {
      sayOnce(rule.id, 'was skipped: the item\'s rules used up their time', { key: target.key, spentMs: Math.round(spent) });
      deferred = true;
      continue;
    }
    const t0 = performance.now();
    const left = scopeLeft(key, t0);
    if (left <= 0) {
      sayOnce(`${key}\u0000budget`, 'was skipped: the rules of this account used up their time for this minute', { scope: target.scope, key: target.key });
      deferred = true;
      continue;
    }
    let hit: boolean | null;
    if (rule.kind === 'regex') {
      hit = testWithin(re, regexBody, Math.min(RULE_MS, ITEM_MS - spent, left));
      if (hit === null) sayOnce(rule.id, `reached its time limit (${RULE_MS} ms) and counts as no match`, { key: target.key, chars: regexBody.length });
    } else {
      hit = re.test(body);
    }
    const took = performance.now() - t0;
    spent += took;
    chargeScope(key, took, t0);
    if (!hit) continue;
    if (!best || r > best.rank) best = { label: rule.minLabel, rank: r, rules: [rule.id] };
    else if (r === best.rank) best.rules.push(rule.id);
  }
  return { hit: best, deferred };
}
