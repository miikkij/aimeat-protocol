/**
 * @file living.js
 * @description Living Documents client service (Phase 0 — no pulse yet). A living document is a
 *   workspace-backed markdown document ASSEMBLED from memory keys. Two surfaces:
 *     - Templates (personal, owner memory `living.template.{id}`): reusable charter+template
 *       skeletons authored/managed in the profile Living Documents tab.
 *     - Instances (workspace-backed): a template DEPLOYED into a workspace, which then accrues
 *       content per slot and renders as markdown. Each instance config snapshots templateId+version.
 *   Phase 0 is client-orchestrated over the generic memory/organism APIs (no-SSR): template CRUD,
 *   deploy, manual add-source / derive-slot, assemble + render. The pulse (workflow), AI authoring,
 *   per-slot versioning and the marketplace come in later phases — see
 *   docs/plans/2026-06-21-living-documents-plan.md.
 * @structure
 *   - templates: listTemplates / getTemplate / saveTemplate / deleteTemplate / blankTemplate
 *   - deploy: deployTemplate(template, orgId, wsId)
 *   - instances: listInstances / readInstance / addSource / deriveSlotFromSources / setSlotContent
 *   - render: renderInstanceMarkdown(instance)
 * @version-history
 *   v1.0.0 — 2026-06-21 — Phase 0: templates + deploy + manual derive + assemble/render.
 */
import { api } from '/js/api.js';
import { createMemory, getMemory, listMemories, deleteMemory, librarianSearch } from '/js/services/memory.js';
import { wsRoot, saveManifest } from '/js/services/organisms.js';
import * as offersService from '/js/services/offers.js';
import { getTask } from '/js/services/agent-tasks.js';

const TEMPLATE_PREFIX = 'living.template.';
const SCHEMA = 'schema:living-document@1';

function rid(prefix) {
  const r = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return prefix + r;
}

// ── Templates (personal, owner memory) ──

/** A fresh, editable template skeleton. */
export function blankTemplate() {
  return {
    id: rid('lt-'),
    title: '',
    description: '',
    visibility: 'private',            // forward-compat: org/public when the marketplace lands
    charter: { scope: '', cadence: 'daily', trust: { derive: 'auto' } },
    template: [
      { section: 'Overview', desc: 'A short, current summary of the topic.', slot: 'overview', kind: 'derived', rules: { max_words: 150 } },
    ],
    version: 1,
  };
}

export async function listTemplates() {
  const all = await listMemories();
  return (Array.isArray(all) ? all : [])
    .filter(m => typeof m.key === 'string' && m.key.startsWith(TEMPLATE_PREFIX))
    .map(m => m.value)
    .filter(v => v && typeof v === 'object')
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
}

export async function getTemplate(id) {
  const r = await getMemory(TEMPLATE_PREFIX + id);
  return r?.data?.value || null;
}

export async function saveTemplate(tpl) {
  const next = { ...tpl, updatedAt: new Date().toISOString() };
  if (!next.createdAt) next.createdAt = next.updatedAt;
  const resp = await createMemory(TEMPLATE_PREFIX + next.id, next, 'private');
  if (resp?.ok === false) throw new Error(resp.error?.message || 'Could not save template');
  return next;
}

export async function deleteTemplate(id) {
  return deleteMemory(TEMPLATE_PREFIX + id);
}

/** AI-author a template from a plain-language need (POST /v1/living/author). `catalogue` grounds the
 *  agent suggestions. Slow AI call — full timeout, no retry. Returns { template, model }. */
export async function authorTemplate(need, catalogue) {
  const resp = await api('/v1/living/author', {
    method: 'POST',
    body: JSON.stringify({ need, catalogue: Array.isArray(catalogue) ? catalogue : [] }),
    timeoutMs: 1_800_000,
    retries: 0,
  });
  if (resp?.ok === false) { const e = new Error(resp.error?.message || 'Author failed'); e.code = resp.error?.code; throw e; }
  return resp?.data || null;
}

function yamlScalar(v) { const s = String(v); return (s === '' || /[:#]/.test(s)) ? JSON.stringify(s) : s; }

/** Minimal display-only YAML for the charter object (the "technical" view). Not a full serializer —
 *  it covers the bounded charter shape (strings, string arrays, nested objects). */
export function charterToYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  const lines = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (Array.isArray(v)) {
      if (!v.length) { lines.push(`${pad}${k}: []`); continue; }
      lines.push(`${pad}${k}:`);
      for (const it of v) {
        if (it && typeof it === 'object') { lines.push(`${pad}  -`); lines.push(charterToYaml(it, indent + 2)); }
        else lines.push(`${pad}  - ${yamlScalar(it)}`);
      }
    } else if (v && typeof v === 'object') {
      lines.push(`${pad}${k}:`);
      lines.push(charterToYaml(v, indent + 1));
    } else {
      lines.push(`${pad}${k}: ${yamlScalar(v)}`);
    }
  }
  return lines.join('\n');
}

// ── Keys for a deployed instance (workspace-backed) ──

const configKey = (loc) => `${wsRoot(loc.orgId, loc.wsId)}.living.${loc.docId}.latest`;
const slotKey = (loc, slotId) => `${wsRoot(loc.orgId, loc.wsId)}.living-slot.${loc.docId}__${slotId}.latest`;
const pendingKey = (loc, slotId) => `${wsRoot(loc.orgId, loc.wsId)}.living-pending.${loc.docId}__${slotId}.latest`;
const histKey = (loc, slotId) => `${wsRoot(loc.orgId, loc.wsId)}.living-hist.${loc.docId}__${slotId}.latest`;
const pagesKey = (loc, docId) => `${wsRoot(loc.orgId, loc.wsId)}.pages.${docId}.latest`;
const srcKey = (loc, srcId) => `${wsRoot(loc.orgId, loc.wsId)}.living-src.${loc.docId}__${srcId}.latest`;
const HIST_CAP = 20;

/** The objectTypes a workspace needs to host living documents (merged into its manifest on deploy). */
function livingObjectTypes() {
  return [
    { name: 'Living', namespace: 'living', schemaRef: SCHEMA, mode: 'document', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true },
    { name: 'Living Sources', namespace: 'living-src', schemaRef: 'schema:living-source@1', mode: 'records', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: false },
    { name: 'Living Slots', namespace: 'living-slot', schemaRef: 'schema:living-slot@1', mode: 'document', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true },
    { name: 'Living Ledger', namespace: 'living-ledger', schemaRef: 'schema:living-ledger@1', mode: 'records', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: false },
    { name: 'Living Pending', namespace: 'living-pending', schemaRef: 'schema:living-slot@1', mode: 'document', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: false },
    { name: 'Living History', namespace: 'living-hist', schemaRef: 'schema:living-hist@1', mode: 'document', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: false },
    { name: 'Pages', namespace: 'pages', schemaRef: 'schema:document@1', mode: 'document', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true },
  ];
}

/** Public: ensure a workspace's manifest has the living object types (used by deploy + pulse). */
export async function ensureLivingTypes(orgId, wsId) { return ensureLivingManifest(orgId, wsId); }

async function ensureLivingManifest(orgId, wsId) {
  let manifest = null;
  try { manifest = (await getMemory(`${wsRoot(orgId, wsId)}.meta.manifest`))?.data?.value || null; } catch { /* none */ }
  const base = manifest || { manifestVersion: '1.0', id: orgId, name: 'Workspace', kind: 'project', status: 'active', objectTypes: [] };
  const have = new Set((base.objectTypes || []).map(o => o.namespace));
  const merged = [...(base.objectTypes || []), ...livingObjectTypes().filter(o => !have.has(o.namespace))];
  if (merged.length !== (base.objectTypes || []).length || !manifest) {
    await saveManifest(orgId, wsId, { ...base, objectTypes: merged });
  }
}

// ── Deploy a template into a workspace ──

/**
 * Deploy a template into an existing workspace, creating a living instance.
 * @returns {Promise<{orgId:string, wsId:string, docId:string}>}
 */
export async function deployTemplate(template, orgId, wsId) {
  if (!orgId || !wsId) throw new Error('Pick a workspace to deploy into');
  await ensureLivingManifest(orgId, wsId);
  const loc = { orgId, wsId, docId: rid('ld-') };
  const config = {
    id: loc.docId,
    type: 'living-config',
    templateId: template.id,
    templateVersion: template.version || 1,
    title: template.title || 'Living document',
    charter: template.charter || {},
    template: template.template || [],
    status: { version: 1, last_pulse: null, health: 'new', paused: false, cost: 0 },
    createdAt: new Date().toISOString(),
  };
  const resp = await createMemory(configKey(loc), config, 'private');
  if (resp?.ok === false) throw new Error(resp.error?.message || 'Could not deploy');
  return loc;
}

// ── Instances ──

/** Parse a living config key → loc, or null. e.g. organism.{org}.w.{ws}.living.{docId}.latest */
function parseConfigKey(key) {
  const m = /^organism\.(.+?)\.w\.(.+?)\.living\.([^.]+)\.latest$/.exec(key);
  return m ? { orgId: m[1], wsId: m[2], docId: m[3] } : null;
}

/** Every living instance across all the owner's workspaces (for the profile tab list). */
export async function listInstances() {
  const all = await listMemories();
  const out = [];
  for (const m of (Array.isArray(all) ? all : [])) {
    const loc = typeof m.key === 'string' ? parseConfigKey(m.key) : null;
    if (loc && m.value && m.value.type === 'living-config') out.push({ loc, config: m.value, updatedAt: m.updated_at || m.created_at });
  }
  return out.sort((a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0));
}

/** Read one instance: config + its sources + slot derivations, keyed by slotId. */
export async function readInstance(orgId, wsId, docId) {
  const loc = { orgId, wsId, docId };
  const all = await listMemories();
  const items = Array.isArray(all) ? all : [];
  const config = items.find(m => m.key === configKey(loc))?.value || null;
  if (!config) return null;
  const slotPrefix = `${wsRoot(orgId, wsId)}.living-slot.${docId}__`;
  const pendingPrefix = `${wsRoot(orgId, wsId)}.living-pending.${docId}__`;
  const histPrefix = `${wsRoot(orgId, wsId)}.living-hist.${docId}__`;
  const srcPrefix = `${wsRoot(orgId, wsId)}.living-src.${docId}__`;
  const slots = {};
  const pending = {};
  const history = {};
  const sources = [];
  for (const m of items) {
    if (typeof m.key !== 'string') continue;
    if (m.key.startsWith(histPrefix) && m.value) history[m.value.slot] = m.value.versions || [];
    else if (m.key.startsWith(pendingPrefix) && m.value) pending[m.value.slot] = m.value;
    else if (m.key.startsWith(slotPrefix) && m.value) slots[m.value.slot] = m.value;
    else if (m.key.startsWith(srcPrefix) && m.value) sources.push(m.value);
  }
  return { loc, config, slots, pending, history, sources };
}

/** Add a raw source to a slot. `data` (optional {label?, value}) feeds aggregate-slot charts. */
export async function addSource(loc, slotId, src) {
  const { text = '', origin = '', producer = 'manual', data = null } = src || {};
  const id = rid('s-');
  const value = { id, slot: slotId, text, origin, producer, data, active: true, addedAt: new Date().toISOString() };
  const resp = await createMemory(srcKey(loc, id), value, 'private');
  if (resp?.ok === false) throw new Error(resp.error?.message || 'Could not add source');
  return value;
}

/** Approve a pending (gated) delta: promote it to the live derivation and clear the pending entry. */
export async function approvePending(loc, slotId, pendingValue) {
  await setSlotContent(loc, slotId, pendingValue?.markdown || '', pendingValue?.derivedFrom || []);
  await deleteMemory(pendingKey(loc, slotId)).catch(() => {});
}

/** Reject a pending (gated) delta: discard it. */
export async function rejectPending(loc, slotId) {
  await deleteMemory(pendingKey(loc, slotId)).catch(() => {});
}

/**
 * Freeze a personalized snapshot: compose the chosen per-section versions (or the current ones) into a
 * static markdown document saved to the workspace's normal `pages` space (a plain, non-living doc).
 * @param {object} selection  { [slotId]: versionEntry } picked from the timeline; missing → current.
 */
export async function saveSnapshot(loc, config, selection) {
  const inst = await readInstance(loc.orgId, loc.wsId, loc.docId);
  const parts = [`# ${config.title || 'Living document'} — snapshot`];
  if (config.charter?.scope) parts.push('', `_${config.charter.scope}_`);
  for (const sec of (config.template || [])) {
    parts.push('', `## ${sec.section || sec.slot}`);
    const chosen = selection?.[sec.slot];
    const md = (chosen?.markdown) ?? (inst.slots[sec.slot]?.markdown) ?? '_empty_';
    parts.push('', md);
  }
  const markdown = parts.join('\n');
  const docId = rid('snap-');
  await ensureLivingManifest(loc.orgId, loc.wsId);   // also ensures the 'pages' objectType
  const resp = await createMemory(pagesKey(loc, docId), { id: docId, title: `${config.title || 'Living'} — snapshot`, markdown }, 'private');
  if (resp?.ok === false) throw new Error(resp.error?.message || 'Could not save snapshot');
  return { docId, markdown };
}

/** Append a version to a slot's capped history (newest first). Best-effort. */
async function appendHistory(loc, slotId, entry) {
  try {
    const cur = (await getMemory(histKey(loc, slotId)))?.data?.value;
    const versions = [entry, ...((cur?.versions) || [])].slice(0, HIST_CAP);
    await createMemory(histKey(loc, slotId), { slot: slotId, versions }, 'private');
  } catch { /* history is best-effort */ }
}

/** Write a slot derivation directly (manual content or an applied delta) + record a history version. */
export async function setSlotContent(loc, slotId, markdown, derivedFrom, producedBy) {
  const producedAt = new Date().toISOString();
  const value = { slot: slotId, version: 1, markdown: markdown || '', derivedFrom: derivedFrom || [], producedAt, producedBy: producedBy || 'human' };
  const resp = await createMemory(slotKey(loc, slotId), value, 'private');
  if (resp?.ok === false) throw new Error(resp.error?.message || 'Could not set slot content');
  await appendHistory(loc, slotId, { markdown: value.markdown, producedAt, producedBy: value.producedBy, derivedFrom: value.derivedFrom });
  return value;
}

/** Phase 0 "derive": compose a slot's active sources into its markdown (a bullet list, with origins).
 *  The real pulse (Phase 2) replaces this with an AI refinement step; the interface stays the same. */
export async function deriveSlotFromSources(loc, slotId, sources) {
  const active = (sources || []).filter(s => s.slot === slotId && s.active !== false);
  const md = active.length
    ? active.map(s => `- ${s.text}${s.origin ? ` 〔${s.origin}〕` : ''}`).join('\n')
    : '_No sources yet._';
  return setSlotContent(loc, slotId, md, active.map(s => s.id));
}

// ── Ledger ──

const ledgerKey = (loc, ts) => `${wsRoot(loc.orgId, loc.wsId)}.living-ledger.${loc.docId}__${ts}.latest`;

async function addLedger(loc, event) {
  const ts = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  try { await createMemory(ledgerKey(loc, ts), { ...event, at: new Date().toISOString() }, 'private'); } catch { /* best-effort */ }
}

/** Recent ledger events for an instance, newest first. */
export async function listLedger(orgId, wsId, docId, limit = 20) {
  const all = await listMemories();
  const prefix = `${wsRoot(orgId, wsId)}.living-ledger.${docId}__`;
  return (Array.isArray(all) ? all : [])
    .filter(m => typeof m.key === 'string' && m.key.startsWith(prefix) && m.value)
    .map(m => m.value)
    .sort((a, b) => +new Date(b.at || 0) - +new Date(a.at || 0))
    .slice(0, limit);
}

// ── Pulse: refresh each slot (gather → re-derive), record ledger + cost + last_pulse ──

const PULSE_AI_TIMEOUT_MS = 1_800_000;
const DELEGATE_TIMEOUT_MS = 900_000;

/** Await a dispatched agent task to a terminal state (resolves the task on done; throws otherwise). */
function awaitTask(agentName, taskId, onStatus) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + DELEGATE_TIMEOUT_MS;
    let settled = false;
    const cleanup = () => { clearInterval(timer); window.removeEventListener('aimeat-live-update', onLive); };
    async function check() {
      if (settled) return;
      let task = null;
      try { const r = await getTask(agentName, taskId); task = r?.data?.task || r?.data || null; } catch { /* transient */ }
      const st = task?.status;
      if (st) onStatus?.(st);
      if (st === 'done') { settled = true; cleanup(); resolve(task); return; }
      if (st === 'failed' || st === 'stalled') { settled = true; cleanup(); reject(new Error('agent ' + st)); return; }
      if (Date.now() > deadline) { settled = true; cleanup(); reject(new Error('TIMEOUT')); }
    }
    const onLive = (e) => { const d = e.detail?.domains; if (d && !d.has('agent-tasks')) return; check(); };
    const timer = setInterval(check, 5000);
    window.addEventListener('aimeat-live-update', onLive);
    check();
  });
}

/** One AI completion via the owner's key (budget-enforced). Returns { content, costUsd }. */
async function aiRefine(prompt, systemPrompt) {
  const resp = await api('/v1/ai/complete', {
    method: 'POST',
    body: JSON.stringify({ prompt, systemPrompt, app_id: 'living' }),
    timeoutMs: PULSE_AI_TIMEOUT_MS, retries: 0,
  });
  if (resp?.ok === false) { const e = new Error(resp.error?.message || 'AI failed'); e.code = resp.error?.code; throw e; }
  return { content: resp?.data?.content || '', costUsd: resp?.data?.usage?.cost_usd || 0 };
}

const DERIVE_SYSTEM =
  'You maintain ONE section of a living document. Rewrite the section so it is current, concise and well-organized, using ONLY the sources provided. Keep strictly to the section scope. Output clean markdown only — no preamble. Cite sources inline as 〔origin〕 where useful. Do not invent facts beyond the sources.';

/** Resolve a slot's assigned agent offer from the live feed. slot.agent is "agentName/offerId". */
function resolveSlotAgent(offersFeed, agentRef) {
  if (!agentRef) return null;
  const [agentName, offerId] = String(agentRef).split('/');
  const agents = offersFeed?.data?.agents || [];
  const entry = agents.find(a => a.agent === agentName);
  const offer = entry?.offers?.find(o => o.id === offerId);
  return entry && offer ? { entry, offer } : null;
}

/**
 * Pulse one living instance: for each slot, gather fresh material (delegate to its agent, or search
 * the owner's own material via the librarian), then AI re-derive the slot from its active sources.
 * Records a ledger entry per slot and updates status (version, last_pulse, cost). Client-orchestrated;
 * `onStatus(slotId, phase)` reports progress. Returns a summary.
 * @param {{ onStatus?: (slotId: string, phase: string) => void }} [opts]
 */
export async function pulseInstance(orgId, wsId, docId, opts = {}) {
  const { onStatus } = opts;
  const loc = { orgId, wsId, docId };
  await ensureLivingManifest(orgId, wsId);
  const inst = await readInstance(orgId, wsId, docId);
  if (!inst) throw new Error('Instance not found');
  const gated = inst.config.charter?.trust?.derive === 'gated';
  const offersFeed = await offersService.listOffers().catch(() => null);

  let costUsd = 0;
  const results = [];
  for (const sec of (inst.config.template || [])) {
    const slotId = sec.slot;
    let gathered = 0;
    // 1. Gather
    try {
      const bound = resolveSlotAgent(offersFeed, sec.agent);
      if (bound) {
        onStatus?.(slotId, 'delegating');
        const query = `${sec.section}. ${sec.desc || ''} Context: ${inst.config.charter?.scope || ''}`.trim();
        const dispatch = await offersService.ask(bound.entry, bound.offer, query);
        if (dispatch.kind === 'task' && dispatch.taskId) {
          onStatus?.(slotId, 'waiting');
          const task = await awaitTask(bound.entry.agent, dispatch.taskId, (s) => onStatus?.(slotId, s));
          const content = await offersService.getDeliverableContent({ agentGaii: bound.entry.gaii, deliverableKey: task?.deliverableKey || task?.deliverable_key, taskId: dispatch.taskId });
          if (content) { await addSource(loc, slotId, { text: content, origin: task?.deliverableKey || ('task:' + dispatch.taskId), producer: bound.entry.gaii }); gathered++; }
        }
      } else {
        onStatus?.(slotId, 'searching');
        const hits = await librarianSearch(`${sec.section} ${inst.config.charter?.scope || ''}`.trim(), 5, 'own').catch(() => []);
        const existingOrigins = new Set(inst.sources.filter(s => s.slot === slotId).map(s => s.origin));
        for (const h of hits) {
          if (existingOrigins.has(h.key)) continue;
          await addSource(loc, slotId, { text: h.snippet || h.title || h.key, origin: h.key, producer: h.producer });
          gathered++;
        }
      }
    } catch (e) {
      await addLedger(loc, { event: 'gather-failed', slot: slotId, error: String(e.message || e) });
    }

    // 2. Re-derive from active sources
    const fresh = await readInstance(orgId, wsId, docId);
    const active = (fresh?.sources || []).filter(s => s.slot === slotId && s.active !== false);
    if (active.length) {
      try {
        onStatus?.(slotId, 'deriving');
        const srcList = active.map(s => `- ${s.text}${s.origin ? ` 〔${s.origin}〕` : ''}`).join('\n');
        const prompt = `Section: ${sec.section}\nScope: ${sec.desc || ''}\nDocument scope: ${inst.config.charter?.scope || ''}\n\nSources:\n${srcList}\n\nWrite the section.`;
        const { content, costUsd: c } = await aiRefine(prompt, DERIVE_SYSTEM);
        costUsd += c;
        if (gated) {
          await createMemory(pendingKey(loc, slotId), { slot: slotId, markdown: content.trim(), derivedFrom: active.map(s => s.id), producedAt: new Date().toISOString(), producedBy: 'pulse', pending: true }, 'private');
          await addLedger(loc, { event: 'pending', slot: slotId, sources: active.length, gathered });
        } else {
          await setSlotContent(loc, slotId, content.trim(), active.map(s => s.id), 'pulse');
          await addLedger(loc, { event: 'slot-derived', slot: slotId, sources: active.length, gathered });
        }
        results.push({ slot: slotId, ok: true, gathered, gated });
      } catch (e) {
        await addLedger(loc, { event: 'derive-failed', slot: slotId, error: String(e.message || e) });
        results.push({ slot: slotId, ok: false });
      }
    } else {
      results.push({ slot: slotId, ok: true, gathered: 0, empty: true });
    }
    onStatus?.(slotId, 'done');
  }

  // 3. Update status
  const cfg = inst.config;
  const status = { ...(cfg.status || {}), version: (cfg.status?.version || 1) + 1, last_pulse: new Date().toISOString(), health: 'green', cost: Number(((cfg.status?.cost || 0) + costUsd).toFixed(4)) };
  await createMemory(configKey(loc), { ...cfg, status }, 'private');
  await addLedger(loc, { event: 'pulse', slots: results.length, costUsd: Number(costUsd.toFixed(4)) });
  return { results, costUsd, status };
}

// ── Instance config controls (pause / cadence) + server pulse-due ──

async function saveInstanceConfig(loc, cfg) {
  const resp = await createMemory(configKey(loc), cfg, 'private');
  if (resp?.ok === false) throw new Error(resp.error?.message || 'Could not save');
  return cfg;
}

/** Pause/resume an instance's unattended pulse (cost control). */
export async function setPaused(loc, cfg, paused) {
  return saveInstanceConfig(loc, { ...cfg, status: { ...(cfg.status || {}), paused } });
}

/** Set the charter cadence ('hourly' | 'daily' | 'weekly', or a numeric cadence_minutes). */
export async function setCadence(loc, cfg, cadence) {
  return saveInstanceConfig(loc, { ...cfg, charter: { ...(cfg.charter || {}), cadence } });
}

/** Trigger the server-side unattended pulse for the owner's own DUE instances now (the same logic the
 *  scheduler runs across all owners — exposed for on-demand refresh + testing). */
export async function pulseDueServer() {
  const resp = await api('/v1/living/pulse-due', { method: 'POST', body: '{}', timeoutMs: 1_800_000, retries: 0 });
  if (resp?.ok === false) { const e = new Error(resp.error?.message || 'Pulse failed'); e.code = resp.error?.code; throw e; }
  return resp?.data || {};
}

/** Numeric data points for an aggregate slot (oldest→newest): from each source's `data.value`, else a
 *  number parsed from its text. Used to render a chart + table. */
export function aggregateData(sources, slotId) {
  return (sources || [])
    .filter(s => s.slot === slotId && s.active !== false)
    .map(s => {
      const value = Number(s.data?.value ?? parseFloat(String(s.text).replace(/[^0-9.\-]/g, '')));
      const label = s.data?.label || String(s.text || '').split(':')[0]?.slice(0, 16) || '';
      return { label, value, at: s.addedAt };
    })
    .filter(d => Number.isFinite(d.value))
    .sort((a, b) => +new Date(a.at || 0) - +new Date(b.at || 0));
}

// ── Render ──

/** Assemble the instance into markdown by walking the template and dropping in each slot's content. */
export function renderInstanceMarkdown(instance) {
  if (!instance?.config) return '';
  const { config, slots = {} } = instance;
  const parts = [`# ${config.title || 'Living document'}`];
  if (config.charter?.scope) parts.push('', `_${config.charter.scope}_`);
  for (const sec of (config.template || [])) {
    parts.push('', `## ${sec.section || sec.slot}`);
    const der = slots[sec.slot];
    parts.push('', der?.markdown ? der.markdown : '_empty_');
  }
  return parts.join('\n');
}
