/**
 * @file src/services/content/ai-stages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The four stages of the content class pipeline that call a model, each run only when
 *   the owner turned it on (contentclass.settings; every one is off until then, Jouni 2026-10-20):
 *
 *   - describe (System 2): a picture gets alt text, a description and the words it shows; a PDF
 *     without a text layer is read whole by a model that reads files; a video gets a description
 *     from a few still frames and what is said in it; a long text gets a summary.
 *   - classify (System 1): one yes-or-no question per candidate content class in ONE decision, so an
 *     item can belong to several classes and the call costs one decision, not one per class. The
 *     decision service scrubs personal data before anything leaves.
 *   - extract (System 2): for each class the item belongs to that extracts anything, the prompt is
 *     built from the class's properties (its OWL datatype properties), and the answer becomes a
 *     JSON-LD entity typed by the class.
 *   - propose (System 2): when no class fits, or the extraction names facts the class has no property
 *     for, a proposal is written for the owner, or approved at once when the owner's settings say so.
 *
 *   WHAT REACHES A MODEL is decided before this file is called: the pipeline asks the sensitivity
 *   classification's useForAi for the item first and calls none of these when it is refused.
 *
 *   One instruction per stage, built here, so every model is told the same thing.
 * @structure StageCtx · StageItem · describeItem · classifyItem · extractClass · proposeClass ·
 *   CLASS_THRESHOLD
 * @usage const d = await describeItem(ctx, item); const m = await classifyItem(ctx, item, classes);
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { completeForOwner } from '../ai/completion.js';
import { decideForOwner } from '../decide/service.js';
import { transcribeForOwner } from '../ai-transcription.js';
import type { AiCallerContext } from '../ai/caller-context.js';
import { logger } from '../../utils/logger.js';
import { redact, parseJsonAnswer } from '../refinery/message.js';
import type {
  ContentClass, ContentKind, ContentSettings, ClassMembership, ClassProperty, TechnicalFacts,
} from './types.js';

/** A probability of yes below this does not make an item a member of a class. */
export const CLASS_THRESHOLD = 0.6;

/** The most text a description or an extraction prompt carries. */
const MAX_PROMPT_TEXT = 24_000;
/** The most text the classifier's state carries. */
const MAX_STATE_TEXT = 4000;

export interface StageCtx {
  deps: { storage: Storage; config: AimeatConfig };
  /** Whose key pays and whose records these are. */
  ownerGhii: string;
  /** Who runs the stage: the owner's GHII, or the agent that asked. */
  principal: string;
  isOwner: boolean;
  appRef?: string;
  ai: AiCallerContext;
  settings: ContentSettings;
}

/** What the stages are given about one item. Bytes only for a file a model reads itself. */
export interface StageItem {
  sourceId: string;
  kind: ContentKind;
  mimeType: string;
  /** The item's own words, already read: a text, a PDF's text layer, a transcript. */
  text: string | null;
  bytes?: Buffer;
  filename: string;
  technical: TechnicalFacts;
  /** For a video: still frames as JPEG. */
  frames?: Buffer[];
  /** For a video: its sound, for a transcript. */
  audio?: Buffer | null;
  /** The description, once describe has run, for the later stages. */
  description?: string;
}

type Json = Record<string, unknown>;

function callerOpts(ctx: StageCtx): { caller: AiCallerContext['caller']; agent?: string; verifiedApp?: string } {
  return { caller: ctx.ai.caller, ...(ctx.ai.agent ? { agent: ctx.ai.agent } : {}), ...(ctx.ai.verifiedApp ? { verifiedApp: ctx.ai.verifiedApp } : {}) };
}

function languageLine(settings: ContentSettings): string {
  return settings.language
    ? `Write every sentence in the language with the BCP 47 tag "${settings.language}".`
    : 'Write in the language of the words in the content; when it has no words, write in English.';
}

function dataUrl(mime: string, b: Buffer): string { return `data:${mime};base64,${b.toString('base64')}`; }

/** One completion asked for a JSON object, asked once more when the answer is not one. */
async function askJson(
  ctx: StageCtx, prompt: string, opts: { images?: string[]; files?: Array<{ data: Uint8Array; mediaType: string; filename?: string }>; vision?: boolean },
): Promise<{ json: Json; model: string; provenanceId?: string }> {
  const model = (opts.vision || opts.images?.length || opts.files?.length ? ctx.settings.models.vision : ctx.settings.models.text) || undefined;
  const ask = () => completeForOwner(ctx.deps.storage, ctx.deps.config, ctx.ownerGhii, {
    prompt, model, temperature: 0, appId: 'contentclass', ...callerOpts(ctx),
    ...(opts.images?.length ? { images: opts.images } : {}),
    ...(opts.files?.length ? { files: opts.files } : {}),
  });
  let r = await ask();
  let json = parseJsonAnswer(r.content);
  if (!json) { r = await ask(); json = parseJsonAnswer(r.content); }
  if (!json) throw Object.assign(new Error('The model did not answer with a JSON object.'), { code: 'NO_JSON' });
  return { json, model: r.model, ...(r.provenance ? { provenanceId: r.provenance.id } : {}) };
}

/** A few facts of the item that help a model and carry nothing personal. */
function factLine(t: TechnicalFacts): string {
  const p: string[] = [`kind ${t.kind}`, `type ${t.mimeType}`];
  if (t.pdf?.pages) p.push(`${t.pdf.pages} pages`);
  if (t.pdf?.title) p.push(`title "${t.pdf.title}"`);
  if (t.image?.width) p.push(`${t.image.width}×${t.image.height} px`);
  if (t.video?.durationSeconds) p.push(`${Math.round(t.video.durationSeconds)} s long`);
  if (t.ai.verdict !== 'unknown') p.push(`declared ${t.ai.verdict}`);
  return p.join(', ');
}

export interface Description { text: string; altText?: string; seenText?: string; transcript?: string; model: string; provenanceId?: string }

/**
 * Describe one item. A picture or a scanned PDF goes to the model whole; a video as its frames and
 * its transcript; anything with words as its words. Null when there is nothing a model could read.
 */
export async function describeItem(ctx: StageCtx, item: StageItem): Promise<Description | null> {
  const lang = languageLine(ctx.settings);
  if (item.kind === 'image' && item.bytes) {
    const r = await askJson(ctx,
      'Describe this picture for a person who cannot see it.\n'
      + `${lang}\n`
      + 'Answer with ONLY a JSON object: {"altText": "one sentence of at most 125 characters, the alt text", '
      + '"description": "two to four sentences on what the picture shows", '
      + '"text": "every word visible in the picture, exactly as written, or an empty string"}',
      { images: [dataUrl(item.mimeType, item.bytes)] });
    return { text: String(r.json.description ?? ''), altText: String(r.json.altText ?? '') || undefined,
      seenText: String(r.json.text ?? '') || undefined, model: r.model, provenanceId: r.provenanceId };
  }
  if (item.kind === 'pdf' && item.bytes && !(item.text && item.text.trim().length >= 40)) {
    const r = await askJson(ctx,
      'This document has no text layer: read it from the pages.\n'
      + `${lang}\n`
      + 'Answer with ONLY a JSON object: {"description": "three to five sentences on what the document is and says", '
      + '"text": "the whole text of the document, exactly as written"}',
      { files: [{ data: new Uint8Array(item.bytes), mediaType: 'application/pdf', filename: item.filename }] });
    return { text: String(r.json.description ?? ''), seenText: String(r.json.text ?? '') || undefined, model: r.model, provenanceId: r.provenanceId };
  }
  if (item.kind === 'video' && (item.frames?.length || item.audio)) {
    let transcript: string | undefined;
    if (item.audio) {
      try {
        const t = await transcribeForOwner(ctx.deps.storage, ctx.deps.config, ctx.ownerGhii, {
          audio: { data: item.audio, mime: 'audio/mpeg', filename: 'sound.mp3' }, appId: 'contentclass', limit: 'exempt', ...callerOpts(ctx),
        });
        transcript = t.text?.trim() || undefined;
      } catch (err) {
        // A video without a transcript is still described from its frames; the reason is logged.
        logger.info('contentclass: the video was described without a transcript', { source: item.sourceId, error: String((err as Error)?.message ?? err) });
      }
    }
    const r = await askJson(ctx,
      `These are ${item.frames?.length ?? 0} still frames taken evenly from a video (${factLine(item.technical)}).\n`
      + (transcript ? `What is said in it:\n${transcript.slice(0, MAX_PROMPT_TEXT)}\n` : '')
      + `${lang}\n`
      + 'Answer with ONLY a JSON object: {"altText": "one sentence of at most 125 characters", '
      + '"description": "three to five sentences on what happens in the video and what it is about"}',
      { images: (item.frames ?? []).map((f) => dataUrl('image/jpeg', f)), vision: true });
    return { text: String(r.json.description ?? ''), altText: String(r.json.altText ?? '') || undefined, transcript, model: r.model, provenanceId: r.provenanceId };
  }
  if (item.text && item.text.trim()) {
    const r = await askJson(ctx,
      `Summarise the content below (${factLine(item.technical)}) so a search can find it and a person can tell what it is without opening it.\n`
      + `${lang}\n`
      + 'Answer with ONLY a JSON object: {"description": "three to five sentences"}\n\n'
      + redact(item.text.slice(0, MAX_PROMPT_TEXT)).text, {});
    return { text: String(r.json.description ?? ''), model: r.model, provenanceId: r.provenanceId };
  }
  return null;
}

/** The candidate classes for an item: those whose kinds include it, or that name no kinds. */
export function candidatesFor(classes: readonly ContentClass[], kind: ContentKind): ContentClass[] {
  return classes.filter((c) => !c.kinds?.length || c.kinds.includes(kind));
}

/** The question id of a class in the decision: a class id is already a valid one. */
const qid = (id: string) => `c_${id}`.slice(0, 64);

/**
 * Which content classes the item belongs to: one decision, one yes-or-no question per candidate.
 * Answers below CLASS_THRESHOLD are not memberships. An empty list is a real answer: none fits.
 */
export async function classifyItem(
  ctx: StageCtx, item: StageItem, classes: readonly ContentClass[],
): Promise<{ classes: ClassMembership[]; decisionId: string; model: string }> {
  const cands = candidatesFor(classes, item.kind);
  if (!cands.length) return { classes: [], decisionId: '', model: '' };
  const questions: Json = {};
  for (const c of cands) {
    questions[qid(c.id)] = { type: 'noul', instructions: `Is this item a ${c.label.en.toLowerCase()}? ${c.describe}`,
      criteria: { true: c.describe, false: 'It is something else.' } };
  }
  const text = item.text ? redact(item.text.slice(0, MAX_STATE_TEXT)).text : '';
  const r = await decideForOwner(ctx.deps.storage, ctx.deps.config,
    { gaii: ctx.ownerGhii, principal: ctx.principal, appRef: ctx.appRef, appId: 'contentclass', isOwner: ctx.isOwner, limit: 'exempt' },
    {
      state: { kind: item.kind, type: item.mimeType, facts: factLine(item.technical), description: item.description ?? '', text },
      questions: questions as never,
      subject: `contentclass:${item.sourceId}`.slice(0, 200),
      gates: 'which content classes an item is filed under and what is extracted from it',
    });
  const out: ClassMembership[] = [];
  for (const c of cands) {
    // A yes-or-no answer is the probability of yes, 0 to 1 (decide/service.ts: { type: 'noul', value }).
    const a = (r.answers?.[qid(c.id)] ?? {}) as unknown as Json;
    const p = Number(a.value);
    if (Number.isFinite(p) && p >= CLASS_THRESHOLD) out.push({ id: c.id, confidence: p, by: 'model', decisionId: r.decision_id });
  }
  out.sort((x, y) => y.confidence - x.confidence);
  return { classes: out, decisionId: r.decision_id, model: r.model };
}

function propertyLines(props: readonly ClassProperty[]): string {
  return props.map((p) => `- ${p.name} (${p.type}${p.required ? ', required' : ', optional'}): ${p.describe}`).join('\n');
}

export interface Extraction { fields: Json; confidence: number; newProperties: ClassProperty[]; model: string; provenanceId?: string }

const PROPERTY_NAME = /^[a-z][a-z0-9_]{0,40}$/;
const PROPERTY_TYPES = new Set(['string', 'number', 'date', 'boolean']);

/** Properties a model named that the class lacks, cleaned: a bad entry is dropped, never repaired. */
function cleanNewProperties(raw: unknown, cls: ContentClass): ClassProperty[] {
  if (!Array.isArray(raw)) return [];
  const have = new Set(cls.properties.map((p) => p.name));
  const out: ClassProperty[] = [];
  for (const x of raw.slice(0, 5)) {
    const o = (x && typeof x === 'object' ? x : {}) as Json;
    const name = String(o.name ?? '');
    const type = String(o.type ?? 'string');
    const describe = String(o.describe ?? '').slice(0, 300);
    if (!PROPERTY_NAME.test(name) || have.has(name) || !PROPERTY_TYPES.has(type) || !describe) continue;
    have.add(name);
    out.push({ name, type: type as ClassProperty['type'], required: false, describe });
  }
  return out;
}

/**
 * Extract one class's properties from the item. A picture, or a PDF without words, goes to the model
 * whole; anything else as its words. `propose` asks the model to name facts the class has no
 * property for, which become a proposal.
 */
export async function extractClass(ctx: StageCtx, item: StageItem, cls: ContentClass, propose: boolean): Promise<Extraction> {
  const shape: Json = {};
  for (const p of cls.properties) shape[p.name] = p.type === 'number' ? 0 : p.type === 'boolean' ? false : '';
  shape._confidence = 0;
  if (propose) shape._newProperties = [{ name: '', type: 'string', describe: '' }];
  const hasWords = !!(item.text && item.text.trim().length >= 40);
  const whole = !hasWords && !!item.bytes && (item.kind === 'image' || item.kind === 'pdf');
  const prompt = `Extract these properties of a ${cls.label.en.toLowerCase()} (${cls.type}: ${cls.describe}) from the content${whole ? ' attached' : ' below'}.\n`
    + `${propertyLines(cls.properties)}\n`
    + 'Use null for a property the content does not state. Never guess a value. A date is YYYY-MM-DD.\n'
    + 'Also answer "_confidence": a number from 0 to 1 for how sure you are of the whole record.\n'
    + (propose ? 'In "_newProperties", name at most five facts this kind of content regularly states that the list above has no property for (name in lower_snake_case, type string, number, date or boolean, one sentence describing it); an empty list when there are none.\n' : '')
    + `Answer with ONLY a JSON object of this shape: ${JSON.stringify(shape)}`
    + (whole ? '' : `\n\n${redact((item.text ?? '').slice(0, MAX_PROMPT_TEXT)).text}`);
  const r = await askJson(ctx, prompt, whole
    ? (item.kind === 'image'
      ? { images: [dataUrl(item.mimeType, item.bytes!)] }
      : { files: [{ data: new Uint8Array(item.bytes!), mediaType: 'application/pdf', filename: item.filename }] })
    : {});
  const confidence = Math.max(0, Math.min(1, Number(r.json._confidence) || 0));
  const newProperties = propose ? cleanNewProperties(r.json._newProperties, cls) : [];
  const fields: Json = {};
  for (const p of cls.properties) if (r.json[p.name] !== undefined) fields[p.name] = r.json[p.name];
  return { fields, confidence, newProperties, model: r.model, ...(r.provenanceId ? { provenanceId: r.provenanceId } : {}) };
}

const CLASS_ID = /^[a-z][a-z0-9-]{1,40}$/;

/**
 * Ask for a new class when none fits. Null when the model says nothing new is worth a class, or
 * answers with a class that does not pass the shape the ontology takes.
 */
export async function proposeClass(ctx: StageCtx, item: StageItem, existing: readonly ContentClass[]): Promise<{ cls: ContentClass; why: string } | null> {
  const known = existing.map((c) => `${c.id}: ${c.describe}`).join('\n');
  const r = await askJson(ctx,
    `None of these content classes fits the item below (${factLine(item.technical)}):\n${known}\n\n`
    + 'If the item is a kind of thing a person keeps more than one of and would want to find or tabulate by its facts, propose ONE new class for it. Otherwise answer {"none": true}.\n'
    + 'A class: {"id": "lower-case-with-dashes", "label": {"fi": "Finnish name", "en": "English name", "es": "Spanish name"}, '
    + '"describe": "one English sentence a classifier can weigh", "type": "the closest schema.org type as a CURIE, e.g. schema:DigitalDocument", '
    + '"properties": [{"name": "lower_snake_case", "type": "string|number|date|boolean", "required": false, "describe": "one sentence"}], '
    + '"why": "one sentence on why this deserves a class"}\n'
    + 'Answer with ONLY a JSON object.\n\n'
    + (item.description ? `Description: ${item.description}\n` : '')
    + redact((item.text ?? '').slice(0, MAX_STATE_TEXT)).text, {});
  const j = r.json;
  if (j.none === true) return null;
  const id = String(j.id ?? '');
  const label = (j.label && typeof j.label === 'object' ? j.label : {}) as Json;
  if (!CLASS_ID.test(id) || existing.some((c) => c.id === id) || !label.fi || !label.en || !j.describe) return null;
  const props = cleanNewProperties(j.properties, { properties: [] } as unknown as ContentClass);
  const cls: ContentClass = {
    id, label: { fi: String(label.fi).slice(0, 80), en: String(label.en).slice(0, 80), ...(label.es ? { es: String(label.es).slice(0, 80) } : {}) },
    describe: String(j.describe).slice(0, 400), process: props.length > 0,
    type: /^[a-z]+:[A-Za-z][A-Za-z0-9]*$/.test(String(j.type ?? '')) ? String(j.type) : 'schema:CreativeWork',
    kinds: [item.kind], properties: props, origin: 'proposed',
  };
  return { cls, why: String(j.why ?? '').slice(0, 300) };
}
