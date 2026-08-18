/**
 * @file apps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description App Catalog routes -- single-file HTML apps with manifest, version
 *   history, search, screenshot, and access-code-gated download. Apps are stored
 *   in the dedicated apps table. Each publish auto-increments the version number;
 *   old versions are preserved. Screenshots use the storage system with key prefix
 *   `apps/screenshots/`. Route handlers live in sibling modules under ./apps/
 *   (registered in original declaration order — Express matches top-to-bottom).
 * @structure
 *   - appsRouter() -- main router factory + the shared canonicalOwner closure
 *   - apps/catalogue-admin.ts -- GET /v1/apps + /v1/admin/apps operator moderation
 *   - apps/read.ts -- versions, forks, lineage, screenshot GET/POST/DELETE, download
 *   - apps/publish.ts -- POST /v1/apps (inline/presigned publish/update)
 *   - apps/drafts.ts -- draft save/preview-token/discard/publish-draft
 *   - apps/fork-manage.ts -- fork, PATCH, DELETE
 *   - apps/helpers.ts -- appOriginUrl + CanonicalOwner type
 * @version-history
 *   v1.0.0 -- pre-2026-05 -- Initial app catalog with versions, manifest, search
 *   v1.1.0 -- 2026-05-29 -- Add strict base64 validation to POST /v1/apps inline
 *     content path. Buffer.from(str, 'base64') silently dropped non-base64 chars
 *     and accepted raw HTML, yielding successful publishes with tiny garbage
 *     payloads served as 200 to downloaders. Now rejects with 400 INVALID_INPUT
 *     before storage write.
 *   v1.2.0 -- 2026-06-05 -- GET download tolerates the legacy full-GHII owner
 *     segment (owner@node) by retrying the lookup with the bare prefix, so links
 *     shared before ownerName normalization still resolve. Fix /versions and
 *     /screenshot routes: they scanned per-agent GAII buckets, but apps + their
 *     screenshots live in the owner's GHII bucket, so both 404'd for every app
 *     published under the current scheme. Now resolve the row via
 *     getAppByOwnerName() and read that bucket directly.
 *   v1.3.0 -- 2026-06-09 -- Canonicalize the owner before computing the storage
 *     bucket in publish/patch/delete (canonicalOwner): strip any @node suffix
 *     and resolve to the owner's GHII. The raw `owner` claim varies by identity
 *     form (dashboard bare name vs MCP/PAT full GHII), which forked the same
 *     owner's app into two buckets with independent version counters. The
 *     startup mergeForkedAppBuckets() migration consolidates pre-existing forks.
 *   v1.4.0 -- 2026-06-16 -- Record a public-activity-feed event on publish/update.
 *   v1.5.0 -- 2026-06-20 -- H-2: when the app origin is provisioned (config.appOriginEnabled),
 *     301-redirect apex inline (runnable) app requests to the isolated app origin
 *     (appOriginUrl: assigned subdomain, else apps.<apex>/<owner>/<file>).
 *   v1.6.0 -- 2026-06-20 -- Add POST /v1/apps/:owner/:filename/screenshot: set/replace an app's
 *     screenshot without re-publishing (owner OR operator). Backs the screenshot worker + manual
 *     override. createStorageFile upserts, so it overwrites any existing screenshot.
 *   v1.7.0 -- 2026-06-20 -- Require a non-empty description when publishing a NEW app (so the
 *     catalogue + landing wall always have one); on an update, carry the existing description
 *     forward when omitted so a re-publish / restore never blanks it.
 *   v1.8.0 -- 2026-06-20 -- appOriginUrl auto-assigns a per-app subdomain (ensureAppSubdomain) so the
 *     apex inline 301 lands on the app's own origin → seamless SSO works with no manual subdomain step.
 *   v1.9.0 -- 2026-06-20 -- Add DELETE /v1/apps/:owner/:filename/screenshot: clear a screenshot
 *     (owner OR operator) without rendering a new one — the scheduled auto-capture job recaptures it
 *     on its next scan (DoS-safe "refresh thumbnail", no on-demand render).
 *   v1.10.0 -- 2026-06-20 -- Parked-app state: GET /v1/apps takes optionalAuth and includes the
 *     caller's own parked apps (hidden from everyone else); responses carry `parked`; PATCH accepts
 *     a `parked` boolean (now field-aware so it no longer clears access_code on a parked-only call);
 *     a re-publish inherits the existing parked state.
 *   v1.11.0 -- 2026-06-24 -- Inline-served HTML apps get a small fixed "aimeat.io · publish your
 *     own app — free" attribution badge appended (injectAimeatBadge): a shared app link is often a
 *     visitor's first contact with AIMEAT, so give them a way to the project + a publish CTA.
 *     Permanent aimeat.io mark (free hosting), idempotent, HTML-only; raw download stays byte-exact.
 *     Content-Length now reflects the injected body.
 *   v1.12.0 -- 2026-06-24 -- Operator moderation: GET /v1/admin/apps (operator) lists every app
 *     including parked + operator-hidden; POST /v1/admin/apps/:owner/:filename/moderate hides/
 *     restores an app from EVERY public surface. operator-hidden apps drop out of /v1/apps for
 *     everyone but the owner (who gets a "moderated by operator: hidden" badge and cannot lift it)
 *     and 404 on direct download for non-owner/non-operator; the flag survives a re-publish so an
 *     owner cannot re-upload to escape moderation. Responses carry operator_hidden + reason.
 *   v1.13.0 -- 2026-06-25 -- Operator hard delete: DELETE /v1/admin/apps/:owner/:filename (operator)
 *     permanently removes an app (every version + screenshot, any owner) from the node — the
 *     irreversible counterpart to the moderation hide.
 *   v1.14.0 -- 2026-07-06 -- Inline-app CSP: font-src gains 'self' so an app can @font-face fonts
 *     from its own origin's public storage (/v1/pub/...). https: already covered prod app origins
 *     but not the http://*.apps.localhost dev origin; 'self' is a tightening-style addition
 *     (same-origin only), verified against the TDR-kit font test (securitypolicyviolation on dev).
 *   v1.15.0 -- 2026-07-07 -- Fork control + provenance: POST /v1/apps/:owner/:filename/fork copies an
 *     app into the caller's catalogue behind two gates — derivative permission (owner/their agents/
 *     operator always; outsiders only when `forkable`) and the paid-app paywall — stamping
 *     manifest.forkedFrom and recording an app_forks lineage event. PATCH accepts a `forkable`
 *     boolean; it survives a re-publish; responses carry `forkable`. Replaces the old client-only
 *     read+republish fork (which had no gate or provenance).
 *   v1.16.0 -- 2026-07-07 -- Fork stats + lineage (Phase 2): listings carry a `forks` count (direct
 *     children); GET /v1/apps/:owner/:filename/forks lists the direct forks with each one's live
 *     status (public/parked/hidden/deleted); GET .../lineage returns the full cross-owner fork tree
 *     (ancestry via forkedFrom + descendants via app_forks, surviving deletions) as nodes/edges.
 *   v1.17.0 -- 2026-07-07 -- Copy-protection (Phase 3): opt-in manifest.protection
 *     (obfuscate/domainLock/watermark/noRawDownload) accepted on publish + PATCH, carried forward on
 *     re-publish, applied to inline serves via applyAppProtection; the raw download 403s when
 *     noRawDownload is set (owner/operator exempt); POST /v1/admin/apps/watermark/decode traces a
 *     leaked fingerprint. Phase 4: GET /v1/admin/apps/similar flags unattributed copies (high
 *     similarity with no fork link) + watermark hits.
 *   v1.18.0 -- 2026-07-10 -- Re-publish carries category, usesCortex and icon forward when the
 *     caller omits them (matching description/protection), so an update never silently resets the
 *     manifest to category 'utility' + empty cortex refs + no icon (TARGET-021 Aalto 1).
 *   v1.19.0 -- 2026-07-13 -- Split route handlers into sibling modules under ./apps/ (max-file-lines);
 *     pure extraction, registration order + behavior preserved.
 *   v1.20.0 -- 2026-07-16 -- Agent-Bundled Apps Slice 1: apps/agents-deploy.ts — deploy/undeploy/
 *     status for crew-defs declared under manifest.cortex.agents (owner-scoped pointer tasks).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import type { CanonicalOwner } from './apps/helpers.js';
import { registerCatalogueAdminRoutes } from './apps/catalogue-admin.js';
import { registerReadRoutes } from './apps/read.js';
import { registerPublishRoutes } from './apps/publish.js';
import { registerDraftRoutes } from './apps/drafts.js';
import { registerForkManageRoutes } from './apps/fork-manage.js';
import { registerAppAgentRoutes } from './apps/agents-deploy.js';

export function appsRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
    const router = Router();

    // Apps are OWNER-scoped. The same owner can authenticate under different
    // identity forms: the dashboard presents the bare owner name as the `owner`
    // claim, while MCP / a Personal Access Token presents the full GHII
    // (`owner@node`). Left unnormalized, those forks the owner into two app
    // buckets with independent version counters. Strip any `@node` suffix to a
    // single bare owner name, then resolve to the owner's canonical GHII via the
    // identity table — the SAME key the startup `mergeForkedAppBuckets()`
    // migration consolidates onto, so route and migration never diverge.
    const canonicalOwner: CanonicalOwner = async (req) => {
        const rawOwner = req.auth!.owner;
        const owner = rawOwner.includes('@') ? rawOwner.split('@')[0] : rawOwner;
        const ownerGhii = await resolveGhii(storage, owner, `${owner}@${config.nodeId}`);
        return { owner, ownerGhii };
    };

    registerCatalogueAdminRoutes(router, config, storage, peers, canonicalOwner);
    registerReadRoutes(router, config, storage, canonicalOwner);
    registerPublishRoutes(router, config, storage, canonicalOwner);
    registerDraftRoutes(router, config, storage, canonicalOwner);
    registerForkManageRoutes(router, config, storage, canonicalOwner);
    registerAppAgentRoutes(router, config, storage);

    return router;
}
