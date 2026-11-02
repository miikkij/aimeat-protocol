/**
 * @file src/services/content/profile-labels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fingerprint's labels from the decision model (System 1, services/decide/): each
 *   section's genre and mark as choice questions, its certainty and its six axes as five-level
 *   score questions, nine questions a section, asked in as few decisions as the provider can carry
 *   (at most 200 questions and the node's request token ceiling each). The text model then writes
 *   only the headings, claims and topics (profile.ts), which is the part a decision model cannot.
 *
 *   WHY. Measured 2026-11-02 on fifteen documents, twice each, with the same sections: TypeSafe Jev
 *   gave the same mark to 98 % of sections on a second run and moved the seal by 0.02 (DeepSeek V4
 *   Pro 87 % and 0.17), agreed with the language models' majority on 81 %, and cost about 0.0005 $
 *   a document (DeepSeek 0.016 $). Its axes sit nearer the ends of the scale than a language
 *   model's, so a profile records which way it was made (`labels`), and seals made two ways are not
 *   compared.
 *
 *   The decision service scrubs personal data before anything leaves, meters the call on the
 *   owner's decision allowance and records the decision; an identical request reuses its answer.
 * @structure LABEL_QUESTIONS_PER_SECTION · labelQuestions() · chunkSections() · labelSections()
 * @usage const { labels, decisionIds, model } = await labelSections(ctx, title, sections, sourceId);
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (wish-aineiston-sormenj-lki-millaista-aineisto-on-yhdell-silm-ykse).
 */
import { decideForOwner } from '../decide/service.js';
import { estimateTokens, type JevQuestion } from '../decide/limits.js';
import type { StageCtx } from './ai-stages.js';
import type { ProfileAxis, ProfileGenre, ProfileMark, TextSection } from './types.js';

export const LABEL_QUESTIONS_PER_SECTION = 9;
const MAX_QUESTIONS = 200;
/** A share of the token ceiling a chunk may fill, for the scrub's placeholders and the criteria. */
const TOKEN_SHARE = 0.75;

const GENRE_OPTIONS: Record<string, [ProfileGenre, string]> = {
  fact: ['F', 'States what is or what happened: observations, figures, events, descriptions, data rows.'],
  analysis: ['A', 'Interprets material: compares, explains causes, weighs options, draws conclusions.'],
  opinion: ['M', 'Takes a stance, values, argues or persuades without showing grounds in the section.'],
  instruction: ['O', 'Tells the reader how to do something: steps, rules, checklists, settings.'],
  decision_or_plan: ['P', 'Records what was decided, proposed or will be done: goals, tasks, owners, dates.'],
  narrative: ['K', 'Tells a story, an example, an anecdote or a person\'s experience.'],
};
const MARK_OPTIONS: Record<string, [ProfileMark, string]> = {
  contradicted: ['x', 'The text itself says a claim is wrong, outdated or replaced, or two statements in the document contradict each other. A proposal to change something is not this.'],
  checkable_source: ['+', 'The section shows the data itself (figures with their origin, a table, data rows, measurements) or names a specific source the reader could find (a link, a named study, report, standard, dataset, document, file, product). A proposal or conclusion the document itself makes is never this on its own.'],
  person_or_meeting: ['~', 'An identified person, group or meeting stands behind it: what they said, decided, observed or experienced, including a meeting\'s decisions and tasks and the author\'s own test or experience.'],
  nothing: ['?', 'No data, no findable source and no identified person. Reasoning alone is not grounds. A general reference such as "studies show", a bare figure, or a claim about a market, a technology or the future with no named source is this.'],
};
const AXIS_LEVELS: Record<ProfileAxis, string[]> = {
  fakta: ['clearly opinion', 'mostly opinion', 'mixed', 'mostly fact', 'clearly fact'],
  konkr: ['very abstract', 'somewhat abstract', 'mixed', 'somewhat concrete', 'very concrete'],
  aika: ['about the past', 'mostly the past', 'the present or timeless', 'mostly the future', 'about the future'],
  toim: ['only describes', 'mostly describes', 'mixed', 'mostly directs the reader to act', 'directs the reader to act'],
  yks: ['broad overview', 'mostly overview', 'mixed', 'mostly detail', 'fine detail'],
  varm: ['a guess', 'mostly guessing', 'mixed', 'mostly certain', 'certain'],
};
const CERTAINTY_LEVELS = ['hedged or speculative, open questions', 'tentative', 'neither', 'fairly firm', 'stated as settled'];

/** One section's labels. */
export interface SectionLabels {
  genre: ProfileGenre;
  mark: ProfileMark;
  certainty: number;
  axes: Record<ProfileAxis, number>;
}

/** The nine questions of each section, ids `s<n>_<what>`. Instructions and criteria in English, as the model asks. */
export function labelQuestions(sections: TextSection[]): Record<string, JevQuestion> {
  const q: Record<string, JevQuestion> = {};
  for (const { n } of sections) {
    q[`s${n}_genre`] = { type: 'choice', instructions: `Section ${n} in sections: what is its main kind of text?`,
      criteria: Object.fromEntries(Object.entries(GENRE_OPTIONS).map(([k, [, d]]) => [k, d])) };
    q[`s${n}_mark`] = { type: 'choice', instructions: `Section ${n} in sections: what does it rest on? Take the first option that fits, in the order listed.`,
      criteria: Object.fromEntries(Object.entries(MARK_OPTIONS).map(([k, [, d]]) => [k, d])) };
    q[`s${n}_cert`] = { type: 'score', instructions: `Section ${n} in sections: how firmly does it state its content, apart from its grounds?`, criteria: CERTAINTY_LEVELS };
    for (const [ax, levels] of Object.entries(AXIS_LEVELS)) {
      q[`s${n}_${ax}`] = { type: 'score', instructions: `Section ${n} in sections: where does it lean?`, criteria: levels };
    }
  }
  return q;
}

const stateOf = (title: string, sections: TextSection[]) => ({
  title, sections: Object.fromEntries(sections.map((s) => [String(s.n), `${s.heading}\n${s.text}`.trim()])),
});

/** The sections in runs that each fit one decision: at most 22 sections, and within the token share. */
export function chunkSections(title: string, sections: TextSection[], maxTokens: number): TextSection[][] {
  const perChunk = Math.floor(MAX_QUESTIONS / LABEL_QUESTIONS_PER_SECTION);
  const budget = maxTokens * TOKEN_SHARE;
  const chunks: TextSection[][] = [];
  let cur: TextSection[] = [];
  for (const s of sections) {
    const next = [...cur, s];
    const tokens = estimateTokens(stateOf(title, next)) + estimateTokens(labelQuestions(next));
    if (cur.length && (next.length > perChunk || tokens > budget)) { chunks.push(cur); cur = [s]; } else cur = next;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

type Answer = { type?: string; value?: unknown } | undefined;
/** A five-level score's value (a float from 0 to 4) as 0..1; the middle when it is missing. */
const level01 = (a: Answer): number => (typeof a?.value === 'number' ? Math.max(0, Math.min(1, a.value / 4)) : 0.5);
const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Label every section with the decision model. Throws what the decision service throws (switched
 * off, no key, the request too large for the provider): the caller then labels with the text model.
 */
export async function labelSections(
  ctx: StageCtx, title: string, sections: TextSection[], sourceId: string,
): Promise<{ labels: Map<number, SectionLabels>; decisionIds: string[]; model: string }> {
  const { storage, config } = ctx.deps;
  const labels = new Map<number, SectionLabels>();
  const decisionIds: string[] = [];
  let model = '';
  for (const chunk of chunkSections(title, sections, config.decideMaxRequestTokens)) {
    const r = await decideForOwner(storage, config,
      { gaii: ctx.ownerGhii, principal: ctx.principal, appRef: ctx.appRef, appId: 'contentclass', isOwner: ctx.isOwner, limit: 'exempt' },
      { state: stateOf(title, chunk), questions: labelQuestions(chunk), subject: `contentclass:profile:${sourceId}`.slice(0, 200),
        gates: 'the fingerprint of an item: each section\'s kind of text, what it rests on, how firmly, and where it leans' });
    decisionIds.push(r.decision_id);
    model = r.model;
    const a = r.answers as Record<string, Answer>;
    for (const { n } of chunk) {
      labels.set(n, {
        genre: GENRE_OPTIONS[String(a[`s${n}_genre`]?.value)]?.[0] ?? 'F',
        mark: MARK_OPTIONS[String(a[`s${n}_mark`]?.value)]?.[0] ?? '?',
        certainty: round2(0.1 + 0.8 * level01(a[`s${n}_cert`])),
        axes: Object.fromEntries(Object.keys(AXIS_LEVELS).map((ax) => [ax, round2(level01(a[`s${n}_${ax}`]) * 2 - 1)])) as Record<ProfileAxis, number>,
      });
    }
  }
  return { labels, decisionIds, model };
}
