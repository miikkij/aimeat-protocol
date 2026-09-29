/**
 * @file src/services/classification/detect.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detection rules, run on a piece of content's text with no model (TARGET-082 V3,
 *   spec §7: rules always run first). Pure: nothing here reads storage or calls anything.
 *
 *   A keyword rule's pattern is comma-separated words, matched whole and case-insensitively. A regex
 *   rule is a pattern with its flags. A classifier rule is a description for the Content Classifier
 *   and never matches here. A rule applies only where its scope says (content kind, organism,
 *   workspace, key prefix). The answer is the most sensitive label any matching rule asks for.
 * @structure RuleHit · ruleApplies() · matchRules()
 * @usage const hit = matchRules(policy, target, text); if (hit) await setLabel(deps, ruleActor, target, { label: hit.label });
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V3. Initial.
 */
import type { ContentLabelTarget } from '../../storage/interface.js';
import type { ClassificationPolicy, ClassificationRule } from './defaults.js';
import { scopeOrganism } from './policy.js';

export interface RuleHit {
  label: string;
  rank: number;
  rules: string[];
}

const MAX_TEXT = 200_000;

/** Whether `rule` applies to `target` at all, before its pattern is tried. */
export function ruleApplies(rule: ClassificationRule, target: ContentLabelTarget): boolean {
  if (!rule.enabled || rule.kind === 'classifier') return false;
  const s = rule.appliesTo;
  if (!s) return true;
  if (s.kinds?.length && !s.kinds.includes(target.kind)) return false;
  if (s.organismId && scopeOrganism(target.scope) !== s.organismId) return false;
  if (s.ws && !target.key.includes(`.w.${s.ws}.`) && !target.key.startsWith(`${s.ws}/`)) return false;
  if (s.keyPrefix && !target.key.startsWith(s.keyPrefix)) return false;
  return true;
}

const compiled = new Map<string, RegExp | null>();
function patternOf(rule: ClassificationRule): RegExp | null {
  const k = `${rule.kind}\u0000${rule.flags}\u0000${rule.pattern}`;
  if (!compiled.has(k)) {
    let re: RegExp | null;
    try {
      if (rule.kind === 'regex') re = new RegExp(rule.pattern, rule.flags);
      else {
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

/** The most sensitive label the matching rules ask for, or null when none matches. */
export function matchRules(policy: ClassificationPolicy, target: ContentLabelTarget, text: string): RuleHit | null {
  const body = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  const rank = new Map(policy.labels.map(l => [l.id, l.rank]));
  let best: RuleHit | null = null;
  for (const rule of policy.rules) {
    if (!ruleApplies(rule, target)) continue;
    const re = patternOf(rule);
    if (!re || !re.test(body)) continue;
    const r = rank.get(rule.minLabel);
    if (r === undefined) continue;
    if (!best || r > best.rank) best = { label: rule.minLabel, rank: r, rules: [rule.id] };
    else if (r === best.rank) best.rules.push(rule.id);
  }
  return best;
}
