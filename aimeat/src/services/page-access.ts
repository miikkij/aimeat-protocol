/**
 * @file src/services/page-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may OPEN an owner's welcome page (the portfolio) and a company's front page (plan
 *   doc-mvcn6c7e4e5q, V3.10). The same three values an app's `open_to` takes (services/app-access.ts),
 *   and the same decision behind them (services/audience.ts):
 *
 *     anyone          the default, stored as no value: the address opens the page, as before.
 *     signed-in       any account of this node, and its agents and apps.
 *     organism:<id>   the members of one organism.
 *
 *   Stored as `access` in the owner's `portfolio.config` record and as `frontPageAccess` on the
 *   company record. A setter names an organism only when the account behind it is an active member
 *   (services/organism-visibility.ts organismVisibilityRefusal, the check a memory record's
 *   visibility gets).
 *
 *   The page origins hold no session, so a page that needs a sign-in is served there only with a
 *   page grant (services/app-access-token.ts pageAccessGranted), which POST /v1/portfolio/:user/open
 *   and POST /v1/companies/:id/open hand out (routes/page-open.ts).
 * @structure PageAccess · pageAccessOf · parsePageAccessInput · pageNeedsSignIn · mayOpenPage ·
 *   pageOpenPath · pageAccessLevel
 * @usage
 *   const parsed = await parsePageAccessInput(storage, body.access, { identity: principal });
 *   if ('refusal' in parsed) → 400; else store parsed.store
 *   if (pageNeedsSignIn(config, stored) && !(await mayOpenPage(storage, config, stored, req.auth))) → refuse
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V3.10).
 */
import type { Storage } from '../storage/interface.js';
import type { ContentAccess } from '../config-visibility.js';
import { parseAppAccessInput, appAccessOf, appAudience, type AppAccess } from './app-access.js';
import { audienceAllows, type AudienceAuth } from './audience.js';
import { organismVisibilityRefusal } from './organism-visibility.js';
import type { PageRef } from './app-access-token.js';

/** What an owner writes and what a read answers: the app's three words. */
export type PageAccess = AppAccess;

const asStored = (stored: unknown): { access?: string } => (typeof stored === 'string' ? { access: stored } : {});

/** The stored value as the owner reads it: 'anyone' for no value. */
export function pageAccessOf(stored: unknown): PageAccess {
  return appAccessOf(asStored(stored));
}

/**
 * Read a setter's `access`. Returns the value to STORE (null for anyone), or the refusal: a value that
 * is none of the three, or an organism the account behind the setter is not an active member of.
 * `writer.identity` is the setter's identity (a GHII or an agent GAII); the account is read from it.
 */
export async function parsePageAccessInput(
  storage: Storage, value: unknown, writer: { identity: string; federated?: boolean },
): Promise<{ store: string | null } | { refusal: { status: 400; code: string; message: string } }> {
  const parsed = parseAppAccessInput(value);
  if ('refusal' in parsed) return { refusal: { status: 400, code: 'INVALID_INPUT', message: parsed.refusal } };
  const refused = await organismVisibilityRefusal(storage, parsed.store, writer);
  if (refused) return { refusal: { status: 400, code: refused.code, message: refused.message } };
  return parsed;
}

/** True when opening the page needs a sign-in (its own setting, or the node's signed-in content access). */
export function pageNeedsSignIn(config: { contentAccess?: ContentAccess }, stored: unknown): boolean {
  return appAudience(config, asStored(stored)) !== null;
}

/** Does this caller pass the page's sign-in gate? True when the page has none. The owner is the caller's to exempt. */
export async function mayOpenPage(
  storage: Storage, config: { contentAccess?: ContentAccess }, stored: unknown, auth: AudienceAuth | null | undefined,
): Promise<boolean> {
  const audience = appAudience(config, asStored(stored));
  return audience === null || audienceAllows(storage, audience, auth);
}

/** The SPA page that opens a page needing a sign-in: the same page an app uses (routes/apps/open.ts appOpenPage). */
export function pageOpenPath(ref: PageRef): string {
  return ref.kind === 'portfolio'
    ? `/v1/app-open?portfolio=${encodeURIComponent(ref.owner)}`
    : `/v1/app-open?company=${encodeURIComponent(ref.id)}`;
}

/** The exposure level the page's own setting names (the node's signed-in setting is the report's to apply). */
export function pageAccessLevel(stored: unknown): { level: 'public' | 'signed-in' | 'organism'; organism_id?: string } {
  const own = pageAccessOf(stored);
  if (own === 'anyone') return { level: 'public' };
  if (own === 'signed-in') return { level: 'signed-in' };
  return { level: 'organism', organism_id: own.slice('organism:'.length) };
}
