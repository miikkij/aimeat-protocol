/**
 * @file subdomain-sites.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Managing which subdomain label points where: list, create, update and delete a
 *   mapping, with the validation and the refusals the operator's doors have always given. One
 *   implementation for /v1/admin/subdomains and for any tool that manages the same list, so the
 *   rules (reserved names, label shape, a restricted app kept off its own address) cannot differ by
 *   door. Serving a request on a label is not here: that is routes/subdomains.ts, on the hot path.
 *
 *   Who may call these is the caller's decision, not this file's: the routes put them behind
 *   requireOperatorPrincipal with operator:admin. `createdBy` is the caller's resolved identity.
 * @structure
 *   - SubdomainRefusal: { ok: false, status, code, message }, the refusal each door renders
 *   - SubdomainSiteInput: the body fields (subdomain, kind, target, enabled), unvalidated
 *   - listSubdomainSites(storage)
 *   - createSubdomainSite(storage, config, input, createdBy)
 *   - updateSubdomainSite(storage, config, subdomain, input)
 *   - deleteSubdomainSite(storage, subdomain)
 * @usage
 *   import { createSubdomainSite } from '../services/subdomain-sites.js';
 *   const out = await createSubdomainSite(storage, config, req.body ?? {}, resolveIdentity(req.auth!, config.nodeId));
 *   if (!out.ok) return res.status(out.status).json(error(config.nodeId, out.code, out.message));
 * @version-history
 *   v1.1.0 — 2026-10-06 — A name ending in `--draft` is refused: it is the address of an app's draft
 *     (secaudit 2026-10 follow-up, A2).
 *   v1.0.0 — 2026-09-27 — Extracted from routes/subdomain-admin.ts v1.0.0, same validation, codes,
 *     messages and writes, when an agent holding operator:admin was allowed to manage the list.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, SubdomainSiteRecord } from '../storage/interface.js';
import {
  RESERVED_SUBDOMAINS, SUBDOMAIN_RE, resolveAppTarget, appIsRestricted, draftBaseLabel, DRAFT_LABEL_SUFFIX,
} from '../routes/subdomains.js';

/** A refusal, in the shape each door renders as its own error envelope. */
export interface SubdomainRefusal {
  ok: false;
  status: 400 | 404 | 409;
  code: 'INVALID_SUBDOMAIN' | 'RESERVED_SUBDOMAIN' | 'INVALID_KIND' | 'INVALID_TARGET'
    | 'APP_NOT_FOUND' | 'APP_RESTRICTED' | 'ALREADY_EXISTS' | 'NOT_FOUND';
  message: string;
}

/** The fields a caller sends, as received. Every one is validated here. */
export interface SubdomainSiteInput {
  subdomain?: unknown;
  kind?: unknown;
  target?: unknown;
  enabled?: unknown;
}

function refuse(status: SubdomainRefusal['status'], code: SubdomainRefusal['code'], message: string): SubdomainRefusal {
  return { ok: false, status, code, message };
}

/** Validates a kind+target pair. Null when it holds. */
async function checkTarget(storage: Storage, config: AimeatConfig, kind: string, target: string): Promise<SubdomainRefusal | null> {
  if (kind === 'redirect') {
    if (!/^https?:\/\/\S+$/.test(target)) {
      return refuse(400, 'INVALID_TARGET', 'Redirect target must be an absolute http(s) URL');
    }
    return null;
  }
  // kind === 'app'
  const app = await resolveAppTarget(storage, target);
  if (!app) {
    return refuse(404, 'APP_NOT_FOUND', `No published app matches target "${target}" (expected "owner/filename")`);
  }
  if (appIsRestricted(config, app)) {
    return refuse(400, 'APP_RESTRICTED', 'An app that needs a code or a payment cannot sit at its own web address. Serve it from the main site instead.');
  }
  return null;
}

/** Every mapping on the node. */
export async function listSubdomainSites(storage: Storage): Promise<{ sites: SubdomainSiteRecord[]; total: number }> {
  const sites = await storage.listSubdomainSites();
  return { sites, total: sites.length };
}

/**
 * Create a mapping. `kind` defaults to 'app' and `enabled` to true. Refuses a malformed or reserved
 * label, an unknown kind, a missing or invalid target, and a label that is already mapped.
 */
export async function createSubdomainSite(
  storage: Storage,
  config: AimeatConfig,
  input: SubdomainSiteInput,
  createdBy: string,
): Promise<{ ok: true; site: SubdomainSiteRecord } | SubdomainRefusal> {
  const subdomain = String(input.subdomain ?? '').trim().toLowerCase();
  const kind = String(input.kind ?? 'app');
  const target = String(input.target ?? '').trim();
  const enabled = input.enabled === undefined ? true : Boolean(input.enabled);

  if (!SUBDOMAIN_RE.test(subdomain)) {
    return refuse(400, 'INVALID_SUBDOMAIN',
      'Subdomain must be 2-63 chars of lowercase a-z, 0-9 and hyphens, not starting or ending with a hyphen');
  }
  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    return refuse(400, 'RESERVED_SUBDOMAIN', `The name "${subdomain}" is kept for the node itself. Choose a different one.`);
  }
  // `<sub>--draft` is the address of an app's draft (routes/subdomains.ts DRAFT_LABEL_SUFFIX).
  if (draftBaseLabel(subdomain) !== null) {
    return refuse(400, 'RESERVED_SUBDOMAIN', `A name ending in "${DRAFT_LABEL_SUFFIX}" is kept for an app's draft. Choose a different one.`);
  }
  if (kind !== 'app' && kind !== 'redirect') {
    return refuse(400, 'INVALID_KIND', 'kind must be "app" or "redirect"');
  }
  if (!target) {
    return refuse(400, 'INVALID_TARGET', 'target is required');
  }
  const bad = await checkTarget(storage, config, kind, target);
  if (bad) return bad;

  if (await storage.getSubdomainSite(subdomain)) {
    return refuse(409, 'ALREADY_EXISTS', `Subdomain "${subdomain}" is already mapped`);
  }

  const now = new Date().toISOString();
  const site: SubdomainSiteRecord = {
    subdomain, kind, target, enabled,
    createdBy,
    createdAt: now, updatedAt: now,
  };
  await storage.createSubdomainSite(site);
  return { ok: true, site };
}

/**
 * Update kind, target or enabled on an existing mapping. The effective kind+target pair is validated
 * again whenever either changes. `site` is what storage answers after the write.
 */
export async function updateSubdomainSite(
  storage: Storage,
  config: AimeatConfig,
  subdomainRaw: string,
  input: SubdomainSiteInput,
): Promise<{ ok: true; site: SubdomainSiteRecord | null } | SubdomainRefusal> {
  const subdomain = subdomainRaw.trim().toLowerCase();
  const existing = await storage.getSubdomainSite(subdomain);
  if (!existing) {
    return refuse(404, 'NOT_FOUND', `Subdomain "${subdomain}" is not mapped`);
  }

  const updates: Partial<Pick<SubdomainSiteRecord, 'kind' | 'target' | 'enabled'>> = {};
  if (input.kind !== undefined) {
    if (input.kind !== 'app' && input.kind !== 'redirect') {
      return refuse(400, 'INVALID_KIND', 'kind must be "app" or "redirect"');
    }
    updates.kind = input.kind;
  }
  if (input.target !== undefined) updates.target = String(input.target).trim();
  if (input.enabled !== undefined) updates.enabled = Boolean(input.enabled);

  // Cross-validate the effective kind/target pair when either changes
  if (updates.kind !== undefined || updates.target !== undefined) {
    const kind = updates.kind ?? existing.kind;
    const target = updates.target ?? existing.target;
    if (!target) {
      return refuse(400, 'INVALID_TARGET', 'target is required');
    }
    const bad = await checkTarget(storage, config, kind, target);
    if (bad) return bad;
  }

  const site = await storage.updateSubdomainSite(subdomain, updates);
  return { ok: true, site };
}

/** Remove a mapping. NOT_FOUND when the label was not mapped. */
export async function deleteSubdomainSite(
  storage: Storage,
  subdomainRaw: string,
): Promise<{ ok: true; deleted: true; subdomain: string } | SubdomainRefusal> {
  const subdomain = subdomainRaw.trim().toLowerCase();
  const deleted = await storage.deleteSubdomainSite(subdomain);
  if (!deleted) {
    return refuse(404, 'NOT_FOUND', `Subdomain "${subdomain}" is not mapped`);
  }
  return { ok: true, deleted: true, subdomain };
}
