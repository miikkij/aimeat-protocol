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
 *   v1.0.0 — 2026-06-21 — Phase 3: unattended self-fulfilled pulse + cadence/guards.
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { completeForOwner, AiCompletionError } from './ai-completion.js';
import { librarianSearch } from './librarian.js';

interface Loc { orgId: string; wsId: string; docId: string }
const CONFIG_RE = /^organism\.(.+?)\.w\.(.+?)\.living\.([^.]+)\.latest$/;
const MAX_PER_SCAN = 25;           // safety cap per scheduler tick
const DERIVE_SYSTEM =
  'You maintain ONE section of a living document. Rewrite the section so it is current, concise and well-organized, using ONLY the sources provided. Keep strictly to the section scope. Output clean markdown only — no preamble. Cite sources inline as 〔origin〕 where useful. Do not invent facts beyond the sources.';

const wsRoot = (l: Loc) => `organism.${l.orgId}.w.${l.wsId}`;
const slotKey = (l: Loc, slot: string) => `${wsRoot(l)}.living-slot.${l.docId}__${slot}.latest`;
const srcKey = (l: Loc, id: string) => `${wsRoot(l)}.living-src.${l.docId}__${id}.latest`;
const ledgerKey = (l: Loc) => `${wsRoot(l)}.living-ledger.${l.docId}__${Date.now()}-${Math.random().toString(36).slice(2, 6)}.latest`;
const configKey = (l: Loc) => `${wsRoot(l)}.living.${l.docId}.latest`;

async function upsert(storage: Storage, ownerGaii: string, key: string, value: unknown): Promise<void> {
  const now = new Date().toISOString();
  const existing = await storage.getMemory(ownerGaii, key);
  await storage.setMemory({
    key, ownerGaii, value, visibility: 'private', tags: [],
    ttlHours: null, version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

async function addLedger(storage: Storage, ownerGaii: string, loc: Loc, event: Record<string, unknown>): Promise<void> {
  try { await upsert(storage, ownerGaii, ledgerKey(loc), { ...event, at: new Date().toISOString() }); } catch { /* best-effort */ }
}

function cadenceMs(charter: Record<string, unknown> | undefined): number {
  const mins = Number((charter as { cadence_minutes?: unknown })?.cadence_minutes);
  if (Number.isFinite(mins) && mins > 0) return mins * 60_000;
  const named = String((charter as { cadence?: unknown })?.cadence || 'daily');
  return ({ hourly: 60, daily: 1440, weekly: 10080 }[named] ?? 1440) * 60_000;
}

/** Is this instance due for an unattended pulse right now? */
function isDue(cfg: Record<string, unknown>): boolean {
  const status = (cfg.status as Record<string, unknown>) || {};
  if (status.paused === true) return false;
  if (status.health === 'retired') return false;
  const last = status.last_pulse ? new Date(status.last_pulse as string).getTime() : 0;
  return (Date.now() - last) >= cadenceMs(cfg.charter as Record<string, unknown>);
}

/** Pulse one instance, self-fulfilled (no agent delegation). Returns sections derived. */
export async function pulseInstanceServer(
  storage: Storage, config: AimeatConfig, ownerGaii: string, loc: Loc, cfg: Record<string, unknown>,
): Promise<{ derived: number; costUsd: number }> {
  const ownerName = ownerGaii.split('@')[0];
  const charter = (cfg.charter as { scope?: string }) || {};
  const sections = Array.isArray(cfg.template) ? cfg.template as Array<Record<string, unknown>> : [];
  let costUsd = 0, derived = 0;

  for (const sec of sections) {
    const slot = String(sec.slot);
    if (sec.agent) { await addLedger(storage, ownerGaii, loc, { event: 'agent-skipped', slot }); continue; }

    // 1. Gather from the owner's own material.
    try {
      const { hits } = await librarianSearch(storage, config, {
        ownerName, isOwnerSession: true, viewerGaii: ownerGaii,
        query: `${sec.section} ${charter.scope || ''}`.trim(), limit: 5, scope: 'own',
      });
      const { items } = await storage.listAllMemory({ prefix: `${wsRoot(loc)}.living-src.${loc.docId}__`, limit: 500 });
      const seen = new Set(items.map(i => (i.value as { origin?: string })?.origin).filter(Boolean));
      for (const h of hits) {
        if (h.key === configKey(loc) || seen.has(h.key)) continue;
        const id = 's-' + Math.random().toString(36).slice(2, 10);
        await upsert(storage, ownerGaii, srcKey(loc, id), { id, slot, text: h.snippet || h.title || h.key, origin: h.key, producer: h.producer || null, active: true, addedAt: new Date().toISOString() });
      }
    } catch { /* gather best-effort */ }

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
      await upsert(storage, ownerGaii, slotKey(loc, slot), { slot, markdown: (r.content || '').trim(), derivedFrom: active.map(s => s.id), producedAt: new Date().toISOString(), producedBy: 'pulse' });
      await addLedger(storage, ownerGaii, loc, { event: 'slot-derived', slot, sources: active.length });
      derived++;
    } catch (e) {
      await addLedger(storage, ownerGaii, loc, { event: 'derive-failed', slot, error: String((e as Error).message || e) });
      if (e instanceof AiCompletionError && (e.code === 'NO_OPENROUTER_KEY' || e.code === 'NO_API_KEY')) break;  // no key → stop this instance
    }
  }

  // 3. Update status.
  const status = (cfg.status as Record<string, unknown>) || {};
  await upsert(storage, ownerGaii, configKey(loc), {
    ...cfg,
    status: { ...status, version: (Number(status.version) || 1) + 1, last_pulse: new Date().toISOString(), health: 'green', cost: Number(((Number(status.cost) || 0) + costUsd).toFixed(4)) },
  });
  await addLedger(storage, ownerGaii, loc, { event: 'pulse', slots: derived, costUsd: Number(costUsd.toFixed(4)) });
  return { derived, costUsd };
}

function pulseRecord(rec: MemoryRecord): Loc | null {
  const m = CONFIG_RE.exec(rec.key);
  return m ? { orgId: m[1], wsId: m[2], docId: m[3] } : null;
}

/** Scan ALL owners' living instances and pulse the due ones (scheduler entrypoint). */
export async function scanAllDue(storage: Storage, config: AimeatConfig): Promise<void> {
  const { items } = await storage.listAllMemory({ prefix: 'organism.', limit: 10_000 });
  let pulsed = 0;
  for (const rec of items) {
    if (pulsed >= MAX_PER_SCAN) break;
    const loc = pulseRecord(rec);
    const cfg = rec.value as Record<string, unknown> | null;
    if (!loc || !cfg || cfg.type !== 'living-config' || !isDue(cfg)) continue;
    try { await pulseInstanceServer(storage, config, rec.ownerGaii, loc, cfg); pulsed++; }
    catch (e) { logger.warn(`living pulse failed for ${rec.key}: ${String((e as Error).message || e)}`); }
  }
  if (pulsed > 0) logger.info(`Living-document pulse: refreshed ${pulsed} due instance(s)`);
}

/** Pulse the owner's OWN due instances now (manual trigger via POST /v1/living/pulse-due). */
export async function scanOwnerDue(storage: Storage, config: AimeatConfig, ownerGaii: string): Promise<{ pulsed: number }> {
  const items = await storage.listMemory(ownerGaii);
  let pulsed = 0;
  for (const rec of items) {
    const loc = pulseRecord(rec);
    const cfg = rec.value as Record<string, unknown> | null;
    if (!loc || !cfg || cfg.type !== 'living-config' || !isDue(cfg)) continue;
    await pulseInstanceServer(storage, config, ownerGaii, loc, cfg);
    pulsed++;
  }
  return { pulsed };
}
