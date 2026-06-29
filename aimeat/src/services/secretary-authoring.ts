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
    const recList = recTargets.map((o) => {
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
      + `Make every document genuinely useful and specific to this area — headings, substance, not a placeholder. Use the EXACT space names listed above. If a space truly has nothing to add, omit it.`;

    let reply: string;
    try {
      const completion = await completeForOwner(storage, config, owner, { prompt, systemPrompt, appId: opts.appId });
      result.morsels += 1;
      reply = completion.content;
    } catch {
      continue;   // a gated/failed completion for one workspace shouldn't sink the others
    }
    const parsed = extractJsonObject(reply);
    if (!parsed) continue;

    let docCount = 0; let recCount = 0;
    const docByName = new Map(docTargets.map((o) => [o.name as string, o]));
    const recByName = new Map(recTargets.map((o) => [o.name as string, o]));

    // Documents (priority).
    const documents = Array.isArray(parsed.documents) ? parsed.documents : [];
    for (const d of documents) {
      if (!d || typeof d !== 'object') continue;
      const dd = d as Record<string, unknown>;
      const ot = docByName.get(String(dd.space ?? '').trim());
      const title = String(dd.title ?? '').trim();
      const markdown = String(dd.markdown ?? '').trim();
      if (!ot || !ot.namespace || !title || !markdown) continue;
      const id = slugId(title, 'doc');
      const value = { id, title: title.slice(0, 200), markdown };
      const written = await writeAndMaybePublish(storage, config, root, ot.namespace, id, value, doPublish, writerGaii);
      if (written.length) { result.writes.push(...written); docCount++; }
    }

    // Records (secondary).
    const records = Array.isArray(parsed.records) ? parsed.records : [];
    for (const r of records) {
      if (!r || typeof r !== 'object') continue;
      const rr = r as Record<string, unknown>;
      const ot = recByName.get(String(rr.space ?? '').trim());
      const rec = rr.record;
      if (!ot || !ot.namespace || !rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
      const id = slugId(String((rec as Record<string, unknown>).title ?? (rec as Record<string, unknown>).name ?? ''), 'rec');
      const value = { ...(rec as Record<string, unknown>), id };
      const written = await writeAndMaybePublish(storage, config, root, ot.namespace, id, value, doPublish, writerGaii);
      if (written.length) { result.writes.push(...written); recCount++; }
    }

    if (docCount || recCount) {
      const parts: string[] = [];
      if (docCount) parts.push(`${docCount} document${docCount === 1 ? '' : 's'}`);
      if (recCount) parts.push(`${recCount} record${recCount === 1 ? '' : 's'}`);
      result.summaries.push(`🖊️ Authored ${parts.join(' + ')} into ${ws.name}${doPublish ? ' (published)' : ' (drafts for review)'}`);
    }
  }

  if (result.writes.length) emitChange('organisms');
  return result;
}

/**
 * Write one item as a draft and (when `publish`) promote it via the draft→publish convention
 * (validate against the .latest schema, write .version.N + .latest, delete the draft) — identical
 * semantics to aimeat_workspace_write + _publish. Returns the keys written (empty on a schema reject,
 * so a single bad item is skipped, not fatal). Free-markdown document spaces carry no schema, so they
 * always validate; record spaces are validated against their locked schema.
 */
async function writeAndMaybePublish(
  storage: Storage, config: AimeatConfig, root: string, namespace: string, instanceId: string,
  value: Record<string, unknown>, publish: boolean, writerGaii: string,
): Promise<string[]> {
  const base = `${root}.${namespace}.${instanceId}`;
  const draftKey = `${base}.draft`;
  const draftValid = await validateMemoryWrite(draftKey, value, storage);
  if (!draftValid.valid) return [];
  const now = new Date().toISOString();
  await storage.setMemory({ key: draftKey, ownerGaii: writerGaii, value, visibility: 'private', tags: ['secretary', 'authored'], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
  if (!publish) return [draftKey];

  const latestValid = await validateMemoryWrite(`${base}.latest`, value, storage);
  if (!latestValid.valid) return [draftKey];   // keep the draft; can't publish a schema-mismatched record
  await storage.setMemory({ key: `${base}.version.1`, ownerGaii: writerGaii, value, visibility: 'private', tags: ['secretary', 'authored'], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
  await storage.setMemory({ key: `${base}.latest`, ownerGaii: writerGaii, value, visibility: 'private', tags: ['secretary', 'authored'], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
  await storage.deleteMemory(writerGaii, draftKey);
  return [`${base}.latest`, `${base}.version.1`];
}
