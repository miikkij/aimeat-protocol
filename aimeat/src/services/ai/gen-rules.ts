/**
 * @file gen-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Generation rules: built-in instructions the node gives to AI image and video
 *   generation, switched on per node and per owner (wish
 *   wish-image-and-video-generation-people-only-in-an-artistic-non-ph, brief doc-mvwu6alpp7w3). The
 *   first rule is `people-artistic`: people only in an artistic, non-photorealistic style.
 *
 *   PURE. This file is the registry, the parsers and the decision. The owner's record, the node
 *   setting and the confirm step are services/ai/gen-rules-store.ts.
 *
 *   THREE LEVELS (Jouni, 2026-10-31). The node sets each rule `off` (an owner may switch it on), `on`
 *   (an owner may switch it off) or `required` (nobody switches it off or bypasses it). The owner
 *   switches a rule on or off within that, and may exempt one app or one agent of theirs with a
 *   reason. One call may bypass a rule only when the owner makes the call in person. An app never
 *   changes or bypasses a rule: an app that could is what the rule exists for.
 *
 *   DIRECTIVE ONLY (Jouni, 2026-10-31). A rule adds an instruction to the prompt; nothing inspects
 *   the result. The provenance record says which rules were given (`applied`), skipped with a reason
 *   (`bypassed`), declared followed by a writer who generated elsewhere (`declared`), or not stated
 *   (`unknown`). Content with no statement is marked, never refused.
 *
 *   A NEW RULE is one entry in GEN_RULES, its locale keys (genRules.<id>.title, genRules.<id>.explain)
 *   and nothing else: the levels, the surfaces and the provenance marks read the registry.
 * @structure
 *   - GEN_RULES — the registry
 *   - GEN_RULE_MEDIA, isGenRuleMedia() — the media a rule can reach
 *   - parseNodeGenRules() — the operator's setting (AIMEAT_AI_GEN_RULES)
 *   - normaliseOwnerGenRules() — the owner's record, validated
 *   - resolveGenRules() — which rules a call or an arrival meets, and why
 *   - directiveText() — the instruction appended to a prompt
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial: people-artistic.
 */
import type { AiGenRuleMark, AiMediaKind } from '../../models/ai-provenance-schemas.js';

/** The media a generation rule can reach. Text is out of scope: the rules are about likeness. */
export const GEN_RULE_MEDIA = ['image', 'video'] as const;
export type GenRuleMedium = (typeof GEN_RULE_MEDIA)[number];

export function isGenRuleMedia(kind: AiMediaKind | undefined): kind is GenRuleMedium {
  return kind === 'image' || kind === 'video';
}

export interface GenRule {
  /** Lower-case letters, digits and `-`. Stable: provenance records name it. */
  id: string;
  /** Raised when the directive's meaning changes, so a record says which wording was given. */
  version: number;
  media: readonly GenRuleMedium[];
  /** One sentence for an AI reading the rules. A person reads genRules.<id>.title and .explain. */
  summary: string;
  /** The instruction appended to a prompt, per medium. English: prompts are English. */
  directive: Readonly<Record<GenRuleMedium, string>>;
}

export const GEN_RULES: readonly GenRule[] = [
  {
    id: 'people-artistic',
    version: 1,
    media: ['image', 'video'],
    summary: 'People in generated pictures and videos are shown only in an artistic, non-photorealistic '
      + 'style, so nothing made here can pass for a photograph or footage of a real person (a deep fake, '
      + 'AI Act Article 50(4)).',
    directive: {
      image: 'If the picture shows people, draw them in a clearly artistic, non-photorealistic style '
        + '(for example illustration, painting, comic or stylised 3D). Never make a person look like a '
        + 'photograph or a real, identifiable individual.',
      video: 'If the video shows people, render them in a clearly artistic, non-photorealistic style '
        + '(for example animation, illustration, comic or stylised 3D). Never make a person look like '
        + 'filmed footage or a real, identifiable individual.',
    },
  },
];

export function genRuleById(id: string): GenRule | undefined {
  return GEN_RULES.find(r => r.id === id);
}

/** The operator's level for one rule. */
export const NODE_GEN_RULE_MODES = ['off', 'on', 'required'] as const;
export type NodeGenRuleMode = (typeof NODE_GEN_RULE_MODES)[number];

/**
 * The operator's setting, `<rule>=<mode>` pairs separated by commas: `people-artistic=required`. A
 * rule the setting does not name is `off`. Returns the problems instead of guessing, so the config
 * validator can refuse the value and the reader can log it.
 */
export function parseNodeGenRules(raw: string | undefined): { modes: Record<string, NodeGenRuleMode>; problems: string[] } {
  const modes: Record<string, NodeGenRuleMode> = {};
  const problems: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const item = part.trim();
    if (!item) continue;
    const [id, mode] = item.split('=').map(s => s.trim());
    if (!id || !genRuleById(id)) { problems.push(`"${item}": no rule named "${id}"`); continue; }
    if (!(NODE_GEN_RULE_MODES as readonly string[]).includes(mode ?? '')) {
      problems.push(`"${item}": the mode is off, on or required`);
      continue;
    }
    modes[id] = mode as NodeGenRuleMode;
  }
  return { modes, problems };
}

/** One exemption the owner made: this rule is not given to this app's or this agent's calls. */
export interface GenRuleException {
  rule: string;
  /** An app's address, `<owner>/<file>.html`. */
  app?: string;
  /** An agent of the owner's, by its bare name. */
  agent?: string;
  reason: string;
}

/** The owner's record (`ai.policy.gen-rules`). A rule the record does not name follows the node. */
export interface OwnerGenRules {
  rules: Record<string, boolean>;
  exceptions: GenRuleException[];
  updatedAt?: string;
}

export const EMPTY_OWNER_GEN_RULES: OwnerGenRules = { rules: {}, exceptions: [] };

const MAX_EXCEPTIONS = 100;
const REASON_MAX = 300;
const APP_ADDRESS = /^[a-z0-9][a-z0-9._-]{0,99}\/[a-z0-9][a-z0-9._-]{0,150}\.html$/i;
const AGENT_NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

/** Read a stored record leniently: what does not parse is left out, never thrown over. */
export function readOwnerGenRules(value: unknown): OwnerGenRules {
  const r = normaliseOwnerGenRules(value);
  return 'problems' in r ? EMPTY_OWNER_GEN_RULES : r.record;
}

/**
 * Validate an owner's record. Every problem at once, so an AI fixing its call gets them all in one
 * answer. `rules` takes `true`, `false` or `null` (null removes the owner's choice, so the rule
 * follows the node again).
 */
export function normaliseOwnerGenRules(input: unknown): { record: OwnerGenRules } | { problems: Array<{ field: string; message: string }> } {
  const problems: Array<{ field: string; message: string }> = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { problems: [{ field: 'gen_rules', message: 'must be an object { rules?, exceptions? }' }] };
  }
  const v = input as Record<string, unknown>;
  const rules: Record<string, boolean> = {};
  if (v.rules !== undefined) {
    if (!v.rules || typeof v.rules !== 'object' || Array.isArray(v.rules)) {
      problems.push({ field: 'rules', message: 'must be an object { "<rule id>": true | false | null }' });
    } else {
      for (const [id, on] of Object.entries(v.rules as Record<string, unknown>)) {
        if (!genRuleById(id)) problems.push({ field: `rules.${id}`, message: `is not a rule; the rules are ${GEN_RULES.map(r => r.id).join(', ')}` });
        else if (on === null) continue;
        else if (typeof on !== 'boolean') problems.push({ field: `rules.${id}`, message: 'must be true, false or null' });
        else rules[id] = on;
      }
    }
  }
  const exceptions: GenRuleException[] = [];
  if (v.exceptions !== undefined) {
    if (!Array.isArray(v.exceptions)) {
      problems.push({ field: 'exceptions', message: 'must be a list of { rule, app | agent, reason }' });
    } else if (v.exceptions.length > MAX_EXCEPTIONS) {
      problems.push({ field: 'exceptions', message: `has at most ${MAX_EXCEPTIONS} entries` });
    } else {
      v.exceptions.forEach((raw, i) => {
        const f = `exceptions[${i}]`;
        const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        const rule = typeof e.rule === 'string' ? e.rule : '';
        const app = typeof e.app === 'string' ? e.app.trim() : undefined;
        const agent = typeof e.agent === 'string' ? e.agent.trim() : undefined;
        const reason = typeof e.reason === 'string' ? e.reason.trim() : '';
        if (!genRuleById(rule)) problems.push({ field: `${f}.rule`, message: 'is not a rule' });
        if (!!app === !!agent) problems.push({ field: f, message: 'names exactly one of app (<owner>/<file>.html) or agent (its name)' });
        if (app && !APP_ADDRESS.test(app)) problems.push({ field: `${f}.app`, message: 'is <owner>/<file>.html' });
        if (agent && !AGENT_NAME.test(agent)) problems.push({ field: `${f}.agent`, message: 'is the agent\'s name' });
        if (!reason || reason.length > REASON_MAX) problems.push({ field: `${f}.reason`, message: `is required, at most ${REASON_MAX} characters` });
        exceptions.push({ rule, ...(app ? { app } : {}), ...(agent ? { agent } : {}), reason });
      });
    }
  }
  if (problems.length) return { problems };
  return {
    record: {
      rules, exceptions,
      ...(typeof v.updatedAt === 'string' ? { updatedAt: v.updatedAt } : {}),
    },
  };
}

/** Who makes the call or wrote the content, as far as the rules are concerned. */
export interface GenRuleCaller {
  /** The owner in person: the only caller whose own bypass counts. */
  ownerInPerson: boolean;
  /** The app the call came through, `<owner>/<file>.html`. */
  app?: string;
  /** The owner's agent that made the call, by bare name. */
  agent?: string;
}

/** A per-call bypass: the rules to skip and why. Only the owner in person may ask for one. */
export interface GenRuleBypass {
  rules: string[];
  reason: string;
}

/** A request's `gen_rules_bypass` as a bypass, or the problem with it. Absent stays absent. */
export function parseGenRulesBypass(raw: unknown): { bypass?: GenRuleBypass } | { problem: string } {
  if (raw === undefined || raw === null) return {};
  const v = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  const rules = Array.isArray(v?.rules) ? v.rules.filter((r): r is string => typeof r === 'string') : [];
  const reason = typeof v?.reason === 'string' ? v.reason.trim() : '';
  if (!v || !rules.length || rules.length !== (v.rules as unknown[]).length || rules.length > GEN_RULES.length) {
    return { problem: 'gen_rules_bypass is { rules: ["<rule id>"], reason: "<why>" }' };
  }
  if (!reason || reason.length > REASON_MAX) return { problem: `gen_rules_bypass.reason is required, at most ${REASON_MAX} characters` };
  return { bypass: { rules, reason } };
}

/** What one rule did to one call or one arrival, as the provenance record states it. */
export type GenRuleMark = AiGenRuleMark;

export interface GenRuleDecision {
  /** The rules in force for this medium and caller (bypassed ones included), with their effect. */
  marks: GenRuleMark[];
  /** The rules whose directive goes into the prompt. */
  given: GenRule[];
  /** A bypass the rules refuse, with the reason: the call is refused before anything is spent. */
  refused?: { rule: string; message: string };
}

/** Is the rule in force for this owner, before any exception or bypass? And can it be lifted? */
export function ruleStanding(rule: GenRule, nodeModes: Record<string, NodeGenRuleMode>, owner: OwnerGenRules): { on: boolean; required: boolean } {
  const mode = nodeModes[rule.id] ?? 'off';
  if (mode === 'required') return { on: true, required: true };
  const own = owner.rules[rule.id];
  return { on: own ?? mode === 'on', required: false };
}

/**
 * The rules a call meets. A required rule is always given; a bypass of it is refused. Otherwise an
 * owner's exception for the app or the agent, then the owner's own bypass, lifts the rule, and the
 * mark keeps the reason.
 */
export function resolveGenRules(input: {
  medium: GenRuleMedium;
  nodeModes: Record<string, NodeGenRuleMode>;
  owner: OwnerGenRules;
  caller: GenRuleCaller;
  bypass?: GenRuleBypass;
}): GenRuleDecision {
  const { medium, nodeModes, owner, caller, bypass } = input;
  if (bypass) {
    for (const id of bypass.rules) {
      const rule = genRuleById(id);
      if (!rule) return { marks: [], given: [], refused: { rule: id, message: `There is no generation rule "${id}".` } };
      if (!caller.ownerInPerson) {
        return { marks: [], given: [], refused: { rule: id, message: `Only the owner in person may bypass "${id}" for one call. An agent or an app asks the owner for an exception instead (aimeat_ai_gen_rules_set).` } };
      }
      if (ruleStanding(rule, nodeModes, owner).required) {
        return { marks: [], given: [], refused: { rule: id, message: `The node requires "${id}", so no call bypasses it.` } };
      }
    }
    if (!bypass.reason.trim()) return { marks: [], given: [], refused: { rule: bypass.rules[0] ?? '', message: 'A bypass needs a reason.' } };
  }
  const marks: GenRuleMark[] = [];
  const given: GenRule[] = [];
  for (const rule of GEN_RULES) {
    if (!rule.media.includes(medium)) continue;
    const standing = ruleStanding(rule, nodeModes, owner);
    if (!standing.on) continue;
    const base = { id: rule.id, version: rule.version };
    if (!standing.required) {
      const ex = owner.exceptions.find(e => e.rule === rule.id
        && ((e.app && caller.app && e.app.toLowerCase() === caller.app.toLowerCase()) || (e.agent && e.agent === caller.agent)));
      if (ex) { marks.push({ ...base, state: 'bypassed', reason: `Owner's exception for ${ex.app ? `app ${ex.app}` : `agent ${ex.agent}`}: ${ex.reason}` }); continue; }
      if (bypass?.rules.includes(rule.id)) { marks.push({ ...base, state: 'bypassed', reason: `Owner in person: ${bypass.reason.trim()}` }); continue; }
    }
    marks.push({ ...base, state: 'applied' });
    given.push(rule);
  }
  return { marks, given };
}

/** The instruction appended to a prompt for the given rules, or '' when none. */
export function directiveText(rules: readonly GenRule[], medium: GenRuleMedium): string {
  return rules.map(r => r.directive[medium]).join(' ');
}

/**
 * The marks for content a writer brought in (generated elsewhere): each rule in force is `declared`
 * when the writer said it followed it, otherwise `unknown`; an exception still says `bypassed`.
 */
export function arrivalMarks(decision: GenRuleDecision, rulesFollowed: readonly string[] | undefined): GenRuleMark[] {
  return decision.marks.map(m => m.state === 'bypassed' ? m
    : { id: m.id, version: m.version, state: rulesFollowed?.includes(m.id) ? 'declared' as const : 'unknown' as const });
}
