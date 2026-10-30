/**
 * @file spa-page-paths.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The page addresses the SPA shell serves under /v1/, in ONE list. Two readers:
 *   routes/portal.ts serves spa.html on each of them, and middleware/content-access-gate.ts lets
 *   each of them through on a signed-in-only node. A browser keeps its session in localStorage, so
 *   a page opened from a link carries no credential even for a signed-in person, and an address the
 *   gate does not know answers a JSON 401 instead of the page.
 *
 *   The two lists were written out separately until 2026-10-30, and three addresses had reached the
 *   router and not the gate: /v1/appcat/structure, /v1/secret-allow and /v1/eco-capability-allow.
 *   On innokas.aimeat.io the structure page link an AI handed out showed SIGN_IN_REQUIRED, while
 *   the same page opened through the catalogue worked, because that was a client-side change of
 *   page. Every address here is also in spa.html's ROUTES, or a refresh shows the wrong view.
 * @structure SPA_PAGE_PATHS
 * @usage import { SPA_PAGE_PATHS } from '../data/spa-page-paths.js';
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial: moved out of routes/portal.ts with its comments, and read by the
 *     content access gate too.
 */

export const SPA_PAGE_PATHS: readonly string[] = [
  '/v1/profile',
  // The built-in chat. Registered here AND in spa.html's ROUTES, or F5 is a 404.
  '/v1/chat',
  // KOTI — the remake's home path. Registered here AND in spa.html's ROUTES: without both,
  // the view works on a client-side click and 404s on a refresh.
  '/v1/home',
  '/v1/aimeat-os',
  '/v1/app-store',
  '/v1/classic',
  '/v1/portfolio',
  // The Agents section (Agent v2 V3). Registered here AND in spa.html's ROUTES.
  '/v1/fleet',
  '/v1/members',
  '/v1/admin',
  // appcat, the app catalogue on the component library (2026-09-27). Registered here AND in
  // spa.html's ROUTES; the old /app-catalog.html stays as it is.
  '/v1/appcat',
  // One app's structure and status (views/appcat/structure.js, 2026-10-29). Here AND in spa.html.
  '/v1/appcat/structure',
  // The design lab's preview page, which the lab shows in frames. Registered here AND in
  // spa.html's ROUTES.
  '/v1/design-lab/frame',
  '/v1/help',
  '/v1/publicknowledgeviewer',
  '/v1/publicworkspaceviewer',
  // /v1/pricing left this list on 2026-08-28: the page is gone and the address redirects
  // (routes/portal.ts).
  '/v1/how-it-works',
  // The showroom's two companions (2026-08-28): the whole change log, and how an app gets built.
  '/v1/changelog',
  '/v1/how-an-app-builds',
  // The connect story (2026-08-29): the road from "connect the AI you already use" to the
  // guided path, told before the account exists.
  '/v1/connect-your-ai',
  // Everything in AIMEAT (2026-09-15): the whole feature list as a page. Registered here AND in
  // spa.html's ROUTES, or F5 is a 404; /everything is its short address.
  '/v1/everything',
  '/v1/glossary',
  '/v1/business',
  // The human sibling of the machine-readable statement at /v1/ai-transparency. A different
  // path on purpose: that one is JSON and is mounted ahead of the portal router, so a page there
  // would never be reached, and a compliance statement is not a surface to route by Accept.
  '/v1/transparency',
  '/v1/start',
  '/v1/app-grant',   // H-2 app-grant consent page (SPA)
  '/v1/app-open',    // Opening an app or a page that needs a sign-in (SPA, ?app=<owner>/<file>, ?portfolio=<user>, ?company=<id>; routes/apps/open.ts, routes/page-open.ts)
  '/v1/invite',      // Email-invitation accept page (SPA, token in ?token=)
  '/v1/oauth-round', // The owner confirms a sign-in round an agent started (SPA, ?state=)
  '/v1/allow',       // The owner allows what their agent asked for with one press (SPA, ?agent=&need=)
  '/v1/secret-allow', // The owner allows an extension to send a secret to one address (SPA, ?secret=&extension=&host=)
  '/v1/eco-capability-allow', // The owner allows another account's capability to run one action of their outside app (SPA, ?app=&capability=)
];
