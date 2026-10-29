/**
 * @file src/services/compliance-app-signals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an app's own statements say about its place in the compliance documents: does it
 *   use AI, does it keep personal data, which regulated data domain that data falls in, and which
 *   area of the EU AI Act's Annex III an AI use of it lands in.
 *
 *   WHY IT EXISTS. On innokas.aimeat.io TalentGrid kept colleagues' competence ratings, sent them to a
 *   model to propose who works on what, and said so in its data map, row by row. The AI Act register
 *   draft never listed it (it took an app only when the publish check had found a disclosure gap),
 *   the records of processing named no domain, and the high-risk question stayed empty. Every fact
 *   was on the node; nothing read them together. This file is the one place that does, and the
 *   register draft, the records-of-processing draft and the report all ask it.
 *
 *   STATED, OR PROPOSED, AND ALWAYS SAID WHICH. A domain the map's row states is `evidence`. When a
 *   personal row states none, the words in the map are matched against each domain's vocabulary and
 *   the match comes back as `proposed`, with the rows and the words it rests on, so a person sees
 *   why and decides. A proposal is never stored as an answer by this file; the caller marks its
 *   source, and a person saving the draft saves it with that mark.
 *
 *   PURE. No storage and no model: the same map and posture always give the same answer, which is
 *   what lets an auditor reproduce it.
 * @structure DOMAIN_WORDS · ANNEX3_BY_DOMAIN · AppAiSignals · appAiSignals()
 * @usage const s = appAiSignals(map, app.manifest?.aiPosture);
 * @version-history
 *   v1.0.2 — 2026-10-29 — "candidates" alone and "fingerprint" alone no longer read as employment or
 *     biometric data: on aimeat.io's maps they were a comic's image candidates and a game save's
 *     fingerprint, and four games read as high-risk candidates.
 *   v1.0.1 — 2026-10-28 — A map that only keeps AI-made content is not an AI use: live on
 *     innokas.aimeat.io it listed two apps that call no model.
 *   v1.0.0 — 2026-10-28 — Initial.
 */
import type { DataMap, DataMapRow } from './data-map/data-map-types.js';
import type { AppAiPosture } from './app-ai-posture.js';

/**
 * One domain's vocabulary as a pattern. A term ending in `*` is a stem and takes any letters after
 * it, so a Finnish stem ("rekry*") reaches its inflections. The edges are Unicode letters, not `\b`,
 * which treats ä and ö as non-letters and so lost "henkilöstöä".
 */
const vocabulary = (terms: string[]): RegExp => new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${terms.map(t => (t.endsWith('*') ? `${t.slice(0, -1)}\\p{L}*` : t)).join('|')})(?![\\p{L}\\p{N}])`, 'iu');

/**
 * The words that put a personal row in a domain, in English and Finnish. Narrow on purpose: a
 * proposal that fires on every app is one nobody reads, so "medical device" does not make health
 * data and "user" does not make employment data.
 */
export const DOMAIN_WORDS: ReadonlyArray<{ domain: string; words: RegExp }> = [
  { domain: 'employment', words: vocabulary(['cvs?', 'resumes?', 'curriculum vitae', 'recruit*', 'hiring', 'job candidates?', 'candidate (?:profiles?|cvs?|pipeline)', 'applicants?', 'job applications?', 'employees?', 'employment', 'staffing', 'personnel', 'human resources', 'hr', 'payroll', 'salar(?:y|ies)', 'competenc*', 'skill (?:matrix|entries|levels?|ratings?)', 'resourcing', 'allocation', 'consultants?', 'work history', 'performance reviews?', 'appraisals?', 'työntekij*', 'henkilöstö*', 'rekry*', 'palkka*', 'palkan', 'osaamis*', 'työhistori*', 'työsuhte*', 'hakij*', 'resursoin*']) },
  { domain: 'health', words: vocabulary(['patients?', 'diagnos*', 'medical records?', 'health data', 'health records?', 'symptoms?', 'medications?', 'potila*', 'terveystie*', 'diagnoos*', 'lääkity*', 'oire*']) },
  { domain: 'children', words: vocabulary(['child(?:ren)?', 'minors?', 'pupils?', 'under 1[3-8]', 'lapsi', 'lapse*', 'lasten', 'oppila*', 'alaikäi*']) },
  { domain: 'biometric-genetic', words: vocabulary(['biometric*', 'fingerprint (?:scans?|images?|templates?|readers?)', 'face recognition', 'facial recognition', 'face templates?', 'genetic*', 'dna', 'biometri*', 'sormenjälj*', 'kasvojentunnist*', 'geneetti*']) },
  { domain: 'criminal', words: vocabulary(['criminal records?', 'convictions?', 'offen[cs]es?', 'rikosrekister*', 'rikostuomi*']) },
  { domain: 'special-category', words: vocabulary(['ethnic*', 'religio*', 'political opinions?', 'trade unions?', 'sexual orientation', 'ammattiliit*', 'uskon*', 'etnis*']) },
  { domain: 'payment-financial', words: vocabulary(['card numbers?', 'credit cards?', 'iban', 'bank accounts?', 'luottokort*', 'tilinumer*']) },
];

/**
 * The Annex III area a domain points to when an app uses AI on it, as the questionnaire's
 * `q-annex3-area` option values. Only the domains whose mere presence with AI makes the area a fair
 * question: employment data handled by AI is Annex III point 4 territory, biometric data point 1.
 * Children's or health data says nothing about the area by itself.
 */
export const ANNEX3_BY_DOMAIN: Readonly<Record<string, string>> = {
  employment: 'employment',
  'biometric-genetic': 'biometrics',
};

export interface DomainFinding {
  domain: string;
  /** `evidence`: a row states it. `proposed`: the map's words match it and no row states one. */
  source: 'evidence' | 'proposed';
  /** The rows (key families) it rests on. */
  rows: string[];
  /** For a proposal, the words that matched. Empty for a stated domain. */
  words: string[];
}

export interface AppAiSignals {
  /** The app uses a model, by its own statement or its declared permission. */
  usesAi: boolean;
  /** Each statement that says so, in words a person can check against the app. */
  aiEvidence: string[];
  /** The map has at least one row with personal data. */
  personal: boolean;
  /** The map sends something to an AI service while it keeps personal data. */
  personalToAi: boolean;
  /** The personal rows that state no domain and match none either: someone has to say. */
  personalRowsWithoutDomain: string[];
  domains: DomainFinding[];
  /**
   * The proposed Annex III area, when the app uses AI on a domain that points to one. `reason` is
   * the English sentence; `basis` is the same facts as data, so a page can say it in its reader's
   * language.
   */
  annex3: { area: string; domain: string; reason: string; basis: DomainFinding } | null;
}

const isPersonal = (r: DataMapRow): boolean =>
  r.personalData === 'yes' || (r.personalData === undefined && r.isA === 'schema:Person');

const rowName = (r: DataMapRow): string => r.what || (r as DataMapRow & { key?: string }).key || '(unnamed)';

/** Every distinct match of a pattern in a text, lower-cased, in the order found. */
function matches(pattern: RegExp, text: string): string[] {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return [...new Set([...text.matchAll(global)].map(m => m[0].toLowerCase()))];
}

const AI_RECIPIENT = vocabulary(['ai', 'models?', 'llm', 'language model', 'tekoäly*', 'kielimalli*']);

/** A `leaves` entry that goes to a model. A map an AI wrote may give the entry as one sentence. */
function leavesToAi(l: unknown): boolean {
  const text = typeof l === 'string' ? l : (l && typeof l === 'object' ? String((l as { to?: unknown }).to ?? '') : '');
  return AI_RECIPIENT.test(text);
}

/**
 * Read one app. `map` is its data map or null; `posture` is what its publish check recorded
 * (`manifest.aiPosture`). Either may be missing, and the answer says only what they say.
 */
export function appAiSignals(map: DataMap | null, posture?: Partial<AppAiPosture> | null): AppAiSignals {
  const aiEvidence: string[] = [];
  if (posture?.usesAi) aiEvidence.push('the app asks for permission to use AI (ai:use)');
  if (posture?.generates?.length) aiEvidence.push(`the app declares it generates ${posture.generates.join(', ')}`);
  const held = Array.isArray(map?.held) ? map!.held : [];
  if (map && Array.isArray(map.machinery) && map.machinery.includes('ai-generation')) aiEvidence.push('the data map lists ai-generation in its machinery');
  const leaves = Array.isArray(map?.leaves) ? map!.leaves : [];
  const toAi = leaves.filter(leavesToAi);
  if (toAi.length) aiEvidence.push(`the data map sends ${toAi.length === 1 ? 'one thing' : `${toAi.length} things`} to an AI service`);
  // Kept AI-made content is evidence only beside a model call. Alone it is a picture an AI drew once
  // or text a person's own agent wrote in from outside: content to label (Article 50), not an AI
  // system this app runs. Counted alone, it put suuntai and Rautavasara in the register.
  const aiRows = held.filter(r => r.kind === 'ai-generated').map(rowName);
  if (aiRows.length && aiEvidence.length) aiEvidence.push(`the data map keeps AI-generated data (${aiRows.join(', ')})`);

  const personalRows = held.filter(isPersonal);
  const appText = `${map?.what ?? ''} ${map?.usedFor ?? ''}`;
  const found = new Map<string, DomainFinding>();
  const add = (domain: string, source: DomainFinding['source'], row: string, words: string[]) => {
    const key = `${source}:${domain}`;
    const f = found.get(key) ?? { domain, source, rows: [], words: [] };
    if (!f.rows.includes(row)) f.rows.push(row);
    for (const w of words) if (!f.words.includes(w)) f.words.push(w);
    found.set(key, f);
  };
  const withoutDomain: string[] = [];
  for (const r of personalRows) {
    if (Array.isArray(r.domains)) {
      for (const d of r.domains) if (typeof d === 'string') add(d, 'evidence', rowName(r), []);
      continue;
    }
    const text = `${rowName(r)} ${r.holds ?? ''} ${r.isA ?? ''} ${appText}`;
    let matched = false;
    for (const { domain, words } of DOMAIN_WORDS) {
      const hit = matches(words, text);
      if (hit.length) { add(domain, 'proposed', rowName(r), hit); matched = true; }
    }
    if (!matched) withoutDomain.push(rowName(r));
  }
  // A stated domain wins over the same domain proposed from another row: one entry, as evidence.
  const domains = [...found.values()].filter(f => f.source === 'evidence' || !found.has(`evidence:${f.domain}`));

  const usesAi = aiEvidence.length > 0;
  let annex3: AppAiSignals['annex3'] = null;
  if (usesAi) {
    const hit = domains.find(d => ANNEX3_BY_DOMAIN[d.domain]);
    if (hit) {
      const how = hit.source === 'evidence'
        ? `the data map states ${hit.domain} data in ${hit.rows.join(', ')}`
        : `the data map's ${hit.rows.join(', ')} read as ${hit.domain} data (${hit.words.slice(0, 6).join(', ')})`;
      annex3 = { area: ANNEX3_BY_DOMAIN[hit.domain], domain: hit.domain, reason: `${how}, and ${aiEvidence[0]}.`, basis: hit };
    }
  }

  return {
    usesAi, aiEvidence,
    personal: personalRows.length > 0,
    personalToAi: personalRows.length > 0 && toAi.length > 0,
    personalRowsWithoutDomain: withoutDomain,
    domains, annex3,
  };
}
