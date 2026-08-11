/**
 * @file src/services/app-lifecycle.ts
 * @description The app-catalogue writes that are NOT a publish: the draft slot, the fork, and the
 *   delete. services/app-publish.ts owns "publish one version" for the same reason and after the same
 *   kind of drift; this file owns the other three acts.
 *
 *   WHY THIS FILE EXISTS. Each of these acts had two implementations, one behind HTTP and one behind
 *   MCP, and they had drifted in the direction nobody watches. What the route did and the tool did
 *   not, before this file:
 *
 *   - DELETE. The route removes every bucket the owner has for that filename (old publish paths left
 *     ghost rows under a second ownerGaii), deletes the app's screenshot and writes a change-log
 *     line. `aimeat_app_delete` deleted one bucket, left the screenshot in storage forever and wrote
 *     nothing to the log, so an app an agent deleted could reappear in a listing with its thumbnail
 *     still on disk.
 *   - FORK. The route re-measures the AI disclosure posture against the copied bytes, strips the
 *     source owner's private `specCheck` note, copies the screenshot, writes a change-log line and
 *     fires the public feed. `aimeat_app_fork` did none of those five: a fork made over MCP carried
 *     one owner's build-spec note into another owner's catalogue and left no trace anywhere.
 *   - DRAFT SAVE. Two manifest builders that disagreed on the default category — 'utility' over HTTP
 *     and inside publishApp, 'tool' over MCP — so a draft-first app staged by an agent landed in a
 *     category no other door can produce.
 *
 *   WHAT DELIBERATELY STAYS AT THE DOOR: the authorization gates (the fork's two gates need the
 *   operator role, which only an HTTP session carries), the payload decode, the 404 wording for a
 *   missing draft (one door tells the caller to `PUT .../draft`, the other to call
 *   `aimeat_app_draft_save`), the MCP resource notification, and every response document.
 * @structure
 *   - APP_FILENAME_RE / appFilenameRefusal() — the one filename rule for a catalogue entry
 *   - resolveAppOwnerScope() — principal → { ownerName, ownerGhii }; the MCP-side twin of the
 *     canonicalOwner closure in routes/apps.ts, so both surfaces address the same bucket
 *   - stageAppDraft() — validate, inherit the live manifest, write the draft slot
 *   - discardAppDraft() — clear the draft slot
 *   - publishAppDraft() — draft manifest → publishApp → clear the slot (the slot survives a refusal)
 *   - forkApp() — validate, copy manifest + bytes + screenshot, record lineage, log, announce
 *   - deleteOwnedApp() — sweep every bucket (or one version), drop screenshots, log
 * @usage
 *   const out = await forkApp(storage, config, { source, callerOwner, callerGhii, callerGaii, newFilename });
 *   if ('refusal' in out) { res.status(out.refusal.status).json(error(...)); return; }
 * @version-history
 *   v1.0.0 — 2026-08-11 — August 2026 audit step 8, unit "apps". Extracted from routes/apps/drafts.ts,
 *     routes/apps/fork-manage.ts, mcp/apps.ts and mcp/apps-fork.ts, which held two copies of each of
 *     these four acts.
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type {
  Storage, AppManifest, AppProtection, AppRecord, AppDraftRecord,
} from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { logger } from '../utils/logger.js';
import { emitChange } from './event-bus.js';
import { recordPublicActivity } from './public-activity.js';
import { appQuotaRefusal } from './install-quotas.js';
import { lintAppAiDisclosure } from './app-ai-posture.js';
import { publishApp, type PublishAppRefusal, type PublishAppResult } from './app-publish.js';
import type { DeclaredProvenance } from './ai-provenance.js';

/**
 * What a catalogue filename may look like. One spelling, because four doors used to carry their own
 * copy of it and a rule that is written four times is a rule that holds until someone widens one.
 */
export const APP_FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

/** The refusal for a filename that breaks the rule, or null when it does not. */
export function appFilenameRefusal(filename: string): PublishAppRefusal | null {
  if (APP_FILENAME_RE.test(filename)) return null;
  return {
    refusal: {
      status: 400, code: 'INVALID_INPUT',
      message: 'Invalid filename. Use alphanumeric, dots, hyphens, underscores. Max 100 chars.',
    },
  };
}

/** The owner an app write lands under: the display/URL name, and the bucket key. */
export interface AppOwnerScope {
  ownerName: string;
  ownerGhii: string;
}

/**
 * Resolve an MCP principal to the owner scope its app writes belong to.
 *
 * Apps are OWNER-scoped whoever publishes them, and the bucket key is the owner's canonical GHII
 * from the identity table — the same key routes/apps.ts resolves through its `canonicalOwner`
 * closure and the same key the startup `mergeForkedAppBuckets()` migration consolidates onto. The
 * MCP tools composed `owner@nodeId` by hand instead, which agrees for a locally registered owner and
 * addresses a different bucket for anyone whose GHII record says otherwise. Two doors that disagree
 * about where an app lives is how the same owner ends up with two version counters.
 *
 * Returns null when the principal is not a GAII, which is the tools' existing "Failed to parse" case.
 */
export async function resolveAppOwnerScope(
  storage: Storage, config: AimeatConfig, principal: string,
): Promise<AppOwnerScope | null> {
  const parsed = parseGAII(principal);
  if (!parsed) return null;
  const ownerName = parsed.owner;
  return { ownerName, ownerGhii: await resolveGhii(storage, ownerName, `${ownerName}@${config.nodeId}`) };
}

// ── The draft slot ────────────────────────────────────────────────────────────────────────────────

/**
 * The manifest fields a caller may state when staging a draft. `undefined` means "not mentioned" and
 * is taken from the live app, exactly as it is on the publish path.
 */
export interface DraftManifestRequest {
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  icon?: string;
  usesCortex?: string[];
  /** Already through sanitizeProtection() at the door. */
  protection?: AppProtection;
  /** Overrides the live app's mime type; the doors that cannot express one leave it undefined. */
  mimeType?: string;
}

export interface StageAppDraftInput {
  ownerName: string;
  ownerGhii: string;
  filename: string;
  data: Buffer;
  requested: DraftManifestRequest;
}

export interface StagedAppDraft {
  filename: string;
  manifest: AppManifest;
  mimeType: string;
  size: number;
  updatedAt: string;
  hasLiveVersion: boolean;
  liveVersionNumber: number;
}

/**
 * Save (upsert) the app's draft. The live published versions are untouched: this writes the staging
 * slot and nothing else, which is why there is no change log, no feed and no provenance stamp here.
 * All three belong to the promotion, which is publishAppDraft below.
 */
export async function stageAppDraft(
  storage: Storage, config: AimeatConfig, input: StageAppDraftInput,
): Promise<StagedAppDraft | PublishAppRefusal> {
  const { ownerName, ownerGhii, filename, data, requested } = input;

  const badName = appFilenameRefusal(filename);
  if (badName) return badName;

  const maxBytes = config.appMaxSizeMb * 1024 * 1024;
  if (data.length > maxBytes) {
    return {
      refusal: {
        status: 413, code: 'TOO_LARGE',
        message: `Draft exceeds ${config.appMaxSizeMb}MB limit (${data.length} bytes)`,
      },
    };
  }

  // The live app's manifest is the base, so a draft that only changes the HTML keeps its name,
  // description, category and icon.
  const live = await storage.getApp(ownerGhii, filename);
  const base = live?.manifest;
  const manifest: AppManifest = {
    name: requested.name ?? base?.name ?? filename.replace(/\.html?$/i, ''),
    description: requested.description ?? base?.description ?? '',
    version: base?.version ?? '1.0.0',
    // 'utility' is what publishApp and the HTTP door both default to. The MCP door said 'tool', so
    // an app first staged by an agent was filed under a category the catalogue's own filters do not
    // offer, and the difference survived every later publish because category carries forward.
    category: requested.category ?? base?.category ?? 'utility',
    tags: requested.tags ?? base?.tags ?? [],
    authorDisplay: ownerName,
    usesCortex: requested.usesCortex ?? base?.usesCortex ?? [],
  };
  const icon = requested.icon ?? base?.icon;
  if (icon) manifest.icon = icon;
  const protection = requested.protection ?? base?.protection;
  if (protection && Object.values(protection).some(Boolean)) manifest.protection = protection;
  // A draft that only changes HTML keeps the live app's bundled crew-defs; the promotion then
  // carries them into the new version unchanged.
  if (base?.cortex?.agents?.length) manifest.cortex = base.cortex;

  const mimeType = requested.mimeType ?? live?.mimeType ?? 'text/html';
  const updatedAt = new Date().toISOString();
  await storage.saveAppDraft({
    ownerGaii: ownerGhii, ownerName, filename, manifest,
    mimeType, size: data.length, data, updatedAt,
  });

  return {
    filename, manifest, mimeType,
    size: data.length,
    updatedAt,
    hasLiveVersion: !!live,
    liveVersionNumber: live?.versionNumber ?? 0,
  };
}

/**
 * Throw the draft away. The live app is untouched; `false` means there was nothing to discard.
 *
 * A one-line wrapper on purpose: the draft slot has one owner in code, so the next thing a discard
 * has to do — a change-log line, a cache drop, a notification — lands on both doors at once instead
 * of on whichever one the author had open.
 */
export async function discardAppDraft(
  storage: Storage, ownerGhii: string, filename: string,
): Promise<boolean> {
  return storage.deleteAppDraft(ownerGhii, filename);
}

export interface PublishAppDraftInput {
  ownerName: string;
  ownerGhii: string;
  /** WHO pressed publish, resolved server-side. Audit + provenance principal. */
  callerGaii: string;
  filename: string;
  /** The slot's contents, already loaded by the door so it can word its own "no draft" answer. */
  draft: AppDraftRecord;
  declaredProvenanceId?: string;
  declaredProvenance?: DeclaredProvenance;
  specToken?: string;
  specAck?: string;
}

/**
 * Promote the draft to a new live version, then clear the slot.
 *
 * The draft manifest IS the caller's statement, so every field it can express is passed as stated;
 * what it cannot express — pricing, licence, per-locale descriptions — is left unmentioned and
 * publishApp carries it from the live app. Both doors wrote that mapping out by hand, nine fields
 * each, which is how the two of them can disagree about whether promoting a draft keeps an app paid.
 */
export async function publishAppDraft(
  storage: Storage, config: AimeatConfig, input: PublishAppDraftInput,
): Promise<PublishAppResult | PublishAppRefusal> {
  const { ownerName, ownerGhii, callerGaii, filename, draft } = input;

  const out = await publishApp(storage, config, {
    ownerName,
    ownerGhii,
    callerGaii,
    filename,
    data: draft.data,
    mimeType: draft.mimeType,
    requested: {
      name: draft.manifest.name,
      description: draft.manifest.description,
      version: draft.manifest.version || undefined,
      category: draft.manifest.category,
      tags: draft.manifest.tags,
      icon: draft.manifest.icon,
      usesCortex: draft.manifest.usesCortex,
      cortexAgents: draft.manifest.cortex?.agents,
      protection: draft.manifest.protection,
    },
    accessCode: { mode: 'carry' },
    source: 'draft',
    declaredProvenanceId: input.declaredProvenanceId,
    declaredProvenance: input.declaredProvenance,
    specToken: input.specToken,
    specAck: input.specAck,
  });
  // The draft SURVIVES a refusal. A broken artifact is work to fix and publish again, and clearing
  // the staging slot would delete the only copy of it.
  if ('refusal' in out) return out;

  await storage.deleteAppDraft(ownerGhii, filename);
  return out;
}

// ── The fork ──────────────────────────────────────────────────────────────────────────────────────

export interface ForkAppInput {
  /** The source app version to copy, already loaded and already past both authorization gates. */
  source: AppRecord;
  /** The forker's bare owner name (display + URL form). */
  callerOwner: string;
  /** The forker's canonical bucket key. */
  callerGhii: string;
  /** WHO forked, resolved server-side. Recorded on the lineage event and the public feed. */
  callerGaii: string;
  newFilename: string;
}

export interface ForkedApp {
  filename: string;
  versionNumber: number;
  manifest: AppManifest;
  downloadUrl: string;
  forkedFrom: { owner: string; filename: string; version: number };
}

/**
 * Copy an app into the caller's catalogue as a new app at version 1.
 *
 * The gates are the door's: derivative permission and the paid-app paywall both need to know whether
 * the caller is an operator, and only an HTTP session carries that role. What happens after them is
 * one act, and it is this: the manifest is copied with the source's paid terms and private notes
 * removed, the bytes and the screenshot come across unchanged, and the fork is written into the
 * append-only lineage log, the change log and the public feed.
 */
export async function forkApp(
  storage: Storage, config: AimeatConfig, input: ForkAppInput,
): Promise<ForkedApp | PublishAppRefusal> {
  const { source, callerOwner, callerGhii, callerGaii, newFilename } = input;
  const sourceFilename = source.filename;

  if (!newFilename || !APP_FILENAME_RE.test(newFilename)) {
    return {
      refusal: {
        status: 400, code: 'INVALID_INPUT',
        message: 'new_filename is required (alphanumeric, dots, hyphens, underscores; max 100 chars)',
      },
    };
  }

  // A fork is a NEW app in the caller's catalogue — refuse to shadow an app they already own by that
  // filename. To update one, publish; do not fork.
  const existingVersion = await storage.getLatestVersionNumber(callerGhii, newFilename);
  if (existingVersion > 0) {
    return {
      refusal: {
        status: 409, code: 'ALREADY_EXISTS',
        message: `You already have an app named "${newFilename}". Choose a different new_filename.`,
      },
    };
  }

  // The per-owner app quota, from the one place that holds it (services/install-quotas.ts).
  const overQuota = await appQuotaRefusal({ storage, config }, callerGhii);
  if (overQuota) return { refusal: overQuota };

  const now = new Date().toISOString();
  const forkedManifest: AppManifest = {
    ...source.manifest,
    name: `${source.manifest.name || sourceFilename.replace(/\.html?$/i, '')} (fork)`,
    authorDisplay: callerOwner,
    // A fork starts as its own independent, free app — drop the source's paid terms; the forker can
    // price their own copy later. Record its origin.
    forkedFrom: { owner: source.ownerName, filename: sourceFilename, version: source.versionNumber, node: config.nodeId },
  };
  delete forkedManifest.priceMorsels;
  delete forkedManifest.licenseType;
  // The build-spec state describes how the SOURCE's last publish was made. It says nothing about this
  // fork, and it is owner-only besides — copying it hands one owner's note about their own working
  // habits to whoever forked them, which is what the MCP fork did.
  delete forkedManifest.specCheck;
  // A FORK OF A GENERATIVE APP IS STILL A GENERATIVE APP. The manifest spread above brings the
  // posture across, and this re-measures the observed half against the bytes actually being stored
  // while keeping what the source DECLARED — so the statement neither resets to silence nor becomes
  // a claim about code that moved on.
  if (/html/i.test(source.mimeType)) {
    forkedManifest.aiPosture = lintAppAiDisclosure(
      Buffer.from(source.data).toString('utf8'), source.manifest.aiPosture,
    ).posture;
  }

  await storage.createApp({
    ownerGaii: callerGhii,
    ownerName: callerOwner,
    filename: newFilename,
    versionNumber: 1,
    manifest: forkedManifest,
    mimeType: source.mimeType,
    size: source.size,
    data: source.data,
    parked: false,
    forkable: false,   // the forker decides their own copy's forkability later
    createdAt: now,
    // The record describes how these BYTES were made, and a fork copies the bytes exactly, so the
    // statement travels with them. A fresh mint here would claim the forker's agent produced content
    // it merely copied; a dropped one would read as unstated content that is known to be model-written.
    ...(source.aiProvenanceId ? { aiProvenanceId: source.aiProvenanceId } : {}),
  });

  // Copy the source screenshot into the fork's bucket so the fork renders with the same catalogue
  // thumbnail. Best-effort: a missing thumbnail is not worth failing a fork over.
  try {
    const srcShot = await storage.getStorageFile(source.ownerGaii, `apps/screenshots/${sourceFilename}`);
    if (srcShot) {
      await storage.createStorageFile({
        key: `apps/screenshots/${newFilename}`,
        ownerGaii: callerGhii,
        visibility: 'public',
        mimeType: srcShot.mimeType,
        size: srcShot.size,
        data: srcShot.data,
        createdAt: now,
      });
    }
  } catch (err) { logger.warn('forkApp: screenshot copy is non-critical', { error: String(err) }); }

  // The append-only fork event — the source of truth for fork stats + lineage.
  await storage.recordAppFork({
    id: `fork-${Date.now()}-${randomBytes(4).toString('hex')}`,
    sourceOwnerGaii: source.ownerGaii,
    sourceOwnerName: source.ownerName,
    sourceFilename,
    sourceVersion: source.versionNumber,
    childOwnerGaii: callerGhii,
    childOwnerName: callerOwner,
    childFilename: newFilename,
    forkedByGaii: callerGaii,
    forkedAt: now,
  });

  const downloadUrl = `/v1/apps/${encodeURIComponent(callerOwner)}/${encodeURIComponent(newFilename)}`;

  await storage.addSiteChangeLog({
    id: `site-${Date.now()}-${randomBytes(4).toString('hex')}`,
    action: 'app_publish',
    summary: `Forked "${sourceFilename}" (by ${source.ownerName}) into "${newFilename}"`,
    changedBy: callerOwner,
    changedAt: now,
  });

  emitChange('apps');
  void recordPublicActivity(storage, config, {
    category: 'apps',
    actor: callerGaii,
    summary: `App ${forkedManifest.name} forked from ${source.ownerName}/${sourceFilename}`,
    detail: forkedManifest.description || '',
    link: `${downloadUrl}?mode=inline`,
  }).catch(err => { logger.warn('forkApp: feed is best-effort', { error: String(err) }); });

  return {
    filename: newFilename,
    versionNumber: 1,
    manifest: forkedManifest,
    downloadUrl,
    forkedFrom: { owner: source.ownerName, filename: sourceFilename, version: source.versionNumber },
  };
}

// ── The delete ────────────────────────────────────────────────────────────────────────────────────

export interface DeleteOwnedAppInput {
  /** The caller's bare owner name. Every bucket swept has to match it. */
  ownerName: string;
  /** The canonical bucket key. */
  ownerGhii: string;
  /** The caller's resolved identity, one of the shadow buckets an old publish path could have used. */
  callerGaii: string;
  filename: string;
  /** Omit to remove every version in every bucket. */
  version?: number;
}

export interface DeletedApp {
  filename: string;
  versionDeleted: number | 'all';
}

/**
 * Remove an app the caller owns, with or without a version.
 *
 * The no-version case sweeps EVERY bucket this owner has for the filename. Old publish paths wrote
 * the same owner+filename under different ownerGaii keys, and a delete that only looked in the
 * canonical bucket left those ghost rows listed and downloadable — which is what `aimeat_app_delete`
 * did, along with leaving the screenshot in storage. A single-version delete still targets one
 * bucket, because keeping versions in one bucket while removing a stray from another is a real thing
 * to want.
 */
export async function deleteOwnedApp(
  storage: Storage, input: DeleteOwnedAppInput,
): Promise<DeletedApp | PublishAppRefusal> {
  const { ownerName, ownerGhii, callerGaii, filename, version } = input;

  if (!version) {
    let sweepCount = 0;
    for (;;) {
      const app = await storage.getAppByOwnerName(ownerName, filename);
      if (!app) break;
      // Authorization sanity check: ownerName MUST match the caller's owner. (It always will,
      // because getAppByOwnerName takes ownerName as the key — but defense in depth.)
      if (app.ownerName !== ownerName) break;
      await storage.deleteApp(app.ownerGaii, filename);
      await storage.deleteStorageFile(app.ownerGaii, `apps/screenshots/${filename}`)
        .catch(err => { logger.warn('deleteOwnedApp: continuing after a suppressed failure', { error: String(err) }); });
      sweepCount++;
      if (sweepCount > 10) break; // safety cap, no real owner has >10 buckets
    }
    if (sweepCount === 0) {
      return {
        refusal: {
          status: 404, code: 'NOT_FOUND',
          message: `App "${filename}" not found in your uploads`,
        },
      };
    }
  } else {
    // Single-version case: try the buckets in order, delete from the one that has it.
    let app = await storage.getApp(ownerGhii, filename, version);
    let effectiveGaii = ownerGhii;
    if (!app) { app = await storage.getApp(callerGaii, filename, version); if (app) effectiveGaii = callerGaii; }
    if (!app) { app = await storage.getApp(ownerName, filename, version); if (app) effectiveGaii = ownerName; }
    if (!app) {
      // Last resort: find the row by ownerName across all buckets.
      const found = await storage.getAppByOwnerName(ownerName, filename, version);
      if (found && found.ownerName === ownerName) { app = found; effectiveGaii = found.ownerGaii; }
    }
    if (!app) {
      return {
        refusal: {
          status: 404, code: 'NOT_FOUND',
          message: `App "${filename}" not found in your uploads (version ${version})`,
        },
      };
    }
    await storage.deleteApp(effectiveGaii, filename, version);
  }

  await storage.addSiteChangeLog({
    id: `site-${Date.now()}-${randomBytes(4).toString('hex')}`,
    action: 'app_delete',
    summary: version ? `Deleted version ${version} of app "${filename}"` : `Deleted app "${filename}" (all versions)`,
    changedBy: ownerName,
    changedAt: new Date().toISOString(),
  });

  emitChange('apps');

  return { filename, versionDeleted: version ?? 'all' };
}
