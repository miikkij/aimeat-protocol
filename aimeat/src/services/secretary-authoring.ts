/**
 * @file secretary-authoring.ts
 * @description Autonomous content authoring for the Secretary tick (document-first). The tick used to
 *   only file a free-text note into a generic `notes` bucket; this lets it actually FILL the active
 *   context's workspaces. It reads each workspace's manifest, finds EMPTY memory-backed spaces —
 *   document spaces FIRST (free markdown "about a topic"), then record spaces (schema-bound, list/task
 *   shaped) — and asks the owner's AI to author real content toward the strategy's focus milestone. The
 *   model MAY draw on its general knowledge (per the owner's setup choice), grounded in the strategy +
 *   existing material. Each item is written as a draft and, when the authoring band is 'act' and the
 *   workspace publish gate is off, published straight away. Band 'draft'/'ask' leaves drafts for review;
 *   'off' skips the phase entirely. The draft→publish convention mirrors src/mcp/workspaces.ts so the
 *   activity feed, counts and reads see exactly what an agent's workspace writes would produce.
 *
 *   Metered: one paid AI call per workspace that has something to fill; the caller passes the remaining
 *   per-day morsel budget and authoring stops when it's exhausted. Content is attributed to the
 *   Secretary's GAII so the workspace activity feed credits the secretary, not the bare owner.
 * @structure authorWorkspaceContent(storage, config, owner, ownerName, active, wsList, opts) · pure helpers
 * @usage import { authorWorkspaceContent } from './secretary-authoring.js';
 * @version-history
 *   v0.4.0 — 2026-06-30 — Authoring prompt now tells the model it MAY use ```mermaid diagrams in documents
 *     (the doc viewer renders them) — but judiciously, only where a chart genuinely clarifies, never by default.
 *   v0.3.0 — 2026-06-30 — Retry transient provider failures (completeWithRetry), honouring the owner's
 *     autoRetry/maxRetries. Stealth/alpha endpoints (owl-alpha) intermittently 400 and succeed on the next
 *     attempt — a single try killed the authoring even though the model is fine; permanent failures (bad
 *     key/malformed) are still not retried. Plus visible failures (log + ⚠️ feed line) from v0.2.x.
 *   v0.2.0 — 2026-06-30 — Agentic, not one-shot: each record space's exact JSON Schema goes into the
 *     prompt, and a rejected record's validation errors are fed BACK to the model for a bounded
 *     correction round (read→write→see-error→correct) instead of being silently dropped. writeAndMaybePublish
 *     now returns the schema errors so the loop can self-correct.
 *   v0.1.0 — 2026-06-30 — Initial: document-first autonomous authoring phase for the secretary tick
 *     (band-gated act→publish / draft→review, budget-metered, fills empty spaces toward the focus milestone).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { completeForOwner } from './ai-completion.js';
import { validateMemoryWrite } from './schema-validator.js';
import { isMemoryBackedSpace } from './workspace-meta.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

/** Minimal structural view of a secretary context (the scheduler's SecretaryContext satisfies it). */
export interface AuthoringContext {
  id: string;
  name?: string;
  organismId?: string | null;
  organismName?: string | null;
  brain?: { purpose?: string; rules?: Array<{ description?: string }> };
  strategy?: {
    enabled?: boolean; current?: string; target?: string; principles?: string[]; risks?: string[];
    milestones?: Array<{ title?: string; enables?: string; status?: string }>;
  };
}

export interface AuthoringOptions {
  /** Open goals in this context (title/why), to steer what gets authored. */
  openGoals: Array<Record<string, unknown>>;
  /** Effective autonomy band for `author_content`: act → publish · draft|ask → leave drafts · off → skip. */
  band: string;
  /** true → fill every empty space this pass; false → a small, steady handful. */
  aggressive: boolean;
  /** The model may use its own general knowledge (owner's setup choice), not only existing material. */
  useGeneralKnowledge: boolean;
  /** Remaining per-day morsel budget (null = unlimited). Authoring stops when it reaches 0. */
  budgetRemaining: number | null;
  /** appId for the metered completion (e.g. `schedule:<jobId>:author`). */
  appId: string;
  /** How many times to RETRY a transient provider failure (flaky stealth endpoints intermittently 400/429/
   *  502 — owl-alpha works but errors occasionally). Honours the owner's autoRetry/maxRetries. 0 = no retry. */
  maxRetries?: number;
  /** Test seam: override the per-workspace AI completion. Defaults to completeForOwner(owner). */
  complete?: (args: { prompt: string; systemPrompt: string; appId: string }) => Promise<{ content: string }>;
}

/** Error codes that are PERMANENT (don't retry) — a bad key / malformed request won't fix itself. */
const PERMANENT_AI_CODES = new Set(['INVALID_API_KEY', 'INVALID_BODY', 'PROMPT_TOO_LONG', 'APP_NOT_ALLOWED', 'APP_ID_REQUIRED']);

/**
 * Run a completion, retrying on TRANSIENT provider failures up to `maxRetries` times with a short linear
 * backoff. Stealth/alpha endpoints (e.g. owl-alpha) intermittently return a provider error and succeed on
 * the next attempt — a single try kills the authoring even though the model is fine. Permanent failures
 * (bad key, malformed request) are thrown immediately. The final failure is re-thrown for the caller to
 * surface. A retried attempt that failed costs nothing (the provider 400s before billing).
 */
async function completeWithRetry(
  run: (a: { prompt: string; systemPrompt: string; appId: string }) => Promise<{ content: string }>,
  args: { prompt: string; systemPrompt: string; appId: string },
  maxRetries: number,
  label: string,
): Promise<{ content: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await run(args); }
    catch (e) {
      lastErr = e;
      const code = (e as { code?: string })?.code;
      if (code && PERMANENT_AI_CODES.has(code)) throw e;     // permanent → don't waste retries
      if (attempt < maxRetries) {
        logger.warn('Secretary authoring: transient completion error, retrying', { label, attempt: attempt + 1, of: maxRetries, error: (e as Error)?.message });
        await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

export interface AuthoringResult {
  /** Memory keys written (drafts + published versions/pointers) — folded into the tick's write list. */
  writes: string[];
  /** Human-readable feed lines, one per workspace touched (the caller appends them to the feed). */
  summaries: string[];
  /** Paid AI calls made (1 per workspace authored) — folded into the tick's morsel ledger. */
  morsels: number;
}

type ObjType = { name?: string; namespace?: string; mode?: string; kind?: string; backing?: string; fields?: Array<{ name?: string; type?: string }> };
type Manifest = { objectTypes?: ObjType[] } & Record<string, unknown>;

/** Document-space predicate — mirrors the frontend isDocSpace + server normalizeObjectTypes inference. */
function isDocSpace(ot: ObjType): boolean {
  return ot.mode === 'document' || (!ot.mode && ot.kind === 'document');
}

/** Distinct existing instance ids for one space (bare/latest/draft count; version-only does not). */
function instancesOf(content: MemoryRecord[], root: string, namespace: string): Set<string> {
  const present = new Map<string, boolean>();
  const nsPrefix = `${root}.${namespace}.`;
  for (const r of content) {
    if (!r.key.startsWith(nsPrefix)) continue;
    const parts = r.key.slice(nsPrefix.length).split('.');
    const id = parts[0];
    const role = parts.slice(1).join('.');
    if (role.startsWith('version.')) { if (!present.has(id)) present.set(id, false); continue; }
    present.set(id, true);
  }
  const ids = new Set<string>();
  for (const [id, real] of present) if (real) ids.add(id);
  return ids;
}

/** Tolerant JSON-object extraction from a model reply (may be fenced / wrapped in prose). */
function extractJsonObject(text: string): Record<string, unknown> | null {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (s[0] !== '{') { const i = s.indexOf('{'); const j = s.lastIndexOf('}'); if (i >= 0 && j > i) s = s.slice(i, j + 1); }
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { return null; }
}

/** Slug an instance id from a title (id stays stable-ish + unique via a short suffix). */
function slugId(title: string, prefix: string): string {
  const base = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${base || prefix}-${randomUUID().slice(0, 6)}`;
}

/**
 * Author content into the active context's workspaces. Returns the writes, per-workspace feed lines, and
 * the morsels spent. Safe no-op (empty result) when the band is 'off', there's no organism, or nothing is
 * empty to fill. Never throws on a single bad item — a record that fails its schema (or a workspace whose
 * AI reply won't parse) is skipped, not fatal, so one bad space can't sink the whole tick.
 */
export async function authorWorkspaceContent(
  storage: Storage,
  config: AimeatConfig,
  owner: string,
  ownerName: string,
  active: AuthoringContext,
  wsList: Array<{ id: string; name: string }>,
  opts: AuthoringOptions,
): Promise<AuthoringResult> {
  const result: AuthoringResult = { writes: [], summaries: [], morsels: 0 };
  if (opts.band === 'off' || !active.organismId || !wsList.length) return result;
  const runComplete = opts.complete ?? ((a: { prompt: string; systemPrompt: string; appId: string }) => completeForOwner(storage, config, owner, a));

  const orgId = active.organismId;
  const writerGaii = `secretary#${ownerName}@${config.nodeId}`;
  const publishWanted = opts.band === 'act';
  // Honour the workspace publish gate: if it's on, leave everything as drafts for human review even on act.
  const cfgRec = await storage.getMemory(owner, `organism.${orgId}.meta.config`);
  const gateOn = !!(cfgRec?.value as { gates?: { publish?: { enabled?: boolean } } } | undefined)?.gates?.publish?.enabled;
  const doPublish = publishWanted && !gateOn;

  const MAX_WS = 12;                                   // bound the per-tick fan-out
  const MAX_DOC_SPACES = opts.aggressive ? 8 : 2;      // empty doc spaces filled per workspace
  const MAX_REC_SPACES = opts.aggressive ? 8 : 1;      // empty record spaces filled per workspace
  const RECS_PER_SPACE = opts.aggressive ? 3 : 1;

  for (const ws of wsList.slice(0, MAX_WS)) {
    if (opts.budgetRemaining !== null && result.morsels >= opts.budgetRemaining) break;
    const root = `organism.${orgId}.w.${ws.id}`;
    const manRec = (await storage.listAllMemory({ prefix: `${root}.meta.manifest`, limit: 5 })).items.find((r) => r.key === `${root}.meta.manifest`);
    const manifest = manRec?.value as Manifest | undefined;
    const types = manifest?.objectTypes;
    if (!Array.isArray(types) || !types.length) continue;

    const { items: content } = await storage.listAllMemory({ prefix: `${root}.`, limit: 5000 });

    // Find the EMPTY memory-backed spaces — documents first, then records.
    const emptyDocs: ObjType[] = [];
    const emptyRecs: ObjType[] = [];
    for (const ot of types) {
      if (!ot.namespace || !ot.name || !isMemoryBackedSpace(ot)) continue;
      if (instancesOf(content, root, ot.namespace).size > 0) continue;   // only fill empties (idempotent / converges)
      if (isDocSpace(ot)) emptyDocs.push(ot); else emptyRecs.push(ot);
    }
    const docTargets = emptyDocs.slice(0, MAX_DOC_SPACES);
    const recTargets = emptyRecs.slice(0, MAX_REC_SPACES);
    if (!docTargets.length && !recTargets.length) continue;             // nothing to fill here — no paid call

    // Build the authoring prompt for THIS workspace.
    const readmeRec = content.find((r) => r.key === `${root}.meta.readme`);
    const readme = typeof readmeRec?.value === 'string' ? readmeRec.value : '';
    const strat = active.strategy;
    const focus = strat?.enabled ? (strat.milestones || []).find((m) => m && m.status !== 'reached') : undefined;
    const goalLines = opts.openGoals.length
      ? opts.openGoals.map((g) => `- ${String(g.title || '')}${g.why ? ` (why: ${String(g.why)})` : ''}`).join('\n')
      : '(no open goals)';
    const strategyBlock = strat?.enabled
      ? `\nStrategy for this area:\n- Current state: ${strat.current || '(unstated)'}\n- Target state: ${strat.target || '(unstated)'}\n- Focus milestone: ${focus ? `${focus.title}${focus.enables ? ` (${focus.enables})` : ''}` : '(all reached)'}`
        + ((strat.principles || []).filter(Boolean).length ? `\n- Principles to respect: ${(strat.principles || []).filter(Boolean).join('; ')}` : '')
      : '';
    const docList = docTargets.map((o) => `- "${o.name}"${manifest && typeof (o as Record<string, unknown>).purpose === 'string' ? ` — ${(o as Record<string, unknown>).purpose as string}` : ''}`).join('\n') || '(none)';
    // Give the model the EXACT JSON Schema for each record space (not just field names) so it conforms
    // on the first shot — and so the correction round can point at concrete schema violations.
    const recSchemas = new Map<string, Record<string, unknown>>();
    for (const o of recTargets) {
      const sc = await storage.findApplicableSchema(`${root}.${o.namespace}.__probe`);
      if (sc?.schemaJson) recSchemas.set(o.name as string, sc.schemaJson as Record<string, unknown>);
    }
    const recList = recTargets.map((o) => {
      const sc = recSchemas.get(o.name as string);
      if (sc) return `- "${o.name}" — each record MUST satisfy this JSON Schema: ${JSON.stringify(sc)}`;
      const fields = (o.fields || []).filter((f) => f && f.name).map((f) => `${f.name}${f.type ? `:${f.type}` : ''}`).join(', ');
      return `- "${o.name}"${fields ? ` — fields: ${fields}` : ''}`;
    }).join('\n') || '(none)';

    const systemPrompt = `You are ${ownerName}'s personal Secretary, working autonomously (the owner is not present) in the "${active.name || 'personal'}" context. `
      + `${active.brain?.purpose || ''} You are FILLING the owner's workspace with real, useful content toward their strategy. `
      + `${opts.useGeneralKnowledge ? 'You MAY use your own general knowledge to write substantive, correct material' : 'Use ONLY what the owner has given you — organise and synthesise it, never invent facts'}, always grounded in the strategy and the workspace's purpose. `
      + `Write in the owner's language. Return ONLY a JSON object — no prose around it.`;
    const prompt = `Workspace: "${ws.name}"${readme ? `\nWorkspace intro:\n${readme.slice(0, 1200)}` : ''}\n${strategyBlock}\n\nOpen goals:\n${goalLines}\n\n`
      + `DOCUMENT spaces to fill (free markdown about a topic — the important ones; write one substantial, well-structured document for EACH):\n${docList}\n\n`
      + `RECORD spaces to fill (structured list/task entries; add ${RECS_PER_SPACE} concrete, realistic entr${RECS_PER_SPACE === 1 ? 'y' : 'ies'} for EACH, matching its fields):\n${recList}\n\n`
      + `Return a JSON object EXACTLY like:\n`
      + `{\n  "documents": [ { "space": "<exact document space name above>", "title": "a clear title", "markdown": "# Title\\n\\nReal, structured content in markdown…" } ],\n`
      + `  "records": [ { "space": "<exact record space name above>", "record": { "<field>": "<value>", "...": "..." } } ]\n}\n`
      + `Make every document genuinely useful and specific to this area — headings, substance, not a placeholder. Use the EXACT space names listed above. If a space truly has nothing to add, omit it. `
      + 'A document MAY include a Mermaid diagram via a ```mermaid fenced code block (it renders as a real chart) — but use it JUDICIOUSLY, only where a flowchart, sequence, timeline or relationship genuinely clarifies the content. Do NOT add diagrams by default or decoratively; most documents need none.';

    let reply: string;
    try {
      const completion = await completeWithRetry(runComplete, { prompt, systemPrompt, appId: opts.appId }, opts.maxRetries ?? 0, ws.name);
      result.morsels += 1;
      reply = completion.content;
    } catch (e) {
      // Don't sink the other workspaces — but DON'T fail silently either (the whole point): log it and
      // surface a feed line so the owner sees "couldn't fill X" instead of nothing happening.
      logger.warn('Secretary authoring: completion failed', { ws: ws.name, error: (e as Error)?.message });
      result.summaries.push(`⚠️ Couldn't author into ${ws.name}: ${(e as Error)?.message || 'the AI call failed'}`);
      continue;
    }
    const parsed = extractJsonObject(reply);
    if (!parsed) {
      logger.warn('Secretary authoring: reply did not parse as JSON', { ws: ws.name, head: reply.slice(0, 300) });
      result.summaries.push(`⚠️ Couldn't author into ${ws.name}: the AI reply was not usable JSON`);
      continue;
    }

    let docCount = 0; let recCount = 0;
    const docByName = new Map(docTargets.map((o) => [o.name as string, o]));
    const recByName = new Map(recTargets.map((o) => [o.name as string, o]));

    // Documents (priority — free markdown, no schema to fight).
    const documents = Array.isArray(parsed.documents) ? parsed.documents : [];
    for (const d of documents) {
      if (!d || typeof d !== 'object') continue;
      const dd = d as Record<string, unknown>;
      const ot = docByName.get(String(dd.space ?? '').trim());
      const title = String(dd.title ?? '').trim();
      const markdown = String(dd.markdown ?? '').trim();
      if (!ot || !ot.namespace || !title || !markdown) continue;
      const id = slugId(title, 'doc');
      const res = await writeAndMaybePublish(storage, config, root, ot.namespace, id, { id, title: title.slice(0, 200), markdown }, doPublish, writerGaii);
      if (res.writes.length) { result.writes.push(...res.writes); docCount++; }
    }

    // Records (secondary) — AGENTIC: write each, and when the schema REJECTS one, feed the exact errors
    // back to the model for a bounded correction round (read→write→see-error→correct), instead of
    // silently dropping it. This is what makes the MCP agent path "just work"; one-shot drop is what made
    // the old generator path tökkii. MAX_CORRECTION bounds the cost (each round is one metered call).
    const MAX_CORRECTION = 1;
    const toPending = (arr: unknown): Array<{ space: string; record: Record<string, unknown> }> =>
      (Array.isArray(arr) ? arr : [])
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r))
        .map((r) => {
          const rec = r.record;
          return { space: String(r.space ?? '').trim(), record: (rec && typeof rec === 'object' && !Array.isArray(rec)) ? rec as Record<string, unknown> : {} };
        })
        .filter((x) => x.space && Object.keys(x.record).length > 0);
    let pending = toPending(parsed.records);
    for (let round = 0; round <= MAX_CORRECTION && pending.length; round++) {
      const rejected: Array<{ space: string; record: Record<string, unknown>; errors: unknown }> = [];
      for (const item of pending) {
        const ot = recByName.get(item.space);
        if (!ot || !ot.namespace) continue;
        const id = slugId(String(item.record.title ?? item.record.name ?? ''), 'rec');
        const res = await writeAndMaybePublish(storage, config, root, ot.namespace, id, { ...item.record, id }, doPublish, writerGaii);
        if (res.writes.length) { result.writes.push(...res.writes); recCount++; }
        else rejected.push({ space: item.space, record: item.record, errors: res.errors });
      }
      // Done if nothing was rejected, no rounds left, or the budget is spent.
      if (!rejected.length || round === MAX_CORRECTION) break;
      if (opts.budgetRemaining !== null && result.morsels >= opts.budgetRemaining) break;
      const fixPrompt = `Some records you produced for workspace "${ws.name}" were REJECTED by the schema. Fix ONLY these and return the corrected records.\n\n`
        + rejected.map((x, i) => `${i + 1}. space "${x.space}" — rejected record: ${JSON.stringify(x.record)}\n   schema errors: ${JSON.stringify(x.errors)}`).join('\n\n')
        + `\n\nFor each, follow that space's JSON Schema EXACTLY: add any required field, fix wrong types, and keep within the allowed fields. Return ONLY:\n{ "records": [ { "space": "<space name>", "record": { ... } } ] }`;
      try {
        const fix = await completeWithRetry(runComplete, { prompt: fixPrompt, systemPrompt, appId: opts.appId }, opts.maxRetries ?? 0, `${ws.name} (correction)`);
        result.morsels += 1;
        pending = toPending(extractJsonObject(fix.content)?.records);
      } catch (e) { logger.warn('Secretary authoring: correction call failed', { ws: ws.name, error: (e as Error)?.message }); break; }
    }

    if (docCount || recCount) {
      const parts: string[] = [];
      if (docCount) parts.push(`${docCount} document${docCount === 1 ? '' : 's'}`);
      if (recCount) parts.push(`${recCount} record${recCount === 1 ? '' : 's'}`);
      result.summaries.push(`🖊️ Authored ${parts.join(' + ')} into ${ws.name}${doPublish ? ' (published)' : ' (drafts for review)'}`);
    } else {
      // Parsed fine but produced nothing usable (wrong space names / empty arrays) — surface it, don't vanish.
      logger.warn('Secretary authoring: nothing authored', { ws: ws.name, head: reply.slice(0, 300) });
      result.summaries.push(`⚠️ Tried to fill ${ws.name} but the AI returned nothing usable`);
    }
  }

  if (result.writes.length) emitChange('organisms');
  return result;
}

/**
 * Write one item as a draft and (when `publish`) promote it via the draft→publish convention
 * (validate against the schema, write .version.N + .latest, delete the draft) — identical semantics
 * to aimeat_workspace_write + _publish. Returns `{ writes, errors }`: on a schema rejection nothing is
 * written and `errors` carries the validation problems so the caller can feed them BACK to the model
 * for a correction round (the read→write→see-error→correct loop, not a one-shot drop). Free-markdown
 * document spaces carry no schema, so they always validate; record spaces validate against their schema.
 */
async function writeAndMaybePublish(
  storage: Storage, config: AimeatConfig, root: string, namespace: string, instanceId: string,
  value: Record<string, unknown>, publish: boolean, writerGaii: string,
): Promise<{ writes: string[]; errors: unknown | null }> {
  const base = `${root}.${namespace}.${instanceId}`;
  const draftKey = `${base}.draft`;
  const draftValid = await validateMemoryWrite(draftKey, value, storage);
  if (!draftValid.valid) return { writes: [], errors: draftValid.errors ?? 'schema rejected' };
  const now = new Date().toISOString();
  await storage.setMemory({ key: draftKey, ownerGaii: writerGaii, value, visibility: 'private', tags: ['secretary', 'authored'], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
  if (!publish) return { writes: [draftKey], errors: null };

  await storage.setMemory({ key: `${base}.version.1`, ownerGaii: writerGaii, value, visibility: 'private', tags: ['secretary', 'authored'], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
  await storage.setMemory({ key: `${base}.latest`, ownerGaii: writerGaii, value, visibility: 'private', tags: ['secretary', 'authored'], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
  await storage.deleteMemory(writerGaii, draftKey);
  return { writes: [`${base}.latest`, `${base}.version.1`], errors: null };
}
