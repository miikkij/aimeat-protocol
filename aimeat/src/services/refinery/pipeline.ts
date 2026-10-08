/**
 * @file src/services/refinery/pipeline.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE REFINERY, on the node: read a batch of mail from the owner's connection, classify
 *   each message (a learned rule first, then the decision model), extract the class's fields from
 *   the text and its attachments (a PDF's text layer, or the PDF itself to the model when it has
 *   none), put it in a queue by how sure both steps were, and write it as a workspace row with a
 *   log row beside it. The browser (aimeat-refinery), the scheduler and an agent all run THIS: one
 *   implementation, so a batch reads the same whoever started it (wish aimeat-refinery, 2026-09-29).
 *
 *   THE DEFINITION IS THE OWNER'S MEMORY RECORD `<prefix>.config` (private), with `<prefix>.cursor`
 *   (where the last batch stopped) and `<prefix>.runs` (the last fifty batches) beside it. The prefix
 *   is the app's word (`postinjalostamo`), so an app keeps the data it already wrote.
 *
 *   IT NEVER SENDS. Approving a record and sending it onward is a person's act in the app, through
 *   their own allowlist; a batch that runs at night only reads, decides and files.
 * @structure RefineryDefinition · RefineryCaller · RunState · Ctx · loadDefinition · readAttachments · runBatch
 * @usage const run = await runBatch(deps, caller, 'postinjalostamo', { onProgress });
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial.
 *   v1.0.1 — 2026-09-29 — The "already filed?" row read uses a system classification reader (TARGET-082).
 *   v1.0.2 — 2026-09-29 — TARGET-082 review: an attachment whose text goes to the model is read
 *     through readAiFile (useForAi first); a refused one is named on the row and left out.
 *   v1.0.3 — 2026-10-05 — The extraction runs as whoever runs the batch, an app or an agent included
 *     (services/ai/caller-context.ts; secaudit 2026-10, AI-3).
 *   v1.0.4 — 2026-10-08 — The extraction is tried again only on the code RATE_LIMITED, not on the
 *     words rate, limit, 429 or busy in any message (aiprov plan, A9).
 *   v1.0.4 — 2026-10-05 — The AI call limit is counted per account in the service, so the MCP tools share it (secaudit 2026-10, C5).
 *     The batch's decisions pass `limit: 'exempt'`: one batch is many calls, not one request each.
 *   v1.0.5 — 2026-10-08 — The row's extractor block names the provenance record the extraction call
 *     minted (provenanceId); a workspace row has no column for it.
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { CLASS_PACKS, type RefineryClass } from '../../data/refinery-classes.js';
import { buildOutboundProviders } from '../connections/providers.js';
import { requireEncryptionKey } from '../connections/credential.js';
import { readResource } from '../connections/read.js';
import { requireOwnConnection } from '../connections/access.js';
import { storeMailAttachment } from '../connections/attachment-store.js';
import { decideForOwner } from '../decide/service.js';
import { completeForOwner } from '../ai/completion.js';
import { readCallFiles } from '../ai/call-files.js';
import { extractFileText } from '../file-text/index.js';
import { appendRows, readRow, type RowCaller } from '../workspace-rows/row-service.js';
import { WorkspaceRowError } from '../workspace-rows/row-space.js';
import { logger } from '../../utils/logger.js';
import { writeMemoryRecord } from '../memory-write.js';
import { systemReader, readerForCaller } from '../classification/reader.js';
import { ClassificationError } from '../classification/labels.js';
import { readAiFile } from '../ai-inputs.js';
import { aiCallerFromCredential } from '../ai/caller-context.js';
import {
  parseMessage, listPage, isGraph, redact, senderDomain, ruleFor, extractionPrompt, parseJsonAnswer, queueFor,
  type MailMessage, type RefineryRule, type Queue,
} from './message.js';

export interface RefineryDeps { storage: Storage; config: AimeatConfig }

/** Who runs the batch: the owner whose mailbox, rows and model budget it spends, and who asked. */
export interface RefineryCaller {
  ownerGhii: string;
  owner: string;
  /** resolveIdentity's answer: the owner's GHII for the owner and their apps, an agent's own GAII. */
  principal: string;
  roles: string[];
  scopes: string[];
  isOwner: boolean;
  /** `owner/filename` when an app asked. */
  appRef?: string;
}

export interface RefineryDefinition {
  connectionId: string;
  provider: string;
  since: string;
  batchSize: number;
  query: string;
  organismId: string;
  workspaceId: string;
  thresholds: { clear: number; unclear: number };
  models: { text: string; vision: string };
  classes: RefineryClass[];
  rules: RefineryRule[];
  spaces: { items: string; events: string };
  /** Who the rows say processed them, and the decision records' app. */
  app: string;
}

export type RunStep = 'list' | 'read' | 'classify' | 'attach' | 'extract' | 'save';

export interface RunState {
  id: string;
  prefix: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  /** Messages in this batch, and which one is being worked on (1-based). */
  n: number;
  i: number;
  step: RunStep | '';
  subject: string;
  counts: { seen: number; clear: number; unclear: number; bad: number; skip: number; skipped_seen: number };
  /** The rows written so far, newest first: queue, subject, class. */
  rows: Array<{ rowId: string; queue: Queue; subject: string; klass: string }>;
  error?: string;
  by: string;
}

type Json = Record<string, unknown>;
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);

export class RefineryError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}

/** The definition from the owner's `<prefix>.config`, class packs resolved, defaults filled. */
export async function loadDefinition(storage: Storage, ownerGhii: string, prefix: string): Promise<RefineryDefinition> {
  const rec = await storage.getMemory(ownerGhii, `${prefix}.config`);
  const c = (rec?.value && typeof rec.value === 'object' ? rec.value : null) as Json | null;
  if (!c) throw new RefineryError('NO_DEFINITION', 404, `No refinery definition at ${prefix}.config. Save one first (the app's setup, or aimeat_memory_write).`);
  const rawClasses = Array.isArray(c.classes) ? c.classes : ['receipt', 'invoice', 'system', 'newsletter', 'personal'];
  const classes = rawClasses.map((x) => (typeof x === 'string' ? CLASS_PACKS.find((p) => p.id === x) : x as RefineryClass))
    .filter((x): x is RefineryClass => !!x && typeof x.id === 'string');
  const th = (c.thresholds && typeof c.thresholds === 'object' ? c.thresholds : {}) as Json;
  const models = (c.models && typeof c.models === 'object' ? c.models : {}) as Json;
  const spaces = (c.spaces && typeof c.spaces === 'object' ? c.spaces : {}) as Json;
  const def: RefineryDefinition = {
    connectionId: String(c.connectionId ?? ''),
    provider: String(c.provider ?? ''),
    since: String(c.since ?? ''),
    batchSize: Math.max(1, Math.min(50, num(c.batchSize, 10))),
    query: String(c.query ?? ''),
    organismId: String(c.organismId ?? ''),
    workspaceId: String(c.workspaceId ?? ''),
    thresholds: { clear: num(th.clear, 0.8), unclear: num(th.unclear, 0.5) },
    models: { text: String(models.text ?? ''), vision: String(models.vision ?? '') },
    classes,
    rules: Array.isArray(c.rules) ? c.rules as RefineryRule[] : [],
    spaces: { items: String(spaces.items ?? 'viesti'), events: String(spaces.events ?? 'tapahtuma') },
    app: String(c.app ?? `${prefix}.html`),
  };
  const missing = [
    !def.connectionId && 'connectionId (the mailbox)', !def.organismId && 'organismId', !def.workspaceId && 'workspaceId',
    !def.since && 'since (the start date)', !def.classes.length && 'classes',
  ].filter(Boolean);
  if (missing.length) throw new RefineryError('INCOMPLETE_DEFINITION', 400, `The definition at ${prefix}.config is missing ${missing.join(', ')}.`);
  return def;
}

async function writeOwn(deps: RefineryDeps, caller: RefineryCaller, key: string, value: unknown): Promise<void> {
  const r = await writeMemoryRecord({ storage: deps.storage, config: deps.config },
    { principal: caller.principal, targetGaii: caller.ownerGhii, scopes: caller.scopes, roles: caller.roles },
    { key, value, visibility: 'private', pipeline: 'refinery.run' });
  if (!r.ok) throw new RefineryError(r.code, r.status, r.message);
}

/** The row's id: the provider and the mailbox's own message id, so the same mail is one row. */
export function rowIdOf(def: RefineryDefinition, messageId: string): string { return `${def.provider || 'mail'}:${messageId}`; }

function rowCaller(caller: RefineryCaller): RowCaller {
  return { principal: caller.principal, identity: caller.ownerGhii, owner: caller.owner, roles: caller.roles, app: caller.appRef };
}

export interface Ctx { deps: RefineryDeps; caller: RefineryCaller; def: RefineryDefinition; conn: { config: AimeatConfig; storage: Storage; providers: ReturnType<typeof buildOutboundProviders>; key: Buffer } }

async function read(ctx: Ctx, resource: string, params: Json): Promise<unknown> {
  const r = await readResource(ctx.conn as never, ctx.def.connectionId, resource, params);
  if (!r.ok) throw new RefineryError(r.code, r.status ?? 502, r.message ?? `The mailbox did not answer (${resource}).`);
  return (r as unknown as { data: unknown }).data;
}

async function classify(ctx: Ctx, msg: MailMessage): Promise<Json> {
  const rule = ruleFor(ctx.def.rules, msg);
  if (rule) return { klass: rule.klass, confidence: 1, by: 'rule', rule: `${rule.match} = ${rule.value}` };
  const criteria: Record<string, string> = {};
  for (const c of ctx.def.classes) criteria[c.id] = c.describe;
  criteria.NONE = 'None of the above, or nothing useful can be told from it.';
  const body = redact(msg.text.slice(0, 6000));
  const subj = redact(msg.subject);
  const r = await decideForOwner(ctx.deps.storage, ctx.deps.config,
    { gaii: ctx.caller.ownerGhii, principal: ctx.caller.principal, appRef: ctx.caller.appRef, appId: ctx.def.app, isOwner: ctx.caller.isOwner, limit: 'exempt' },
    {
      state: { from_domain: senderDomain(msg.from), subject: subj.text, text: body.text, attachments: msg.attachments.map((a) => a.filename).join(', ') },
      questions: { kind: { type: 'choice', instructions: 'Which kind of email message is this?', criteria } } as never,
      thresholds: { kind: ctx.def.thresholds.clear },
      subject: `${ctx.def.app}:${msg.id}`,
      gates: 'which queue an email message goes to',
    });
  const ans = (r.answers?.kind ?? {}) as unknown as Json;
  return {
    klass: ans.value, confidence: num(ans.confidence, 0), by: 'jev', decisionId: r.decision_id, model: r.model,
    keySource: r.key_source, probabilities: ans.probabilities ?? {}, scrubbed: r.scrub?.total ?? 0, redacted: body.n + subj.n,
    costUsd: r.usage?.cost_usd ?? null, cached: !!r.cached,
  };
}

/** Store the PDFs and pictures; a PDF's text layer is read here, a PDF with none goes to the model whole.
 *  Exported for the unit test of its classification check; runBatch is the caller. */
export async function readAttachments(ctx: Ctx, msg: MailMessage): Promise<{ text: string; fileKeys: string[]; stored: Json[] }> {
  const wanted = msg.attachments.filter((a) => /pdf|image\//i.test(a.mime) || /\.pdf$/i.test(a.filename)).slice(0, 4);
  const out = { text: '', fileKeys: [] as string[], stored: [] as Json[] };
  for (const att of wanted) {
    // Stored as the connection's holder, the way aimeat_mail_read and the REST read store it.
    const s = await storeMailAttachment(ctx.conn as never, ctx.deps, ctx.caller.principal, ctx.def.connectionId,
      { message_id: msg.id, attachment_id: att.id, filename: att.filename, mime_type: att.mime });
    if (!s.ok) { out.stored.push({ filename: att.filename, error: s.message }); continue; }
    const stored = s;
    // Its text goes to a model, so the file is read through readAiFile: useForAi refuses a file a
    // model may not read before a byte of it is extracted (TARGET-082 review). A refused attachment
    // is named on the row and left out of the extraction; the message is still filed.
    let file;
    try {
      file = await readAiFile(ctx.deps.storage, callerReader(ctx), ctx.caller.principal, stored.key, { capability: 'refinery.extract' });
    } catch (err) {
      if (!(err instanceof ClassificationError)) throw err;
      out.stored.push({ filename: att.filename, key: stored.key, mime: stored.mime_type, size: stored.size, error: `${err.code}: ${err.message}` });
      continue;
    }
    out.stored.push({ filename: att.filename, key: stored.key, mime: stored.mime_type, size: stored.size });
    if (!file) continue;
    const isPdf = /pdf/i.test(stored.mime_type) || /\.pdf$/i.test(att.filename);
    const text = isPdf ? await extractFileText(file.data, stored.mime_type, att.filename) : null;
    if (text && text.text.trim().length >= 40) out.text += `\n--- ${att.filename} ---\n${text.text}`;
    else out.fileKeys.push(stored.key);
  }
  return out;
}

/** The classification reader of whoever runs the batch: what reaches a model is decided per file. */
function callerReader(ctx: Ctx) {
  return readerForCaller(ctx.deps, { gaii: ctx.caller.principal, owner: ctx.caller.owner, roles: ctx.caller.roles, scopes: ctx.caller.scopes });
}

async function extract(ctx: Ctx, cls: RefineryClass, msg: MailMessage, att: { text: string; fileKeys: string[] }): Promise<Json> {
  const files = att.fileKeys.length
    ? await readCallFiles(ctx.deps.storage, callerReader(ctx), ctx.caller.principal, att.fileKeys.map((k) => ({ storage_key: k })))
    : undefined;
  const model = (files ? ctx.def.models.vision : ctx.def.models.text) || undefined;
  // As whoever runs the batch: the app or agent that started it, under the owner's rules for it
  // (services/ai/caller-context.ts; secaudit 2026-10, AI-3).
  const who = aiCallerFromCredential({ roles: ctx.caller.roles, app: ctx.caller.appRef }, ctx.caller.principal);
  const ask = () => completeForOwner(ctx.deps.storage, ctx.deps.config, ctx.caller.ownerGhii, {
    prompt: extractionPrompt(cls, msg, att.text, att.fileKeys.length), model, temperature: 0, appId: ctx.def.app, files,
    caller: who.caller, ...(who.agent ? { agent: who.agent } : {}), ...(who.verifiedApp ? { verifiedApp: who.verifiedApp } : {}),
  });
  let tries = 1;
  let r;
  try { r = await ask(); } catch (err) {
    // A provider's rate limit is a wait, not a verdict: one more try after a pause. Read from the code
    // every AI path answers it with (services/ai/errors.ts), not from the message's words, which
    // matched "limit" in any refusal that mentioned one (aiprov plan, A9).
    if ((err as { code?: unknown })?.code !== 'RATE_LIMITED') throw err;
    await new Promise((ok) => setTimeout(ok, 8000));
    tries = 2;
    r = await ask();
  }
  let fields = parseJsonAnswer(r.content);
  if (!fields) { tries += 1; r = await ask(); fields = parseJsonAnswer(r.content); }
  if (!fields) throw new RefineryError('NO_JSON', 502, 'The model did not answer with the fields as JSON.');
  // The record the extraction call minted. A workspace row has no provenance column, so the row's
  // extractor block names it, and a reader resolves it at /v1/provenance/{id} like any other.
  return { fields, model: r.model, tries, files: att.fileKeys.length, attachmentChars: att.text.length,
    ...(r.provenance ? { provenanceId: r.provenance.id } : {}) };
}

async function processOne(ctx: Ctx, run: RunState, id: string, tick: () => void): Promise<Json> {
  run.step = 'read'; tick();
  const msg = parseMessage(ctx.def.provider, await read(ctx, 'message', { id }));
  run.subject = msg.subject; run.step = 'classify'; tick();
  const cl = await classify(ctx, msg);
  const cls = cl.klass && cl.klass !== 'NONE' ? ctx.def.classes.find((c) => c.id === cl.klass) ?? null : null;
  const confidence = num(cl.confidence, 0);
  let att = { text: '', fileKeys: [] as string[], stored: [] as Json[] };
  let ex: Json | null = null;
  let error = '';
  if (cls && cls.process && confidence >= ctx.def.thresholds.unclear) {
    try {
      run.step = 'attach'; tick();
      att = await readAttachments(ctx, msg);
      run.step = 'extract'; tick();
      ex = await extract(ctx, cls, msg, att);
    } catch (err) { error = (err as Error).message; }
  }
  run.step = 'save'; tick();
  const fields = ex ? ex.fields as Json : null;
  const queue = queueFor(cls, confidence, fields, ctx.def.thresholds);
  const row: Json = {
    app: ctx.def.app, provider: ctx.def.provider, messageId: msg.id, date: msg.date, from: msg.from, subject: msg.subject,
    snippet: msg.text.slice(0, 280), klass: cls ? cls.id : 'NONE', confidence, decisionId: cl.decisionId ?? '',
    queue, status: queue, type: cls ? cls.type : '', fields, error, attachments: att.stored, runId: run.id,
    processedAt: new Date().toISOString(), automated: true, by: run.by,
    classifier: { by: cl.by, rule: cl.rule ?? '', model: cl.model ?? '', keySource: cl.keySource ?? '', probabilities: cl.probabilities ?? {},
      scrubbed: cl.scrubbed ?? 0, redacted: cl.redacted ?? 0, costUsd: cl.costUsd ?? null, cached: !!cl.cached },
    extractor: ex ? { model: ex.model, tries: ex.tries, files: ex.files, attachmentChars: ex.attachmentChars,
      ...(ex.provenanceId ? { provenanceId: ex.provenanceId } : {}) } : null,
  };
  const rc = rowCaller(ctx.caller);
  await appendRows(ctx.deps, rc, { organismId: ctx.def.organismId, wsId: ctx.def.workspaceId, space: ctx.def.spaces.items,
    rows: [{ rowId: rowIdOf(ctx.def, msg.id), occurredAt: msg.date || undefined, body: row }] });
  await appendRows(ctx.deps, rc, { organismId: ctx.def.organismId, wsId: ctx.def.workspaceId, space: ctx.def.spaces.events,
    rows: [{ body: { app: ctx.def.app, kind: 'processed', message: rowIdOf(ctx.def, msg.id), subject: msg.subject, actor: 'automatic',
      at: new Date().toISOString(), detail: { queue, runId: run.id, classifier: row.classifier, extractor: row.extractor, error } } }] })
    // The row itself is the record; a log line that could not be written is said, not fatal.
    .catch((err: unknown) => logger.warn('refinery: the log row was not written', { message: rowIdOf(ctx.def, msg.id), error: String(err) }));
  return row;
}

/** Whether an earlier batch filed this message. Only "no such row" is a no; any other failure stops the batch. */
async function alreadyDone(ctx: Ctx, id: string): Promise<boolean> {
  try {
    // Bookkeeping, not a read for anyone: a system reader, so a labelled row still counts as filed.
    await readRow(ctx.deps, rowCaller(ctx.caller), ctx.def.organismId, ctx.def.workspaceId, ctx.def.spaces.items, rowIdOf(ctx.def, id),
      systemReader(ctx.deps, ctx.caller.principal));
    return true;
  } catch (err) {
    if (err instanceof WorkspaceRowError && err.code === 'NOT_FOUND') return false;
    throw err;
  }
}

/**
 * Run one batch: the next page from where the last one stopped, or exactly `messageIds` (a rerun,
 * which processes them again even when they have rows). `onProgress` is called at every step.
 */
export async function runBatch(
  deps: RefineryDeps, caller: RefineryCaller, prefix: string,
  opts: { run: RunState; messageIds?: string[]; onProgress?: (run: RunState) => void },
): Promise<RunState> {
  const run = opts.run;
  const tick = () => { if (opts.onProgress) opts.onProgress(run); };
  const key = requireEncryptionKey(deps.config);
  if (!key) throw new RefineryError('NO_ENCRYPTION_KEY', 503, 'This node has no encryption key, so it cannot use a connection.');
  const def = await loadDefinition(deps.storage, caller.ownerGhii, prefix);
  // A CONNECTION BELONGS TO THE EXACT PRINCIPAL (mcp/connections.ts): the owner and their apps read
  // the owner's mailbox, and an agent reads only a mailbox it connected itself.
  const owns = await requireOwnConnection(deps.storage, caller.principal, def.connectionId);
  if (!owns) throw new RefineryError('NOT_FOUND', 404, 'The mailbox the definition names is not one of your connections. An agent runs a definition that names a mailbox the agent connected itself.');
  const ctx: Ctx = { deps, caller, def, conn: { config: deps.config, storage: deps.storage, providers: buildOutboundProviders(deps.config), key } };

  let ids: string[];
  let cursor: Json = {};
  run.step = 'list'; tick();
  if (opts.messageIds?.length) {
    ids = opts.messageIds.slice(0, 50);
  } else {
    const rec = await deps.storage.getMemory(caller.ownerGhii, `${prefix}.cursor`);
    const c = (rec?.value && typeof rec.value === 'object' ? rec.value : {}) as Json;
    cursor = c.since === def.since && c.query === def.query ? c : { since: def.since, query: def.query, page: '' };
    const p: Json = { limit: def.batchSize };
    if (cursor.page) p.page_token = cursor.page;
    if (isGraph(def.provider)) { if (def.query) p.query = def.query; else p.filter = `receivedDateTime ge ${def.since}T00:00:00Z`; }
    else p.query = `after:${def.since.replace(/-/g, '/')} ${def.query}`.trim();
    const page = listPage(def.provider, await read(ctx, 'messages', p));
    ids = page.ids;
    cursor = { ...cursor, page: page.next };
  }
  run.n = ids.length; tick();
  const failed: Array<{ id: string; message: string }> = [];
  for (const id of ids) {
    run.i += 1; run.subject = ''; tick();
    if (!opts.messageIds?.length && await alreadyDone(ctx, id)) { run.counts.skipped_seen += 1; continue; }
    try {
      const row = await processOne(ctx, run, id, tick);
      run.counts.seen += 1;
      const k = ({ selkea: 'clear', epaselva: 'unclear', kelvoton: 'bad', ohitettu: 'skip' } as Record<string, keyof RunState['counts']>)[String(row.queue)];
      if (k) run.counts[k] += 1;
      run.rows.unshift({ rowId: rowIdOf(def, String(row.messageId)), queue: row.queue as Queue, subject: String(row.subject), klass: String(row.klass) });
    } catch (err) {
      failed.push({ id, message: err instanceof RefineryError ? `${err.code}: ${err.message}` : String((err as Error)?.message ?? err) });
    }
    tick();
  }
  // EVERY MESSAGE FAILED: the cause is the batch's (no model key, the mailbox refusing), not the
  // mail's. Nothing is filed and the cursor stays, so the same page is read again once it is fixed.
  const allFailed = failed.length > 0 && run.counts.seen === 0;
  if (!allFailed) {
    // Some failed among ones that worked: each is filed as Unclear with its error, so a person sees
    // it and can run it again, and the cursor moves on past it.
    for (const f of failed) await fileFailure(ctx, run, f.id, f.message);
    if (!opts.messageIds?.length) await writeOwn(deps, caller, `${prefix}.cursor`, cursor);
  }
  const runsRec = await deps.storage.getMemory(caller.ownerGhii, `${prefix}.runs`);
  const runs = Array.isArray(runsRec?.value) ? runsRec!.value as Json[] : [];
  runs.unshift({ id: run.id, at: run.startedAt, count: run.counts.seen, counts: run.counts, failed: failed.length,
    ...(allFailed ? { error: failed[0].message } : {}), textModel: def.models.text || 'default', by: run.by });
  await writeOwn(deps, caller, `${prefix}.runs`, runs.slice(0, 50));
  if (allFailed) throw new RefineryError('BATCH_FAILED', 502, `All ${failed.length} messages failed, so nothing was filed and the next batch starts from the same place. The first error: ${failed[0].message}`);
  return run;
}

/** A message that failed among ones that worked: an Unclear row saying why, so it can be run again. */
async function fileFailure(ctx: Ctx, run: RunState, id: string, message: string): Promise<void> {
  const rowId = rowIdOf(ctx.def, id);
  try {
    await appendRows(ctx.deps, rowCaller(ctx.caller), { organismId: ctx.def.organismId, wsId: ctx.def.workspaceId, space: ctx.def.spaces.items,
      rows: [{ rowId, body: {
        app: ctx.def.app, provider: ctx.def.provider, messageId: id, date: '', from: '', subject: '', snippet: '', klass: 'ERROR', confidence: 0,
        decisionId: '', queue: 'epaselva', status: 'epaselva', type: '', fields: null, error: message, attachments: [], runId: run.id,
        processedAt: new Date().toISOString(), automated: true, by: run.by, classifier: null, extractor: null,
      } }] });
    run.counts.unclear += 1;
    run.rows.unshift({ rowId, queue: 'epaselva', subject: `(${message})`, klass: 'ERROR' });
  } catch (err) {
    run.rows.unshift({ rowId, queue: 'epaselva', subject: `(${message}; not filed: ${(err as Error).message})`, klass: 'ERROR' });
  }
}
