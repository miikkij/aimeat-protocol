/**
 * @file compliance-tab.gaps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure arithmetic behind the admin Compliance page: the gap list grouped by kind
 *   with the evidence each kind carries, who answered what across the register, the class counts,
 *   and the filter and order of the register table. No DOM, no i18n, no fetch, so the unit suite
 *   can hold every number the page prints.
 *
 *   THE GAPS ARE GROUPED BY KIND, NEVER LISTED RAW. The node serves one gap per model, per app and
 *   per entry, and an operator with fifteen undocumented models read fifteen identical sentences.
 *   One row per kind, the evidence in the row, and a door that does something about that kind.
 *
 *   AN ANSWER WITH NO RECORDED SOURCE COUNTS AS THE OPERATOR'S. The register's own form wrote
 *   answers without a source before sources existed, and a person at the form is the only thing
 *   that could have written them. The node's draft marks "evidence" and an agent marks "ai", so
 *   a missing mark is the one case left.
 * @structure groupGaps · answersOf · answerStats · classCounts · orderUsecases · filterUsecases ·
 *   impliesSummary · modelsShort
 * @usage imported by compliance-tab.js and compliance-tab.register.js; tested by
 *   test/unit/compliance-gaps.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (the Compliance page in the poster face).
 */

/** The four kinds the node serves, in the order the page's rows have. */
export const GAP_KINDS = [
  'undocumented-ai-activity',
  'app-declares-generation-with-gap',
  'unclassified-usecase',
  'unlabelled-public-content',
];

/** The classes, worst first; `unclassified` leads because it means nobody has looked. */
export const CLASS_ORDER = ['unclassified', 'prohibited', 'high', 'limited', 'minimal'];

/** How many register rows the table shows before "Show the next". */
export const PAGE = 20;

const classOf = (u) => (u && u.risk && u.risk.class) || 'unclassified';

/**
 * The gap list grouped by kind, with the evidence each kind carries.
 *
 * @param {Array<{kind: string, detail?: string, evidence?: object}>|undefined} gaps
 * @returns {{ total: number, models: string[], apps: Array<{app: string, inRegister: boolean}>,
 *   usecases: Array<{id: string, unanswered: string[]}>, unlabelled: number, other: object[] }}
 */
export function groupGaps(gaps) {
  const g = { total: 0, models: [], apps: [], usecases: [], unlabelled: 0, other: [] };
  for (const gap of gaps || []) {
    g.total++;
    const ev = gap.evidence || {};
    switch (gap.kind) {
      case 'undocumented-ai-activity':
        g.models.push(String(ev.model || gap.detail || ''));
        break;
      case 'app-declares-generation-with-gap':
        g.apps.push({ app: String(ev.app || gap.detail || ''), inRegister: Boolean(ev.in_register) });
        break;
      case 'unclassified-usecase':
        g.usecases.push({ id: String(ev.usecase_id || ''), unanswered: Array.isArray(ev.unanswered) ? ev.unanswered.map(String) : [] });
        break;
      case 'unlabelled-public-content':
        g.unlabelled += Number(ev.count) || 0;
        break;
      default:
        g.other.push(gap);
    }
  }
  g.models.sort((a, b) => a.localeCompare(b));
  g.apps.sort((a, b) => a.app.localeCompare(b.app));
  return g;
}

/**
 * Who answered what on one entry.
 *
 * @param {object} u — a register entry
 * @param {Array<{id: string}>} questions
 * @returns {{ total: number, answered: number, unanswered: number, ai: number, human: number, evidence: number }}
 */
export function answersOf(u, questions) {
  const r = { total: questions.length, answered: 0, unanswered: 0, ai: 0, human: 0, evidence: 0 };
  const answers = (u && u.answers) || {};
  const sources = (u && u.answerSources) || {};
  for (const q of questions) {
    const v = answers[q.id];
    if (v === undefined || v === null || v === '') { r.unanswered++; continue; }
    r.answered++;
    const src = sources[q.id];
    if (src === 'ai') r.ai++;
    else if (src === 'evidence') r.evidence++;
    else r.human++;
  }
  return r;
}

/** The same counts across the whole register, plus how many entries and questions there are. */
export function answerStats(usecases, questions) {
  const s = { entries: (usecases || []).length, questions: questions.length, answered: 0, unanswered: 0, ai: 0, human: 0, evidence: 0 };
  for (const u of usecases || []) {
    const a = answersOf(u, questions);
    s.answered += a.answered; s.unanswered += a.unanswered;
    s.ai += a.ai; s.human += a.human; s.evidence += a.evidence;
  }
  return s;
}

/**
 * How many entries sit in each class, the biggest count first and CLASS_ORDER breaking a tie.
 *
 * @returns {Array<{cls: string, n: number}>}
 */
export function classCounts(usecases) {
  const counts = new Map();
  for (const u of usecases || []) {
    const c = classOf(u);
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts].map(([cls, n]) => ({ cls, n }))
    .sort((a, b) => b.n - a.n || CLASS_ORDER.indexOf(a.cls) - CLASS_ORDER.indexOf(b.cls));
}

/** The register in reading order: the entries nobody has finished first, the rest as stored. */
export function orderUsecases(usecases) {
  const list = usecases || [];
  const open = list.filter(u => classOf(u) === 'unclassified');
  return [...open, ...list.filter(u => classOf(u) !== 'unclassified')];
}

/**
 * The rows a class chip and the search field leave visible.
 *
 * @param {object[]} usecases
 * @param {string} cls — a class id, or 'all'
 * @param {string} query — matched against the title, id, purpose, models and apps, case-insensitively
 */
export function filterUsecases(usecases, cls, query) {
  const q = String(query || '').trim().toLowerCase();
  return (usecases || []).filter(u => (cls === 'all' || classOf(u) === cls)
    && (!q || [u.title, u.id, u.purpose, ...(u.models || []), ...(u.apps || [])]
      .some(x => String(x || '').toLowerCase().includes(q))));
}

/**
 * What a question's answers imply, as chips: `yes → limited`, or for a choice with several
 * options landing in one class, `choice → high`. A question that implies nothing returns [].
 *
 * @param {{ type?: string, implies?: Record<string, string> }} q
 * @returns {Array<{ answer: 'yes'|'no'|'choice', cls: string }>}
 */
export function impliesSummary(q) {
  const implies = (q && q.implies) || {};
  const entries = Object.entries(implies);
  if (entries.length === 0) return [];
  if (q.type === 'boolean') {
    return entries.map(([a, cls]) => ({ answer: a === 'true' ? 'yes' : 'no', cls: String(cls) }));
  }
  const classes = [...new Set(entries.map(([, cls]) => String(cls)))];
  return classes.map(cls => ({ answer: 'choice', cls }));
}

/** The first two models and how many more: `grok-4.3, stealth/ox-alpha +3`. */
export function modelsShort(models) {
  const list = (models || []).filter(Boolean);
  if (list.length === 0) return '';
  const head = list.slice(0, 2).join(', ');
  return list.length > 2 ? `${head} +${list.length - 2}` : head;
}
