/**
 * @file src/services/content/pipeline.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The content class pipeline for one item (wish-sis-ll-n-purku-luokittelu-ja-owl):
 *   read what the item says about itself (technical.ts, no model), then the stages that call a
 *   model (ai-stages.ts) when the owner turned them on, and keep the result as the item's facts
 *   (facts-store.ts). Every surface runs THIS: the arrival hook (intake.ts), a scan over many items
 *   (scan.ts), POST /v1/content/inspect and the MCP tool, so an item reads the same whoever asked.
 *
 *   WHO MAY ASK ABOUT WHICH ITEM. The rule GET /v1/storage/{key} has: an item in the caller's own
 *   namespace, and for the account holder also an item of one of their own agents (the owner sees
 *   everything their agents hold; never the other way round). Anything else answers NOT_FOUND, the
 *   same answer as an item that does not exist. The classification reader then decides whether the
 *   caller may see the item at all, and separately whether a model may read it (useForAi): refused,
 *   the technical facts are kept and every model stage is skipped with the reason.
 *
 *   NOTHING IS READ TWICE. Facts read from the same bytes (the same hash) are reused; a stage that
 *   already ran is not run again unless `force` says so. A changed item (another hash) is read
 *   afresh, which is how stale facts are replaced.
 *
 *   SIZE. A file over MAX_READ_BYTES is not loaded: its facts are what the stored record says (size,
 *   type, provenance record), with the reason. Loading a whole large file is what ends the process
 *   on postgres-kysely today (incident a-large-stored-file-ends-the-node-process, 2026-10).
 * @structure ContentError · InspectOptions · InspectResult · inspectSource · stagesToRun · loadItem
 * @usage const out = await inspectSource(deps, caller, { kind: 'file', owner, key }, { automatic: true });
 * @version-history
 *   v1.2.0 — 2026-10-29 — An automatic read of a PDF whose text reached the node's PDF read limit
 *     tells the account (secaudit2026oct26 round 8c, memory-b-09).
 *   v1.1.0 — 2026-10-21 — Extracting a class again keeps the values a person corrected (correct.ts).
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import { readerFor, systemReader, type ContentReader } from '../classification/reader.js';
import { fileTarget, memoryTarget, ClassificationError } from '../classification/labels.js';
import { aiCallerFromCredential, OWNER_CALLER } from '../ai/caller-context.js';
import { decideForOwner } from '../decide/service.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { readTechnicalFacts } from './technical.js';
import { videoFrames, videoAudio } from './extract-video.js';
import { measureText } from './extract-text.js';
import { aiMarksOf } from './provenance-read.js';
import { getFacts, putFacts, putText, getText, sourceIdOf } from './facts-store.js';
import { readSettings } from './settings.js';
import { listClasses, addProposal, decideProposal, entityFor } from './classes.js';
import { fieldsOf } from './correct-fields.js';
import { describeItem, classifyItem, extractClass, proposeClass, type StageCtx, type StageItem } from './ai-stages.js';
import {
  AI_STAGES, type ContentFacts, type ContentSource, type ContentSettings, type StageName, type ClassProposal,
} from './types.js';
import { createHash } from 'node:crypto';
import { notify } from '../notify.js';

/** The largest file the pipeline loads to read. Above it only the stored record is used. */
export const MAX_READ_BYTES = 64 * 1024 * 1024;
/** The largest picture or PDF sent to a model whole. */
const MAX_MODEL_BYTES = 15 * 1024 * 1024;
/** How many still frames a video is described from, and how much of its sound is transcribed. */
const VIDEO_FRAMES = 4;
const VIDEO_AUDIO_SECONDS = 600;

export class ContentError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}

export interface InspectOptions {
  /** The stages asked for. Absent: the owner's settings. A model stage the settings leave off runs only when named here. */
  stages?: StageName[];
  /** Run the asked stages again even when they ran on the same bytes. */
  force?: boolean;
  /** The arrival hook or a scan: no person asked, so the owner's settings alone decide. */
  automatic?: boolean;
  /** `owner/filename` of the app grant that asked, so its model calls run under the owner's rules for that app. */
  appRef?: string;
}

export interface InspectResult {
  facts: ContentFacts;
  /** The stages that ran now. */
  ran: StageName[];
  /** Stages that were asked for and did not run, with the reason. */
  skipped: Partial<Record<StageName, string>>;
  /** Proposals written by this run, for the caller to tell the owner about. */
  proposals: ClassProposal[];
}

type Deps = { storage: Storage; config: AimeatConfig };

/** The stages to run: asked ones, or the settings'; model stages only when the settings or the ask turn them on. */
export function stagesToRun(settings: ContentSettings, asked: StageName[] | undefined, automatic: boolean): StageName[] {
  if (automatic || !asked) return (Object.keys(settings.stages) as StageName[]).filter((s) => settings.stages[s]);
  return [...new Set(asked)];
}

interface LoadedItem {
  owner: string;
  key: string;
  mimeType: string;
  filename: string;
  size: number;
  bytes: Buffer | null;
  /** A memory record's text; null for a file. */
  memoryText: string | null;
  aiProvenanceId: string | null;
  target: ReturnType<typeof fileTarget>;
  tooLarge: boolean;
}

/** May this caller ask about an item stored under `owner`: its own, or the account holder's agent's. */
function mayAsk(caller: CallerContext, owner: string): boolean {
  if (owner === caller.principal) return true;
  return caller.inPerson && ownerGhiiOf(owner) === caller.ownerGhii;
}

/** A memory value as the words it holds: a string; a document's title and markdown; else JSON. */
export function memoryValueText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.markdown === 'string') return [typeof v.title === 'string' ? v.title : '', v.markdown].filter(Boolean).join('\n\n');
  }
  try {
    return JSON.stringify(value) ?? '';
  } catch (err) {
    // A value JSON cannot hold (a cycle) has no text to read; said in the log, read as empty.
    logger.debug('contentclass: a memory value has no JSON form', { error: String(err) });
    return '';
  }
}

async function loadItem(deps: Deps, reader: ContentReader, source: ContentSource): Promise<LoadedItem> {
  const notFound = () => new ContentError('NOT_FOUND', 404, `Nothing of yours is stored as ${source.kind} "${source.key}".`);
  if (source.kind === 'file') {
    const meta = await deps.storage.getStorageFileMeta(source.owner, source.key);
    const target = meta ? fileTarget(source.owner, source.key, meta.workspaceRef) : null;
    const [shown] = meta && target ? await reader.show([meta], () => target) : [];
    if (!shown || !target) throw notFound();
    const tooLarge = shown.size > MAX_READ_BYTES;
    const whole = tooLarge ? null : await deps.storage.getStorageFile(source.owner, source.key);
    if (!tooLarge && !whole) throw notFound();
    return {
      owner: source.owner, key: source.key, mimeType: shown.mimeType || 'application/octet-stream',
      filename: source.key.split('/').pop() ?? source.key, size: shown.size, bytes: whole?.data ?? null,
      memoryText: null, aiProvenanceId: shown.aiProvenanceId ?? null, target, tooLarge,
    };
  }
  const rec = await deps.storage.getMemory(source.owner, source.key);
  const target = memoryTarget(source.owner, source.key);
  const [shown] = rec ? await reader.show([rec], () => target) : [];
  if (!shown) throw notFound();
  const text = memoryValueText(shown.value);
  return {
    owner: source.owner, key: source.key, mimeType: typeof shown.value === 'string' ? 'text/plain' : 'application/json',
    filename: source.key, size: Buffer.byteLength(text, 'utf8'), bytes: null, memoryText: text,
    aiProvenanceId: (shown as { aiProvenanceId?: string | null }).aiProvenanceId ?? null, target, tooLarge: false,
  };
}

/** The account hears that a stored PDF's text was not read at a limit. Never throws. */
async function tellTextNotRead(deps: Deps, ownerGhii: string, source: ContentSource, why: { reason: 'time' | 'memory'; limit: number }): Promise<void> {
  const limit = why.reason === 'time' ? `${why.limit} s` : `${why.limit} MB`;
  const vars = { key: source.key, limit };
  await notify(deps.storage, ownerGhii, {
    type: 'content_pdf_text_not_read',
    title: `The text of your PDF ${source.key} was not read`,
    body: `The file is stored as it was. Reading its text reached this node's ${why.reason === 'time' ? 'time' : 'memory'} limit of ${limit}, `
      + 'which applies to a PDF whose size the node cannot check before it reads it. Its details on your Data Wallet page say the same.',
    link: '/v1/profile?tab=datawallet',
    i18n: { key: why.reason === 'time' ? 'content_pdf_text_not_read_time' : 'content_pdf_text_not_read_memory', vars },
  }).catch((err: unknown) => logger.warn('contentclass: the notice about an unread PDF text was not sent', { key: source.key, error: String(err) }));
}

function hashOf(item: LoadedItem): string {
  const h = createHash('sha256');
  if (item.bytes) h.update(item.bytes);
  else if (item.memoryText !== null) h.update(item.memoryText, 'utf8');
  else h.update(`${item.owner}\u0000${item.key}\u0000${item.size}`);
  return `sha256:${h.digest('hex')}`;
}

/** The facts of an item too large to load, or a memory record: only what needs no reading of bytes. */
async function shallowTechnical(deps: Deps, item: LoadedItem, hash: string): Promise<ContentFacts['technical']> {
  const row = item.aiProvenanceId ? await deps.storage.getAiProvenance(item.aiProvenanceId) : null;
  const ai = aiMarksOf({ nodeRecord: row ? { id: row.id, level: row.record.level } : null });
  if (item.memoryText !== null) {
    return { kind: 'text', mimeType: item.mimeType, size: item.size, contentHash: hash, text: measureText(item.memoryText, 'memory'), ai };
  }
  return { kind: 'other', mimeType: item.mimeType, size: item.size, contentHash: hash, ai,
    errors: { read: `The file is ${item.size} bytes; files over ${MAX_READ_BYTES} bytes are not read.` } };
}

/**
 * Inspect one item: read its technical facts when they are missing or stale, then the asked model
 * stages, and keep the facts. The caller is whoever asked; `automatic` runs come from the arrival
 * hook and the scan, with the owner as the caller.
 */
export async function inspectSource(
  deps: Deps, caller: CallerContext, source: ContentSource, opts: InspectOptions = {},
): Promise<InspectResult> {
  if (deps.config.contentClassMode === 'off') throw new ContentError('NOT_FOUND', 404, 'Content classes are off on this node.');
  if (!mayAsk(caller, source.owner)) throw new ContentError('NOT_FOUND', 404, `Nothing of yours is stored as ${source.kind} "${source.key}".`);
  const ownerGhii = caller.ownerGhii;
  const automatic = opts.automatic === true;
  const reader = automatic ? systemReader(deps, ownerGhii) : readerFor(deps, caller.auth);
  const settings = await readSettings(deps.storage, ownerGhii);
  const stages = stagesToRun(settings, opts.stages, automatic);
  const item = await loadItem(deps, reader, source);
  const hash = hashOf(item);
  const sourceId = sourceIdOf(source);
  const now = new Date().toISOString();
  const writer = { principal: ownerGhii, ownerGhii, scopes: [] as string[], roles: ['owner'] };
  const existing = await getFacts(deps.storage, ownerGhii, sourceId);
  const fresh = !existing || existing.readFrom !== hash;
  const facts: ContentFacts = fresh
    ? { source, sourceId, technical: await shallowTechnical(deps, item, hash), stages: {}, readFrom: hash, updatedAt: now }
    : structuredClone(existing);
  const ran: StageName[] = [];
  const skipped: Partial<Record<StageName, string>> = {};
  const proposals: ClassProposal[] = [];

  // ── technical ── always for fresh facts; again only when asked with force.
  let text: string | null = item.memoryText;
  if (fresh || (opts.force && stages.includes('technical'))) {
    if (item.bytes) {
      const t = await readTechnicalFacts(deps, {
        bytes: item.bytes, mimeType: item.mimeType, filename: item.filename, aiProvenanceId: item.aiProvenanceId,
        onlineSignatures: settings.onlineSignatureChecks, ffprobePath: deps.config.ffprobePath,
      });
      facts.technical = t.technical;
      text = t.text;
      // Nobody asked for an automatic read, so the account hears when a PDF's text was not read at a
      // limit; a caller who asked gets the facts back (file-text/pdf-bounded.ts).
      if (automatic && t.technical.pdf?.textNotRead) await tellTextNotRead(deps, ownerGhii, source, t.technical.pdf.textNotRead);
    }
    if (text && text.trim() && item.memoryText === null) facts.textKey = await putText(deps, writer, sourceId, text);
    facts.stages.technical = { at: now, ok: true, ...(item.tooLarge ? { note: 'too large to read' } : {}) };
    ran.push('technical');
  } else if (facts.textKey) {
    text = await getText(deps.storage, ownerGhii, facts.textKey);
  }

  // ── the model stages ──
  const wanted = stages.filter((s) => (AI_STAGES as readonly string[]).includes(s))
    .filter((s) => opts.force || fresh || !facts.stages[s]?.ok);
  if (wanted.length) {
    let allowed = true;
    try {
      await reader.useForAi([item.target], { capability: 'contentclass' });
    } catch (err) {
      if (!(err instanceof ClassificationError)) throw err;
      allowed = false;
      for (const s of wanted) skipped[s] = `${err.code}: ${err.message}`;
    }
    if (allowed) {
      const ctx: StageCtx = {
        deps, ownerGhii, principal: automatic ? ownerGhii : caller.principal, isOwner: automatic || caller.inPerson,
        ai: automatic ? OWNER_CALLER : aiCallerFromCredential({ roles: caller.roles, app: opts.appRef ?? null }, caller.principal),
        ...(opts.appRef ? { appRef: opts.appRef } : {}),
        settings,
      };
      await runModelStages(deps, ctx, { facts, item, text, wanted, writer, ran, skipped, proposals, now, sourceId });
    }
  }

  facts.updatedAt = new Date().toISOString();
  await putFacts(deps, writer, facts);
  emitChange('contentclass', ownerGhii);
  return { facts, ran, skipped, proposals };
}

interface StageRun {
  facts: ContentFacts;
  item: LoadedItem;
  text: string | null;
  wanted: StageName[];
  writer: { principal: string; ownerGhii: string; scopes: string[]; roles: string[] };
  ran: StageName[];
  skipped: Partial<Record<StageName, string>>;
  proposals: ClassProposal[];
  now: string;
  sourceId: string;
}

/** One stage, with its failure kept on the facts rather than thrown: the other stages still run. */
async function stage(r: StageRun, name: StageName, fn: () => Promise<string | void>): Promise<void> {
  try {
    const note = await fn();
    r.facts.stages[name] = { at: r.now, ok: true, ...(note ? { note } : {}) };
    r.ran.push(name);
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown };
    const why = `${e.code ? `${String(e.code)}: ` : ''}${String(e.message ?? err)}`.slice(0, 500);
    r.facts.stages[name] = { at: r.now, ok: false, note: why };
    r.skipped[name] = why;
    logger.info('contentclass: a stage failed; the others still run', { source: r.sourceId, stage: name, error: why });
  }
}

async function runModelStages(deps: Deps, ctx: StageCtx, r: StageRun): Promise<void> {
  const { facts, item } = r;
  const kind = facts.technical.kind;
  const modelBytes = item.bytes && item.bytes.length <= MAX_MODEL_BYTES ? item.bytes : undefined;
  const si: StageItem = {
    sourceId: r.sourceId, kind, mimeType: item.mimeType, text: r.text, filename: item.filename, technical: facts.technical,
    ...(modelBytes && (kind === 'image' || kind === 'pdf') ? { bytes: modelBytes } : {}),
    ...(facts.description?.text ? { description: facts.description.text } : {}),
  };

  if (r.wanted.includes('describe')) {
    await stage(r, 'describe', async () => {
      if (kind === 'video' && item.bytes) {
        const ext = (item.filename.split('.').pop() ?? 'mp4').toLowerCase();
        const opts = { ffmpegPath: deps.config.ffmpegPath };
        si.frames = await videoFrames(opts, item.bytes, ext, VIDEO_FRAMES, facts.technical.video?.durationSeconds);
        si.audio = await videoAudio(opts, item.bytes, ext, VIDEO_AUDIO_SECONDS);
      }
      const d = await describeItem(ctx, si);
      if (!d) return 'nothing a model could read';
      facts.description = { text: d.text, ...(d.altText ? { altText: d.altText } : {}), model: d.model,
        ...(d.provenanceId ? { provenanceId: d.provenanceId } : {}), at: r.now };
      si.description = d.text;
      // Words a model read from the item become its text, when the item had none of its own.
      const words = d.seenText || d.transcript;
      if (words && !(si.text && si.text.trim())) {
        si.text = words;
        facts.textKey = await putText(deps, r.writer, r.sourceId, words);
        facts.technical.text = measureText(words, 'model');
      }
    });
  }

  const classes = (r.wanted.includes('classify') || r.wanted.includes('extract')) ? await listClasses(deps.storage, ctx.ownerGhii) : [];

  if (r.wanted.includes('classify')) {
    await stage(r, 'classify', async () => {
      const m = await classifyItem(ctx, si, classes);
      // A class the owner set by hand stays; the model's answer replaces only the model's.
      const kept = (facts.classes ?? []).filter((c) => c.by !== 'model');
      facts.classes = [...kept, ...m.classes.filter((c) => !kept.some((k) => k.id === c.id))];
      if (!m.classes.length && r.wanted.includes('propose')) {
        const p = await proposeClass(ctx, si, classes);
        if (p) r.proposals.push(await settle(deps, ctx, r, await addProposal(deps, r.writer, { kind: 'class', class: p.cls, sourceId: r.sourceId, why: p.why })));
      }
      return m.classes.length ? undefined : 'no content class fits';
    });
  }

  if (r.wanted.includes('extract')) {
    await stage(r, 'extract', async () => {
      const members = (facts.classes ?? []).map((m) => classes.find((c) => c.id === m.id)).filter((c) => !!c && c.process && c.properties.length);
      if (!members.length) return 'no class of this item extracts anything';
      facts.entities = { ...(facts.entities ?? {}) };
      for (const cls of members) {
        const ex = await extractClass(ctx, si, cls!, r.wanted.includes('propose'));
        // A value a person corrected (correct.ts) wins over what the model reads now.
        const prev = facts.entities[cls!.id];
        const kept = prev?.corrected ? fieldsOf(prev.entity, cls!.id) : {};
        const fields = { ...ex.fields, ...Object.fromEntries((prev?.corrected?.properties ?? []).map((n) => [n, kept[n] ?? null])) };
        facts.entities[cls!.id] = {
          entity: entityFor(cls!, fields, { sourceId: r.sourceId, baseUrl: deps.config.baseUrl }),
          model: ex.model, confidence: ex.confidence, ...(ex.provenanceId ? { provenanceId: ex.provenanceId } : {}), at: r.now,
          ...(prev?.corrected ? { corrected: prev.corrected } : {}),
        };
        if (ex.newProperties.length) {
          r.proposals.push(await settle(deps, ctx, r, await addProposal(deps, r.writer, {
            kind: 'properties', classId: cls!.id, properties: ex.newProperties, sourceId: r.sourceId,
            why: `An extraction found facts the class ${cls!.id} has no property for.`,
          })));
        }
      }
    });
  }
  if (r.wanted.includes('propose') && !r.ran.includes('propose')) {
    r.facts.stages.propose = { at: r.now, ok: true, note: r.proposals.length ? `${r.proposals.length} proposed` : 'nothing to propose' };
    r.ran.push('propose');
  }
}

/**
 * A new proposal under the owner's approval setting: 'auto' approves it at once, 'rule' asks the
 * owner's decision rule and approves on the outcome `act`, 'ask' leaves it pending for the owner.
 */
async function settle(deps: Deps, ctx: StageCtx, r: StageRun, p: ClassProposal): Promise<ClassProposal> {
  if (p.status !== 'pending') return p;
  const s = ctx.settings;
  if (s.approval === 'auto') return decideProposal(deps, r.writer, p.id, 'approve', 'auto');
  if (s.approval === 'rule' && s.approvalRule) {
    try {
      const d = await decideForOwner(deps.storage, deps.config,
        { gaii: ctx.ownerGhii, principal: ctx.principal, appId: 'contentclass', isOwner: ctx.isOwner, limit: 'exempt' },
        { rule: s.approvalRule, state: { proposal: { kind: p.kind, class: p.class, classId: p.classId, properties: p.properties, why: p.why } },
          subject: `contentclass:proposal:${p.id}` });
      if (d.outcome === 'act') return decideProposal(deps, r.writer, p.id, 'approve', `rule:${s.approvalRule}`);
    } catch (err) {
      // The rule could not be asked: the proposal waits for the owner, which is what 'ask' does.
      logger.info('contentclass: the approval rule was not asked; the proposal waits', { proposal: p.id, error: String((err as Error)?.message ?? err) });
    }
  }
  return p;
}
