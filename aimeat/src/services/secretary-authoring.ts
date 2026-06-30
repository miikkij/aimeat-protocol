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
 *   v0.6.0 — 2026-06-30 — Never-empty + document-first + agentic. The fill prompt now (1) stays scoped to ONE
 *     workspace (no cross-workspace bleed), (2) reframes DOCUMENTS as where the secretary THINKS — grounded
 *     reasoning/plans are wanted; "don't invent" forbids fabricating FACTS, not thinking — so a workspace
 *     gets a real document instead of staying blank, (3) drops the copy-able "a clear title" skeleton example
 *     and guards placeholder-echo titles/markdown on write, and (4) adds an opt-in `retryOnEmpty` (set by the
 *     user-initiated setup fill, off for the tick) that re-prompts ONCE when a workspace produced no usable
 *     document — covering a reply that didn't parse, mislabelled the space, or was a placeholder (a parse
 *     failure now flows into the retry instead of skipping it). writeDocs also accepts the document when
 *     there is exactly ONE document space and the model misspelled its name. Pairs with the frontend
 *     guaranteeing every workspace has a document space. Browser-verified end-to-end on owl-alpha/free.
 *   v0.5.0 — 2026-06-30 — Stop hallucinating: the fill is GROUNDED. Per workspace it queries Discovery
 *     (scope=own) for the owner's real material and feeds it as cited sources; the prompt now forbids
 *     inventing facts/data, makes DOCUMENTS the place for realistic grounded thinking (approaches/plans,
 *     mermaid where it helps) and RECORDS real-data-only (leave empty rather than invent an entry).
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
import { buildDiscoveryRegistry, runDiscovery, type DiscoveryContext } from './discovery/index.js';

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
  /** Re-prompt ONCE, more firmly, when a workspace parsed fine but produced no usable document — so the
   *  document "thinking home" never ends up blank. Set for the user-initiated setup fill; the autonomous
   *  tick leaves it off so tick economics are unchanged. Budget-gated like any other call. */
  retryOnEmpty?: boolean;
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

/** Reject a title/markdown that just echoes the prompt skeleton ("a clear title", a bare "<…>" placeholder,
 *  "title"/"otsikko"/"untitled") instead of real authored content — a weak model copies the example verbatim. */
function isPlaceholderEcho(s: string): boolean {
  const t = String(s || '').trim();
  return !t || /^<[^>]*>$/.test(t) || /^(a clear title|title|otsikko|untitled)$/i.test(t);
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

  // Discovery registry — the same cross-domain search the owner's "Discover" surface uses. We query it
  // per workspace so the authoring is GROUNDED in real things (the owner's own organisms/workspaces/agents/
  // knowledge), not invented from thin air. Best-effort: if it returns nothing, we just author less.
  const discRegistry = buildDiscoveryRegistry(storage, config);

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

    // GROUNDING: query Discovery (scope=own) for the owner's REAL material relevant to this workspace, so
    // the model writes from what actually exists rather than hallucinating. These are the cited sources.
    let groundBlock = '';
    try {
      const q = [ws.name, readme.slice(0, 120), strat?.target || ''].filter(Boolean).join(' ').slice(0, 200);
      const discCtx: DiscoveryContext = {
        caller: { ownerName, sub: ownerName, gaii: owner, isOwnerSession: true, scopes: [] },
        scope: 'own', filters: { q, limit: 12 }, nodeId: config.nodeId,
      };
      const entries = (await runDiscovery(discRegistry, discCtx)).slice(0, 12);
      if (entries.length) {
        groundBlock = `\n\nReal things that EXIST in ${ownerName}'s world, found via Discovery — these are your SOURCES. Ground your content in them and cite them by title; do not duplicate or reinvent what is already here:\n`
          + entries.map((e) => `- [${e.type}] ${e.title}${e.description ? ' — ' + String(e.description).replace(/\s+/g, ' ').slice(0, 160) : ''}`).join('\n');
      }
    } catch { /* discovery is best-effort grounding */ }

    const systemPrompt = `You are ${ownerName}'s personal Secretary, working autonomously (the owner is not present) in the "${active.name || 'personal'}" context. ${active.brain?.purpose || ''}\n\n`
      + `GROUNDING RULES — follow them strictly:\n`
      + `1. Stay INSIDE this one workspace's purpose. Write only what belongs to THIS workspace; if some material clearly belongs to a different area, leave it out here — never pull other workspaces' topics into this one.\n`
      + `2. DOCUMENTS are where you THINK, and thinking is the whole point: write the realistic approach, plan or analysis for THIS area (e.g. how to approach this area's marketing) — your own reasoning and proposals are WELCOME. "Do not invent" means do NOT fabricate FACTS, data, names, numbers, dates or events; it does NOT mean stay silent. Reason from the strategy, this workspace's purpose and the Discovery sources, and flag anything you are assuming AS an assumption ("Oletus: …"). ${opts.useGeneralKnowledge ? 'You may bring general know-how to reason well.' : 'Stick to the owner\'s own material.'}\n`
      + `3. RECORDS are real DATA only. NEVER invent record entries. Fill a records space only with concrete, real items grounded in the material above; if there is no real data for it, return NO records for that space — that is fine, the document carries the thinking.\n`
      + `Write in the owner's language. Return ONLY a JSON object — no prose around it.`;
    const prompt = `Workspace: "${ws.name}"${readme ? `\nWorkspace intro:\n${readme.slice(0, 1200)}` : ''}\n${strategyBlock}\n\nOpen goals:\n${goalLines}${groundBlock}\n\n`
      + `Write a substantial, grounded thinking document for EACH document space below — this is the IMPORTANT part: real analysis/plan/approach specific to THIS workspace's area, useful and concrete, never a placeholder. DOCUMENT spaces:\n${docList}\n\n`
      + `RECORD spaces (structured data — fill ONLY with real, grounded entries; if you have no real data, leave the records array empty for that space — do NOT invent):\n${recList}\n\n`
      + `Return a JSON object in EXACTLY this shape, replacing every <…> with real content (do NOT copy the angle-bracket text itself):\n`
      + `{\n  "documents": [ { "space": "<one of the exact document space names above>", "title": "<a specific, descriptive title for this document>", "markdown": "<the document body, in markdown>" } ],\n`
      + `  "records": [ { "space": "<one of the exact record space names above>", "record": { "<field>": "<value>" } } ]\n}\n`
      + `Fill DOCUMENTS richly and well; leave a records space empty rather than inventing entries. Use the EXACT space names above. `
      + 'A document MAY include a ```mermaid fenced block (it renders as a real chart) — but JUDICIOUSLY, only where a flow, sequence, timeline or relationship genuinely clarifies; most documents need none.';

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
    // Parse the reply (tolerant of fences/prose). A parse failure is NOT fatal here: it flows into the
    // retry-on-empty below (docCount stays 0) so the document thinking-home still gets a shot, instead of
    // the workspace silently vanishing — a flaky model returning not-quite-JSON is the most common failure.
    const parsed = extractJsonObject(reply);
    if (!parsed) logger.warn('Secretary authoring: reply did not parse as JSON', { ws: ws.name, head: reply.slice(0, 300) });

    let recCount = 0;
    const docByName = new Map(docTargets.map((o) => [o.name as string, o]));
    const recByName = new Map(recTargets.map((o) => [o.name as string, o]));

    // Documents (priority — free markdown, no schema to fight). Skip any whose title/markdown just echoes
    // the prompt skeleton (e.g. "a clear title", a bare "<…>"). When there is exactly ONE document space,
    // accept the model's document even if it mislabelled the space name (flaky models misspell it).
    const writeDocs = async (documents: unknown): Promise<number> => {
      let n = 0;
      for (const d of (Array.isArray(documents) ? documents : [])) {
        if (!d || typeof d !== 'object') continue;
        const dd = d as Record<string, unknown>;
        let ot = docByName.get(String(dd.space ?? '').trim());
        if (!ot && docTargets.length === 1) ot = docTargets[0];
        const title = String(dd.title ?? '').trim();
        const markdown = String(dd.markdown ?? '').trim();
        if (!ot || !ot.namespace || !title || !markdown || isPlaceholderEcho(title) || /^<[^>]*>$/.test(markdown)) continue;
        const id = slugId(title, 'doc');
        const res = await writeAndMaybePublish(storage, config, root, ot.namespace, id, { id, title: title.slice(0, 200), markdown }, doPublish, writerGaii);
        if (res.writes.length) { result.writes.push(...res.writes); n++; }
      }
      return n;
    };
    let docCount = parsed ? await writeDocs(parsed.documents) : 0;

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
    let pending = parsed ? toPending(parsed.records) : [];
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

    // Retry-on-empty (agentic, setup only): the document space is the guaranteed thinking-home — if the model
    // produced no usable document (whether the reply didn't parse, mislabelled the space, or was a
    // placeholder), re-prompt ONCE, more firmly, before giving up, instead of leaving the workspace blank.
    // Records legitimately empty is fine and does not trigger this. Budget-gated.
    if (opts.retryOnEmpty && docCount === 0 && docTargets.length
        && (opts.budgetRemaining === null || result.morsels < opts.budgetRemaining)) {
      const retryPrompt = prompt
        + `\n\nIMPORTANT: your previous answer ${parsed ? 'produced no usable document' : 'was not valid JSON'}. Return ONLY one valid JSON object — no prose before or after it, and every string properly escaped — in the EXACT shape shown above, containing at least one substantial document for a document space named above: a specific title (never "a clear title" or any "<…>" placeholder) and a multi-paragraph markdown body of real analysis/plan for "${ws.name}".`;
      try {
        const retry = await completeWithRetry(runComplete, { prompt: retryPrompt, systemPrompt, appId: opts.appId }, opts.maxRetries ?? 0, `${ws.name} (retry-on-empty)`);
        result.morsels += 1;
        docCount += await writeDocs(extractJsonObject(retry.content)?.documents);
      } catch (e) { logger.warn('Secretary authoring: retry-on-empty failed', { ws: ws.name, error: (e as Error)?.message }); }
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
