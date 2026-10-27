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
 * @structure holdAppLabels(storage, ownerBare, filename, config?) · holdErasedOwnerAppLabels(storage, ownerBare, pseudonym) ·
 *   sweepHeldAppLabels(storage, config, now?)
 * @usage
 *   await holdAppLabels(storage, ownerName, filename, config);       // when an app goes away
 *   scheduler.registerCoreHandler('held-label-release', () => sweepHeldAppLabels(storage, config));
 * @version-history
 *   v1.1.0 — 2026-10-27 — holdErasedOwnerAppLabels: an account erasure holds the account's app labels
 *     under the erasure's pseudonym, so the next holder of the name does not get them (secaudit2026oct26).
 *   v1.0.1 — 2026-10-25 — The mappings are read a page at a time (listSubdomainSitesPage), and whether
 *     an app is there is asked of storage here: a service does not import a route (check:deps).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, app-label-recycled-after-delete).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, SubdomainSiteRecord } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 500;

/** Every mapping, read a bounded page at a time (listSubdomainSitesPage). */
async function allSites(storage: Storage): Promise<SubdomainSiteRecord[]> {
  const out: SubdomainSiteRecord[] = [];
  for (let after: string | undefined; ;) {
    const page = await storage.listSubdomainSitesPage({ ...(after ? { after } : {}), limit: PAGE });
    out.push(...page);
    if (page.length < PAGE) return out;
    after = page[page.length - 1].subdomain;
  }
}

/** Whether the app an app target ("owner/filename") names is published here: the owner part as an
 *  account name, or as a full identity whose account part names it (the targets the label code writes). */
async function appIsThere(storage: Storage, target: string): Promise<boolean> {
  const slash = target.indexOf('/');
  if (slash <= 0 || slash === target.length - 1) return false;
  const owner = target.slice(0, slash);
  const filename = target.slice(slash + 1);
  if (await storage.getAppByOwnerName(owner, filename)) return true;
  const bare = localAccountName(owner);
  return bare !== owner && !!(await storage.getAppByOwnerName(bare, filename));
}

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
  const sites = await allSites(storage);
  for (const s of sites) {
    if (s.kind !== 'app' || s.target !== target || s.heldSince) continue;
    await storage.updateSubdomainSite(s.subdomain, { heldSince: now });
    s.heldSince = now;
  }
  if (!config) return [];
  const held = sites.filter(s => s.kind === 'app' && s.heldSince && ownerOfTarget(s.target) === ownerBare);
  return releaseOverLimit(storage, config, held);
}

/**
 * At an account erasure: every app label whose target names the erased account (`<name>/<file>`, or
 * the account's full identity) is held, and its target is given the erasure's pseudonym in place of the
 * name. The account name is released for reuse (decision 2026-08-10), and the labels were found by
 * that name: the next account registered under it got the previous person's origins back on its first
 * publish of the same file name, with what that person's visitors kept in the origin's storage
 * (secaudit2026oct26, ensureAppSubdomain:origin-handed-to-next-name-holder). A pseudonym matches no
 * account, so the label serves nothing and is released by the daily sweep after apps.held_label_days,
 * or by the operator on the Subdomains page. Returns the labels held.
 */
export async function holdErasedOwnerAppLabels(storage: Storage, ownerBare: string, pseudonym: string): Promise<string[]> {
  const now = new Date().toISOString();
  const held: string[] = [];
  for (const s of await allSites(storage)) {
    if (s.kind !== 'app') continue;
    const owner = ownerOfTarget(s.target);
    if (!owner || localAccountName(owner) !== ownerBare) continue;
    const file = s.target.slice(owner.length + 1);
    await storage.updateSubdomainSite(s.subdomain, { target: `${pseudonym}/${file}`, heldSince: s.heldSince ?? now });
    held.push(s.subdomain);
  }
  return held;
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
  for (const s of await allSites(storage)) {
    if (s.kind !== 'app') continue;
    if (await appIsThere(storage, s.target)) {
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
