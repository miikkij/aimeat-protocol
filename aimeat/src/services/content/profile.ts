/**
 * @file src/services/content/profile.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `profile` stage of the content class pipeline: the fingerprint of an item (wish
 *   wish-aineiston-sormenj-lki-millaista-aineisto-on-yhdell-silm-ykse, 2026-11-02). A person sees
 *   what kind of material an item is and how far it can be trusted before reading it: each section's
 *   kind of text (genre), what it rests on (mark), how firmly it is stated (certainty), the topic it
 *   belongs to, and six directions it leans (axes). The pipeline runs it only when the owner turned
 *   the stage on (contentclass.settings, off by default like every stage that calls a model).
 *
 *   SECTIONS ARE CUT HERE, NOT BY THE MODEL. segmentText() splits the text at its headings, merges
 *   pieces under 40 words into the next, splits pieces over 380 words at blank lines, and keeps at
 *   most MAX_SECTIONS. The same text always gives the same sections, so two runs, or two models,
 *   label the same pieces and their answers can be compared section by section.
 *
 *   THE INSTRUCTION IS MEASURED. PROFILE_INSTRUCTION is version PROFILE_PROMPT of the instruction
 *   measured on 2026-11-02 on fifteen real documents with three models from three vendors, twice
 *   each (docs/internal/aineiston-sormenjalki-mittaus-2026-11-02.html on the developer's machine):
 *   one model gives the same mark to 90-96 % of the sections on a second run, two models agree on
 *   78-84 %. Change it only together with a new measurement, and raise PROFILE_PROMPT when it
 *   changes, so every stored profile says which instruction made it.
 *
 *   WHAT IS KEPT WHERE. The compact profile (genres, marks, topics, axes, the model) goes into the
 *   item's facts; the sections' headings, claims and per-section axes are a stored file of their own
 *   (facts-store.ts putProfileDetail), as the extracted text is, so a shard stays small.
 *
 *   THE TAG. fingerprintTag() writes the profile as a few lines of text and coloured squares, so a
 *   chat that draws no pictures still shows it. Its words are English; the AI that shows it to a
 *   person says it in the person's language (built-in skill aimeat-content-classes).
 *   TWO WAYS TO LABEL. With the decision service on and content_class.profile_labels 'auto' (the
 *   default), the decision model labels each section (profile-labels.ts: 98 % the same mark on a
 *   second run, about 0.0005 $ a document) and the text model writes only the headings, claims and
 *   topics (PROFILE_TEXT_INSTRUCTION). Otherwise, or when the decision service refuses, the text
 *   model does all of it (PROFILE_INSTRUCTION). The profile says which (`labels`).
 * @structure PROFILE_PROMPT · PROFILE_TEXT_PROMPT · PROFILE_INSTRUCTION · PROFILE_TEXT_INSTRUCTION ·
 *   segmentText() · profileItem() · readTextAnswer() · withSections() · correctSections() · keepCorrections() · fingerprintTag()
 * @usage
 *   const { profile, sections } = await profileItem(ctx, item, 'Report.pdf');
 *   const tag = fingerprintTag(profile);
 * @version-history
 *   v1.2.0 — 2026-11-03 — withSections() and correctSections(): a person corrects a section's kind of
 *     text or mark, the compact profile is built again from the sections, and the tag names who
 *     corrected it.
 *   v1.0.0 — 2026-11-02 — Initial: instruction version 4 of the measurement.
 *   v1.1.0 — 2026-11-02 — The decision model labels when the node lets it (profile-labels.ts), the
 *     text model writes; the owner's or the node's fingerprint model; 24 000 output tokens.
 */
import { redact } from '../refinery/message.js';
import { logger } from '../../utils/logger.js';
import { askJson, type StageCtx, type StageItem } from './ai-stages.js';
import { labelSections } from './profile-labels.js';
import type {
  ContentProfile, ProfileAxis, ProfileGenre, ProfileMark, ProfileSection, ProfileTopic, TextSection,
} from './types.js';

/** The version of the instruction below. Raise it whenever the instruction changes. */
export const PROFILE_PROMPT = 'profile-4';
/** The version of PROFILE_TEXT_INSTRUCTION, the text model's part when the decision model labels. */
export const PROFILE_TEXT_PROMPT = 'profile-text-1';
/** The most text a profile reads; a longer text is profiled from its beginning. */
export const MAX_PROFILE_CHARS = 48_000;
/** A text shorter than this is not profiled: there is too little to tell its kind. */
export const MIN_PROFILE_CHARS = 200;
const MAX_SECTIONS = 24;
const MAX_TOPICS = 8;
/**
 * A reasoning model spends most of its answer thinking: DeepSeek V4 Pro used 9 639 of 12 000 tokens
 * on reasoning for a 2 965-word document and the JSON was cut off (2026-11-02). The ceiling is paid
 * only when it is used.
 */
const MAX_TOKENS = 24_000;

export const GENRES: readonly ProfileGenre[] = ['F', 'A', 'M', 'O', 'P', 'K'];
export const MARKS: readonly ProfileMark[] = ['+', '~', '?', 'x'];
export const AXES: readonly ProfileAxis[] = ['fakta', 'konkr', 'aika', 'toim', 'yks', 'varm'];

export const PROFILE_INSTRUCTION = [
  'You profile a document so that a person can see at a glance what kind of material it is and how far it can be trusted, before reading it.',
  '',
  'The document has already been split into numbered sections. Label every section, in order, and group the sections into topics. Judge only what the text itself shows. Write `heading`, `claim` and topic names in the document\'s own language.',
  '',
  'For each section give:',
  '',
  '- `n`: the section number you were given.',
  '- `heading`: the section\'s heading. Keep the given one when it is informative; when the section has none, or it is only a number or a date, write a short heading of at most five words.',
  '- `claim`: one plain sentence saying what the section states. Keep the concrete content: numbers, names, decisions. Write it as the content itself ("Price rose 38 % in ten years."), never as a description of the text ("The section discusses prices.").',
  '- `genre`: the main kind of text, one letter:',
  '  - `F` fact: states what is or what happened: observations, figures, events, descriptions, data rows.',
  '  - `A` analysis: interprets material: compares, explains causes, weighs options, draws conclusions.',
  '  - `M` opinion: takes a stance, values, argues or persuades without showing the grounds in the section.',
  '  - `O` instruction: tells the reader how to do something: steps, rules, checklists, settings.',
  '  - `P` decision or plan: records what was decided, proposed or will be done: goals, tasks, owners, dates.',
  '  - `K` narrative: tells a story, an example, an anecdote or a person\'s experience.',
  '- `trust`: what the section rests on, one character. Go through these four in order and take the first one that fits:',
  '  1. `x` the text itself says that a claim is wrong, outdated or replaced, or two statements in this document contradict each other. A proposal to change something is not `x`.',
  '  2. `+` the reader can check it: the section shows the data itself (figures with their origin, a table, data rows, measurements, test results), or names a specific source the reader could find: a link, a named study, report, standard, dataset, document, file, commit, record, product or product page. A proposal, recommendation, plan or conclusion that the document itself makes is never `+` on its own, even when it is about named material: it is `~` when an identified person or meeting stands behind it, `?` otherwise.',
  '  3. `~` an identified person, group or meeting stands behind it: the section reports what they said, decided, observed or experienced (a meeting\'s decisions and tasks, participants\' views, the author\'s own test or experience, an expert\'s statement).',
  '  4. `?` nothing of the above: no data, no findable source and no identified person. Reasoning alone does not count as grounds; a conclusion is only as grounded as what it rests on.',
  '  How the common cases fall: a meeting record\'s decisions, tasks and participants\' views are `~`, because the meeting is the source. A proposal or plan is `~` when it says who proposes it and on what experience, `?` otherwise. A general reference such as "studies show" without naming the study is `?`. A figure is `+` only when its origin is named or the data is shown; a bare figure is `?`. Statements about a market, a technology or the future with no named source are `?`, however confident they sound.',
  '- `certainty`: a number from 0 to 1 for how firmly the section states its content, apart from its grounds: 0.2 hedged or speculative ("might", "possibly", open questions), 0.5 tentative, 0.9 stated as settled.',
  '- `topic`: the index (0-based) of the topic in `topics` this section belongs to.',
  '- `axes`: six numbers from -1 to 1, one decimal:',
  '  - `fakta`: -1 opinion … +1 fact',
  '  - `konkr`: -1 abstract … +1 concrete',
  '  - `aika`: -1 about the past … 0 present or timeless … +1 about the future',
  '  - `toim`: -1 describes … +1 directs the reader to act',
  '  - `yks`: -1 overview … +1 detail',
  '  - `varm`: -1 a guess … +1 certain',
  '',
  'Topics: 2 to 6 topics that together cover the document, each named in at most four words. A topic is what the sections are about (for example "Hintakehitys", "Kilpailutilanne"), never the kind of text ("Analyysi", "Johdanto").',
  '',
  'Also give `kind`: what this document is, in two or three words in its own language (for example "tutkimusraportti", "kokousmuistio", "asennusohje").',
  '',
  'Answer with one JSON object and nothing else:',
  '',
  '{"kind": "...", "topics": ["...", "..."], "sections": [{"n": 1, "heading": "...", "claim": "...", "genre": "F", "trust": "+", "certainty": 0.8, "topic": 0, "axes": {"fakta": 0.8, "konkr": 0.6, "aika": -0.4, "toim": -0.5, "yks": 0.5, "varm": 0.7}}]}',
  '',
  'Every section you were given appears exactly once in `sections`, in the same order.',
].join('\n');

/**
 * The text model's part when the decision model labels the sections (profile-labels.ts): the words
 * a decision model cannot write. The same rules for heading, claim, topic and kind as above.
 */
export const PROFILE_TEXT_INSTRUCTION = [
  'You write the headings, one-sentence claims and topics of a document so that a person can see at a glance what it says, before reading it.',
  '',
  'The document has already been split into numbered sections. For every section, in order, give `n` (the section number you were given), `heading` (keep the given heading when it is informative; when the section has none, or it is only a number or a date, write a short heading of at most five words), `claim` (one plain sentence saying what the section states, keeping the concrete content: numbers, names, decisions; write it as the content itself ("Price rose 38 % in ten years."), never as a description of the text ("The section discusses prices.")) and `topic` (the 0-based index of its topic in `topics`).',
  '',
  'Topics: 2 to 6 topics that together cover the document, each named in at most four words. A topic is what the sections are about (for example "Hintakehitys", "Kilpailutilanne"), never the kind of text ("Analyysi", "Johdanto"). Also give `kind`: what this document is, in two or three words (for example "tutkimusraportti", "kokousmuistio", "asennusohje").',
  '',
  'Write headings, claims, topics and kind in the document\'s own language. Answer with one JSON object and nothing else:',
  '',
  '{"kind": "...", "topics": ["...", "..."], "sections": [{"n": 1, "heading": "...", "claim": "...", "topic": 0}]}',
  '',
  'Every section you were given appears exactly once in `sections`, in the same order.',
].join('\n');

export type { TextSection };

const WORD = /[\p{L}\p{N}_]+/gu;
const wordsIn = (s: string): number => (s.match(WORD) ?? []).length;

/**
 * Cut a text into sections: at its headings, pieces under 40 words merged into the next, pieces over
 * 380 words split at blank lines, at most MAX_SECTIONS. A first line that is a heading is the title.
 */
export function segmentText(text: string): { title: string; sections: TextSection[] } {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const title = /^#\s/.test(lines[0] ?? '') ? lines[0].replace(/^#\s*/, '').trim() : '';
  const body = title ? lines.slice(1) : lines;
  const pieces: Array<[string, string]> = [];
  let head = '';
  let buf: string[] = [];
  const flush = () => { const t = buf.join('\n').trim(); if (t) pieces.push([head, t]); };
  for (const ln of body) {
    const m = /^(#{1,4})\s+(.*)/.exec(ln);
    if (m) { flush(); head = m[2].trim(); buf = []; } else buf.push(ln);
  }
  flush();
  const out: Array<[string, string]> = [];
  for (const [h0, t] of pieces) {
    if (wordsIn(t) <= 380) { out.push([h0, t]); continue; }
    let h = h0;
    let cur: string[] = [];
    for (const p of t.split(/\n\s*\n/)) {
      if (cur.length && wordsIn([...cur, p].join('\n\n')) > 300) {
        out.push([h, cur.join('\n\n')]);
        if (h && !h.endsWith('(jatkuu)')) h = `${h} (jatkuu)`;
        cur = [p];
      } else cur.push(p);
    }
    if (cur.length) out.push([h, cur.join('\n\n')]);
  }
  const merged: Array<[string, string]> = [];
  for (const [h, t] of out) {
    const last = merged[merged.length - 1];
    if (last && wordsIn(last[1]) < 40) merged[merged.length - 1] = [last[0] || h, `${last[1]}\n\n${h ? `${h}\n` : ''}${t}`];
    else merged.push([h, t]);
  }
  while (merged.length > MAX_SECTIONS) {
    let at = 0;
    let least = Infinity;
    for (let k = 0; k < merged.length - 1; k++) {
      const w = wordsIn(merged[k][1]) + wordsIn(merged[k + 1][1]);
      if (w < least) { least = w; at = k; }
    }
    const [a, b] = [merged[at], merged[at + 1]];
    merged.splice(at, 2, [a[0] || b[0], `${a[1]}\n\n${b[0] ? `${b[0]}\n` : ''}${b[1]}`]);
  }
  return { title, sections: merged.map(([h, t], i) => ({ n: i + 1, heading: h, text: t, words: wordsIn(t) })) };
}

type Json = Record<string, unknown>;

const clampAxis = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.max(-1, Math.min(1, n)) * 100) / 100 : 0;
};
const zeroAxes = (): Record<ProfileAxis, number> => ({ fakta: 0, konkr: 0, aika: 0, toim: 0, yks: 0, varm: 0 });

/** The model's answer laid over the sections that were sent; an answer missing half of them is refused. */
function readAnswer(json: Json, given: TextSection[]): { kind: string; topics: string[]; sections: ProfileSection[] } {
  const topics = (Array.isArray(json.topics) ? json.topics : [])
    .map((t) => String(t ?? '').trim().slice(0, 60)).filter(Boolean).slice(0, MAX_TOPICS);
  if (!topics.length) topics.push('—');
  const byN = new Map<number, Json>();
  for (const s of Array.isArray(json.sections) ? json.sections : []) {
    const o = (s && typeof s === 'object' ? s : {}) as Json;
    const n = Number(o.n);
    if (Number.isInteger(n) && !byN.has(n)) byN.set(n, o);
  }
  let missing = 0;
  const sections = given.map((g): ProfileSection => {
    const o = byN.get(g.n);
    if (!o) missing += 1;
    const s = o ?? {};
    const genre = GENRES.includes(s.genre as ProfileGenre) ? s.genre as ProfileGenre : 'F';
    const mark = MARKS.includes(s.trust as ProfileMark) ? s.trust as ProfileMark : '?';
    const certainty = Number.isFinite(Number(s.certainty)) ? Math.max(0, Math.min(1, Number(s.certainty))) : 0.5;
    const ti = Number(s.topic);
    const ax = (s.axes && typeof s.axes === 'object' ? s.axes : {}) as Json;
    return {
      n: g.n, words: g.words,
      heading: String(s.heading ?? g.heading ?? '').trim().slice(0, 120) || g.heading.slice(0, 120) || `${g.n}`,
      claim: String(s.claim ?? '').trim().slice(0, 400),
      genre, mark, certainty: Math.round(certainty * 100) / 100,
      topic: Number.isInteger(ti) && ti >= 0 && ti < topics.length ? ti : 0,
      axes: Object.fromEntries(AXES.map((k) => [k, clampAxis(ax[k])])) as Record<ProfileAxis, number>,
    };
  });
  if (missing * 2 > given.length) {
    throw Object.assign(new Error(`The model labelled ${given.length - missing} of ${given.length} sections.`), { code: 'PROFILE_INCOMPLETE' });
  }
  return { kind: String(json.kind ?? '').trim().slice(0, 60), topics, sections };
}

/** The word-weighted mean of the sections' axes. */
function meanAxes(sections: ProfileSection[]): Record<ProfileAxis, number> {
  const total = sections.reduce((a, s) => a + s.words, 0) || 1;
  const out = zeroAxes();
  for (const k of AXES) out[k] = Math.round((sections.reduce((a, s) => a + s.axes[k] * s.words, 0) / total) * 100) / 100;
  return out;
}

/** The genre or mark that covers the most words. */
function mostWords<T extends string>(sections: ProfileSection[], pick: (s: ProfileSection) => T): T {
  const c = new Map<T, number>();
  for (const s of sections) c.set(pick(s), (c.get(pick(s)) ?? 0) + s.words);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** The topics with words, in the order the model named them; the sections' topic indexes follow. */
function buildTopics(names: string[], sections: ProfileSection[]): ProfileTopic[] {
  const total = sections.reduce((a, s) => a + s.words, 0) || 1;
  const keep = names.map((_, i) => i).filter((i) => sections.some((s) => s.topic === i));
  const remap = new Map(keep.map((old, i) => [old, i]));
  const topics = keep.map((i): ProfileTopic => {
    const mine = sections.filter((s) => s.topic === i);
    return {
      name: names[i], share: Math.round((mine.reduce((a, s) => a + s.words, 0) / total) * 1000) / 1000,
      genre: mostWords(mine, (s) => s.genre), mark: mostWords(mine, (s) => s.mark), axes: meanAxes(mine),
    };
  });
  for (const s of sections) s.topic = remap.get(s.topic) ?? 0;
  return topics;
}

/**
 * Profile one item from its words. Throws NO_TEXT when it has too few words to tell its kind.
 * Answers the compact profile for the facts (without detailKey, which the caller sets when it has
 * stored the sections) and the sections with their headings and claims.
 */
export async function profileItem(
  ctx: StageCtx, item: StageItem, title: string, sourceId = item.sourceId,
): Promise<{ profile: ContentProfile; sections: ProfileSection[] }> {
  const whole = (item.text ?? '').trim();
  if (whole.length < MIN_PROFILE_CHARS) throw Object.assign(new Error('The item has too few words to profile.'), { code: 'NO_TEXT' });
  const text = whole.slice(0, MAX_PROFILE_CHARS);
  const cut = segmentText(text);
  const docTitle = cut.title || title;
  const doc = `Document title: ${docTitle}\n\n` + cut.sections.map((s) =>
    `=== Section ${s.n} ===\nGiven heading: ${s.heading || '(none)'}\n${redact(s.text).text}`).join('\n\n');
  // The owner's own fingerprint model, else the node's (content_class.profile_model), else the
  // owner's text model and defaults (askJson).
  const model = ctx.settings.models.profile || ctx.deps.config.contentClassProfileModel || undefined;
  const ask = (instruction: string) => askJson(ctx, `${instruction}\n\n${doc}`, { maxTokens: MAX_TOKENS, ...(model ? { model } : {}) });
  const common = { at: new Date().toISOString(), ...(whole.length > MAX_PROFILE_CHARS ? { truncatedAt: MAX_PROFILE_CHARS } : {}) };

  // The decision model labels and the text model writes, when the node lets the decision model
  // answer (content_class.profile_labels 'auto' and the decision service on). Any refusal from the
  // decision service (switched off, no key, too large for the provider) falls back to the text
  // model labelling everything, which is what a node without the decision service does.
  if (ctx.deps.config.contentClassProfileLabels !== 'model' && ctx.deps.config.decideEnabled) {
    let labelled: Awaited<ReturnType<typeof labelSections>> | null = null;
    try {
      labelled = await labelSections(ctx, docTitle, cut.sections, sourceId);
    } catch (err) {
      const e = err as { code?: unknown; message?: unknown };
      logger.info('contentclass: the decision model did not label the fingerprint; the text model labels it', {
        source: sourceId, code: String(e.code ?? ''), error: String(e.message ?? err).slice(0, 300),
      });
    }
    if (labelled) {
      const r = await ask(PROFILE_TEXT_INSTRUCTION);
      const answer = readTextAnswer(r.json, cut.sections, labelled.labels);
      const topics = buildTopics(answer.topics, answer.sections);
      const profile: ContentProfile = {
        v: 1, prompt: PROFILE_TEXT_PROMPT, model: r.model, ...(r.provenanceId ? { provenanceId: r.provenanceId } : {}),
        labels: 'decide', labelModel: labelled.model, decisionIds: labelled.decisionIds,
        kind: answer.kind, topics, sections: answer.sections.map((s) => [s.genre, s.words, s.certainty, s.mark, s.topic]),
        axes: meanAxes(answer.sections), ...common,
      };
      return { profile, sections: answer.sections };
    }
  }

  const r = await ask(PROFILE_INSTRUCTION);
  const answer = readAnswer(r.json, cut.sections);
  const topics = buildTopics(answer.topics, answer.sections);
  const profile: ContentProfile = {
    v: 1, prompt: PROFILE_PROMPT, model: r.model, ...(r.provenanceId ? { provenanceId: r.provenanceId } : {}),
    labels: 'model', kind: answer.kind, topics,
    sections: answer.sections.map((s) => [s.genre, s.words, s.certainty, s.mark, s.topic]),
    axes: meanAxes(answer.sections), ...common,
  };
  return { profile, sections: answer.sections };
}

/**
 * The compact profile built again from its sections: the per-section tuples, the topics' shares,
 * kinds and marks, and the item's leaning. The topic names stay; a topic no section has any more
 * goes, as profileItem drops it.
 */
export function withSections(p: ContentProfile, sections: ProfileSection[]): { profile: ContentProfile; sections: ProfileSection[] } {
  const secs = sections.map((s) => ({ ...s, axes: { ...s.axes } }));
  const topics = buildTopics(p.topics.map((t) => t.name), secs);
  return {
    profile: { ...p, topics, sections: secs.map((s) => [s.genre, s.words, s.certainty, s.mark, s.topic]), axes: meanAxes(secs) },
    sections: secs,
  };
}

const correctionRefused = (message: string) => Object.assign(new Error(message), { code: 'INVALID_INPUT', status: 400 });

/**
 * A person's correction of sections: `asked` is a list of `{ n, genre?, mark? }`. The profile
 * records who corrected which sections, added to any earlier correction, and is built again.
 * Throws INVALID_INPUT naming the first entry it cannot take.
 */
export function correctSections(
  p: ContentProfile, sections: ProfileSection[], asked: unknown, by: string, at = new Date().toISOString(),
): { profile: ContentProfile; sections: ProfileSection[] } {
  if (!Array.isArray(asked) || !asked.length || asked.length > sections.length) {
    throw correctionRefused(`profile.sections is a list of 1 to ${sections.length} corrections, each { n, genre?, mark? }.`);
  }
  const next = sections.map((s) => ({ ...s }));
  const touched = new Set(p.corrected?.sections ?? []);
  for (const [i, raw] of asked.entries()) {
    const c = (raw && typeof raw === 'object' ? raw : {}) as { n?: unknown; genre?: unknown; mark?: unknown };
    const s = next.find((x) => x.n === c.n);
    if (!s) throw correctionRefused(`profile.sections[${i}].n names no section; the sections are 1 to ${sections.length}.`);
    if (c.genre === undefined && c.mark === undefined) throw correctionRefused(`profile.sections[${i}] changes nothing: give genre, mark or both.`);
    if (c.genre !== undefined && !(GENRES as readonly unknown[]).includes(c.genre)) throw correctionRefused(`profile.sections[${i}].genre is one of ${GENRES.join(', ')}.`);
    if (c.mark !== undefined && !(MARKS as readonly unknown[]).includes(c.mark)) throw correctionRefused(`profile.sections[${i}].mark is one of ${MARKS.join(' ')}.`);
    if (c.genre !== undefined) s.genre = c.genre as ProfileGenre;
    if (c.mark !== undefined) s.mark = c.mark as ProfileMark;
    touched.add(s.n);
  }
  const rebuilt = withSections(p, next);
  return { profile: { ...rebuilt.profile, corrected: { by, at, sections: [...touched].sort((a, b) => a - b) } }, sections: rebuilt.sections };
}

/**
 * A new run of the model on the same words keeps what a person corrected: the corrected sections
 * take the person's kind of text and mark again. Sections are cut from the words alone
 * (segmentText), so the same words give the same sections.
 */
export function keepCorrections(
  prev: { profile: ContentProfile; sections: ProfileSection[] },
  next: { profile: ContentProfile; sections: ProfileSection[] },
): { profile: ContentProfile; sections: ProfileSection[] } {
  const c = prev.profile.corrected;
  if (!c || !c.sections.length || prev.sections.length !== next.sections.length) return next;
  const secs = next.sections.map((s) => {
    const was = c.sections.includes(s.n) ? prev.sections.find((x) => x.n === s.n) : undefined;
    return was ? { ...s, genre: was.genre, mark: was.mark } : s;
  });
  const rebuilt = withSections(next.profile, secs);
  return { profile: { ...rebuilt.profile, corrected: c }, sections: rebuilt.sections };
}

/**
 * The text model's headings, claims and topics laid over the decision model's labels. A section
 * the text model left out keeps its given heading and an empty claim; it still has its labels.
 */
function readTextAnswer(
  json: Json, given: TextSection[], labels: Map<number, { genre: ProfileGenre; mark: ProfileMark; certainty: number; axes: Record<ProfileAxis, number> }>,
): { kind: string; topics: string[]; sections: ProfileSection[] } {
  const topics = (Array.isArray(json.topics) ? json.topics : [])
    .map((t) => String(t ?? '').trim().slice(0, 60)).filter(Boolean).slice(0, MAX_TOPICS);
  if (!topics.length) topics.push('—');
  const byN = new Map<number, Json>();
  for (const s of Array.isArray(json.sections) ? json.sections : []) {
    const o = (s && typeof s === 'object' ? s : {}) as Json;
    const n = Number(o.n);
    if (Number.isInteger(n) && !byN.has(n)) byN.set(n, o);
  }
  const sections = given.map((g): ProfileSection => {
    const s = byN.get(g.n) ?? {};
    const l = labels.get(g.n);
    const ti = Number(s.topic);
    return {
      n: g.n, words: g.words,
      heading: String(s.heading ?? g.heading ?? '').trim().slice(0, 120) || g.heading.slice(0, 120) || `${g.n}`,
      claim: String(s.claim ?? '').trim().slice(0, 400),
      genre: l?.genre ?? 'F', mark: l?.mark ?? '?', certainty: l?.certainty ?? 0.5,
      topic: Number.isInteger(ti) && ti >= 0 && ti < topics.length ? ti : 0,
      axes: l?.axes ?? { fakta: 0, konkr: 0, aika: 0, toim: 0, yks: 0, varm: 0 },
    };
  });
  return { kind: String(json.kind ?? '').trim().slice(0, 60), topics, sections };
}

const GENRE_NAME: Record<ProfileGenre, string> = { F: 'Fact', A: 'Analysis', M: 'Opinion', O: 'Instruction', P: 'Decision or plan', K: 'Narrative' };
/** The nearest coloured square a chat shows for each genre (the screens use their own palette). */
const GENRE_SQUARE: Record<ProfileGenre, string> = { F: '🟦', A: '🟩', M: '🟧', O: '🟨', P: '🟥', K: '🟪' };
const MARK_NAME: Record<ProfileMark, string> = { '+': 'source given', '~': 'a person or meeting stands behind it', '?': 'no grounds', x: 'contradicted or replaced' };
/** The four zones of the three default views, [top left, top right, bottom left, bottom right]. */
const ZONES: Array<{ x: ProfileAxis; y: ProfileAxis; names: [string, string, string, string] }> = [
  { x: 'konkr', y: 'fakta', names: ['Principles and theory', 'Measured fact', 'Views and visions', 'Examples and experience'] },
  { x: 'aika', y: 'toim', names: ['Lessons and fixes', 'Plans and tasks', 'History and reporting', 'Forecast and vision'] },
  { x: 'yks', y: 'varm', names: ['Settled overview', 'Precise knowledge', 'General estimate', 'Seeming precision'] },
];

const pct = (v: number): string => `${Math.round(v * 100)} %`;

/**
 * The profile as text: a row of coloured squares (one per section, as wide as its share of the
 * words) and lines a chat shows as they are. `marks` and `genres` are the shares, for an AI that
 * phrases its own answer.
 */
export function fingerprintTag(p: ContentProfile): {
  squares: string; lines: string[]; text: string; genres: Record<string, number>; marks: Record<string, number>; leaning: string[];
} {
  const total = p.sections.reduce((a, s) => a + s[1], 0) || 1;
  const squares = p.sections.map(([g, w]) => GENRE_SQUARE[g].repeat(Math.max(1, Math.round((w / total) * 18)))).join('');
  const genres: Record<string, number> = {};
  const marks: Record<string, number> = {};
  for (const [g, w, , m] of p.sections) {
    genres[g] = (genres[g] ?? 0) + w / total;
    marks[m] = (marks[m] ?? 0) + w / total;
  }
  const genreLine = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([g, v]) => `${GENRE_NAME[g as ProfileGenre]} ${pct(v)}`).join(', ');
  const topicLine = [...p.topics].sort((a, b) => b.share - a.share).map((t) => `${t.name} ${t.mark}`).join(', ');
  const markLine = MARKS.filter((m) => marks[m]).map((m) => `${m} ${pct(marks[m])}`).join('  ');
  const leaning = ZONES.map((z) => z.names[(p.axes[z.y] >= 0 ? 0 : 2) + (p.axes[z.x] >= 0 ? 1 : 0)]);
  const lines = [
    `Kind: ${p.kind || 'unknown'}. ${genreLine}`,
    `Topics: ${topicLine}`,
    `Trust: ${markLine}  (${MARKS.filter((m) => marks[m]).map((m) => `${m} ${MARK_NAME[m]}`).join(', ')})`,
    `Leaning: ${leaning.join(' · ')}`,
    `${p.labels === 'decide' && p.labelModel ? `Marked by ${p.labelModel}, written by ${p.model}` : `Profiled by ${p.model}`} on ${p.at.slice(0, 10)}${p.truncatedAt ? `, from the first ${p.truncatedAt} characters` : ''}`
      + (p.corrected ? `; ${p.corrected.sections.length} ${p.corrected.sections.length === 1 ? 'section' : 'sections'} corrected by ${p.corrected.by} on ${p.corrected.at.slice(0, 10)}` : ''),
  ];
  return { squares, lines, text: [squares, ...lines].join('\n'), genres, marks, leaning };
}
