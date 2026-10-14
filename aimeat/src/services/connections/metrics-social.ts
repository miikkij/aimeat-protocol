/**
 * @file metrics-social.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading back how a post did on a Facebook Page, Instagram and Reddit (2026-10-15).
 *   Same interface and the same discipline as metrics.ts, which registers these readers: null is
 *   not zero, and a reference a reader does not recognise is a refusal rather than a guess.
 *
 *   WHAT IS NOT READ, AND WHY. Facebook's post impressions were deprecated above Graph API v25 and
 *   for every version from 2026-06-15, so no impression number is asked for there; Instagram's
 *   `impressions` is deprecated for media made after 2024-07-02 and its replacement `views` is still
 *   marked "in development". Both report likes, comments and shares, which is what is compared.
 * @structure SOCIAL_METRIC_READERS · facebookObjectIdOf · redditPostIdOf
 * @usage import { SOCIAL_METRIC_READERS } from './metrics-social.js';
 * @version-history
 *   v1.0.0 — 2026-10-15 — Facebook Page, Instagram, Reddit.
 */

import { safeFetch } from '../../utils/url-validator.js';
import { readJson } from '../../utils/read-capped.js';
import { logger } from '../../utils/logger.js';
import type { ConnectionCredential, PublishMetricSample } from '../../models/connection-schemas.js';
import { FACEBOOK_GRAPH, INSTAGRAM_GRAPH, REDDIT_USER_AGENT } from './providers-social.js';
import { igMediaIdOf } from './publish-social.js';

/** A provider's answer here is a few kilobytes; a reply list is the largest, well under this (C6). */
const ANSWER_MAX_BYTES = 4 * 1024 * 1024;

type Sample = Omit<PublishMetricSample, 'id' | 'attemptId'>;
type Outcome = { ok: true; sample: Sample } | { ok: false; permanent: boolean; reason: string };
type Reader = (input: { credential: ConnectionCredential; externalRef: string }) => Promise<Outcome>;

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function sample(parts: { likes?: number | null; comments?: number | null; shares?: number | null; impressions?: number | null }, raw: Record<string, unknown>): Outcome {
  return {
    ok: true,
    sample: {
      fetchedAt: new Date().toISOString(),
      impressions: parts.impressions ?? null,
      likes: parts.likes ?? null,
      comments: parts.comments ?? null,
      shares: parts.shares ?? null,
      raw,
    },
  };
}

/**
 * The Graph object a Facebook reference names: `https://www.facebook.com/<page>_<post>` for a post
 * or photo, `https://www.facebook.com/<page>/videos/<video>` for a video. Anything else is not ours.
 */
export function facebookObjectIdOf(ref: string): string {
  const m = /^https:\/\/www\.facebook\.com\/(?:\d+\/videos\/(\d+)|(\d+_\d+|\d+))\/?$/.exec(ref);
  return m ? (m[1] ?? m[2] ?? '') : '';
}

/** The post id in a Reddit reference (`.../comments/<id>/...`). */
export function redditPostIdOf(ref: string): string {
  return /^https:\/\/(?:www\.|old\.)?reddit\.com\/r\/[A-Za-z0-9_]+\/comments\/([a-z0-9]+)/i.exec(ref)?.[1] ?? '';
}

async function answer(res: Response): Promise<Record<string, unknown>> {
  try {
    return await readJson(res, ANSWER_MAX_BYTES) as Record<string, unknown>;
  } catch (err) {
    // An unreadable body reads as an empty one below, whose every count is null: no number is
    // invented. Logged so the two can be told apart.
    logger.warn('connections: a metrics answer was not JSON', { status: res.status, error: String(err) });
    return {};
  }
}

const facebookMetrics: Reader = async ({ credential, externalRef }) => {
  const id = facebookObjectIdOf(externalRef);
  if (!id) return { ok: false, permanent: true, reason: 'no Facebook post id in the stored reference' };
  try {
    const fields = 'shares,reactions.summary(total_count).limit(0),comments.summary(true).limit(0)';
    const r = await safeFetch(`${FACEBOOK_GRAPH}/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`, {
      headers: { Authorization: `Bearer ${credential.accessToken}` }, signal: AbortSignal.timeout(15_000),
    });
    const j = await answer(r);
    if (r.status === 404 || (r.status === 400 && /does not exist/i.test(JSON.stringify(j)))) {
      return { ok: false, permanent: true, reason: 'that post is gone from the page' };
    }
    if (!r.ok) return { ok: false, permanent: r.status === 401 || r.status === 403, reason: `Facebook answered HTTP ${r.status}` };
    const reactions = (j.reactions as { summary?: { total_count?: unknown } } | undefined)?.summary?.total_count;
    const comments = (j.comments as { summary?: { total_count?: unknown } } | undefined)?.summary?.total_count;
    // `shares` is absent, not zero, on a post nobody has shared; and on a video it does not exist.
    const shares = (j.shares as { count?: unknown } | undefined)?.count;
    return sample({ likes: n(reactions), comments: n(comments), shares: n(shares) }, j);
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach Facebook: ${(err as Error).message}` };
  }
};

const instagramMetrics: Reader = async ({ credential, externalRef }) => {
  const id = igMediaIdOf(externalRef);
  if (!id) return { ok: false, permanent: true, reason: 'no Instagram media id in the stored reference' };
  const headers = { Authorization: `Bearer ${credential.accessToken}` };
  try {
    const r = await safeFetch(`${INSTAGRAM_GRAPH}/${encodeURIComponent(id)}?fields=like_count,comments_count`, {
      headers, signal: AbortSignal.timeout(15_000),
    });
    const j = await answer(r);
    if (r.status === 400 || r.status === 404) return { ok: false, permanent: true, reason: 'that post is gone, or is not this account\'s' };
    if (!r.ok) return { ok: false, permanent: r.status === 401 || r.status === 403, reason: `Instagram answered HTTP ${r.status}` };
    // Shares and saves are an insights read, which needs the insights permission; asked for, and a
    // refusal there costs the shares number only, never the sample.
    let shares: number | null = null;
    const raw: Record<string, unknown> = { ...j };
    try {
      const ins = await safeFetch(`${INSTAGRAM_GRAPH}/${encodeURIComponent(id)}/insights?metric=shares,saved,reach`, {
        headers, signal: AbortSignal.timeout(15_000),
      });
      if (ins.ok) {
        const ij = await answer(ins);
        raw.insights = ij;
        const rows = Array.isArray(ij.data) ? ij.data as Array<{ name?: unknown; values?: Array<{ value?: unknown }> }> : [];
        shares = n(rows.find((x) => x.name === 'shares')?.values?.[0]?.value);
      }
    } catch (err) {
      // The counts above are the sample; insights are a bonus the account may not grant.
      logger.info('connections: Instagram insights were not read; the sample carries no shares', { error: String(err) });
    }
    return sample({ likes: n(j.like_count), comments: n(j.comments_count), shares }, raw);
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach Instagram: ${(err as Error).message}` };
  }
};

const redditMetrics: Reader = async ({ credential, externalRef }) => {
  const id = redditPostIdOf(externalRef);
  if (!id) return { ok: false, permanent: true, reason: 'no Reddit post id in the stored reference' };
  try {
    const r = await safeFetch(`https://oauth.reddit.com/by_id/t3_${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${credential.accessToken}`, 'User-Agent': REDDIT_USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 404) return { ok: false, permanent: true, reason: 'that post is gone' };
    if (r.status === 429) return { ok: false, permanent: false, reason: 'Reddit is rate limiting this app; try later' };
    if (!r.ok) return { ok: false, permanent: r.status === 401 || r.status === 403, reason: `Reddit answered HTTP ${r.status}` };
    const j = await answer(r);
    const post = ((j.data as { children?: Array<{ data?: Record<string, unknown> }> } | undefined)?.children?.[0]?.data) ?? null;
    if (!post) return { ok: false, permanent: true, reason: 'Reddit returned no such post' };
    // `score` is upvotes minus downvotes, the number Reddit shows; it stands in for likes, and the
    // ratio stays in raw for anyone who wants the split.
    return sample({ likes: n(post.score), comments: n(post.num_comments), shares: n(post.num_crossposts) }, post);
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach Reddit: ${(err as Error).message}` };
  }
};

export const SOCIAL_METRIC_READERS: Readonly<Record<string, Reader>> = {
  facebook: facebookMetrics,
  instagram: instagramMetrics,
  reddit: redditMetrics,
};
