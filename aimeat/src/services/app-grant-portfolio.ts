/**
 * @file src/services/app-grant-portfolio.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ceiling of a token minted for a PORTFOLIO origin on the silent bridge (audit H-9).
 *   Moved unchanged from routes/app-grants.ts, which reached the 800-line ceiling; the route
 *   re-exports PORTFOLIO_GRANT_SCOPES.
 * @structure PORTFOLIO_GRANT_SCOPES · isPortfolioTarget() · capPortfolioScopes()
 * @usage const requested = isPortfolioTarget(target) ? capPortfolioScopes(asked) : asked;
 * @version-history
 *   v1.0.0 — 2026-10-25 — Moved from routes/app-grants.ts, unchanged (line limit; secaudit2026oct22).
 */
import { PORTFOLIO_TARGET_PREFIX } from './app-origin-target.js';

/**
 * The most a token minted for a PORTFOLIO origin may carry.
 *
 * A portfolio origin exists for one job: the owner visiting their own published page sees their own
 * members-only content there without logging in a second time. Reading memory is all that takes, and
 * the node already publishes exactly this answer twice — `services/protected-resource.ts` returns
 * `scopes_supported: ['memory:read']` for a portfolio origin, and `routes/subdomains.ts` injects a
 * matching `<meta name="aimeat-scopes" content="memory:read">` into every portfolio it serves. Both
 * of those still write the word out inline; when either is next touched, import it from here, so the
 * ceiling has one home instead of three.
 */
export const PORTFOLIO_GRANT_SCOPES: readonly string[] = ['memory:read'];

/** Is this grant target a portfolio origin rather than a published app? */
export function isPortfolioTarget(target: string): boolean {
  return target.startsWith(PORTFOLIO_TARGET_PREFIX);
}

/**
 * Trim a scope request down to what a portfolio origin may receive.
 *
 * AUDIT H-9. The silent bridge used to hand a portfolio whatever the PAGE asked for, and a portfolio
 * page writes that ask itself, twice over: the SDK reads the FIRST `<meta name="aimeat-scopes">`
 * while the node appends its own last, and a page can skip the SDK and build the /app-silent.html
 * iframe with any `?scope=` it likes. Portfolio HTML is served with `unsafe-inline`, so any script
 * that lands in a portfolio inherits that reach, and the inner fetch is apex-to-apex, so the
 * `Sec-Fetch-Site` caller check does not see it. The ceiling was the node's published answer already;
 * the bridge was the one door not reading it.
 *
 * A scope outside the ceiling is dropped rather than refused, and an empty result falls back to the
 * ceiling, so the members-only content the origin exists for keeps working either way.
 *
 * This NARROWS the escalation, it does not close it. A standing memory:read grant reaches the
 * owner's whole namespace, which is a lot of data, and a page holding that token can post it
 * anywhere `connect-src https:` allows. The root is the unconditional own-app branch in the silent
 * bridge, which hands any origin the owner happens to own whatever it asks for, and replacing that
 * with something the owner actually decides is a larger piece of work than this cap.
 */
export function capPortfolioScopes(requested: string[]): string[] {
  const capped = requested.filter(s => PORTFOLIO_GRANT_SCOPES.includes(s));
  return capped.length ? capped : [...PORTFOLIO_GRANT_SCOPES];
}
