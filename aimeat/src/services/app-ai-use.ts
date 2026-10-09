/**
 * @file src/services/app-ai-use.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a person's own AI can use on one published app, counted for the "Use with your
 *   AI" mark on the served app and its guide page (/v1/use-with-ai/:owner/:filename).
 *
 *   An app's tools and the skills bound to it were findable only by a machine: the noscript block,
 *   llms.txt, /.well-known/mcp.json and the public WebMCP listing. A person who opened the app saw
 *   the AI label and nothing that said their AI could work the app (Jouni, 2026-10-09). The mark
 *   says so, and it is served only when there is something to use: at least one public tool or one
 *   public bound skill.
 *
 *   THE SAME PUBLIC FACTS THE WEBMCP LISTING SERVES. The tools are the app's public tool manifest
 *   read through publicManifestTools, the listing's own gate, the skills are what
 *   listSkillsByBinding gives a caller who is not signed in, and an app the listing refuses (an
 *   access code, an operator hide, a price) gets no mark: appHiddenFromPublicSurfaces is that
 *   listing's own test, moved here so the two cannot disagree.
 * @structure
 *   - appHiddenFromPublicSurfaces(config, app) — the WebMCP listing's refusal test
 *   - aiUseGuideUrl(config, owner, filename) — the guide page's address
 *   - appAiUse(storage, config, app) — the counts, or null when no mark is owed
 * @usage
 *   const aiUse = await appAiUse(storage, config, app);   // → applyServeMarks({ aiUse: … })
 * @version-history
 *   v1.0.0 -- 2026-10-09 -- Initial (wish-ai-skill-and-ai-app-tool-badges-on-a-published-app-with-a-pa).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AppRecord } from '../storage/interface.js';
import { appToolsKey } from '../models/app-tool-schemas.js';
import { publicManifestTools } from '../commerce/app-tool-catalog.js';
import { listSkillsByBinding } from './skills.js';
import { cached, TTL } from './cache.js';
import { logger } from '../utils/logger.js';
import { appAiUseOn, type AppAiUse } from '../utils/app-ai-use-badge.js';
export type { AppAiUse } from '../utils/app-ai-use-badge.js';

/** The fields of an app record the decision reads. */
type AppFacts = Pick<AppRecord, 'ownerName' | 'ownerGaii' | 'filename' | 'accessCode' | 'operatorHidden' | 'manifest'>;

/** True when an app must not be described on a public surface (gated, priced, or moderated away). */
export function appHiddenFromPublicSurfaces(
  config: Pick<AimeatConfig, 'marketplaceEnabled'>, app: Pick<AppRecord, 'accessCode' | 'operatorHidden' | 'manifest'>,
): boolean {
  if (app.accessCode) return true;
  if (app.operatorHidden) return true;
  if (config.marketplaceEnabled && app.manifest.priceMorsels && app.manifest.priceMorsels > 0) return true;
  return false;
}

/** The guide page for one app: how a person's AI, an agent or a program uses it. */
export function aiUseGuideUrl(config: Pick<AimeatConfig, 'baseUrl'>, owner: string, filename: string): string {
  return `${config.baseUrl.replace(/\/+$/, '')}/v1/use-with-ai/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}`;
}

/**
 * The counts behind the mark, or null when no mark is owed: the owner switched it off, the app is
 * hidden from public surfaces, or it has no public tool and no public bound skill. A storage error
 * reads as no mark, because the mark is an offer and the app must still be served.
 */
export async function appAiUse(storage: Storage, config: AimeatConfig, app: AppFacts): Promise<AppAiUse | null> {
  if (!appAiUseOn(app.manifest)) return null;
  if (appHiddenFromPublicSurfaces(config, app)) return null;
  try {
    const binding = `app:${app.ownerName}/${app.filename}`;
    // One app is served many times, so the two counts are cached together. The event bus evicts
    // them on a write: the tool manifest is a memory record (domain:memory), a skill publish says
    // domain:skills, a republish says domain:apps. The 60-second TTL is the backstop only.
    const { tools, skills } = await cached(`appaiuse:${app.ownerGaii}:${app.filename}`, TTL.dashboard, async () => ({
      tools: publicManifestTools(await storage.getMemory(app.ownerGaii, appToolsKey(app.filename)))?.length ?? 0,
      skills: (await listSkillsByBinding(storage, config, binding, { ownerName: null })).length,
    }), ['domain:memory', 'domain:skills', 'domain:apps']);
    if (tools + skills === 0) return null;
    return { tools, skills, guideUrl: aiUseGuideUrl(config, app.ownerName, app.filename) };
  } catch (err) {
    logger.warn('app-ai-use: counting failed, the app is served without the mark', {
      app: `${app.ownerName}/${app.filename}`, error: (err as Error).message,
    });
    return null;
  }
}
