/**
 * @file src/services/classification/levels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three policy levels and the rule that a lower level never dilutes a higher one
 *   (TARGET-082 V2, spec §4 and §4.1). Pure functions: nothing here reads storage.
 *
 *   THE LEVELS. The node's policy is whole: every label, every rule, the default, the AI mode and the
 *   limits. An owner's layer applies to their personal content, an organism's layer to the
 *   organism's content; content has one owner or one organism, so it merges two levels, never three.
 *   A layer holds only what it adds or tightens.
 *
 *   ONLY TIGHTEN (decided 2026-09-29). A layer may add its own labels between the node's, add rules,
 *   and make a node label or rule stricter. It may not remove, rename, move, retire or loosen a node
 *   label, turn off or weaken a node rule, pick a less sensitive default, or give an AI more say.
 *   A label of its own inherits every field it leaves out from the node label at or below its rank,
 *   and what it sets may only be stricter than that. A refusal names the node label or rule.
 *
 *   THE SAME COMPARISON twice: validateLayer holds a layer to the node, and loosenings() tells
 *   whether a change to one level gives anything away, which decides whether an AI's change applies
 *   at once or waits for a person (decided 2026-09-29: an AI tightens at once and loosens only as a
 *   proposal a person approves in their own session).
 * @structure PolicyLayer · validateNodePolicy() · validateLayer() · mergePolicy() · loosenings()
 * @usage
 *   const layer = validateLayer(node, input);        // throws POLICY_DILUTES naming the node's rule
 *   const effective = mergePolicy(node, layer);
 *   const given = loosenings(before, after);         // [] when the change only tightens
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V2. Initial.
 */
import {
  DEFAULT_CLASSIFIER, DEFAULT_LIMITS, type AiVisibility, type ClassificationLabel, type ClassificationPolicy,
  type ClassificationRule, type ClassifierSettings, type LabelAudience, type RuleScope,
} from './defaults.js';

/** Thrown for a policy that cannot be stored. `problems` lists every one, so a caller fixes all at once. */
export class PolicyError extends Error {
  constructor(public code: 'INVALID_POLICY' | 'POLICY_DILUTES', public problems: string[]) {
    super(`${code === 'POLICY_DILUTES' ? 'A lower level may only make the node policy stricter' : 'The policy is not valid'}: ${problems.join(' ')}`);
    this.name = 'PolicyError';
  }
}

/** What an owner or an organism stores: only what it adds or tightens, plus its own switch. */
export interface PolicyLayer {
  enabled?: boolean;
  /** The classifier type and provider this owner or organism uses, and more kinds to judge on write. */
  classifier?: Partial<Pick<ClassifierSettings, 'type' | 'provider' | 'onWrite'>>;
  labels?: ClassificationLabel[];
  rules?: ClassificationRule[];
  defaultLabel?: string;
  aiMode?: ClassificationPolicy['aiMode'];
  aiThreshold?: number;
}

const VIS: Record<AiVisibility, number> = { allowed: 0, warning: 1, hidden: 2 };
const AI_MODE: Record<ClassificationPolicy['aiMode'], number> = { auto: 0, suggest: 1, off: 2 };
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_LIST = 50;

// ── Reading input ────────────────────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : undefined;
}

function strList(v: unknown, field: string, problems: string[]): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > MAX_LIST || v.some(x => typeof x !== 'string' || !x.trim() || x.length > 200)) {
    problems.push(`${field} is a list of at most ${MAX_LIST} names.`);
    return undefined;
  }
  return [...new Set(v.map(x => (x as string).trim()))];
}

function readAudience(v: unknown, where: string, problems: string[]): LabelAudience | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!isObj(v)) { problems.push(`${where}.audience is an object with roles, groups and people.`); return undefined; }
  const a: LabelAudience = {};
  const roles = strList(v.roles, `${where}.audience.roles`, problems);
  const groups = strList(v.groups, `${where}.audience.groups`, problems);
  const people = strList(v.people, `${where}.audience.people`, problems);
  if (roles?.length) a.roles = roles;
  if (groups?.length) a.groups = groups;
  if (people?.length) a.people = people;
  return audienceEmpty(a) ? null : a;
}

function audienceEmpty(a: LabelAudience | null | undefined): boolean {
  return !a || (!a.roles?.length && !a.groups?.length && !a.people?.length);
}

/** A label from input. `base` fills what the input leaves out (a layer's own label inherits). */
function readLabel(v: unknown, i: number, problems: string[], base?: ClassificationLabel): ClassificationLabel | null {
  const where = `labels[${i}]`;
  if (!isObj(v)) { problems.push(`${where} is an object.`); return null; }
  const id = typeof v.id === 'string' ? v.id.trim() : '';
  if (!ID.test(id)) { problems.push(`${where}.id is 1-40 lowercase letters, digits and dashes.`); return null; }
  const n = isObj(v.name) ? v.name : {};
  const en = str(n.en, 80) ?? base?.name?.en;
  const name = { fi: str(n.fi, 80) ?? base?.name?.fi ?? en ?? id, en: en ?? id, es: str(n.es, 80) ?? base?.name?.es ?? en ?? id };
  const rank = v.rank ?? base?.rank;
  if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 0 || rank > 999) {
    problems.push(`${where} (${id}).rank is a whole number from 0 to 999.`);
    return null;
  }
  const color = str(v.color, 20) ?? base?.color ?? '#888888';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) problems.push(`${where} (${id}).color is #rrggbb.`);
  const status = v.status ?? base?.status ?? 'active';
  if (status !== 'active' && status !== 'retired') problems.push(`${where} (${id}).status is active or retired.`);
  const aiVisibility = (v.aiVisibility ?? base?.aiVisibility ?? 'allowed') as AiVisibility;
  if (!(aiVisibility in VIS)) problems.push(`${where} (${id}).aiVisibility is hidden, warning or allowed.`);
  const bool = (f: 'audit' | 'mayLeaveOrganism' | 'lowerNeedsJustification', dflt: boolean): boolean => {
    const x = v[f] ?? base?.[f] ?? dflt;
    if (typeof x !== 'boolean') { problems.push(`${where} (${id}).${f} is true or false.`); return dflt; }
    return x;
  };
  const audience = readAudience(v.audience, `${where} (${id})`, problems);
  return {
    id, name, rank, color, status: status as ClassificationLabel['status'],
    description: str(v.description, 500) ?? base?.description ?? '',
    aiVisibility, audit: bool('audit', false), mayLeaveOrganism: bool('mayLeaveOrganism', true),
    lowerNeedsJustification: bool('lowerNeedsJustification', false),
    audience: audience === undefined ? (base?.audience ?? null) : audience,
  };
}

function readScope(v: unknown, where: string, problems: string[]): RuleScope | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) { problems.push(`${where}.appliesTo is an object.`); return null; }
  const s: RuleScope = {};
  if (v.kinds !== undefined) {
    if (!Array.isArray(v.kinds) || v.kinds.some(k => k !== 'memory' && k !== 'file' && k !== 'row')) {
      problems.push(`${where}.appliesTo.kinds lists memory, file and row.`);
    } else if (v.kinds.length) s.kinds = [...new Set(v.kinds)] as RuleScope['kinds'];
  }
  for (const f of ['organismId', 'ws', 'keyPrefix'] as const) {
    if (v[f] === undefined) continue;
    const x = str(v[f], 200);
    if (x) s[f] = x; else problems.push(`${where}.appliesTo.${f} is text.`);
  }
  return Object.keys(s).length ? s : null;
}

function readRule(v: unknown, i: number, problems: string[]): ClassificationRule | null {
  const where = `rules[${i}]`;
  if (!isObj(v)) { problems.push(`${where} is an object.`); return null; }
  const id = typeof v.id === 'string' ? v.id.trim() : '';
  if (!ID.test(id)) { problems.push(`${where}.id is 1-40 lowercase letters, digits and dashes.`); return null; }
  const kind = v.kind;
  if (kind !== 'keyword' && kind !== 'regex' && kind !== 'classifier') {
    problems.push(`${where} (${id}).kind is keyword, regex or classifier.`);
    return null;
  }
  const pattern = str(v.pattern, 1000);
  if (!pattern) { problems.push(`${where} (${id}).pattern is text of at most 1000 characters.`); return null; }
  const flags = typeof v.flags === 'string' ? v.flags : '';
  if (!/^[imsu]*$/.test(flags)) problems.push(`${where} (${id}).flags uses only i, m, s and u.`);
  if (kind === 'regex') {
    // eslint-disable-next-line aimeat/no-silent-catch -- the failure is the answer: it becomes a problem the caller is told
    try { new RegExp(pattern, flags); } catch { problems.push(`${where} (${id}).pattern is not a valid regular expression.`); }
  }
  const minLabel = typeof v.minLabel === 'string' ? v.minLabel.trim() : '';
  if (!minLabel) problems.push(`${where} (${id}).minLabel names a label.`);
  const enabled = v.enabled ?? true;
  if (typeof enabled !== 'boolean') problems.push(`${where} (${id}).enabled is true or false.`);
  return {
    id, name: str(v.name, 120) ?? id, kind, pattern, flags, minLabel, enabled: enabled === true,
    appliesTo: readScope(v.appliesTo, `${where} (${id})`, problems),
  };
}

function readLimits(v: unknown, problems: string[]): ClassificationPolicy['limits'] {
  if (v === undefined) return { ...DEFAULT_LIMITS };
  const ok = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 10_000;
  if (!isObj(v) || !ok(v.labels ?? DEFAULT_LIMITS.labels) || !ok(v.rules ?? DEFAULT_LIMITS.rules)) {
    problems.push('limits.labels and limits.rules are whole numbers from 1 to 10000.');
    return { ...DEFAULT_LIMITS };
  }
  return { labels: (v.labels ?? DEFAULT_LIMITS.labels) as number, rules: (v.rules ?? DEFAULT_LIMITS.rules) as number };
}

function readAiMode(v: unknown, problems: string[]): ClassificationPolicy['aiMode'] | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'string' && v in AI_MODE) return v as ClassificationPolicy['aiMode'];
  problems.push('aiMode is off, suggest or auto.');
  return undefined;
}

function readThreshold(v: unknown, problems: string[]): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number' && v >= 0 && v <= 1) return v;
  problems.push('aiThreshold is a number from 0 to 1.');
  return undefined;
}

const KINDS = new Set(['memory', 'file', 'row']);

/**
 * The classifier settings from input. The node sets every field; a layer picks only its type, its
 * provider and more kinds to judge on write (`node` false), because the caps are the operator's.
 */
function readClassifier(v: unknown, problems: string[], base: ClassifierSettings, node: boolean): Partial<ClassifierSettings> | ClassifierSettings | undefined {
  if (v === undefined) return node ? { ...base, onWrite: [...base.onWrite] } : undefined;
  if (!isObj(v)) { problems.push('classifier is an object.'); return node ? { ...base } : undefined; }
  const out: Partial<ClassifierSettings> = node ? { ...base, onWrite: [...base.onWrite] } : {};
  if (v.type !== undefined) {
    if (v.type === 'jev' || v.type === 'llm') out.type = v.type; else problems.push('classifier.type is jev or llm.');
  }
  if (v.provider !== undefined) {
    if (v.provider === null || (typeof v.provider === 'string' && v.provider.length <= 120)) out.provider = v.provider as string | null;
    else problems.push('classifier.provider is a provider id or null.');
  }
  if (v.onWrite !== undefined) {
    if (Array.isArray(v.onWrite) && v.onWrite.every(k => typeof k === 'string' && KINDS.has(k))) out.onWrite = [...new Set(v.onWrite as ClassifierSettings['onWrite'])];
    else problems.push('classifier.onWrite lists memory, file and row.');
  }
  for (const f of ['dailyPerOwner', 'dailyNode'] as const) {
    if (v[f] === undefined) continue;
    if (!node) { problems.push(`classifier.${f} is the operator's, set at the node level.`); continue; }
    const n = v[f];
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1_000_000) out[f] = n;
    else problems.push(`classifier.${f} is a whole number from 0 to 1000000.`);
  }
  return out;
}

function duplicates(values: Array<string | number>, what: string, problems: string[]): void {
  const seen = new Set<string | number>();
  for (const x of values) {
    if (seen.has(x)) problems.push(`Two ${what} share ${typeof x === 'number' ? 'rank' : 'id'} ${x}.`);
    seen.add(x);
  }
}

// ── The node level ───────────────────────────────────────────────────────────────────────────────

/** The node's whole policy from input, or PolicyError listing every problem. */
export function validateNodePolicy(input: unknown): ClassificationPolicy {
  const problems: string[] = [];
  if (!isObj(input)) throw new PolicyError('INVALID_POLICY', ['The node policy is an object.']);
  const limits = readLimits(input.limits, problems);
  const labels = (Array.isArray(input.labels) ? input.labels : []).map((l, i) => readLabel(l, i, problems)).filter(Boolean) as ClassificationLabel[];
  const rules = (Array.isArray(input.rules) ? input.rules : []).map((r, i) => readRule(r, i, problems)).filter(Boolean) as ClassificationRule[];
  if (!labels.some(l => l.status === 'active')) problems.push('The node policy needs at least one active label.');
  if (labels.length > limits.labels) problems.push(`${labels.length} labels is over the limit of ${limits.labels}.`);
  if (rules.length > limits.rules) problems.push(`${rules.length} rules is over the limit of ${limits.rules}.`);
  duplicates(labels.map(l => l.id), 'labels', problems);
  duplicates(labels.map(l => l.rank), 'labels', problems);
  duplicates(rules.map(r => r.id), 'rules', problems);
  const active = new Set(labels.filter(l => l.status === 'active').map(l => l.id));
  for (const r of rules) if (r.minLabel && !active.has(r.minLabel)) problems.push(`Rule ${r.id} names ${r.minLabel}, which is not an active label.`);
  const defaultLabel = typeof input.defaultLabel === 'string' ? input.defaultLabel : '';
  if (!active.has(defaultLabel)) problems.push('defaultLabel names an active label.');
  const aiMode = readAiMode(input.aiMode, problems) ?? 'suggest';
  const aiThreshold = readThreshold(input.aiThreshold, problems) ?? 0.85;
  let auditRetentionDays: number | null = 365;
  if (input.auditRetentionDays === null) auditRetentionDays = null;
  else if (input.auditRetentionDays !== undefined) {
    const d = input.auditRetentionDays;
    if (typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 36_500) auditRetentionDays = d;
    else problems.push('auditRetentionDays is a whole number of days from 1 to 36500, or null to keep every row.');
  }
  const classifier = readClassifier(input.classifier, problems, DEFAULT_CLASSIFIER, true) as ClassifierSettings;
  if (problems.length) throw new PolicyError('INVALID_POLICY', problems);
  return { labels: labels.sort((a, b) => a.rank - b.rank), rules, limits, defaultLabel, aiMode, aiThreshold, auditRetentionDays, classifier };
}

// ── A lower level ────────────────────────────────────────────────────────────────────────────────

/** The node label an own label at `rank` inherits from: the one at or below it, else the lowest. */
function inheritFrom(node: ClassificationPolicy, rank: number): ClassificationLabel {
  const sorted = [...node.labels].sort((a, b) => a.rank - b.rank);
  return [...sorted].reverse().find(l => l.rank <= rank) ?? sorted[0];
}

/** Is `inner` no wider than `outer`? An empty outer admits everyone, so anything is within it. */
function audienceWithin(inner: LabelAudience | null | undefined, outer: LabelAudience | null | undefined): boolean {
  if (audienceEmpty(outer)) return true;
  if (audienceEmpty(inner)) return false;
  const sub = (a?: string[], b?: string[]) => (a ?? []).every(x => (b ?? []).includes(x));
  return sub(inner!.roles, outer!.roles) && sub(inner!.groups, outer!.groups) && sub(inner!.people, outer!.people);
}

/** `base` with every rule field of `over` that is stricter; names and rank stay the base's. */
function stricterLabel(base: ClassificationLabel, over: ClassificationLabel): ClassificationLabel {
  const narrower = audienceWithin(over.audience, base.audience) && !audienceEmpty(over.audience) ? over.audience : base.audience;
  return {
    ...base,
    aiVisibility: VIS[over.aiVisibility] > VIS[base.aiVisibility] ? over.aiVisibility : base.aiVisibility,
    audit: base.audit || over.audit,
    mayLeaveOrganism: base.mayLeaveOrganism && over.mayLeaveOrganism,
    lowerNeedsJustification: base.lowerNeedsJustification || over.lowerNeedsJustification,
    audience: narrower ?? null,
  };
}

/** Every way `next` is less strict than `base`, as sentences naming `baseName`. */
function labelLoosenings(next: ClassificationLabel, base: ClassificationLabel, baseName: string): string[] {
  const out: string[] = [];
  if (VIS[next.aiVisibility] < VIS[base.aiVisibility]) out.push(`${baseName} shows an AI "${base.aiVisibility}", and "${next.aiVisibility}" lets it see more.`);
  if (base.audit && !next.audit) out.push(`${baseName} keeps an audit trail, which cannot be turned off.`);
  if (!base.mayLeaveOrganism && next.mayLeaveOrganism) out.push(`${baseName} may not leave the organism, which cannot be allowed.`);
  if (base.lowerNeedsJustification && !next.lowerNeedsJustification) out.push(`${baseName} needs a reason for lowering, which cannot be dropped.`);
  if (!audienceWithin(next.audience, base.audience)) out.push(`${baseName} limits its readers, and a lower level may only narrow that list.`);
  return out;
}

/** Every way rule `next` is weaker than `base` in `policy`'s ranks. */
function ruleLoosenings(next: ClassificationRule | undefined, base: ClassificationRule, rankOf: (id: string) => number, who: string): string[] {
  if (!base.enabled) return [];
  if (!next || !next.enabled) return [`${who} rule ${base.id} cannot be turned off or removed.`];
  const out: string[] = [];
  if (next.kind !== base.kind || next.pattern !== base.pattern || next.flags !== base.flags) out.push(`${who} rule ${base.id} cannot be changed, only added to.`);
  if (rankOf(next.minLabel) < rankOf(base.minLabel)) out.push(`${who} rule ${base.id} gives at least ${base.minLabel}, and ${next.minLabel} is lower.`);
  if (JSON.stringify(next.appliesTo ?? null) !== JSON.stringify(base.appliesTo ?? null) && base.appliesTo) {
    out.push(`${who} rule ${base.id} cannot be narrowed to fewer places.`);
  }
  return out;
}

/**
 * An owner's or organism's layer from input, held to `node`. Throws INVALID_POLICY for a malformed
 * layer and POLICY_DILUTES for one that would loosen anything the node set, naming each case.
 */
export function validateLayer(node: ClassificationPolicy, input: unknown): PolicyLayer {
  const problems: string[] = [];
  if (!isObj(input)) throw new PolicyError('INVALID_POLICY', ['The policy is an object.']);
  const nodeById = new Map(node.labels.map(l => [l.id, l]));
  const layer: PolicyLayer = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled === 'boolean') layer.enabled = input.enabled; else problems.push('enabled is true or false.');
  }
  const rawLabels = input.labels === undefined ? [] : Array.isArray(input.labels) ? input.labels : (problems.push('labels is a list.'), []);
  const labels: ClassificationLabel[] = [];
  rawLabels.forEach((raw, i) => {
    const id = isObj(raw) && typeof raw.id === 'string' ? raw.id.trim() : '';
    const nodeLabel = nodeById.get(id);
    const rank = isObj(raw) && typeof raw.rank === 'number' ? raw.rank : nodeLabel?.rank;
    // A node label keeps its own names; a label of the layer's own inherits the rules, not the words.
    const inherited = !nodeLabel && typeof rank === 'number'
      ? { ...inheritFrom(node, rank), id, status: 'active' as const, name: undefined as unknown as ClassificationLabel['name'], description: '', color: undefined as unknown as string }
      : undefined;
    const l = readLabel(raw, i, problems, nodeLabel ?? inherited);
    if (l) labels.push(l);
  });
  if (labels.length > node.limits.labels) problems.push(`${labels.length} labels is over the node's limit of ${node.limits.labels}.`);
  duplicates(labels.map(l => l.id), 'labels', problems);
  const rules = (input.rules === undefined ? [] : Array.isArray(input.rules) ? input.rules : (problems.push('rules is a list.'), []))
    .map((r, i) => readRule(r, i, problems)).filter(Boolean) as ClassificationRule[];
  if (rules.length > node.limits.rules) problems.push(`${rules.length} rules is over the node's limit of ${node.limits.rules}.`);
  duplicates(rules.map(r => r.id), 'rules', problems);
  if (input.defaultLabel !== undefined) {
    if (typeof input.defaultLabel === 'string') layer.defaultLabel = input.defaultLabel; else problems.push('defaultLabel names a label.');
  }
  layer.aiMode = readAiMode(input.aiMode, problems);
  layer.aiThreshold = readThreshold(input.aiThreshold, problems);
  layer.classifier = readClassifier(input.classifier, problems, node.classifier, false) as PolicyLayer['classifier'];
  if (problems.length) throw new PolicyError('INVALID_POLICY', problems);

  const dilutes: string[] = [];
  const ranks = new Map(node.labels.map(l => [l.rank, l.id]));
  for (const l of labels) {
    const nodeLabel = nodeById.get(l.id);
    if (nodeLabel) {
      if (l.rank !== nodeLabel.rank || l.status !== nodeLabel.status) dilutes.push(`Node label ${l.id} keeps its rank ${nodeLabel.rank} and its status; a lower level only tightens it.`);
      dilutes.push(...labelLoosenings(l, nodeLabel, `Node label ${l.id}`));
      continue;
    }
    const taken = ranks.get(l.rank);
    if (taken) dilutes.push(`Rank ${l.rank} of label ${l.id} is taken by node label ${taken}.`);
    ranks.set(l.rank, l.id);
    const base = inheritFrom(node, l.rank);
    dilutes.push(...labelLoosenings(l, base, `Label ${l.id} inherits from node label ${base.id}, which`));
  }
  const merged = mergePolicy(node, { ...layer, labels, rules });
  const rankOf = (id: string) => merged.labels.find(x => x.id === id)?.rank ?? -1;
  const active = new Set(merged.labels.filter(x => x.status === 'active').map(x => x.id));
  for (const r of rules) if (!active.has(r.minLabel)) dilutes.push(`Rule ${r.id} names ${r.minLabel}, which is not an active label.`);
  const ruleById = new Map(rules.map(r => [r.id, r]));
  for (const base of node.rules) {
    if (ruleById.has(base.id)) dilutes.push(...ruleLoosenings(ruleById.get(base.id), base, rankOf, 'Node'));
  }
  if (layer.defaultLabel !== undefined) {
    if (!active.has(layer.defaultLabel)) dilutes.push(`defaultLabel ${layer.defaultLabel} is not an active label.`);
    else if (rankOf(layer.defaultLabel) < rankOf(node.defaultLabel)) dilutes.push(`The node's default label is ${node.defaultLabel}; ${layer.defaultLabel} is less sensitive.`);
  }
  if (layer.aiMode && AI_MODE[layer.aiMode] < AI_MODE[node.aiMode]) dilutes.push(`The node's AI mode is ${node.aiMode}; ${layer.aiMode} gives an AI more say.`);
  if (layer.aiThreshold !== undefined && layer.aiThreshold < node.aiThreshold) dilutes.push(`The node's AI confidence threshold is ${node.aiThreshold}; a lower level may only raise it.`);
  if (dilutes.length) throw new PolicyError('POLICY_DILUTES', dilutes);
  if (labels.length) layer.labels = labels;
  if (rules.length) layer.rules = rules;
  for (const k of Object.keys(layer) as Array<keyof PolicyLayer>) if (layer[k] === undefined) delete layer[k];
  return layer;
}

/** The policy that applies: the node's, with the layer's additions and tightenings. */
export function mergePolicy(node: ClassificationPolicy, layer?: PolicyLayer | null): ClassificationPolicy {
  if (!layer) return node;
  // The merge takes the stricter value field by field, so a layer stored before the node tightened
  // a label or a rule can never hand back what the node took away since.
  const own = new Map((layer.labels ?? []).map(l => [l.id, l]));
  const labels = [
    ...node.labels.map(l => (own.has(l.id) ? stricterLabel(l, own.get(l.id)!) : l)),
    ...(layer.labels ?? []).filter(l => !node.labels.some(n => n.id === l.id))
      .map(l => stricterLabel({ ...inheritFrom(node, l.rank), id: l.id, name: l.name, color: l.color, description: l.description, rank: l.rank, status: l.status, audience: null }, l)),
  ].sort((a, b) => a.rank - b.rank);
  const rank = (id: string) => labels.find(l => l.id === id)?.rank ?? -1;
  const ownRules = new Map((layer.rules ?? []).map(r => [r.id, r]));
  const rules = [
    ...node.rules.map(r => {
      const o = ownRules.get(r.id);
      if (!o || o.kind !== r.kind || o.pattern !== r.pattern || o.flags !== r.flags) return r;
      return { ...r, enabled: r.enabled || o.enabled, minLabel: rank(o.minLabel) > rank(r.minLabel) ? o.minLabel : r.minLabel };
    }),
    ...(layer.rules ?? []).filter(r => !node.rules.some(n => n.id === r.id)),
  ];
  const stricterMode = layer.aiMode && AI_MODE[layer.aiMode] > AI_MODE[node.aiMode] ? layer.aiMode : node.aiMode;
  return {
    labels, rules, limits: node.limits,
    defaultLabel: layer.defaultLabel && rank(layer.defaultLabel) > rank(node.defaultLabel) ? layer.defaultLabel : node.defaultLabel,
    aiMode: stricterMode,
    aiThreshold: Math.max(node.aiThreshold, layer.aiThreshold ?? 0),
    auditRetentionDays: node.auditRetentionDays,
    // The caps are the node's; the type and provider are the layer's choice; kinds judged on write
    // only grow, since judging more content is never a loosening.
    classifier: {
      ...(node.classifier ?? DEFAULT_CLASSIFIER),
      ...(layer.classifier?.type ? { type: layer.classifier.type } : {}),
      ...(layer.classifier?.provider !== undefined ? { provider: layer.classifier.provider } : {}),
      onWrite: [...new Set([...(node.classifier?.onWrite ?? []), ...(layer.classifier?.onWrite ?? [])])],
    },
  };
}

/**
 * Every way `after` gives away something `before` held, as sentences; [] when the change only
 * tightens. Adding a label or a rule, and changing a name, colour or description, gives nothing away.
 */
export function loosenings(
  before: ClassificationPolicy, after: ClassificationPolicy, enabled?: { before: boolean; after: boolean },
): string[] {
  const out: string[] = [];
  if (enabled?.before && !enabled.after) out.push('Classification is turned off.');
  const afterLabels = new Map(after.labels.map(l => [l.id, l]));
  for (const b of before.labels) {
    if (b.status !== 'active') continue;
    const a = afterLabels.get(b.id);
    if (!a || a.status !== 'active') { out.push(`Label ${b.id} is removed or retired.`); continue; }
    if (a.rank !== b.rank) out.push(`Label ${b.id} moves from rank ${b.rank} to ${a.rank}.`);
    out.push(...labelLoosenings(a, b, `Label ${b.id}`));
  }
  const afterRules = new Map(after.rules.map(r => [r.id, r]));
  const rankOf = (id: string) => after.labels.find(l => l.id === id)?.rank ?? -1;
  for (const b of before.rules) out.push(...ruleLoosenings(afterRules.get(b.id), b, rankOf, 'The'));
  const beforeRank = (id: string) => before.labels.find(l => l.id === id)?.rank ?? -1;
  if (rankOf(after.defaultLabel) < beforeRank(before.defaultLabel)) out.push(`The default label goes from ${before.defaultLabel} to the less sensitive ${after.defaultLabel}.`);
  if (AI_MODE[after.aiMode] < AI_MODE[before.aiMode]) out.push(`The AI mode goes from ${before.aiMode} to ${after.aiMode}.`);
  if (after.aiThreshold < before.aiThreshold) out.push(`The AI confidence threshold goes down from ${before.aiThreshold} to ${after.aiThreshold}.`);
  const keep = (d: number | null | undefined) => (d === null ? Infinity : d ?? 365);
  if (keep(after.auditRetentionDays) < keep(before.auditRetentionDays)) out.push(`The audit log keeps its rows for ${after.auditRetentionDays} days instead of ${before.auditRetentionDays ?? 'ever'}.`);
  return out;
}
