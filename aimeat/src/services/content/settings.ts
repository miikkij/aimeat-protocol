/**
 * @file src/services/content/settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's content class settings, `contentclass.settings` (wish
 *   wish-sis-ll-n-purku-luokittelu-ja-owl, 2026-10-20). The settings decide what spends the owner's
 *   AI key, so the defaults are the cautious ones (types.ts DEFAULT_SETTINGS: the technical stage on,
 *   every AI stage off), and a stored value is never trusted as a whole: readSettings() checks each
 *   field and falls back to that field's default when it is not valid, so one bad field does not
 *   turn the AI stages on or reset the others.
 *
 *   A write is a partial patch, merged onto the current settings and checked strictly: a key the
 *   settings do not have, or a value of the wrong type, is refused with INVALID_INPUT naming the key,
 *   and nothing is written. The record is written on the version that was read (classes.ts
 *   updateOwnRecord), so two writers that change different fields both keep their change.
 * @structure SETTINGS_KEY · readSettings() · writeSettings() · aiStagesOn()
 * @usage
 *   const s = await readSettings(storage, ownerGhii);
 *   if (aiStagesOn(s)) { ... }
 *   await writeSettings(deps, writer, { stages: { describe: true } });
 * @version-history
 *   v1.0.1 — 2026-10-20 — `stages.technical` is always on: a patch turning it off is refused with the
 *     setting that does stop reading (onArrival), and a stored false reads as true. The pipeline always
 *     ran it, so the setting promised what nothing did.
 *   v1.0.0 — 2026-10-20 — Initial, with `language` (the language descriptions are written in).
 */
import type { Storage } from '../../storage/interface.js';
import { ContentClassError, updateOwnRecord, type ContentDeps, type ContentWriter } from './classes.js';
import { AI_STAGES, DEFAULT_SETTINGS, type ContentSettings, type StageName } from './types.js';

export const SETTINGS_KEY = 'contentclass.settings';

const STAGES: readonly StageName[] = ['technical', 'describe', 'classify', 'extract', 'propose'];
const SOURCES = ['files', 'memory', 'workspace'] as const;
const MODELS = ['text', 'vision'] as const;
const APPROVALS: readonly ContentSettings['approval'][] = ['ask', 'auto', 'rule'];
const RULE_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const TOP_KEYS = ['onArrival', 'stages', 'sources', 'minTextChars', 'approval', 'approvalRule', 'onlineSignatureChecks', 'models', 'language'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const okMinText = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 200 && v <= 1_000_000;
const okModel = (v: unknown): v is string => typeof v === 'string' && v.length <= 200;
const okLanguage = (v: unknown): v is string => typeof v === 'string' && (v === '' || LANGUAGE.test(v));
const okApproval = (v: unknown): v is ContentSettings['approval'] => APPROVALS.includes(v as ContentSettings['approval']);

function defaults(): ContentSettings {
  return {
    ...DEFAULT_SETTINGS,
    stages: { ...DEFAULT_SETTINGS.stages },
    sources: { ...DEFAULT_SETTINGS.sources },
    models: { ...DEFAULT_SETTINGS.models },
  };
}

/** A stored value read field by field; a field that is not valid takes its default. */
function lenient(v: unknown): ContentSettings {
  const out = defaults();
  if (!isObj(v)) return out;
  if (isBool(v.onArrival)) out.onArrival = v.onArrival;
  if (isBool(v.onlineSignatureChecks)) out.onlineSignatureChecks = v.onlineSignatureChecks;
  if (isObj(v.stages)) for (const s of STAGES) if (s !== 'technical' && isBool(v.stages[s])) out.stages[s] = v.stages[s] as boolean;
  if (isObj(v.sources)) for (const s of SOURCES) if (isBool(v.sources[s])) out.sources[s] = v.sources[s] as boolean;
  if (isObj(v.models)) for (const m of MODELS) if (okModel(v.models[m])) out.models[m] = v.models[m] as string;
  if (okMinText(v.minTextChars)) out.minTextChars = v.minTextChars;
  if (okLanguage(v.language)) out.language = v.language;
  if (typeof v.approvalRule === 'string' && RULE_ID.test(v.approvalRule)) out.approvalRule = v.approvalRule;
  // 'rule' without a rule to ask cannot approve anything, so it reads as 'ask'.
  if (okApproval(v.approval) && (v.approval !== 'rule' || out.approvalRule)) out.approval = v.approval;
  return out;
}

/** The owner's settings: the defaults with every valid stored field laid over them. */
export async function readSettings(storage: Storage, ownerGhii: string): Promise<ContentSettings> {
  return lenient((await storage.getMemory(ownerGhii, SETTINGS_KEY))?.value);
}

const refuse = (message: string): ContentClassError => new ContentClassError('INVALID_INPUT', 400, message);

function mergeFlags<K extends string>(name: string, keys: readonly K[], patch: unknown, into: Record<K, boolean>): void {
  if (!isObj(patch)) throw refuse(`${name} must be an object of true or false values.`);
  for (const [k, v] of Object.entries(patch)) {
    if (!keys.includes(k as K)) throw refuse(`${name}.${k} is not a setting. The keys are: ${keys.join(', ')}.`);
    if (!isBool(v)) throw refuse(`${name}.${k} must be true or false.`);
    into[k as K] = v;
  }
}

/** The patch merged onto `cur`, checked strictly. Throws INVALID_INPUT naming the first bad key. */
function applyPatch(cur: ContentSettings, patch: unknown): ContentSettings {
  if (!isObj(patch)) throw refuse('The settings change must be an object.');
  const next: ContentSettings = { ...cur, stages: { ...cur.stages }, sources: { ...cur.sources }, models: { ...cur.models } };
  for (const [k, v] of Object.entries(patch)) {
    switch (k as (typeof TOP_KEYS)[number]) {
      case 'onArrival': case 'onlineSignatureChecks':
        if (!isBool(v)) throw refuse(`${k} must be true or false.`);
        next[k as 'onArrival' | 'onlineSignatureChecks'] = v;
        break;
      case 'stages':
        mergeFlags('stages', STAGES, v, next.stages);
        // The technical read is what every other step works from, and it calls no model: it is
        // always on. Reading nothing on arrival is `onArrival: false`.
        if (next.stages.technical === false) throw refuse('stages.technical is always on: every other step works from what it reads, and it uses no AI. To read nothing when content arrives, set onArrival to false.');
        break;
      case 'sources': mergeFlags('sources', SOURCES, v, next.sources); break;
      case 'minTextChars':
        if (!okMinText(v)) throw refuse('minTextChars must be a whole number from 200 to 1000000.');
        next.minTextChars = v;
        break;
      case 'approval':
        if (!okApproval(v)) throw refuse(`approval must be one of ${APPROVALS.join(', ')}.`);
        next.approval = v;
        break;
      case 'approvalRule':
        if (v === null || v === '') { delete next.approvalRule; break; }
        if (typeof v !== 'string' || !RULE_ID.test(v)) throw refuse('approvalRule must be a decision rule id: 1 to 64 letters, digits, dots, hyphens or underscores.');
        next.approvalRule = v;
        break;
      case 'models':
        if (!isObj(v)) throw refuse('models must be an object with text and vision.');
        for (const [m, name] of Object.entries(v)) {
          if (!MODELS.includes(m as (typeof MODELS)[number])) throw refuse(`models.${m} is not a setting. The keys are: ${MODELS.join(', ')}.`);
          if (!okModel(name)) throw refuse(`models.${m} must be a model id of at most 200 characters, or empty for the owner's default.`);
          next.models[m as (typeof MODELS)[number]] = name;
        }
        break;
      case 'language':
        if (!okLanguage(v)) throw refuse('language must be a language tag such as fi, en or pt-BR, or empty for the content\'s own language.');
        next.language = v;
        break;
      default:
        throw refuse(`${k} is not a setting. The keys are: ${TOP_KEYS.join(', ')}.`);
    }
  }
  if (next.approval === 'rule' && !next.approvalRule) throw refuse('approval "rule" needs approvalRule, the id of the decision rule that approves a proposal.');
  return next;
}

/** Merge a partial patch onto the owner's settings, check it, and write it. Answers the settings as stored. */
export async function writeSettings(deps: ContentDeps, writer: ContentWriter, patch: unknown): Promise<ContentSettings> {
  // Checked against the stored settings inside the conditional write: whether approval 'rule' has
  // its rule depends on what is stored. A refusal throws before anything is written.
  const stored = await updateOwnRecord(deps, writer, SETTINGS_KEY, (cur) => applyPatch(lenient(cur), patch));
  return lenient(stored);
}

/** True when any stage that spends the owner's AI key is on. */
export function aiStagesOn(settings: ContentSettings): boolean {
  return AI_STAGES.some((s) => settings.stages[s] === true);
}
