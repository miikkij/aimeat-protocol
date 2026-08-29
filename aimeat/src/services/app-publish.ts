/**
 * @file src/services/app-publish.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE one act of publishing an app version. Three doors lead here — `POST /v1/apps`
 *   (inline base64), the presigned upload completion (`PUT /v1/upload/:token`, utype `app`), and
 *   `POST /v1/apps/:owner/:filename/publish-draft` — and after this file they differ only in how
 *   they OBTAIN the bytes and how they SHAPE their response. Everything between those two points
 *   happens exactly once, here.
 *
 *   WHY THIS FILE EXISTS. The three doors were written separately and drifted, repeatedly, in the
 *   direction nobody notices: whatever the newest door forgot. The presigned door — the one the
 *   guidance tells every agent to use for anything over ~1 KB — never wrote a change-log entry,
 *   never announced, never fired the public feed, never emitted `apps` to the live channel and
 *   never enforced the per-owner quota. The draft door never provisioned the app's subdomain and
 *   silently dropped `priceMorsels`, `licenseType` and the per-locale `descriptions`, because a
 *   draft manifest cannot express them and it published the draft manifest verbatim — so promoting
 *   a draft turned a paid app free. Provenance went missing at a forgotten door in Phase 4 and
 *   again in Phase 5. A shared function is the only fix that survives the next door.
 *
 *   THE CARRY-FORWARD RULE, IN ONE PLACE. `undefined` in `requested` means "the caller did not
 *   mention this", and every such field is taken from the live app. It never means "clear it".
 *   Clearing is explicit: `price_morsels: 0`, `cortex: { agents: [] }`. That rule was written out
 *   three times with three different field lists, which is how an update came to rename five live
 *   apps to their own filenames in the public catalogue.
 *
 *   WHAT DELIBERATELY STAYS AT THE DOOR: the screenshot (only the inline body carries one), the
 *   draft-slot clear, the MCP resource notification, and each door's response document — those are
 *   published contracts, and unifying them would be an API break dressed up as a refactor.
 * @structure
 *   - PublishAppInput / PublishAppResult / PublishAppRefusal — the contract
 *   - publishApp(storage, config, input) — resolve version → quota → ARTIFACT CHECK → spec check →
 *     carry forward → lint → stamp → store → subdomain → change log → announce → feed
 * @usage
 *   const out = await publishApp(storage, config, {
 *     ownerName, ownerGhii, callerGaii, filename, data, mimeType: 'text/html',
 *     requested: { name, description, category, tags, icon },
 *     accessCode: { mode: 'carry' }, source: 'presigned',
 *   });
 *   if ('refusal' in out) return res.status(out.refusal.status).json(error(...));
 * @version-history
 *   v1.7.0 — 2026-08-29 — `legal` (the app's own pages) carries forward on a republish.
 *   v1.6.0 — 2026-08-29 — `marks`, `authorship` and `authorshipLog` carry forward on a republish.
 *   v1.5.0 — 2026-08-27 — The build track (TARGET-074): `<meta name="aimeat-track">` in the app's
 *     head is parsed into `manifest.track` and carried forward on silent updates, so a later edit
 *     session loads the guide the app was built with instead of mixing Classic and Atelier.
 *   v1.4.0 — 2026-08-25 — The publish writes the map DOCUMENT as well as stamping the summary.
 *     The stamp names a key, and with nothing at that key every surface that opens a map said "no
 *     data map yet" about an app it had just stamped. Best-effort: a publish that already happened
 *     must not fail because a side record could not be stored.
 *   v1.3.0 — 2026-08-24 — The data map (TARGET-073): the node drafts where this app puts what
 *     from the permissions it asks for and the document its owner wrote, stamps the SUMMARY on the
 *     manifest beside `aiPosture`, and WARNS rather than refusing. Refusing would break the next
 *     publish of all 169 apps already on the node, and a map is a statement about storage rather
 *     than a property of the bytes.
 *   v1.2.0 — 2026-08-11 — Three additions, all on the shared path so no door can miss them: the
 *     ARTIFACT CHECK (services/app-artifact-lint.ts) refuses a publish whose inline script does not
 *     parse or whose asset URL this node answers 404 for — the first thing here that blocks, because
 *     both are proof the app cannot run rather than an opinion about it; the build-spec check
 *     (services/app-spec-gate.ts) reports whether the publisher carried the current spec token, and
 *     records an owner-declared skip on the change-log line; and `nextSteps` moved in from mcp/apps.ts
 *     so the agent-face and bound-skill reminder reaches every door instead of MCP-inline only.
 *   v1.1.0 — 2026-08-02 — The app's declared `public-interest` reaches the disclosure decision.
 *     It was parsed into the posture and then never passed, so every publish fell to the
 *     over-label default and recorded the statutory basis. Tri-state: `observed` (the author
 *     said nothing) stays unstated rather than becoming a `no`.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 8 step 0a. Extracted from routes/apps/publish.ts,
 *     routes/upload.ts and routes/apps/drafts.ts, which each held a partial copy of it.
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppManifest, AppManifestCortex, AppProtection } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { recordPublicActivity } from './public-activity.js';
import { recordAccountEvent } from './account-events.js';
import { provenanceForWrite, type DeclaredProvenance } from './ai-provenance.js';
import { lintAppAiDisclosure, type AppAiLintResult } from './app-ai-posture.js';
import { lintAppArtifact, type AppArtifactFinding } from './app-artifact-lint.js';
import { evaluateSpecCheck, type AppSpecCheck } from './app-spec-gate.js';
import { buildPublishNextSteps } from './app-publish-next-steps.js';
import { readAppDataMap } from './data-map/data-map-store.js';
import { stampFor } from './data-map/data-map-check.js';
import type { DataMapStamp } from './data-map/data-map-types.js';
import { lintAppHtmlForMobile } from '../utils/app-mobile-lint.js';
import { invalidateProtectionCache } from '../utils/app-protect.js';
import { ensureAppSubdomain } from '../routes/subdomains.js';
import { appSeoIndexable } from './app-seo.js';
import { submitToIndexNow, appSubmitUrls } from './indexnow.js';
import { logger } from '../utils/logger.js';

/**
 * The manifest fields a caller may state. **`undefined` means "not mentioned"** and is filled from
 * the live app; it never means "clear". Every door maps its own payload onto this one shape, so the
 * carry-forward list is written once instead of once per door.
 */
export interface RequestedManifest {
  name?: string;
  description?: string;
  descriptions?: Record<string, string>;
  version?: string;
  category?: string;
  tags?: string[];
  icon?: string;
  usesCortex?: string[];
  /** Already validated against CrewDefSchema by the door. `[]` clears the section explicitly. */
  cortexAgents?: Record<string, unknown>[];
  /** `0` unprices explicitly; `undefined` carries the live price forward. */
  priceMorsels?: number;
  licenseType?: AppManifest['licenseType'];
  /** Already run through sanitizeProtection() by the door. */
  protection?: AppProtection;
}

export interface PublishAppInput {
  /** Bare owner name — the display/URL form. Never the @node-suffixed GHII. */
  ownerName: string;
  /** The canonical app bucket key. Apps are OWNER-scoped whoever publishes them. */
  ownerGhii: string;
  /** WHO pressed publish, resolved server-side: GHII, GAII or GEAI. Audit + provenance principal. */
  callerGaii: string;
  filename: string;
  data: Buffer;
  mimeType: string;
  requested: RequestedManifest;
  /**
   * `explicit` uses the value verbatim (the inline door, whose body carries `access_code`);
   * `carry` keeps whatever the live app has (the presigned and draft doors, which cannot express
   * one). Two modes rather than one nullable value, because "the caller sent nothing" and "the
   * caller asked for no access code" are different acts and conflating them is how a re-publish
   * silently unprotects an app.
   */
  accessCode: { mode: 'explicit'; value?: string } | { mode: 'carry' };
  /** Which door this came through. Recorded in the change-log line so a reader can tell them apart. */
  source: 'inline' | 'presigned' | 'draft';
  /** A provenance record the caller asked to attach — checked against their own account. */
  declaredProvenanceId?: string;
  /** What the caller said about how the bytes were made. Absent + non-human principal → MINT-3. */
  declaredProvenance?: DeclaredProvenance;
  /** The build-spec digest the caller says they built against (services/app-spec-gate.ts). */
  specToken?: string;
  /** `skipped-by-owner` when the owner decided to publish without the spec. Recorded, not silent. */
  specAck?: string;
  /** A NEW app counts against the per-owner quota. Always on; the parameter exists for tests. */
  enforceQuota?: boolean;
}

/** A refusal the door turns into its own error envelope. */
export interface PublishAppRefusal {
  refusal: {
    status: number; code: string; message: string;
    /** Machine-readable reasons, for a refusal whose remedy is per-finding rather than per-message. */
    details?: Record<string, unknown>;
  };
}

export interface PublishAppResult {
  filename: string;
  versionNumber: number;
  isUpdate: boolean;
  manifest: AppManifest;
  size: number;
  mimeType: string;
  accessCode?: string;
  parked: boolean;
  forkable: boolean;
  downloadUrl: string;
  /** Non-blocking phone-overflow hints (HTML only). */
  mobileHints: string[];
  /** The AI transparency check, or null for a non-HTML bundle. */
  aiLint: AppAiLintResult | null;
  /** Where this app puts what. Null for a non-HTML bundle. `missing` when nobody has written one. */
  dataMap: DataMapStamp | null;
  aiProvenanceId?: string;
  /** Did the publisher carry the current build spec? Warns; never refuses. */
  specCheck: AppSpecCheck;
  /** Non-blocking artifact findings (HTML only) — the blocking ones became a refusal. */
  artifactWarnings: AppArtifactFinding[];
  /** Agent face + bound skill, and what to do about each. Best-effort, so it can be undefined. */
  nextSteps?: Record<string, unknown>;
}

/**
 * Publish or update one app version.
 *
 * The order below is load-bearing in two places. The quota is checked before anything is written,
 * so a refusal leaves no half-published state. The provenance stamp is taken over the bytes **as
 * stored** and before `createApp`, so the hash in the record identifies exactly the bytes a
 * detection query will be asked about — the serve-time marks are added on the way out and cannot
 * change the answer.
 */
export async function publishApp(
  storage: Storage, config: AimeatConfig, input: PublishAppInput,
): Promise<PublishAppResult | PublishAppRefusal> {
  const { ownerName, ownerGhii, callerGaii, filename, data, mimeType, requested } = input;

  const existingVersion = await storage.getLatestVersionNumber(ownerGhii, filename);
  const isUpdate = existingVersion > 0;
  const newVersion = existingVersion + 1;

  // The per-owner app quota, on EVERY door. The presigned door skipped it, which made the upload
  // route the recommended way past a limit the inline route enforced — the same shape of hole the
  // storage quota had before v1.10.0 of routes/upload.ts closed it there.
  if (!isUpdate && input.enforceQuota !== false && config.maxAppsPerAgent > 0) {
    const { total } = await storage.listApps({ ownerGaii: ownerGhii, limit: 1 });
    if (total >= config.maxAppsPerAgent) {
      return {
        refusal: {
          status: 429, code: 'QUOTA_EXCEEDED',
          message: `You have reached the maximum of ${config.maxAppsPerAgent} published apps`,
        },
      };
    }
  }

  // THE ARTIFACT CHECK, before a single byte is written. Two findings are proof the app cannot work
  // — an inline script that does not parse, and an asset URL this node answers 404 for — and both
  // used to reach production unremarked: an app published on 2026-08-11 loaded /lib/aimeat-auth.js
  // (the path is /v1/libs/) and threw before drawing anything, while the publish response said
  // "published". Everything else the check notices is a warning further down. Refusing here rather
  // than after createApp is what keeps a rejected publish from leaving a half-written version.
  const isHtml = /html/i.test(mimeType);
  const html = isHtml ? data.toString('utf8') : '';
  const artifact = isHtml
    ? await lintAppArtifact(html, config)
    : { blocking: [], warnings: [] };
  if (artifact.blocking.length > 0) {
    return {
      refusal: {
        status: 422, code: 'APP_ARTIFACT_BROKEN',
        message: `This app cannot run as published: ${artifact.blocking.map(f => f.message).join(' ')}`,
        details: { findings: artifact.blocking },
      },
    };
  }

  // Did whoever is publishing read the build spec that is in force NOW? This one only ever warns
  // (services/app-spec-gate.ts explains why), and an owner-declared skip is recorded on the change
  // log below rather than passing silently.
  const specCheck = evaluateSpecCheck(config, { specToken: input.specToken, specAck: input.specAck });

  const live = isUpdate ? await storage.getApp(ownerGhii, filename) : null;
  const prev = live?.manifest;

  // A description is REQUIRED for a NEW app so the catalogue and the landing wall always have one.
  // On an update, silence carries the existing one forward — a re-publish or a restore must never
  // blank it.
  const description = (requested.description ?? '').trim() || (prev?.description ?? '');
  if (!description) {
    return {
      refusal: {
        status: 400, code: 'INVALID_INPUT',
        message: 'A description is required when publishing a new app — write 1-2 sentences about what it does (your AI can write it for you).',
      },
    };
  }

  // ── The manifest: one carry-forward list, applied to every door ──
  const manifest: AppManifest = {
    name: requested.name ?? prev?.name ?? filename.replace(/\.html?$/i, ''),
    description,
    version: requested.version ?? prev?.version ?? `1.0.${newVersion - 1}`,
    category: requested.category ?? prev?.category ?? 'utility',
    tags: requested.tags ?? prev?.tags ?? [],
    authorDisplay: ownerName,
    usesCortex: requested.usesCortex ?? prev?.usesCortex ?? [],
  };
  const descriptions = sanitizeDescriptions(requested.descriptions) ?? prev?.descriptions;
  if (descriptions) manifest.descriptions = descriptions;
  // The build track (TARGET-074), read from the app's own head declaration — the same
  // bytes-on-demand pattern as `aimeat-scopes`, but persisted so an edit session months later
  // loads the guide this app was built with. Silence carries the previous answer forward; an app
  // that never declared either reads as classic, because every pre-track app is one.
  const declaredTrack = /<meta\s+name=["']aimeat-track["']\s+content=["'](classic|atelier)["']/i
    .exec(html.slice(0, 4096))?.[1] as 'classic' | 'atelier' | undefined;
  const track = declaredTrack ?? prev?.track;
  if (track) manifest.track = track;
  const icon = requested.icon ?? prev?.icon;
  if (icon) manifest.icon = icon;
  // An explicit `cortexAgents` replaces the section (send `[]` to clear it); omitted carries forward.
  const cortex: AppManifestCortex | undefined = requested.cortexAgents !== undefined
    ? (requested.cortexAgents.length > 0 ? { agents: requested.cortexAgents } : undefined)
    : (prev?.cortex?.agents?.length ? prev.cortex : undefined);
  if (cortex) manifest.cortex = cortex;
  // Pricing: `0` unprices explicitly, silence keeps the price. An update that omits the field must
  // never silently turn a paid app free — which is what publishing a DRAFT used to do, because a
  // draft manifest cannot carry a price and the draft door published it verbatim.
  const priceMorsels = requested.priceMorsels ?? prev?.priceMorsels;
  if (typeof priceMorsels === 'number' && priceMorsels > 0) manifest.priceMorsels = priceMorsels;
  const licenseType = requested.licenseType ?? prev?.licenseType;
  if (licenseType) manifest.licenseType = licenseType;
  const protection = requested.protection ?? prev?.protection;
  if (protection && Object.values(protection).some(Boolean)) manifest.protection = protection;
  // A fork stays a fork: the badge lives on the manifest and nothing in a re-publish restates it.
  if (prev?.forkedFrom) manifest.forkedFrom = prev.forkedFrom;
  // Search visibility survives a republish, and it has to. No publish door accepts this field —
  // it is set through PATCH, from the app's own details view — so a manifest rebuilt without it
  // would silently switch an app back out of search every time its author shipped a new version,
  // and they would find out weeks later from their traffic.
  //
  // The operator's approval carries too, in review mode. What they approved is this app being
  // findable under this name and this description, not one particular build of its HTML; making
  // every version bump re-enter the queue would make the mode unusable and would teach owners to
  // stop shipping. An operator who wants to withdraw it has the seo-approve door, and the block
  // is a column that a republish cannot touch at all.
  if (prev?.seo) manifest.seo = prev.seo;
  // The owner's chrome switches and the named reviewer travel the same road, for the same reason:
  // PATCH-only fields that a rebuilt manifest would otherwise silently reset. The reviewer's
  // declaration and its log survive a new version on purpose — the person answers for the app,
  // and withdrawing that is their explicit act, never a side effect of shipping.
  if (prev?.marks) manifest.marks = prev.marks;
  if (prev?.authorship) manifest.authorship = prev.authorship;
  if (prev?.authorshipLog?.length) manifest.authorshipLog = prev.authorshipLog;
  // The app's legal pages are the owner's standing statements about the app, not about one build.
  if (prev?.legal) manifest.legal = prev.legal;

  // What the app DECLARES survives a version whose author forgot the meta tag; what the node
  // OBSERVES is re-measured from the bytes being published, never carried. HTML only — there is
  // nothing to read in a binary. It WARNS and never blocks (decision D2): a publish that fails is a
  // publish that gets worked around, and the app then ships with less transparency, not more.
  const aiLint = isHtml ? lintAppAiDisclosure(data.toString('utf8'), prev?.aiPosture) : null;
  if (aiLint) manifest.aiPosture = aiLint.posture;

  // WHERE THIS APP PUTS WHAT. The node READS the map somebody wrote and stamps its summary on the
  // manifest. It does NOT draft one: a map guessed from permission words produced the same confident
  // row on 114 apps, sitting exactly where the answer belonged and reading like one. An app with no
  // map is stamped as having none, which is the honest answer and the one that gets it written.
  //
  // Never refuses. A map is a statement about storage rather than a property of the bytes, and the
  // one blocking check on this path refuses things that are broken, not things that are unfinished.
  let dataMap: DataMapStamp | null = null;
  if (isHtml) {
    const at = new Date().toISOString();
    const appId = filename.replace(/\.html$/i, '');
    const existing = await readAppDataMap(storage, ownerGhii, appId);
    dataMap = stampFor(existing, appId, at);
    manifest.dataMap = dataMap;
  }

  // The spec state of THIS publish, kept where the owner can still find it later. Deliberately not
  // carried forward: a clean publish clears it, so the field answers "how was this version put
  // here" rather than marking an app forever for one hurried afternoon.
  if (specCheck.status !== 'ok') {
    manifest.specCheck = { status: specCheck.status, at: new Date().toISOString() };
  }

  // Carry the moderation and exposure state forward, so an update never silently re-exposes a
  // parked app, opens forking, or escapes an operator hide by re-uploading.
  const parked = !!live?.parked;
  const forkable = !!live?.forkable;
  const accessCode = input.accessCode.mode === 'explicit' ? input.accessCode.value : live?.accessCode;

  // The bytes changed → drop any cached obfuscated/locked base.
  invalidateProtectionCache(ownerName, filename);

  // MINT-3 and the declaration path in one call. An app published by an agent or an ecosystem app
  // that declared nothing is stamped by the node — silence from a non-human principal must not read
  // as "a human wrote it" — while an owner publishing through their own token is never stamped. Per
  // version, because each publish is different content, and the record becomes anonymously
  // resolvable exactly while this app is actually public.
  const aiProvenanceId = await provenanceForWrite(storage, {
    principal: callerGaii,
    content: data,
    declaredId: input.declaredProvenanceId,
    declared: input.declaredProvenance,
    pipeline: 'app.publish',
    surface: {
      visibility: accessCode || parked ? 'private' : 'public',
      humanAudience: true,
      // THE APP'S OWN ANSWER, finally asked. `<meta name="aimeat-ai" content="… public-interest=yes">`
      // was parsed into the posture and then never reached the disclosure decision, so no publish on
      // this node had ever stated one — every record fell to the D4 default and claimed the statutory
      // basis regardless. Tri-state on purpose: `observed` means the author said nothing, which is
      // NOT the same as saying no, and mapping silence to 'no' would be the opposite overclaim.
      ...(aiLint?.posture.source === 'declared'
        ? { publicInterest: aiLint.posture.publicInterest ? 'yes' as const : 'no' as const }
        : {}),
    },
    labelPolicy: config.aiLabelPublic,
    nodeId: config.nodeId,
    baseUrl: config.baseUrl,
    enabled: config.aiProvenance,
  });

  await storage.createApp({
    ownerGaii: ownerGhii,
    ownerName,
    filename,
    versionNumber: newVersion,
    manifest,
    mimeType,
    size: data.length,
    data,
    accessCode,
    parked,
    forkable,
    operatorHidden: !!live?.operatorHidden,
    operatorHiddenBy: live?.operatorHiddenBy,
    operatorHiddenAt: live?.operatorHiddenAt,
    operatorHideReason: live?.operatorHideReason,
    createdAt: new Date().toISOString(),
    ...(aiProvenanceId ? { aiProvenanceId } : {}),
  });

  const downloadUrl = `/v1/apps/${encodeURIComponent(ownerName)}/${encodeURIComponent(filename)}`;
  const now = new Date().toISOString();

  // Provision the per-app subdomain NOW. Previously assigned on the first path-form open, so a new
  // app's vanity URL 404'd until someone hit the canonical URL — which reads as a broken app rather
  // than a missing mapping. Best-effort: a failed ensure never fails the publish.
  if (/\.html?$/i.test(filename)) {
    try {
      await ensureAppSubdomain(storage, config, ownerName, filename);
    } catch (err) {
      logger.warn('publishApp: subdomain provisioning failed; the vanity URL will 404 until the canonical path is opened',
        { filename, owner: ownerName, error: String(err) });
    }
  }

  // Tell the search engines that participate in IndexNow, instead of waiting to be crawled. Only
  // when this app is actually search-visible, which for a newly published app it is not — the
  // switch is off until its owner turns it on. So in practice this fires on the republish of an
  // app somebody already chose to have found, which is exactly the case where the wait matters.
  // Best-effort and silent by contract: submitToIndexNow never throws.
  {
    const published = await storage.getApp(ownerGhii, filename);
    if (published && appSeoIndexable(published, config)) {
      const site = /\.html?$/i.test(filename)
        ? (await storage.listSubdomainSites())
          .find(s => s.enabled && s.kind === 'app' && s.target === `${ownerName}/${filename}`)
        : undefined;
      await submitToIndexNow(config, storage, appSubmitUrls(config, { ownerName, filename }, site?.subdomain));
    }
  }

  await storage.addSiteChangeLog({
    id: `site-${Date.now()}-${randomBytes(4).toString('hex')}`,
    action: isUpdate ? 'app_update' : 'app_publish',
    // The spec-check state rides on the change-log line, which is the owner's own record of what
    // happened to their node. A skip the owner asked for is a decision, and a decision that leaves
    // no trace is indistinguishable from an omission six months later.
    summary: `${isUpdate ? 'Updated' : 'Published'} app "${filename}" v${newVersion}`
      + `${input.source === 'draft' ? ' from draft' : ''} (${(data.length / 1024).toFixed(1)} KB)`
      + (specCheck.status === 'ok' ? '' : ` [build spec: ${specCheck.status}]`),
    changedBy: ownerName,
    changedAt: now,
  });

  // Board announcement — best-effort, never fails the publish.
  if (config.appAnnouncementBoardId) {
    try {
      await storage.createPost({
        id: `post-${Date.now()}-${randomBytes(4).toString('hex')}`,
        boardId: config.appAnnouncementBoardId,
        authorGaii: callerGaii,
        title: `${isUpdate ? '🔄' : '🚀'} ${manifest.name || filename} v${newVersion}`,
        body: `${manifest.description || 'A new app has been published.'}\n\nDownload: ${downloadUrl}`,
        tags: manifest.tags,
        reactions: {},
        createdAt: now,
      });
    } catch (err) { logger.warn('publishApp: board announcement is best-effort', { error: String(err) }); }
  }

  emitChange('apps');
  void recordPublicActivity(storage, config, {
    category: 'apps',
    actor: callerGaii,
    summary: `App ${manifest.name || filename} ${isUpdate ? 'updated' : 'published'} (v${newVersion})`,
    detail: manifest.description || '',
    link: `${downloadUrl}?mode=inline`,
  }).catch(err => { logger.warn('publishApp: feed is best-effort', { error: String(err) }); });

  // The owner's own "what has happened". The public feed above tells the NODE; this tells the
  // person, and the two are different audiences with different privacy — a private app publishes
  // nothing publicly and still belongs in its owner's history.
  void recordAccountEvent(storage, {
    ownerGhii: `${ownerName}@${config.nodeId}`,
    kind: isUpdate ? 'app_updated' : 'app_published',
    actorGaii: callerGaii,
    subject: `${ownerName}/${filename}`,
    link: `${downloadUrl}?mode=inline`,
    data: { name: manifest.name || filename, version: String(newVersion) },
  }, config);

  // Activation (05-mittaus.md): a published app is one of the three ways an account first
  // produces something durable of its own. Write-once and fire-and-forget — measuring a publish
  // must never be able to fail it.
  void import('./onboarding-funnel.js')
    .then(m => m.recordActivation(storage, config, ownerName, 'app'))
    .catch(err => { logger.warn('publishApp: activation marker is best-effort', { error: String(err) }); });

  if (specCheck.status !== 'ok') {
    logger.info('publishApp: published without a current build-spec token', {
      filename, owner: ownerName, by: callerGaii, spec_check: specCheck.status,
    });
  }

  return {
    filename,
    versionNumber: newVersion,
    isUpdate,
    manifest,
    size: data.length,
    mimeType,
    accessCode,
    parked,
    forkable,
    downloadUrl,
    mobileHints: isHtml ? lintAppHtmlForMobile(data.toString('utf8')) : [],
    dataMap,
    aiLint,
    ...(aiProvenanceId ? { aiProvenanceId } : {}),
    specCheck,
    artifactWarnings: artifact.warnings,
    // Every door returns this now. It used to exist only on the MCP inline branch, so the two
    // things an app most often lacks went unmentioned on the door most apps come through.
    nextSteps: await buildPublishNextSteps(storage, config, ownerName, filename, data.length),
  };
}

/** Drop blank entries and cap each at 2000 characters; `undefined` when nothing survives. */
function sanitizeDescriptions(input: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const cleaned: Record<string, string> = {};
  for (const [loc, val] of Object.entries(input)) {
    if (typeof val === 'string' && val.trim().length > 0) cleaned[loc] = val.trim().slice(0, 2000);
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}
