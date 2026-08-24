/**
 * @file src/services/signals/page-views.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Counts a fetch of something published here into the owner's own signal stream —
 *   the door that sees what the other two cannot: an AI reading the page.
 *
 *   WHY THIS EXISTS BESIDE THE TRACKING IMAGE. GPTBot, ClaudeBot, PerplexityBot and the rest run no
 *   JavaScript and load no images, so a browser-side counter records almost none of the fetches a
 *   customer is buying an AI-visibility report for. The only place those requests are visible is
 *   where the bytes leave the node, which is here.
 *
 *   OPT-IN BY EXISTENCE, so nothing is measured behind anybody's back and no new setting was
 *   invented for it: the page is counted when a stream named after it already exists, and the owner
 *   creates that stream through the ordinary signals door. `cadence.html` is counted into
 *   `page-cadence-html`. No stream, no counting, no storage written.
 *
 *   IT COSTS NO DATABASE READ FOR THE PAGES NOBODY MEASURES. Serving an app is a hot path, and a
 *   key lookup per request to discover that an owner never opted in would be a tax on every app on
 *   the node. A short negative cache answers that question in memory. The window is deliberately
 *   short: turning measurement ON should take effect within a minute, and the cost of being one
 *   minute late is nothing.
 *
 *   NEVER BLOCKS AND NEVER THROWS. It is called after the response is on its way and a failure is
 *   logged, because a counter must not be able to cost anyone their page.
 *
 * @structure pageStreamId · countPageView · resetPageViewCache (tests)
 * @usage countPageView(storage, { ownerGhii: app.ownerGaii, name: filename, userAgent: … });
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial, with the signals collector.
 */
import type { Storage } from '../../storage/interface.js';
import { getStream, recordHit, streamsRevision } from './signal-service.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';

/**
 * The stream a published thing is counted into: `page-` plus its name reduced to the slug
 * alphabet a stream id allows. `cadence.html` → `page-cadence-html`.
 *
 * A convention rather than a stored mapping, so the owner can create the stream before the page
 * exists (a campaign is usually set up that way) and nothing has to be linked up afterwards.
 */
export function pageStreamId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55);
  return `page-${slug || 'unnamed'}`;
}

/** How long a "this page is not measured" answer is trusted. Short on purpose: see the header. */
const NEGATIVE_TTL_MS = 60_000;
/** Bound on the cache, so a node serving many apps cannot grow it without limit. */
const MAX_CACHE = 5_000;

interface Miss { until: number; revision: number }
const notMeasured = new Map<string, Miss>();

/** Test seam: the cache is process-local and would otherwise leak between cases. */
export function resetPageViewCache(): void {
  notMeasured.clear();
}

/**
 * Count one fetch of a published page. Fire and forget: callers do not await this.
 *
 * `ref` is what was fetched, which lets one stream cover a family of pages (every page of a
 * campaign) while still saying which of them was read.
 */
export function countPageView(storage: Storage, args: {
  /** The publisher, as stored on the record. An agent GAII resolves to its owner. */
  ownerGaii: string;
  /** The file or page name, as served. */
  name: string;
  userAgent?: string | null;
  /** Overrides the derived stream id when the caller knows the stream by name. */
  streamId?: string;
  ref?: string | null;
}): void {
  const ownerGhii = ownerGhiiOf(args.ownerGaii);
  const streamId = args.streamId ?? pageStreamId(args.name);
  const cacheKey = `${ownerGhii}|${streamId}`;

  // A cached miss is trusted only while no stream anywhere has changed. Creating the stream is how
  // an owner turns measurement on, and it has to take effect on the next request rather than when
  // a timer happens to expire.
  const miss = notMeasured.get(cacheKey);
  if (miss && miss.until > Date.now() && miss.revision === streamsRevision()) return;

  void (async () => {
    try {
      const stream = await getStream(storage, ownerGhii, streamId);
      if (!stream || !stream.enabled) {
        if (notMeasured.size >= MAX_CACHE) notMeasured.clear();
        notMeasured.set(cacheKey, { until: Date.now() + NEGATIVE_TTL_MS, revision: streamsRevision() });
        return;
      }
      notMeasured.delete(cacheKey);
      await recordHit(storage, {
        ownerGhii, streamId, event: 'view', channel: 'page',
        ref: args.ref ?? args.name, userAgent: args.userAgent,
      });
    } catch (e) {
      logger.warn('signals: a page view could not be counted', { streamId, error: String(e) });
    }
  })();
}
