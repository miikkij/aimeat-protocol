/**
 * @file src/services/exchange-projection.ts
 * @description TARGET-050 — the EXCHANGE listing as a PROJECTION of its source, not a hand-authored
 *   snapshot. Before this, listing a capability was a second authoring step: the provider priced a tool
 *   in the app-catalog and then had to call the listing endpoint again, so the market showed stale prices,
 *   duplicate cards (one per relist) and outdated titles. Now the SOURCE owns the listing:
 *
 *     app-tool   → `apps.{appId}.tools` manifest entry with `exchange: true`
 *     ext-action → extension action `commercial.exchange === true`
 *     agent-work → `agents.{agent}.offers` entry with `exchange: true` (and visibility 'public')
 *
 *   Reconcile projects those sources onto offerings: creates what is flagged, updates what changed,
 *   delists what is no longer flagged (or no longer priced). Identity of a listing is the DEDUPE KEY
 *   (kind, ext, action, unit, currency) — a price change therefore UPDATES the existing listing instead
 *   of minting a rival one, and a tool priced in both morsels and EUR yields one listing per unit that
 *   the marketplace app groups into a single card.
 *
 *   HARD INVARIANT: a projection never touches a CONTRACT. Entitlements keep the interface version and
 *   the price they were signed at (`app-tool-interfaces.ts` deliberately does not freeze price — it is
 *   authoritative at accept time and captured into the entitlement). Reconcile only writes offering
 *   records, and adopts a legacy listing by keeping its `offeringId` so `contractRef: offering:{id}`
 *   on existing entitlements keeps resolving.
 * @structure ReconcileChange · ReconcileReport · reconcileOwnerOfferings · migrateLegacyOfferings ·
 *   desiredFromAppTools · desiredFromExtActions · desiredFromAgentOffers · moneyPricesOf
 * @usage
 *   const report = await reconcileOwnerOfferings(storage, ownerGhii, { dryRun: true });
 *   await reconcileOwnerOfferings(storage, ownerGhii, { appId: 'prh.html' });
 * @version-history
 *   v1.0.0 — 2026-07-25 — Initial projection + reconcile + legacy adoption (TARGET-050 slices 1 & 3).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import { AppToolsDocSchema, appToolsKey, type AppTool } from '../models/app-tool-schemas.js';
import { OffersDocSchema, type Offer } from '../models/offer-schemas.js';
import { ensureInterfaceVersion, getLatestInterface } from './app-tool-interfaces.js';
import {
  appToolCoordinate, agentWorkCoordinate, listAllOfferings, newOfferingId, putOffering,
  type Offering, type OfferingPlan, type UsageTerms,
} from './exchange-market.js';
import type { EntitlementUnit } from './metered-entitlements.js';

/** One outcome line of a reconcile — the dry-run report is exactly this list. */
export interface ReconcileChange {
  action: 'created' | 'updated' | 'adopted' | 'delisted' | 'unchanged' | 'skipped';
  offeringId: string | null;
  kind: Offering['kind'];
  label: string;                 // human coordinate, e.g. "prh.html/getStatistics"
  unit: EntitlementUnit | null;
  currency: string | null;
  reason?: string;               // why it was skipped
}

export interface ReconcileReport {
  owner: string;
  dryRun: boolean;
  changes: ReconcileChange[];
  created: number; updated: number; adopted: number; delisted: number; unchanged: number; skipped: number;
}

/** A listing the sources say SHOULD exist. `key` is its identity — price is deliberately not part of it. */
interface DesiredListing {
  key: string;
  kind: Offering['kind'];
  ext: string;
  action: string;
  surface: Offering['surface'];
  title: string;
  description: string;
  unit: EntitlementUnit;
  basePrice: number;
  currency: string | null;
  plans: OfferingPlan[];
  taskSpec?: Offering['taskSpec'];
  usageTerms: UsageTerms;
  tags: string[];
  sourceHash: string;
}

/** The dedupe identity of a listing: one per (kind, coordinate, unit, currency) — never one per relist. */
const listingKey = (kind: string, ext: string, action: string, unit: string, currency: string | null): string =>
  `${kind}|${ext}|${action}|${unit}|${currency ?? ''}`;

const offeringKey = (o: Offering): string => listingKey(o.kind, o.ext, o.action, o.unit, o.currency);

const hasSchema = (v: unknown): boolean => !!v && typeof v === 'object' && Object.keys(v as Record<string, unknown>).length > 0;

/** Same permissive-but-attributed defaults the manual listing route applies when a field is omitted. */
function usageTermsOf(src: { derivatives?: boolean; resale?: boolean; attribution?: boolean; note?: string } | undefined): UsageTerms {
  return {
    derivatives: src?.derivatives !== false,
    resale: src?.resale === true,
    attribution: src?.attribution !== false,
    ...(src?.note ? { note: src.note } : {}),
  };
}

/** Every money price a source declares, `priceMoney` first, de-duplicated by currency. */
function moneyPricesOf(
  primary: { amount: number; currency: string } | null | undefined,
  extra: Array<{ amount: number; currency: string }> | undefined,
): Array<{ amount: number; currency: string }> {
  const out: Array<{ amount: number; currency: string }> = [];
  const seen = new Set<string>();
  for (const p of [primary, ...(extra ?? [])]) {
    if (!p || typeof p.amount !== 'number' || !Number.isInteger(p.amount) || p.amount <= 0 || !p.currency) continue;
    if (seen.has(p.currency)) continue;
    seen.add(p.currency); out.push({ amount: p.amount, currency: p.currency });
  }
  return out;
}

function contentHash(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

// ── SOURCE → DESIRED LISTINGS ────────────────────────────────────────────────

/** App-tool manifests (`apps.{appId}.tools`) the owner has flagged for EXCHANGE. */
async function desiredFromAppTools(
  storage: Storage, ownerGhii: string, ownerName: string, only: string | undefined,
  skips: ReconcileChange[], dryRun: boolean,
): Promise<DesiredListing[]> {
  const out: DesiredListing[] = [];
  const records = only
    ? [await storage.getMemory(ownerGhii, appToolsKey(only))].filter(Boolean)
    : (await storage.listMemory(ownerGhii, { prefix: 'apps.' })).filter(r => /^apps\..+\.tools$/.test(r.key));
  for (const rec of records) {
    if (!rec) continue;
    const appId = rec.key.replace(/^apps\./, '').replace(/\.tools$/, '');
    const parsed = AppToolsDocSchema.safeParse(rec.value);
    if (!parsed.success) {
      skips.push({ action: 'skipped', offeringId: null, kind: 'app-tool', label: appId, unit: null, currency: null, reason: 'INVALID_TOOL_MANIFEST' });
      continue;
    }
    for (const tool of parsed.data.tools) {
      if (tool.exchange !== true) continue;
      const label = `${appId}/${tool.name}`;
      const skip = (reason: string) => skips.push({ action: 'skipped', offeringId: null, kind: 'app-tool', label, unit: null, currency: null, reason });
      if (!tool.action_id) { skip('TOOL_UNBOUND'); continue; }
      if (!hasSchema(tool.inputSchema) || !hasSchema(tool.outputSchema)) { skip('SCHEMA_REQUIRED'); continue; }
      const money = moneyPricesOf(tool.priceMoney, tool.pricesMoney);
      const morsels = tool.price && tool.price.morsels > 0 ? tool.price.morsels : 0;
      if (!money.length && !morsels) { skip('NOT_PRICED'); continue; }
      // Pin (or read, when dry) the interface version — the integration contract, unchanged by this work.
      const def = { inputSchema: tool.inputSchema ?? {}, outputSchema: tool.outputSchema ?? {}, binding: tool.action_id };
      const iface = dryRun
        ? await getLatestInterface(storage, ownerGhii, appId, tool.name)
        : await ensureInterfaceVersion(storage, ownerGhii, appId, tool.name, def);
      const ifaceVersion = iface?.ifaceVersion ?? 1;
      const coord = appToolCoordinate(ownerName, appId, tool.name);
      const base = {
        kind: 'app-tool' as const, ext: coord.ext, action: coord.action,
        surface: { kind: 'app-tool' as const, ownerName, appId, tool: tool.name, ifaceVersion },
        title: `${appId} · ${tool.name}`, description: tool.description ?? '',
        plans: (tool.plans ?? []) as OfferingPlan[], usageTerms: usageTermsOf(tool.usageTerms), tags: [] as string[],
      };
      for (const p of prices(morsels, money)) {
        out.push({
          ...base, ...p,
          key: listingKey('app-tool', coord.ext, coord.action, p.unit, p.currency),
          sourceHash: contentHash([base.title, base.description, base.plans, base.usageTerms, ifaceVersion, p]),
        });
      }
    }
  }
  return out;
}

/** Extension actions the owner has flagged (`commercial.exchange === true`). */
async function desiredFromExtActions(
  storage: Storage, ownerName: string, only: string | undefined, skips: ReconcileChange[],
): Promise<DesiredListing[]> {
  const out: DesiredListing[] = [];
  const all = await storage.listExtensions();
  for (const ext of all) {
    if (ext.installedBy !== ownerName) continue;
    if (only && ext.name !== only) continue;
    for (const act of ext.actions) {
      const comm = act.commercial;
      if (!comm || comm.exchange !== true) continue;
      const label = `${ext.name}/${act.id}`;
      const skip = (reason: string) => skips.push({ action: 'skipped', offeringId: null, kind: 'ext-action', label, unit: null, currency: null, reason });
      if (!hasSchema(act.inputSchema) || !hasSchema(act.outputSchema)) { skip('SCHEMA_REQUIRED'); continue; }
      const money = moneyPricesOf(comm.payMoney, comm.pricesMoney);
      const morsels = comm.payMorsels > 0 ? comm.payMorsels : 0;
      if (!money.length && !morsels) { skip('NOT_PRICED'); continue; }
      const base = {
        kind: 'ext-action' as const, ext: ext.name, action: act.id, surface: null,
        title: `${ext.name} · ${act.id}`, description: ext.description ?? '',
        plans: (comm.plans ?? []) as OfferingPlan[], usageTerms: usageTermsOf(comm.usageTerms), tags: [] as string[],
      };
      for (const p of prices(morsels, money)) {
        out.push({
          ...base, ...p,
          key: listingKey('ext-action', ext.name, act.id, p.unit, p.currency),
          sourceHash: contentHash([base.title, base.description, base.plans, base.usageTerms, p]),
        });
      }
    }
  }
  return out;
}

/** Agent offers flagged for sale as agent work (`exchange: true` + public + priced + I/O declared). */
async function desiredFromAgentOffers(
  storage: Storage, ownerName: string, only: string | undefined, skips: ReconcileChange[],
): Promise<DesiredListing[]> {
  const out: DesiredListing[] = [];
  const agents = (await storage.listAgents()).filter(a => a.owner === ownerName && (!only || a.name === only));
  for (const agent of agents) {
    const rec = await storage.getMemory(agent.gaii, `agents.${agent.name}.offers`);
    if (!rec) continue;
    const parsed = OffersDocSchema.safeParse(rec.value);
    if (!parsed.success) {
      skips.push({ action: 'skipped', offeringId: null, kind: 'agent-work', label: agent.name, unit: null, currency: null, reason: 'INVALID_OFFERS_DOC' });
      continue;
    }
    for (const offer of parsed.data.offers as Offer[]) {
      if (offer.exchange !== true) continue;
      const label = `${agent.name}:${offer.id}`;
      const skip = (reason: string) => skips.push({ action: 'skipped', offeringId: null, kind: 'agent-work', label, unit: null, currency: null, reason });
      // Selling implies being discoverable: `exchange` is the sale switch, `visibility` the shop window.
      if (offer.visibility !== 'public') { skip('NOT_PUBLIC'); continue; }
      if (!hasSchema(offer.inputSchema) || !hasSchema(offer.outputSchema)) { skip('SCHEMA_REQUIRED'); continue; }
      const money = moneyPricesOf(offer.priceMoney, offer.pricesMoney);
      const morsels = offer.price && offer.price.morsels > 0 ? offer.price.morsels : 0;
      if (!money.length && !morsels) { skip('NOT_PRICED'); continue; }
      const coord = agentWorkCoordinate(ownerName, agent.name, offer.id);
      const base = {
        kind: 'agent-work' as const, ext: coord.ext, action: coord.action,
        surface: { kind: 'agent-work' as const, ownerName, agentName: agent.name, taskType: offer.id },
        title: offer.title || `${agent.name}: ${offer.id}`, description: offer.ask ?? '',
        plans: [] as OfferingPlan[], usageTerms: usageTermsOf(offer.usageTerms), tags: (offer.tags ?? []) as string[],
        taskSpec: { inputSchema: offer.inputSchema ?? {}, outputSchema: offer.outputSchema ?? {} },
      };
      for (const p of prices(morsels, money)) {
        out.push({
          ...base, ...p,
          key: listingKey('agent-work', coord.ext, coord.action, p.unit, p.currency),
          sourceHash: contentHash([base.title, base.description, base.taskSpec, base.usageTerms, base.tags, p]),
        });
      }
    }
  }
  return out;
}

/** One price row per sellable unit: morsels (when priced) plus every declared money currency. */
function prices(morsels: number, money: Array<{ amount: number; currency: string }>):
  Array<{ unit: EntitlementUnit; basePrice: number; currency: string | null }> {
  const rows: Array<{ unit: EntitlementUnit; basePrice: number; currency: string | null }> = [];
  if (morsels > 0) rows.push({ unit: 'morsels', basePrice: morsels, currency: null });
  for (const m of money) rows.push({ unit: 'money', basePrice: m.amount, currency: m.currency });
  return rows;
}

// ── RECONCILE ────────────────────────────────────────────────────────────────

/**
 * Project every flagged source of one owner onto their EXCHANGE listings. Idempotent: running it twice
 * changes nothing the second time. `dryRun` reports what WOULD change and writes nothing (not even an
 * interface snapshot). Scope it with appId/extName/agentName to reconcile a single source after a write.
 */
export async function reconcileOwnerOfferings(
  storage: Storage, ownerGhii: string,
  opts?: { dryRun?: boolean; appId?: string; extName?: string; agentName?: string },
): Promise<ReconcileReport> {
  const dryRun = opts?.dryRun === true;
  const ownerName = ownerGhii.split('@')[0].split('#').pop() ?? ownerGhii;
  const scoped = !!(opts?.appId || opts?.extName || opts?.agentName);
  const changes: ReconcileChange[] = [];

  const desired: DesiredListing[] = [
    ...(!scoped || opts?.appId ? await desiredFromAppTools(storage, ownerGhii, ownerName, opts?.appId, changes, dryRun) : []),
    ...(!scoped || opts?.extName ? await desiredFromExtActions(storage, ownerName, opts?.extName, changes) : []),
    ...(!scoped || opts?.agentName ? await desiredFromAgentOffers(storage, ownerName, opts?.agentName, changes) : []),
  ];

  const mine = (await listAllOfferings(storage)).filter(o => o.providerOwner === ownerName);
  const byKey = new Map<string, Offering>();
  for (const o of mine) {
    const k = offeringKey(o);
    const prev = byKey.get(k);
    // Prefer an already-projected listing, then a listed one, then whatever is oldest — so adoption is stable.
    if (!prev || (o.auto && !prev.auto) || (o.state === 'listed' && prev.state !== 'listed')) byKey.set(k, o);
  }

  const now = new Date().toISOString();
  const wanted = new Set<string>();
  for (const d of desired) {
    wanted.add(d.key);
    const existing = byKey.get(d.key);
    if (!existing) {
      const offering: Offering = {
        offeringId: newOfferingId(), providerGhii: ownerGhii, providerOwner: ownerName,
        kind: d.kind, ext: d.ext, action: d.action, surface: d.surface,
        title: d.title, description: d.description,
        unit: d.unit, basePrice: d.basePrice, currency: d.currency, plans: d.plans,
        ...(d.taskSpec ? { taskSpec: d.taskSpec } : {}),
        provenance: null, usageTerms: d.usageTerms, tags: d.tags,
        state: 'listed', auto: true, sourceHash: d.sourceHash, createdAt: now, updatedAt: now,
      };
      if (!dryRun) await putOffering(storage, offering);
      changes.push({ action: 'created', offeringId: offering.offeringId, kind: d.kind, label: labelOf(d), unit: d.unit, currency: d.currency });
      continue;
    }
    const adopting = !existing.auto;
    const unchanged = !adopting && existing.state === 'listed' && existing.sourceHash === d.sourceHash
      && existing.basePrice === d.basePrice;
    if (unchanged) {
      changes.push({ action: 'unchanged', offeringId: existing.offeringId, kind: d.kind, label: labelOf(d), unit: d.unit, currency: d.currency });
      continue;
    }
    // Keep offeringId: existing entitlements carry `contractRef: offering:{id}`.
    const updated: Offering = {
      ...existing,
      kind: d.kind, ext: d.ext, action: d.action, surface: d.surface,
      title: d.title, description: d.description,
      unit: d.unit, basePrice: d.basePrice, currency: d.currency, plans: d.plans,
      ...(d.taskSpec ? { taskSpec: d.taskSpec } : {}),
      usageTerms: d.usageTerms, tags: d.tags,
      state: 'listed', auto: true, sourceHash: d.sourceHash, updatedAt: now,
    };
    if (!dryRun) await putOffering(storage, updated);
    changes.push({
      action: adopting ? 'adopted' : 'updated', offeringId: existing.offeringId,
      kind: d.kind, label: labelOf(d), unit: d.unit, currency: d.currency,
    });
  }

  // Anything this owner PROJECTED that the sources no longer ask for → delist. Hand-authored listings are
  // never delisted here: the provider made them by hand, only they (or the migration) may retire them.
  for (const o of mine) {
    if (!o.auto || o.state !== 'listed') continue;
    if (wanted.has(offeringKey(o))) continue;
    if (scoped && !inScope(o, opts)) continue;
    if (!dryRun) await putOffering(storage, { ...o, state: 'delisted', updatedAt: now });
    changes.push({ action: 'delisted', offeringId: o.offeringId, kind: o.kind, label: `${o.ext}/${o.action}`, unit: o.unit, currency: o.currency });
  }

  return summarise(ownerName, dryRun, changes);
}

const labelOf = (d: DesiredListing): string =>
  d.surface?.kind === 'app-tool' ? `${d.surface.appId}/${d.surface.tool}`
    : d.surface?.kind === 'agent-work' ? `${d.surface.agentName}:${d.surface.taskType}`
      : `${d.ext}/${d.action}`;

/** Does a projected offering belong to the source this scoped reconcile is about? */
function inScope(o: Offering, opts?: { appId?: string; extName?: string; agentName?: string }): boolean {
  if (opts?.appId) return o.kind === 'app-tool' && o.surface?.kind === 'app-tool' && o.surface.appId === opts.appId;
  if (opts?.extName) return o.kind === 'ext-action' && o.ext === opts.extName;
  if (opts?.agentName) return o.kind === 'agent-work' && o.surface?.kind === 'agent-work' && o.surface.agentName === opts.agentName;
  return true;
}

function summarise(owner: string, dryRun: boolean, changes: ReconcileChange[]): ReconcileReport {
  const count = (a: ReconcileChange['action']) => changes.filter(c => c.action === a).length;
  return {
    owner, dryRun, changes,
    created: count('created'), updated: count('updated'), adopted: count('adopted'),
    delisted: count('delisted'), unchanged: count('unchanged'), skipped: count('skipped'),
  };
}

/**
 * Fire-and-forget reconcile after a SOURCE record was written, so pricing a tool in the app-catalog (or
 * via MCP) shows on the market immediately with no second step. Recognises the two memory-backed sources
 * (`apps.{appId}.tools`, `agents.{agent}.offers`); anything else is ignored. Never rejects into the
 * caller's response path — a failed projection must not fail the write that triggered it.
 */
export function reconcileAfterSourceWrite(storage: Storage, ownerGaii: string, key: string): void {
  const app = /^apps\.(.+)\.tools$/.exec(key);
  const offers = /^agents\.(.+)\.offers$/.exec(key);
  if (!app && !offers) return;
  // An offers doc lives under the AGENT's GAII (`agent#owner@node`); listings belong to the owner GHII.
  const [namePart, host] = ownerGaii.split('@');
  const ownerName = namePart.includes('#') ? namePart.split('#')[1] : namePart;
  const ownerGhii = host ? `${ownerName}@${host}` : ownerName;
  const opts = app ? { appId: app[1] } : { agentName: offers![1] };
  void reconcileOwnerOfferings(storage, ownerGhii, opts).catch(() => { /* projection is best-effort */ });
}

/** Same, for an extension whose actions may carry `commercial.exchange`. */
export function reconcileAfterExtensionWrite(storage: Storage, ownerName: string, nodeId: string, extName: string): void {
  void reconcileOwnerOfferings(storage, `${ownerName}@${nodeId}`, { extName })
    .catch(() => { /* projection is best-effort */ });
}

// ── MIGRATION (TARGET-050 slice 3) ───────────────────────────────────────────

/**
 * Bring hand-authored listings into the projection model: for each of the owner's listed offerings that is
 * not yet a projection, flip the `exchange` flag ON in its SOURCE (so the source now explains why the
 * listing exists) and let reconcile adopt the existing record — keeping its `offeringId`, so entitlements
 * referencing `offering:{id}` keep resolving. A listing whose source is gone is reported as an orphan and
 * left exactly as it is. Idempotent; `dryRun` writes nothing.
 */
export async function migrateLegacyOfferings(
  storage: Storage, ownerGhii: string, opts?: { dryRun?: boolean },
): Promise<ReconcileReport & { orphans: string[]; flagged: string[] }> {
  const dryRun = opts?.dryRun === true;
  const ownerName = ownerGhii.split('@')[0].split('#').pop() ?? ownerGhii;
  const legacy = (await listAllOfferings(storage)).filter(o => o.providerOwner === ownerName && o.state === 'listed' && !o.auto);
  const orphans: string[] = []; const flagged: string[] = [];

  for (const o of legacy) {
    if (o.kind === 'app-tool' && o.surface?.kind === 'app-tool') {
      const { appId, tool: toolName } = o.surface;
      const key = appToolsKey(appId);
      const rec = await storage.getMemory(ownerGhii, key);
      const parsed = rec ? AppToolsDocSchema.safeParse(rec.value) : null;
      const tool = parsed?.success ? parsed.data.tools.find((t: AppTool) => t.name === toolName) : null;
      if (!rec || !parsed?.success || !tool) { orphans.push(`${o.offeringId} (${o.ext}/${o.action})`); continue; }
      if (tool.exchange === true) continue;
      flagged.push(`${appId}/${tool.name}`);
      if (!dryRun) {
        tool.exchange = true;
        if (!tool.usageTerms && o.usageTerms) tool.usageTerms = { ...o.usageTerms };
        await storage.setMemory({
          key, ownerGaii: ownerGhii, value: { ...parsed.data, updatedAt: new Date().toISOString() },
          visibility: 'public', tags: ['app-tools'], ttlHours: null, version: 1,
          createdAt: rec.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
      }
      continue;
    }
    if (o.kind === 'ext-action') {
      const ext = await storage.getExtension(o.ext);
      const act = ext?.actions.find(a => a.id === o.action);
      if (!ext || !act || ext.installedBy !== ownerName) { orphans.push(`${o.offeringId} (${o.ext}/${o.action})`); continue; }
      if (act.commercial?.exchange === true) continue;
      flagged.push(`${ext.name}/${act.id}`);
      if (!dryRun && act.commercial) {
        act.commercial.exchange = true;
        if (!act.commercial.usageTerms && o.usageTerms) act.commercial.usageTerms = { ...o.usageTerms };
        await storage.updateExtension(ext.name, { actions: ext.actions });
      }
      continue;
    }
    if (o.kind === 'agent-work' && o.surface?.kind === 'agent-work') {
      const agentName = o.surface.agentName;
      const agent = (await storage.listAgents()).find(a => a.owner === ownerName && a.name === agentName);
      const rec = agent ? await storage.getMemory(agent.gaii, `agents.${agentName}.offers`) : null;
      const parsed = rec ? OffersDocSchema.safeParse(rec.value) : null;
      const offer = parsed?.success ? parsed.data.offers.find((f: Offer) => f.id === o.action) : null;
      if (!agent || !rec || !parsed?.success || !offer) { orphans.push(`${o.offeringId} (${o.ext}/${o.action})`); continue; }
      if (offer.exchange === true) continue;
      flagged.push(`${agentName}:${offer.id}`);
      if (!dryRun) {
        offer.exchange = true;
        offer.visibility = 'public';
        if (!offer.inputSchema && o.taskSpec?.inputSchema) offer.inputSchema = o.taskSpec.inputSchema;
        if (!offer.outputSchema && o.taskSpec?.outputSchema) offer.outputSchema = o.taskSpec.outputSchema;
        if (!offer.usageTerms && o.usageTerms) offer.usageTerms = { ...o.usageTerms };
        await storage.setMemory({
          key: `agents.${agentName}.offers`, ownerGaii: agent.gaii, value: { ...parsed.data, updatedAt: new Date().toISOString() },
          visibility: rec.visibility ?? 'owner', tags: ['offers'], ttlHours: null, version: 1,
          createdAt: rec.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
      }
      continue;
    }
    orphans.push(`${o.offeringId} (${o.ext}/${o.action})`);
  }

  const report = await reconcileOwnerOfferings(storage, ownerGhii, { dryRun });
  return { ...report, orphans, flagged };
}
