/**
 * @file src/routes/subdomain-webmcp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The WebMCP tool surface on an APP ORIGIN. An agent that finds an app lands on
 *   `<app>.apps.<node>`, and that origin already serves the page, `llms.txt`, the MCP server card
 *   and the RFC 9728 resource document. The tools themselves lived only on the apex, so the app's
 *   own agent-facing document had to point away from the origin the agent was standing on, and a
 *   POST to `/webmcp/tools/<tool>` there answered 404. This rewrites to the apex path rather than
 *   redirecting, so one POST reaches the same handler with the same body and no follow.
 * @structure AppOriginDeps · registerAppOriginWebmcp(router, storage, deps) — one `router.all` for `/webmcp*`
 * @usage Called from subdomainServeRouter, which is mounted BEFORE the WebMCP router; that order
 *   is what makes the rewrite land.
 * @version-history
 *   v1.0.0 — 2026-07-29 — Extracted from subdomains.ts (max-file-lines) as it was written.
 */
import type { Router, Request, Response } from 'express';
import type { Storage } from '../storage/interface.js';

/**
 * The two lookups this needs, handed in rather than imported: both are private to subdomains.ts,
 * and importing them back from the module that calls this one would make the cycle real.
 */
export interface AppOriginDeps {
  resolveApp: (target: string) => Promise<{ ownerName: string; filename: string } | null>;
  isRestricted: (app: { ownerName: string; filename: string }) => boolean;
}

/**
 * Serve `/webmcp` and `/webmcp/...` on an app origin by rewriting to the apex route.
 *
 * The app is resolved from the SUBDOMAIN rather than through `appForOrigin`, which additionally
 * requires the app-origin feature flag. Gating a path rewrite on a feature flag makes it invisible
 * wherever the flag is off, which includes every test environment — the first version of this did
 * exactly that, and its own test 404'd with the fix in place.
 */
export function registerAppOriginWebmcp(router: Router, storage: Storage, deps: AppOriginDeps): void {
  router.all(['/webmcp', '/webmcp/*splat'], async (req: Request, res: Response, next) => {
    const sub = req.subdomain;
    if (!sub) return next();
    const site = await storage.getSubdomainSite(sub);
    if (!site || !site.enabled || site.kind !== 'app') return next();
    const app = await deps.resolveApp(site.target);
    if (!app || deps.isRestricted(app)) return next();
    const suffix = req.url.slice('/webmcp'.length);   // '' | '/tools/x' | '/tools/x?a=b'
    req.url = `/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}/webmcp${suffix}`;
    next();
  });
}
