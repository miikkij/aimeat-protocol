/**
 * @file app-grant-auto.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description When the app-grant consent page (app-grant.js) approves a request with no screen.
 *   Pure functions, no imports, so a unit test reads them as they ship. The server decides `own` again
 *   at consent time (routes/app-grants.ts authorize-consent), so these choose what the person sees;
 *   they are not the gate on what the grant holds.
 * @structure isOwnApp(request, myOwner) · ownAppAsks(request, grant) · autoApproves(request, myOwner, grant)
 * @usage if (autoApproves(res.data, myOwner, grant)) setState({ status: 'autoapprove', request: res.data });
 * @version-history
 *   2026-10-25 — ownAppAsks: the owner's own app shows the screen for scopes the grant lacks when
 *     another account published the live version or the owner narrowed the grant (secaudit2026oct22).
 *   2026-10-24 — Extracted from app-grant.js for a unit test. A covering grant approves with no screen
 *     only on a bound request (secaudit2026oct22).
 */

/**
 * The signed-in owner's OWN app: the request's redirect is bound to exactly this app (origin_bound),
 * the person is its owner, and no package installed it (a package-installed app is somebody else's
 * code under the owner's name).
 * @param {{ origin_bound?: boolean, app_owner?: string|null, package_app?: boolean }} request - GET /v1/app-grants/request/:id data
 * @param {string} myOwner - the signed-in account name
 * @returns {boolean}
 */
export function isOwnApp(request, myOwner) {
  return !!(request.origin_bound && request.app_owner && myOwner && myOwner === request.app_owner && !request.package_app);
}

/**
 * The owner's own app still asks its owner: another account published the live version
 * (`published_by_other`), or the owner narrowed the grant by hand (`scopes_fixed_at`), and the app
 * asks for a scope the grant does not hold. The silent bridge asks in the same two cases
 * (services/own-app-consent.ts).
 * @param {{ published_by_other?: string|null, scopes?: Array<{ scope: string }> }} request
 * @param {{ scopes: string[], scopes_fixed_at?: string|null }|null} grant
 * @returns {boolean}
 */
export function ownAppAsks(request, grant) {
  if (!request.published_by_other && !grant?.scopes_fixed_at) return false;
  const held = grant?.scopes || [];
  return (request.scopes || []).some((s) => !held.includes(s.scope));
}

/**
 * Approve with no screen: the owner's own app, or an app whose live grant already covers every scope
 * it asks for. Never in manage mode (the gear), which always shows the screen. Both need a bound
 * request (origin_bound: the redirect is the requesting app's own address). An unbound redirect can
 * name another app's page, which would receive the code, so the person sees the screen and decides.
 * @param {{ origin_bound?: boolean, app_owner?: string|null, package_app?: boolean, manage?: boolean, scopes?: Array<{ scope: string }> }} request
 * @param {string} myOwner - the signed-in account name
 * @param {{ scopes: string[] }|null} grant - the live grant this person holds for the app, or null
 * @returns {boolean}
 */
export function autoApproves(request, myOwner, grant) {
  if (request.manage || !request.origin_bound) return false;
  if (isOwnApp(request, myOwner)) return !ownAppAsks(request, grant);
  const reqScopes = (request.scopes || []).map((s) => s.scope);
  return !!grant && reqScopes.every((s) => grant.scopes.includes(s));
}
