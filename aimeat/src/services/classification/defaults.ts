/**
 * @file src/services/classification/defaults.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shapes of a classification policy (TARGET-082) and the node's defaults: the four
 *   labels and five detection rules Lifecycle Central proved in production (TARGET-081, extension
 *   2.4.2, rules corrected against 926 real records). They are a starting point, not a list the code
 *   knows: an operator adds, renames and retires labels and rules, and an owner or an organism adds
 *   their own (spec §4.1). Nothing in the node decides by a label's id; every behaviour comes from a
 *   label's fields.
 * @structure AiVisibility · LabelAudience · ClassificationLabel · RuleScope · ClassificationRule ·
 *   PolicyLimits · ClassificationPolicy · DEFAULT_LABELS · DEFAULT_RULES · DEFAULT_LIMITS ·
 *   defaultPolicy() · labelById()
 * @usage import { defaultPolicy } from './defaults.js';
 * @version-history
 *   v1.1.0 — 2026-09-29 — V2: a label's reader audience, a rule's scope and the classifier kind, and
 *     the per-level limits.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */

/** What an AI reader sees of content with this label (spec §5, decided 2026-09-29: three states). */
export type AiVisibility = 'hidden' | 'warning' | 'allowed';

/**
 * Who may read content with this label at all (spec §4.1, decided 2026-09-29): an organism role, a
 * group, or named people. A reader in any one list may read. Empty or absent means everyone who has
 * access anyway. It only narrows access, for people and AI alike; V4 enforces it.
 */
export interface LabelAudience {
  roles?: string[];
  groups?: string[];
  people?: string[];
}

export interface ClassificationLabel {
  id: string;
  name: { fi: string; en: string; es: string };
  /** Higher is more sensitive. 0–999, one label per rank: the rank decides what "lower" means. */
  rank: number;
  color: string;
  description: string;
  status: 'active' | 'retired';
  aiVisibility: AiVisibility;
  /** Showing it to an AI, or using it in an AI call, leaves a trail (V4). */
  audit: boolean;
  mayLeaveOrganism: boolean;
  /** Moving content from this label to a lower one needs a written reason. */
  lowerNeedsJustification: boolean;
  audience?: LabelAudience | null;
}

/** Where a rule applies. Absent fields mean everywhere. */
export interface RuleScope {
  kinds?: Array<'memory' | 'file' | 'row'>;
  organismId?: string;
  ws?: string;
  keyPrefix?: string;
}

export interface ClassificationRule {
  id: string;
  name: string;
  /** keyword: comma-separated words. regex: a pattern. classifier: a description the Content
   *  Classifier judges (V3); until then the rule is kept and never matches. */
  kind: 'keyword' | 'regex' | 'classifier';
  pattern: string;
  flags: string;
  /** Content the rule matches gets at least this label. A rule never lowers a label. */
  minLabel: string;
  enabled: boolean;
  appliesTo?: RuleScope | null;
}

/** How many labels and rules one level may hold. A node setting, never a code constant (§4.1). */
export interface PolicyLimits {
  labels: number;
  rules: number;
}

export interface ClassificationPolicy {
  labels: ClassificationLabel[];
  rules: ClassificationRule[];
  limits: PolicyLimits;
  /** What unlabelled content reads as. Existing content is never rewritten to carry it. */
  defaultLabel: string;
  /** off: an AI may not label. suggest: an AI's label waits for a person. auto: an AI's raise at or
   *  above `aiThreshold` confidence applies; anything else waits. */
  aiMode: 'off' | 'suggest' | 'auto';
  aiThreshold: number;
}

export const DEFAULT_LABELS: readonly ClassificationLabel[] = [
  {
    id: 'julkinen', name: { fi: 'Julkinen', en: 'Public', es: 'Público' }, rank: 0, color: '#3f9d6b', status: 'active',
    description: 'May be shown to anyone. No personal data, no customer data, no secrets.',
    aiVisibility: 'allowed', audit: false, mayLeaveOrganism: true, lowerNeedsJustification: false,
  },
  {
    id: 'sisainen', name: { fi: 'Sisäinen', en: 'Internal', es: 'Interno' }, rank: 10, color: '#4a7bd0', status: 'active',
    description: "The members' working information. Does not leave the organism without a decision.",
    aiVisibility: 'allowed', audit: false, mayLeaveOrganism: false, lowerNeedsJustification: false,
  },
  {
    id: 'luottamuksellinen', name: { fi: 'Luottamuksellinen', en: 'Confidential', es: 'Confidencial' }, rank: 20, color: '#d08a2e', status: 'active',
    description: 'Data about a customer, a partner or a person, contracts or prices. Lowering needs a reason.',
    aiVisibility: 'warning', audit: true, mayLeaveOrganism: false, lowerNeedsJustification: true,
  },
  {
    id: 'erittain-luottamuksellinen', name: { fi: 'Erittäin luottamuksellinen', en: 'Highly confidential', es: 'Altamente confidencial' }, rank: 30, color: '#c8453b', status: 'active',
    description: 'Credentials, keys, identity codes and anything whose leak causes harm. No AI processes the content.',
    aiVisibility: 'hidden', audit: true, mayLeaveOrganism: false, lowerNeedsJustification: true,
  },
];

export const DEFAULT_RULES: readonly ClassificationRule[] = [
  {
    id: 'henkilotunnus', name: 'Finnish personal identity code', kind: 'regex',
    pattern: '\\b\\d{6}[-+ABCDEFYXWVU]\\d{3}[0-9A-Y]\\b', flags: '', minLabel: 'erittain-luottamuksellinen', enabled: true,
  },
  {
    id: 'salaisuus', name: 'API key, token or private key', kind: 'regex',
    pattern: '(?:\\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})|-----BEGIN [A-Z ]*PRIVATE KEY-----)',
    flags: '', minLabel: 'erittain-luottamuksellinen', enabled: true,
  },
  {
    id: 'salasana', name: 'Password in text', kind: 'regex',
    pattern: '(salasana|password|passwd|pwd)\\s*[:=]\\s*\\S{4,}', flags: 'i', minLabel: 'erittain-luottamuksellinen', enabled: true,
  },
  {
    id: 'iban', name: 'Bank account number (IBAN)', kind: 'regex',
    pattern: '\\b(?:FI\\d{16}|FI\\d{2}(?: \\d{4}){3} \\d{2}|[A-Z]{2}\\d{2}(?: [A-Z0-9]{4}){3,7}(?: [A-Z0-9]{1,3})?)\\b',
    flags: '', minLabel: 'luottamuksellinen', enabled: true,
  },
  {
    id: 'sahkoposti', name: 'E-mail address', kind: 'regex',
    pattern: '[A-Za-z0-9._%+-]+@[A-Za-z][A-Za-z0-9-]*(?:\\.[A-Za-z0-9-]+)*\\.(?!(?:js|mjs|cjs|css|json|ts|html?|min|map|png|svg)\\b)[A-Za-z]{2,}\\b',
    flags: '', minLabel: 'luottamuksellinen', enabled: true,
  },
];

/** Spec §4.1: 100 labels and 500 rules per level unless the operator sets other numbers. */
export const DEFAULT_LIMITS: Readonly<PolicyLimits> = { labels: 100, rules: 500 };

/** A fresh copy of the node's default policy, safe for the caller to change. */
export function defaultPolicy(): ClassificationPolicy {
  return {
    labels: DEFAULT_LABELS.map(l => ({ ...l, name: { ...l.name } })),
    rules: DEFAULT_RULES.map(r => ({ ...r })),
    limits: { ...DEFAULT_LIMITS },
    defaultLabel: 'sisainen',
    aiMode: 'suggest',
    aiThreshold: 0.85,
  };
}

/** The label with this id, active or retired, or undefined. */
export function labelById(policy: ClassificationPolicy, id: string | null | undefined): ClassificationLabel | undefined {
  return id ? policy.labels.find(l => l.id === id) : undefined;
}
