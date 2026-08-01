/**
 * @file living-pulse.ts
 * @description Living Documents — SERVER-SIDE unattended pulse (Phase 3). The client "Pulse now"
 *   (living.js) handles the full pulse incl. agent delegation while the page is open; this runs the
 *   self-fulfilled path UNATTENDED on a schedule: for each due instance, per non-agent section it
 *   gathers from the owner's own material (librarian) and AI re-derives via the owner's key
 *   (completeForOwner), writing a versioned derivation + change ledger + cost/last_pulse. Agent-backed
 *   sections are left to the client/manual pulse for now (cross-owner async agent fills + billing are a
 *   later phase). Guards: paused, retired, and the charter cadence. See
 *   docs/plans/2026-06-21-living-documents-plan.md.
 * @structure
 *   - scanAllDue(storage, config) — scheduler entrypoint: pulse every due instance across all owners
 *   - scanOwnerDue(storage, config, ownerGaii) — pulse the owner's own due instances (manual trigger)
 *   - pulseInstanceServer(storage, config, ownerGaii, loc, cfg) — one instance, self-fulfilled
 * @version-history
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 4: a derived section carries the provenance record the
 *     completion already minted. A living document derives itself on a cadence with nobody present,
 *     which is exactly the case where the origin has to be recorded rather than remembered.
 *   v1.0.0 — 2026-06-21 — Phase 3: unattended self-fulfilled pulse + cadence/guards.
 */
import { randomUUID } from 'node:crypto';
import type { Storage, MemoryRecord, AgentTaskRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { completeForOwner, AiCompletionError } from './ai-completion.js';
import { librarianSearch } from './librarian.js';
import type { PushService } from './push.js';
import type { EmailService } from './email.js';

/** Optional notify services for stop/retire alerts (web-push + email). The in-UI retired badge + ledger
 *  are written regardless; these are the extra out-of-app nudges. */
export interface LivingNotify { push?: PushService; email?: EmailService }

interface Loc { orgId: string; wsId: string; docId: string }
const CONFIG_RE = /^organism\.(.+?)\.w\.(.+?)\.living\.([^.]+)\.latest$/;
const MAX_PER_SCAN = 25;           // safety cap per scheduler tick
const DERIVE_SYSTEM =
  'You maintain ONE section of a living document. Rewrite the section so it is current, concise and well-organized, using ONLY the sources provided. Keep strictly to the section scope. Output clean markdown only — no preamble. Cite sources inline as 〔origin〕 where useful. Do not invent facts beyond the sources.';

const wsRoot = (l: Loc) => `organism.${l.orgId}.w.${l.wsId}`;
const slotKey = (l: Loc, slot: string) => `${wsRoot(l)}.living-slot.${l.docId}__${slot}.latest`;
const pendingKey = (l: Loc, slot: string) => `${wsRoot(l)}.living-pending.${l.docId}__${slot}.latest`;
const histKey = (l: Loc, slot: string) => `${wsRoot(l)}.living-hist.${l.docId}__${slot}.latest`;
const taskStateKey = (l: Loc, slot: string) => `${wsRoot(l)}.living-task.${l.docId}__${slot}.latest`;
const HIST_CAP = 20;

/** Append a version to a slot's capped history (newest first). Best-effort. */
async function appendHistory(storage: Storage, ownerGaii: string, loc: Loc, slot: string, entry: Record<string, unknown>): Promise<void> {
  try {
    const cur = await storage.getMemory(ownerGaii, histKey(loc, slot));
    const prev = ((cur?.value as { versions?: unknown[] })?.versions) || [];
    await upsert(storage, ownerGaii, histKey(loc, slot), { slot, versions: [entry, ...prev].slice(0, HIST_CAP) });
  } catch (err) { logger.warn('prev: history best-effort', { error: String(err) }); }
}
const srcKey = (l: Loc, id: string) => `${wsRoot(l)}.living-src.${l.docId}__${id}.latest`;
const ledgerKey = (l: Loc) => `${wsRoot(l)}.living-ledger.${l.docId}__${Date.now()}-${Math.random().toString(36).slice(2, 6)}.latest`;
const configKey = (l: Loc) => `${wsRoot(l)}.living.${l.docId}.latest`;

async function upsert(
  storage: Storage, ownerGaii: string, key: string, value: unknown, aiProvenanceId?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await storage.getMemory(ownerGaii, key);
  await storage.setMemory({
    key, ownerGaii, value, visibility: 'private', tags: [],
    // TARGET-058. Attached, never inherited from `existing`: a re-derivation is new bytes, so
    // carrying the previous record forward would leave a statement standing about content it was
    // never about. Passed only for the DERIVED section text — the ledger and status rows below are
    // bookkeeping and make no claim about authorship.
    ...(aiProvenanceId ? { aiProvenanceId } : {}),
    ttlHours: null, version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

async function addLedger(storage: Storage, ownerGaii: string, loc: Loc, event: Record<string, unknown>): Promise<void> {
  try { await upsert(storage, ownerGaii, ledgerKey(loc), { ...event, at: new Date().toISOString() }); } catch (err) { logger.warn('addLedger: best-effort', { error: String(err) }); }
}

/** Web-push + email when a living document retires (best-effort; in addition to the UI retired badge). */
async function notifyStop(services: LivingNotify | undefined, storage: Storage, ownerGaii: string, title: string, reason: string): Promise<void> {
  if (!services) return;
  const body = `"${title}" stopped refreshing: ${reason}`;
  try {
    if (services.push?.enabled) {
      await services.push.sendNotification(ownerGaii.split('@')[0], { title: 'Living document retired', body, url: '/v1/profile?tab=living', tag: 'living:retired' });
    }
  } catch (err) { logger.warn('notifyStop: push best-effort', { error: String(err) }); }
  try {
    if (services.email?.enabled) {
      const to = (await storage.getGHII(ownerGaii) as { notificationEmail?: string } | null)?.notificationEmail;
      if (to) await services.email.sendNotification(to, 'Living document retired', body);
    }
  } catch (err) { logger.warn('to: email best-effort', { error: String(err) }); }
}

function cadenceMs(charter: Record<string, unknown> | undefined): number {
  const mins = Number((charter as { cadence_minutes?: unknown })?.cadence_minutes);
  if (Number.isFinite(mins) && mins > 0) return mins * 60_000;
  const named = String((charter as { cadence?: unknown })?.cadence || 'daily');
  return ({ hourly: 60, daily: 1440, weekly: 10080 }[named] ?? 1440) * 60_000;
}

/** Count workspace activity (user content changed) since `lastMs`, ignoring living-doc machinery. */
function workspaceActivity(wsItems: MemoryRecord[], lastMs: number): { changedSince: number; lastActivityMs: number } {
  let changedSince = 0, lastActivityMs = 0;
  for (const r of wsItems) {
    if (/\.living(-src|-slot|-ledger)?\./.test(r.key) || /\.meta\./.test(r.key)) continue;
    const u = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
    if (u > lastActivityMs) lastActivityMs = u;
    if (u > lastMs) changedSince++;
  }
  return { changedSince, lastActivityMs };
}

/**
 * Is this instance due for an unattended pulse right now? Honours the charter's triggers + guards:
 *   triggers: { kind:'schedule'|'cadence' } | { kind:'activity', changed_gte, since_last_pulse_h_gte? }
 *   guards:   { cadence_floor_h } | { no_workspace_activity_for_h }
 * With no `triggers` declared it falls back to the cadence. `wsItems` = the instance's workspace memory.
 */
function evaluateDue(cfg: Record<string, unknown>, wsItems: MemoryRecord[], now = Date.now()): boolean {
  const status = (cfg.status as Record<string, unknown>) || {};
  if (status.paused === true || status.health === 'retired') return false;
  const charter = (cfg.charter as Record<string, unknown>) || {};
  const lastMs = status.last_pulse ? new Date(status.last_pulse as string).getTime() : 0;
  const hoursSince = lastMs ? (now - lastMs) / 3.6e6 : Infinity;
  const { changedSince, lastActivityMs } = workspaceActivity(wsItems, lastMs);
  const hoursSinceActivity = lastActivityMs ? (now - lastActivityMs) / 3.6e6 : Infinity;

  // Guards suppress even when a trigger matches.
  const guards = Array.isArray(charter.guards) ? charter.guards as Array<Record<string, unknown>> : [];
  for (const g of guards) {
    if (typeof g.cadence_floor_h === 'number' && hoursSince < g.cadence_floor_h) return false;
    if (typeof g.no_workspace_activity_for_h === 'number' && hoursSinceActivity > g.no_workspace_activity_for_h) return false;
  }

  const triggers = Array.isArray(charter.triggers) ? charter.triggers as Array<Record<string, unknown>> : null;
  if (!triggers || !triggers.length) return (now - lastMs) >= cadenceMs(charter);   // cadence fallback
  for (const tr of triggers) {
    if (tr.kind === 'schedule' || tr.kind === 'cadence') {
      if ((now - lastMs) >= cadenceMs(charter)) return true;
    } else if (tr.kind === 'activity') {
      const n = Number(tr.changed_gte) || 1;
      const ageH = Number(tr.since_last_pulse_h_gte) || 0;
      if (changedSince >= n && hoursSince >= ageH) return true;
    }
  }
  return false;
}

async function addSrc(storage: Storage, ownerGaii: string, loc: Loc, slot: string, src: { text: string; origin?: string; producer?: string | null }): Promise<void> {
  const id = 's-' + Math.random().toString(36).slice(2, 10);
  await upsert(storage, ownerGaii, srcKey(loc, id), { id, slot, text: src.text, origin: src.origin || '', producer: src.producer ?? null, active: true, addedAt: new Date().toISOString() });
}

/** Create a queued offer task for a section's agent (fire-and-forget; the running crew picks it up). */
async function dispatchAgentTask(storage: Storage, config: AimeatConfig, ownerGaii: string, agentName: string, offerId: string, query: string): Promise<string> {
  const ownerName = ownerGaii.split('@')[0];
  const agentGaii = `${agentName}#${ownerName}@${config.nodeId}`;
  const now = new Date().toISOString();
  const record: AgentTaskRecord = {
    id: randomUUID(), agentGaii, ownerGaii,
    title: query.length > 80 ? query.slice(0, 80) + '…' : query,
    description: query,
    scope: [{ name: 'kind', value: 'offer', type: 'text' }, { name: 'offer_id', value: offerId, type: 'text' }],
    rules: [], verification: { userExpects: '', technicalChecks: [] }, resources: {}, todos: [],
    status: 'queued', createdAt: now, updatedAt: now,
  };
  await storage.createAgentTask(record);
  return record.id;
}

/** Read a completed task's deliverable from the agent's memory (deliverableKey, then task tag, then
 *  longest *output value) — mirrors the client getDeliverableContent. */
async function readDeliverable(storage: Storage, task: AgentTaskRecord): Promise<string | null> {
  if (task.deliverableKey) {
    const m = await storage.getMemory(task.agentGaii, task.deliverableKey);
    if (m?.value != null) return typeof m.value === 'string' ? m.value : JSON.stringify(m.value, null, 2);
  }
  const items = await storage.listMemory(task.agentGaii);
  const tag = `task:${task.id}`;
  const cand = items.filter(i => (i.tags || []).includes(tag) || /latest_output$/.test(i.key));
  const pick = cand.sort((a, b) => (typeof b.value === 'string' ? b.value.length : 0) - (typeof a.value === 'string' ? a.value.length : 0))[0];
  if (!pick?.value) return null;
  return typeof pick.value === 'string' ? pick.value : JSON.stringify(pick.value, null, 2);
}

/** Handle an agent-backed section across pulses: dispatch a task, wait, then fold its deliverable.
 *  Returns 'folded' when a deliverable was just added (so the caller re-derives), else dispatched/
 *  waiting/failed (caller skips derive this pulse). */
async function handleAgentSection(
  storage: Storage, config: AimeatConfig, ownerGaii: string, loc: Loc,
  sec: Record<string, unknown>, slot: string, charter: { scope?: string },
): Promise<'dispatched' | 'waiting' | 'failed' | 'folded'> {
  const [agentName, offerId] = String(sec.agent).split('/');
  const stateRec = await storage.getMemory(ownerGaii, taskStateKey(loc, slot));
  const taskId = (stateRec?.value as { taskId?: string } | undefined)?.taskId;
  const clear = () => upsert(storage, ownerGaii, taskStateKey(loc, slot), { taskId: null });

  if (taskId) {
    const task = await storage.getAgentTask(taskId);
    if (!task) { await clear(); return 'failed'; }
    if (task.status === 'done') {
      const content = await readDeliverable(storage, task);
      if (content) await addSrc(storage, ownerGaii, loc, slot, { text: content, origin: task.deliverableKey || `task:${task.id}`, producer: task.agentGaii });
      await addLedger(storage, ownerGaii, loc, { event: 'agent-folded', slot });
      await clear();
      return content ? 'folded' : 'failed';
    }
    if (task.status === 'failed' || task.status === 'stalled') { await addLedger(storage, ownerGaii, loc, { event: 'agent-failed', slot }); await clear(); return 'failed'; }
    return 'waiting';   // queued / active
  }

  const query = `${sec.section}. ${sec.desc || ''} Context: ${charter.scope || ''}`.trim();
  const newId = await dispatchAgentTask(storage, config, ownerGaii, agentName, offerId, query);
  await upsert(storage, ownerGaii, taskStateKey(loc, slot), { taskId: newId, agent: agentName, offerId, createdAt: new Date().toISOString() });
  await addLedger(storage, ownerGaii, loc, { event: 'agent-dispatched', slot, agent: agentName });
  return 'dispatched';
}

/** Pulse one instance: self-fulfilled sections + agent sections (dispatch → fold next pulse). */
export async function pulseInstanceServer(
  storage: Storage, config: AimeatConfig, ownerGaii: string, loc: Loc, cfg: Record<string, unknown>,
  services?: LivingNotify,
): Promise<{ derived: number; costUsd: number; retired: boolean }> {
  const ownerName = ownerGaii.split('@')[0];
  const charter = (cfg.charter as { scope?: string; trust?: { derive?: string } }) || {};
  const gated = charter.trust?.derive === 'gated';
  const sections = Array.isArray(cfg.template) ? cfg.template as Array<Record<string, unknown>> : [];
  let costUsd = 0, derived = 0;
  const rendered: string[] = [];

  for (const sec of sections) {
    const slot = String(sec.slot);
    if (sec.agent) {
      // Agent-backed section: dispatch a task, then fold its deliverable on a later pulse.
      const r = await handleAgentSection(storage, config, ownerGaii, loc, sec, slot, charter);
      if (r !== 'folded') continue;   // dispatched / waiting / failed → nothing new to derive this pulse
    } else {
      // 1. Gather from the owner's own material.
      try {
        const { hits } = await librarianSearch(storage, config, {
          ownerName, fanOutOwner: true, viewerGaii: ownerGaii,
          query: `${sec.section} ${charter.scope || ''}`.trim(), limit: 5, scope: 'own',
        });
        const { items } = await storage.listAllMemory({ prefix: `${wsRoot(loc)}.living-src.${loc.docId}__`, limit: 500 });
        const seen = new Set(items.map(i => (i.value as { origin?: string })?.origin).filter(Boolean));
        for (const h of hits) {
          if (h.key === configKey(loc) || seen.has(h.key)) continue;
          await addSrc(storage, ownerGaii, loc, slot, { text: h.snippet || h.title || h.key, origin: h.key, producer: h.producer || null });
        }
      } catch (err) { logger.warn('charter: gather best-effort', { error: String(err) }); }
    }

    // 2. Re-derive from active sources.
    const { items } = await storage.listAllMemory({ prefix: `${wsRoot(loc)}.living-src.${loc.docId}__`, limit: 500 });
    const active = items.map(i => i.value as { slot?: string; text?: string; origin?: string; active?: boolean; id?: string })
      .filter(v => v?.slot === slot && v.active !== false);
    if (!active.length) continue;
    try {
      const srcList = active.map(s => `- ${s.text}${s.origin ? ` 〔${s.origin}〕` : ''}`).join('\n');
      const prompt = `Section: ${sec.section}\nScope: ${sec.desc || ''}\nDocument scope: ${charter.scope || ''}\n\nSources:\n${srcList}\n\nWrite the section.`;
      const r = await completeForOwner(storage, config, ownerGaii, { prompt, systemPrompt: DERIVE_SYSTEM, appId: 'living' });
      costUsd += r.usage.costUsd || 0;
      const md = (r.content || '').trim();
      const der = { slot, markdown: md, derivedFrom: active.map(s => s.id), producedAt: new Date().toISOString(), producedBy: 'pulse', pending: gated };
      // The completion above already minted an observed record (the node watched the model
      // produce these bytes), so it is CARRIED rather than re-derived. `gated` parks the text for
      // a human to approve — and approving is not yet reading the substance, so the record keeps
      // humanInvolvement 'none' until somebody actually reviews it.
      await upsert(storage, ownerGaii, gated ? pendingKey(loc, slot) : slotKey(loc, slot), der, r.provenance?.id);
      if (!gated) await appendHistory(storage, ownerGaii, loc, slot, { markdown: md, producedAt: der.producedAt, producedBy: 'pulse', derivedFrom: der.derivedFrom });
      await addLedger(storage, ownerGaii, loc, { event: gated ? 'pending' : 'slot-derived', slot, sources: active.length });
      rendered.push(`## ${sec.section}\n\n${md}`);
      derived++;
    } catch (e) {
      await addLedger(storage, ownerGaii, loc, { event: 'derive-failed', slot, error: String((e as Error).message || e) });
      if (e instanceof AiCompletionError && (e.code === 'NO_OPENROUTER_KEY' || e.code === 'NO_API_KEY')) break;  // no key → stop this instance
    }
  }

  // 3. Update status (+ evaluate stop conditions → retire).
  const status = (cfg.status as Record<string, unknown>) || {};
  const pulses = (Number(status.pulses) || 0) + 1;
  const stopReason = await evaluateStop(storage, config, ownerGaii, charter as Record<string, unknown>, rendered.join('\n\n'), pulses);
  const nextStatus: Record<string, unknown> = {
    ...status,
    version: (Number(status.version) || 1) + 1,
    pulses,
    last_pulse: new Date().toISOString(),
    health: stopReason ? 'retired' : 'green',
    cost: Number(((Number(status.cost) || 0) + costUsd).toFixed(4)),
  };
  if (stopReason) nextStatus.retired_reason = stopReason;
  await upsert(storage, ownerGaii, configKey(loc), { ...cfg, status: nextStatus });
  await addLedger(storage, ownerGaii, loc, { event: 'pulse', slots: derived, costUsd: Number(costUsd.toFixed(4)) });
  if (stopReason) {
    await addLedger(storage, ownerGaii, loc, { event: 'retired', reason: stopReason });
    await notifyStop(services, storage, ownerGaii, String(cfg.title || 'Living document'), stopReason);
  }
  return { derived, costUsd, retired: !!stopReason };
}

/** Evaluate the charter's stop conditions after a pulse. Returns a reason string if the document
 *  should retire, else null. Supports deterministic stops (max_pulses, until) + an optional
 *  natural-language `stop_when` judged by the owner's AI ("good enough"). */
async function evaluateStop(
  storage: Storage, config: AimeatConfig, ownerGaii: string,
  charter: Record<string, unknown>, renderedDoc: string, pulses: number,
): Promise<string | null> {
  const stop = Array.isArray(charter.stop) ? charter.stop as Array<Record<string, unknown>> : [];
  for (const s of stop) {
    if (typeof s.max_pulses === 'number' && pulses >= s.max_pulses) return `reached max pulses (${s.max_pulses})`;
    if (typeof s.until === 'string' && Date.now() > new Date(s.until).getTime()) return `reached end date (${s.until})`;
  }
  const stopWhen = typeof charter.stop_when === 'string' ? charter.stop_when.trim() : '';
  if (stopWhen && renderedDoc.trim()) {
    try {
      const r = await completeForOwner(storage, config, ownerGaii, {
        prompt: `Stop condition: ${stopWhen}\n\nCurrent document:\n${renderedDoc.slice(0, 12000)}\n\nIs the stop condition met? Answer only YES or NO.`,
        systemPrompt: 'You judge whether a living document has met its stop condition. Answer with only YES or NO.',
        appId: 'living',
      });
      if (/^\s*yes\b/i.test(r.content || '')) return `condition met: ${stopWhen}`;
    } catch (err) { logger.warn('evaluateStop: judge best-effort; do not retire on error', { error: String(err) }); }
  }
  return null;
}

function pulseRecord(rec: MemoryRecord): Loc | null {
  const m = CONFIG_RE.exec(rec.key);
  return m ? { orgId: m[1], wsId: m[2], docId: m[3] } : null;
}

/** Scan ALL owners' living instances and pulse the due ones (scheduler entrypoint). */
export async function scanAllDue(storage: Storage, config: AimeatConfig, services?: LivingNotify): Promise<void> {
  const { items } = await storage.listAllMemory({ prefix: 'organism.', limit: 10_000 });
  let pulsed = 0;
  for (const rec of items) {
    if (pulsed >= MAX_PER_SCAN) break;
    const loc = pulseRecord(rec);
    const cfg = rec.value as Record<string, unknown> | null;
    if (!loc || !cfg || cfg.type !== 'living-config') continue;
    const wsItems = items.filter(i => i.key.startsWith(`${wsRoot(loc)}.`));
    if (!evaluateDue(cfg, wsItems)) continue;
    try { await pulseInstanceServer(storage, config, rec.ownerGaii, loc, cfg, services); pulsed++; }
    catch (e) { logger.warn(`living pulse failed for ${rec.key}: ${String((e as Error).message || e)}`); }
  }
  if (pulsed > 0) logger.info(`Living-document pulse: refreshed ${pulsed} due instance(s)`);
}

/** Pulse the owner's OWN due instances now (manual trigger via POST /v1/living/pulse-due). */
export async function scanOwnerDue(storage: Storage, config: AimeatConfig, ownerGaii: string, services?: LivingNotify): Promise<{ pulsed: number }> {
  const items = await storage.listMemory(ownerGaii);
  let pulsed = 0;
  for (const rec of items) {
    const loc = pulseRecord(rec);
    const cfg = rec.value as Record<string, unknown> | null;
    if (!loc || !cfg || cfg.type !== 'living-config') continue;
    const wsItems = items.filter(i => i.key.startsWith(`${wsRoot(loc)}.`));
    if (!evaluateDue(cfg, wsItems)) continue;
    await pulseInstanceServer(storage, config, ownerGaii, loc, cfg, services);
    pulsed++;
  }
  return { pulsed };
}
