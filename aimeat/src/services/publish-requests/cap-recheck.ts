/**
 * @file src/services/publish-requests/cap-recheck.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An approved publish request is held to the label's audience cap again before it is
 *   applied (plan doc-mvdipuyqraas, L3.3). The door asked the cap before it filed the request, but the
 *   label may have risen since, or the request was filed before the label had a cap: a request never
 *   carries content past a cap. decide.ts asks this before the applier and settles a refused request
 *   with 409 LABEL_CAPS_AUDIENCE, saying why.
 *
 *   WHICH KINDS. The ones whose target is classifiable content or a container: a memory record, a
 *   stored file, a board, an organism, an app and a workspace share. Packages, knowledge packages and
 *   data packages have no cap yet (decision 10.4 of the plan); a skill, a cortex library, a personal
 *   welcome page and a company front page carry no classification. Those pass.
 *
 *   The level each kind would get is the one its applier sets: public for a record, a file, a board
 *   and an organism; for an app, what the one held-back field makes it; for a workspace share, the
 *   share with the held-back body merged in, as setWorkspaceShareOp merges it.
 * @structure requestCapRefusal(ctx, ownerGhii, request, by)
 * @usage
 *   const capped = await requestCapRefusal(ctx, ownerGhii, request, { principal: by, kind: 'human' });
 *   if (capped) → settle outdated, answer 409 LABEL_CAPS_AUDIENCE
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L3.3).
 */
import type { AppRecord } from '../../storage/interface.js';
import { appListingOf } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import type { ResolvedShare } from '../../routes/organisms/share-types.js';
import {
  audienceCapOf, audienceOfVisibility, audienceOfOrganism, capRefusalOf, type CapOptions,
} from '../classification/audience-cap.js';
import { appTarget, boardTarget, organismTarget } from '../classification/containers.js';
import { fileTarget, memoryTarget } from '../classification/labels.js';
import { appAudienceOf } from '../app-publish-gate.js';
import { readShareMetaOf } from '../workspace-share.js';
import { shareCapRefusal } from '../workspace-share-gate.js';
import type { PublishRequest, PublishStoreCtx } from './store.js';

type Refusal = { ok: false; status: 409; code: string; message: string };

/** The app after the one change a request names, as its applier makes it. */
function appAfter(app: AppRecord, field: string): Parameters<typeof appAudienceOf>[0] {
  const listing = appListingOf(app);
  return {
    accessCode: field === 'access_code' ? null : app.accessCode,
    access: field === 'open_to' ? null : app.access,
    parked: field === 'listing' ? false : listing !== 'listed',
    community: field === 'listing' ? false : listing === 'community',
  };
}

/** The share with a request's held-back body merged in, as setWorkspaceShareOp merges a body. */
function shareAfter(prev: ResolvedShare, body: Record<string, unknown>): ResolvedShare {
  return {
    ...prev,
    public: typeof body.public === 'boolean' ? body.public : prev.public,
    spaces: { ...prev.spaces, ...((body.spaces as Record<string, boolean> | undefined) ?? {}) },
    docs: { ...prev.docs, ...((body.docs as Record<string, boolean> | undefined) ?? {}) },
    access: (body.access as ResolvedShare['access'] | undefined) ?? prev.access,
  };
}

/** Null when the request's target may have the level its approval gives; else the 409. */
export async function requestCapRefusal(
  ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest, by: CapOptions['by'],
): Promise<Refusal | null> {
  const t = request.target;
  const where = `publish request ${request.id}`;
  switch (request.kind) {
    case 'memory': {
      const ns = String(t.namespace ?? '');
      const record = ns ? await ctx.storage.getMemory(ns, String(t.key ?? '')) : null;
      if (!record) return null;
      return capRefusalOf(await audienceCapOf(ctx, memoryTarget(ns, record.key), 'public', { from: audienceOfVisibility(record.visibility), by, where }));
    }
    case 'file': {
      const owner = String(t.owner ?? '');
      const file = owner ? await ctx.storage.getStorageFileMeta(owner, String(t.key ?? '')) : null;
      if (!file) return null;
      return capRefusalOf(await audienceCapOf(ctx, fileTarget(owner, file.key, file.workspaceRef), 'public', { from: audienceOfVisibility(file.visibility), by, where }));
    }
    case 'board': {
      const board = await ctx.storage.getBoard(String(t.board_id ?? ''));
      if (!board) return null;
      return capRefusalOf(await audienceCapOf(ctx, boardTarget(board), 'public', { from: audienceOfVisibility(board.visibility), by, where }));
    }
    case 'organism': {
      const organism = await ctx.storage.getOrganism(String(t.organism_id ?? ''));
      if (!organism) return null;
      return capRefusalOf(await audienceCapOf(ctx, organismTarget(organism.id), 'public', { from: audienceOfOrganism(organism.visibility), by, where }));
    }
    case 'app': {
      const filename = String(t.filename ?? '');
      const app = filename ? (await ctx.storage.getApp(ownerGhii, filename)) ?? (await ctx.storage.getAppByOwnerName(localAccountName(ownerGhii), filename)) : null;
      if (!app) return null;
      return capRefusalOf(await audienceCapOf(ctx, appTarget(app.ownerGaii, app.filename), appAudienceOf(appAfter(app, request.change.field)), {
        from: appAudienceOf(app), by, where,
      }));
    }
    case 'workspace-share': {
      const orgId = String(t.organism_id ?? '');
      const ws = String(t.ws ?? '');
      const body = request.change.to;
      if (!orgId || !ws || !body || typeof body !== 'object') return null;
      const prev = await readShareMetaOf(ctx.storage, ctx.config, orgId, ws);
      return shareCapRefusal(ctx, orgId, ws, prev, shareAfter(prev, body as Record<string, unknown>), true, by);
    }
    default:
      return null;
  }
}
