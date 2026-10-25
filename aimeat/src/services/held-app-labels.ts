/**
 * @file src/services/held-app-labels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The own address of an app that went away is held for that app's owner. A per-app
 *   label is an origin, and what the app's visitors left in their browsers (the app's saved data, the
 *   SDK's stored session) belongs to that origin. A package removal deleted the label's row, and the
 *   next app with the same file name, from any owner, got the label on its first publish or open
 *   (routes/subdomains.ts ensureAppSubdomain) and could read that storage (secaudit2026oct22,
 *   app-label-recycled-after-delete). Ordinary app deletion already kept the row.
 *
 *   Now a removal keeps the row and marks it held (`heldSince`). ensureAppSubdomain already gives a
 *   held label only to its own target, so the owner who publishes the same app again gets the label
 *   back, and the mark is cleared. The daily core job held-label-release:
 *   - clears the mark of a label whose app is there again, and marks a label whose app is gone (a row
 *     from before this change, or an app deleted another way), so the clock starts when it is first seen;
 *   - releases (deletes) a label held longer than apps.held_label_days (default 90; 0 holds it until
 *     the operator releases it);
 *   - keeps each owner to apps.held_labels_per_owner held labels (default 20; 0 is no limit),
 *     releasing the one held longest first, so deleting apps does not hoard addresses.
 *   The operator releases a held label at any time with the ordinary delete on the Subdomains page
 *   (DELETE /v1/admin/subdomains/:subdomain, MCP aimeat_app_manage subdomain_delete).
 * @structure holdAppLabels(storage, ownerBare, filename, config?) · sweepHeldAppLabels(storage, config, now?)
 * @usage
 *   await holdAppLabels(storage, ownerName, filename, config);       // when an app goes away
 *   scheduler.registerCoreHandler('held-label-release', () => sweepHeldAppLabels(storage, config));
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, app-label-recycled-after-delete).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, SubdomainSiteRecord } from '../storage/interface.js';
import { resolveAppTarget } from '../routes/subdomain-app-gate.js';
import { logger } from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The owner part of an app target ("alice/notes.html" -> "alice"). */
const ownerOfTarget = (target: string): string => target.slice(0, Math.max(0, target.indexOf('/')));

type LimitConfig = Pick<AimeatConfig, 'appHeldLabelDays' | 'appHeldLabelsPerOwner'>;

/** Release the held labels past the per-owner limit among `held`, the one held longest first. */
async function releaseOverLimit(storage: Storage, config: LimitConfig, held: SubdomainSiteRecord[]): Promise<string[]> {
  const cap = config.appHeldLabelsPerOwner;
  if (!(Number.isInteger(cap) && cap > 0)) return [];
  const byOwner = new Map<string, SubdomainSiteRecord[]>();
  for (const s of held) {
    const owner = ownerOfTarget(s.target);
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), s]);
  }
  const released: string[] = [];
  for (const rows of byOwner.values()) {
    if (rows.length <= cap) continue;
    rows.sort((a, b) => Date.parse(a.heldSince ?? '') - Date.parse(b.heldSince ?? '') || a.subdomain.localeCompare(b.subdomain));
    for (const s of rows.slice(0, rows.length - cap)) {
      if (await storage.deleteSubdomainSite(s.subdomain)) released.push(s.subdomain);
    }
  }
  return released;
}

/**
 * Mark the labels of an app that went away as held. With `config`, the owner's limit of held labels
 * applies at once; without it, the next daily sweep applies it. Returns the labels released by it.
 */
export async function holdAppLabels(storage: Storage, ownerBare: string, filename: string, config?: LimitConfig): Promise<string[]> {
  const target = `${ownerBare}/${filename}`;
  const now = new Date().toISOString();
  const sites = await storage.listSubdomainSites();
  for (const s of sites) {
    if (s.kind !== 'app' || s.target !== target || s.heldSince) continue;
    await storage.updateSubdomainSite(s.subdomain, { heldSince: now });
    s.heldSince = now;
  }
  if (!config) return [];
  const held = sites.filter(s => s.kind === 'app' && s.heldSince && ownerOfTarget(s.target) === ownerBare);
  return releaseOverLimit(storage, config, held);
}

/** The daily sweep: the marks follow the apps, then age and the per-owner limit release labels. */
export async function sweepHeldAppLabels(storage: Storage, config: LimitConfig, now: Date = new Date()): Promise<{ held: string[]; cleared: string[]; released: string[] }> {
  const held: string[] = [];
  const cleared: string[] = [];
  const released: string[] = [];
  const stillHeld: SubdomainSiteRecord[] = [];
  const nowIso = now.toISOString();
  const days = config.appHeldLabelDays;
  const cutoff = Number.isInteger(days) && days > 0 ? now.getTime() - days * DAY_MS : null;
  for (const s of await storage.listSubdomainSites()) {
    if (s.kind !== 'app') continue;
    const app = await resolveAppTarget(storage, s.target);
    if (app) {
      if (s.heldSince) { await storage.updateSubdomainSite(s.subdomain, { heldSince: null }); cleared.push(s.subdomain); }
      continue;
    }
    if (!s.heldSince) {
      await storage.updateSubdomainSite(s.subdomain, { heldSince: nowIso });
      held.push(s.subdomain);
      stillHeld.push({ ...s, heldSince: nowIso });
      continue;
    }
    if (cutoff !== null && Date.parse(s.heldSince) < cutoff) {
      if (await storage.deleteSubdomainSite(s.subdomain)) released.push(s.subdomain);
      continue;
    }
    stillHeld.push(s);
  }
  released.push(...await releaseOverLimit(storage, config, stillHeld));
  if (held.length || cleared.length || released.length) logger.info('[held-label-release] app addresses', { held: held.length, cleared: cleared.length, released });
  return { held, cleared, released };
}
