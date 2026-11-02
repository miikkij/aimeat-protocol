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
 * @structure PROFILE_PROMPT · PROFILE_INSTRUCTION · segmentText() · profileItem() · fingerprintTag()
 * @usage
 *   const { profile, sections } = await profileItem(ctx, item, 'Report.pdf');
 *   const tag = fingerprintTag(profile);
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial: instruction version 4 of the measurement.
 */
import { redact } from '../refinery/message.js';
import { askJson, type StageCtx, type StageItem } from './ai-stages.js';
import type {
  ContentProfile, ProfileAxis, ProfileGenre, ProfileMark, ProfileSection, ProfileTopic,
} from './types.js';

/** The version of the instruction below. Raise it whenever the instruction changes. */
export const PROFILE_PROMPT = 'profile-4';
/** The most text a profile reads; a longer text is profiled from its beginning. */
export const MAX_PROFILE_CHARS = 48_000;
/** A text shorter than this is not profiled: there is too little to tell its kind. */
export const MIN_PROFILE_CHARS = 200;
const MAX_SECTIONS = 24;
const MAX_TOPICS = 8;
const MAX_TOKENS = 12_000;

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

/** One piece of the text, before a model has labelled it. */
export interface TextSection { n: number; heading: string; text: string; words: number }

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
export async function profileItem(ctx: StageCtx, item: StageItem, title: string): Promise<{ profile: ContentProfile; sections: ProfileSection[] }> {
  const whole = (item.text ?? '').trim();
  if (whole.length < MIN_PROFILE_CHARS) throw Object.assign(new Error('The item has too few words to profile.'), { code: 'NO_TEXT' });
  const text = whole.slice(0, MAX_PROFILE_CHARS);
  const cut = segmentText(text);
  const docTitle = cut.title || title;
  const doc = `Document title: ${docTitle}\n\n` + cut.sections.map((s) =>
    `=== Section ${s.n} ===\nGiven heading: ${s.heading || '(none)'}\n${redact(s.text).text}`).join('\n\n');
  const r = await askJson(ctx, `${PROFILE_INSTRUCTION}\n\n${doc}`, { maxTokens: MAX_TOKENS });
  const answer = readAnswer(r.json, cut.sections);
  const topics = buildTopics(answer.topics, answer.sections);
  const profile: ContentProfile = {
    v: 1, prompt: PROFILE_PROMPT, model: r.model, ...(r.provenanceId ? { provenanceId: r.provenanceId } : {}),
    at: new Date().toISOString(), kind: answer.kind, topics,
    sections: answer.sections.map((s) => [s.genre, s.words, s.certainty, s.mark, s.topic]),
    axes: meanAxes(answer.sections),
    ...(whole.length > MAX_PROFILE_CHARS ? { truncatedAt: MAX_PROFILE_CHARS } : {}),
  };
  return { profile, sections: answer.sections };
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
    `Profiled by ${p.model} on ${p.at.slice(0, 10)}${p.truncatedAt ? `, from the first ${p.truncatedAt} characters` : ''}`,
  ];
  return { squares, lines, text: [squares, ...lines].join('\n'), genres, marks, leaning };
}
