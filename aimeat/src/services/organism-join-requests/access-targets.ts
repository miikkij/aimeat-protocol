/**
 * @file src/services/organism-join-requests/access-targets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an access request names: an app, a welcome page or a company front page, found
 *   the way its open route finds it, with the label the approver reads. One finder per kind, called
 *   by the access-request routes (routes/apps/open.ts, routes/portfolio.ts, routes/companies.ts) and
 *   by the MCP tool aimeat_access_request, so both answer "no such target" for the same targets.
 * @structure appAccessTarget · portfolioAccessTarget · companyAccessTarget · accessTargetOf
 * @usage const target = await appAccessTarget(storage, config, req.auth, `${owner}/${filename}`);
 * @version-history
 *   v1.0.0 — 2026-11-12 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { isNodeAccount } from '../audience.js';
import { operatorOverride, type OperatorAuth } from '../operator-override.js';
import { resolvePublishedPortfolio } from '../portfolio/published.js';
import { isSameAccount } from '../../utils/same-account.js';
import { localAccountName } from '../../utils/gaii.js';
import type { AccessRequestTarget } from './requests.js';

/**
 * The app `<owner>/<filename>`. Null for a missing app, and for an app an operator hid, which is
 * missing to everyone but its owner and the operator. The label is the app's name.
 */
export async function appAccessTarget(
  storage: Storage, config: AimeatConfig, auth: OperatorAuth | null | undefined, target: string,
): Promise<AccessRequestTarget | null> {
  // `<owner>/<filename>`, the owner as an account name or a full GHII: the lookup of
  // routes/subdomain-app-gate.ts resolveAppTarget, which the open route uses.
  const slash = target.indexOf('/');
  if (slash <= 0 || slash === target.length - 1) return null;
  const owner = target.slice(0, slash), filename = target.slice(slash + 1);
  const bare = localAccountName(owner);
  const app = await storage.getAppByOwnerName(owner, filename)
    ?? (bare !== owner ? await storage.getAppByOwnerName(bare, filename) : null);
  if (!app) return null;
  const isOwner = isNodeAccount(auth) && isSameAccount(auth!.owner, app.ownerName);
  if (app.operatorHidden && !isOwner && !(await operatorOverride(
    storage, config, auth, { ownerOf: app.ownerName, area: 'app', action: 'read', subject: app.filename }))) return null;
  return {
    access: app.access, ownerName: app.ownerName,
    via: { kind: 'app', ref: `${app.ownerName}/${app.filename}`, label: app.manifest?.name || app.filename },
  };
}

/**
 * The welcome page of an account. Null where its open route answers 404: no account, or no
 * published page. The label is the page owner's account name.
 */
export async function portfolioAccessTarget(storage: Storage, username: string): Promise<AccessRequestTarget | null> {
  const resolved = await resolvePublishedPortfolio(storage, username);
  if (!resolved.ok || !resolved.html) return null;
  const ownerName = resolved.ghii.username;
  return { access: resolved.portfolioConfig.access, ownerName, via: { kind: 'portfolio', ref: ownerName, label: ownerName } };
}

/**
 * The front page of a company. Null where its open route answers 404: no company, one that is not
 * active, or one that serves nothing. The label is the company's name.
 */
export async function companyAccessTarget(storage: Storage, id: string): Promise<AccessRequestTarget | null> {
  const company = await storage.getCompany(id);
  if (!company || company.status !== 'active' || company.frontPage.kind === 'none') return null;
  return {
    access: company.frontPageAccess, ownerName: localAccountName(company.ownerGhii),
    via: { kind: 'company', ref: company.id, label: company.name },
  };
}

/**
 * The target a caller named by kind and ref, for a surface that takes all three kinds in one call
 * (the MCP tool). Null when the kind is none of the three or the ref names nothing that can be opened.
 */
export async function accessTargetOf(
  storage: Storage, config: AimeatConfig, auth: OperatorAuth | null | undefined, kind: unknown, ref: unknown,
): Promise<AccessRequestTarget | null> {
  if (typeof ref !== 'string' || !ref) return null;
  if (kind === 'app') return appAccessTarget(storage, config, auth, ref);
  if (kind === 'portfolio') return portfolioAccessTarget(storage, ref);
  if (kind === 'company') return companyAccessTarget(storage, ref);
  return null;
}
