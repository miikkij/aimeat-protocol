/**
 * @file src/services/app-announce.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The public announcements of an app: the node's public activity feed and the
 *   announcement board post. Ruled by Jouni on 2026-10-18 (plan doc-mvcn6c7e4e5q): they announce an
 *   app only while it is really public, which is services/app-publish-gate.ts appIsPublic: listed,
 *   open to anyone (`open_to` null) and with no access code.
 *
 *   THREE CALLERS. A publish (services/app-publish.ts) and a fork (services/app-lifecycle.ts forkApp)
 *   ask isAnnounceable with the stored app and announce only when it holds. A settings change
 *   (services/app-settings.ts applyOwnerSettingsUpdate, which PATCH /v1/apps/:filename,
 *   aimeat_app_manage and an approved publish request through publish-requests/apply-app.ts all run)
 *   calls announceAppBecamePublic with the app before and after the change: an app that was not
 *   public and is now is announced then, once. "Once": an app whose link is in the retained feed
 *   already is not announced again, so taking an app off the list and back does not repeat it.
 *
 *   The owner's own records are not announcements and are not gated here: the site change log line
 *   (operator view, GET /v1/site/changelog) and the account event still record every publish.
 * @structure isAnnounceable · postAppBoardAnnouncement · recordAppActivity · announceAppBecamePublic
 * @usage
 *   const app = await storage.getApp(ownerGhii, filename);
 *   if (isAnnounceable(app)) { await postAppBoardAnnouncement(...); recordAppActivity(...); }
 *   await announceAppBecamePublic(storage, config, before, after, callerGaii);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial. The board post moved here from services/app-publish.ts by pure
 *     extraction; the public-only rule and the settings announcement are new (plan doc-mvcn6c7e4e5q).
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppRecord, AppSummaryRecord } from '../storage/interface.js';
import { recordPublicActivity, readPublicActivity } from './public-activity.js';
import { provenanceForWrite } from './ai-provenance.js';
import { appIsPublic } from './app-publish-gate.js';
import { logger } from '../utils/logger.js';

/** True when the stored app may be announced: it exists and anyone finds and opens it. */
export function isAnnounceable(app: Pick<AppRecord, 'accessCode' | 'access' | 'parked' | 'community'> | null | undefined): boolean {
  return !!app && appIsPublic(app);
}

/** The link the feed carries for an app: its owner-scoped path, opened inline. */
function feedLink(ownerName: string, filename: string): string {
  return `/v1/apps/${encodeURIComponent(ownerName)}/${encodeURIComponent(filename)}?mode=inline`;
}

/**
 * The announcement board post (config.appAnnouncementBoardId). Best-effort: a failure is logged and
 * never fails the publish. The post carries the provenance record of its own text (aiprov D13).
 */
export async function postAppBoardAnnouncement(
  storage: Storage, config: AimeatConfig,
  input: { callerGaii: string; name: string; description?: string; tags?: string[]; version: number; isUpdate: boolean; downloadUrl: string },
): Promise<void> {
  if (!config.appAnnouncementBoardId) return;
  try {
    const title = `${input.isUpdate ? '🔄' : '🚀'} ${input.name} v${input.version}`;
    const body = `${input.description || 'A new app has been published.'}\n\nDownload: ${input.downloadUrl}`;
    const postProvenanceId = await provenanceForWrite(storage, { principal: input.callerGaii, content: `${title}\n\n${body}`,
      pipeline: 'app.announce', surface: { visibility: 'public', humanAudience: true }, labelPolicy: config.aiLabelPublic,
      nodeId: config.nodeId, baseUrl: config.baseUrl, enabled: config.aiProvenance });
    await storage.createPost({
      id: `post-${Date.now()}-${randomBytes(4).toString('hex')}`, boardId: config.appAnnouncementBoardId,
      authorGaii: input.callerGaii, title, body, tags: input.tags ?? [], reactions: {}, createdAt: new Date().toISOString(),
      ...(postProvenanceId ? { aiProvenanceId: postProvenanceId } : {}),
    });
  } catch (err) { logger.warn('app announcement: the board post is best-effort', { error: String(err) }); }
}

/** One public feed event about an app. Fire-and-forget: the feed never fails its caller. */
export function recordAppActivity(
  storage: Storage, config: AimeatConfig, input: { actor: string; summary: string; detail: string; link: string },
): void {
  void recordPublicActivity(storage, config, { category: 'apps', ...input })
    .catch(err => { logger.warn('app announcement: the feed is best-effort', { error: String(err) }); });
}

/**
 * Announce an app that a settings change made public: the feed event and the board post, once.
 * Nothing when it was public before, is not public after, or its link is in the feed already.
 */
export async function announceAppBecamePublic(
  storage: Storage, config: AimeatConfig,
  before: AppSummaryRecord | null | undefined, after: AppSummaryRecord | null | undefined, callerGaii: string,
): Promise<void> {
  if (!after || !before || appIsPublic(before) || !appIsPublic(after)) return;
  try {
    const link = feedLink(after.ownerName, after.filename);
    const seen = await readPublicActivity(storage, config, { category: 'apps', limit: 200 });
    if (seen.some(e => e.link === link)) return;
    const name = after.manifest?.name || after.filename;
    await postAppBoardAnnouncement(storage, config, {
      callerGaii, name, description: after.manifest?.description, tags: after.manifest?.tags,
      version: after.versionNumber, isUpdate: false, downloadUrl: link.replace(/\?mode=inline$/, ''),
    });
    recordAppActivity(storage, config, {
      actor: callerGaii, summary: `App ${name} published (v${after.versionNumber})`,
      detail: after.manifest?.description || '', link,
    });
  } catch (err) { logger.warn('app announcement: announcing a newly public app failed', { error: String(err) }); }
}
