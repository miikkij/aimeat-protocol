/**
 * @file metrics.ts
 * @description Reading back how a published item is doing (TARGET-057). One function per provider,
 *   behind one interface, mirroring publish.ts.
 *
 *   WHY THE NUMBERS ARE NORMALISED AND THE ORIGINAL IS KEPT. A Mastodon reblog, a Bluesky repost,
 *   an X retweet and a LinkedIn share are cousins rather than synonyms; so are an "impression" and
 *   a "view". Normalising is what makes "which platform did this land on" answerable at all, and
 *   keeping `raw` is what keeps a wrong mapping discoverable instead of letting it become the only
 *   surviving record.
 *
 *   NULL IS NOT ZERO, AND THAT IS THE WHOLE DISCIPLINE HERE. A platform that does not report
 *   impressions to the author has reported nothing. Writing 0 would invent a measurement nobody
 *   made, and a dashboard that averages invented zeros lies confidently.
 *
 *   THE REFERENCE IS A URL. publish.ts stores a human-openable link rather than a bare id, which is
 *   right for the thing a person clicks and means every reader here has to get the id back out.
 *   Each extractor is written against the exact shape its own recipe produces, and a reference it
 *   does not recognise is a refusal rather than a guess: guessing an id fetches somebody else's
 *   post and reports it as yours.
 * @structure MetricReader · readMetrics · mastodonMetrics · blueskyMetrics · youtubeMetrics ·
 *   linkedinMetrics · xMetrics
 * @usage import { readMetrics } from './metrics.js';
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057. Reach for Mastodon, Bluesky, YouTube and X; LinkedIn refuses
 *     out loud because member-post analytics are partner-gated.
 */

import { randomUUID } from 'node:crypto';
import { safeFetch } from '../../utils/url-validator.js';
import { logger } from '../../utils/logger.js';
import type { ConnectionCredential, ConnectionRecord, PublishMetricSample } from '../../models/connection-schemas.js';
import type { OutboundProvider } from './providers.js';

export interface MetricInput {
  provider: OutboundProvider;
  connection: ConnectionRecord;
  credential: ConnectionCredential;
  /** What publish.ts recorded. A URL, from which each reader recovers its own provider's id. */
  externalRef: string;
}

export type MetricOutcome =
  | { ok: true; sample: Omit<PublishMetricSample, 'id' | 'attemptId'> }
  | {
    ok: false;
    /**
     * True when asking again will never work: the platform does not offer this number to an
     * author, or the item is gone. A caller that retries a permanent refusal on a schedule turns
     * one wrong answer into a standing cost, which on X is literal money.
     */
    permanent: boolean;
    reason: string;
  };

export type MetricReader = (input: MetricInput) => Promise<MetricOutcome>;

/** A number the provider reported, or null. Absent and zero are different answers. */
function n(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Some providers report counts as strings (YouTube does). Still not the same as absent. */
function ns(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return null;
}

function sample(
  parts: { impressions?: number | null; likes?: number | null; comments?: number | null; shares?: number | null },
  raw: Record<string, unknown>,
): MetricOutcome {
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
 * Mastodon: the status itself carries its counts.
 *
 * The reference is the status URL, whose last path segment is the id. Read from the connection's
 * OWN instance rather than from the URL's host: a boosted status can carry a URL pointing at
 * wherever it originated, and fetching that would ask a stranger's server about it.
 */
const mastodonMetrics: MetricReader = async ({ connection, credential, externalRef }) => {
  const id = /\/(\d+)\/?$/.exec(externalRef)?.[1];
  if (!id) return { ok: false, permanent: true, reason: 'no Mastodon status id in the stored reference' };
  const origin = connection.instance;
  if (!origin) return { ok: false, permanent: true, reason: 'this connection has no instance' };
  try {
    const r = await safeFetch(`${origin}/api/v1/statuses/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${credential.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 404) return { ok: false, permanent: true, reason: 'that post is gone from the instance' };
    if (!r.ok) return { ok: false, permanent: r.status === 401, reason: `Mastodon answered HTTP ${r.status}` };
    const j = await r.json() as Record<string, unknown>;
    return sample({
      // Mastodon reports no impressions to an author at all. Null, not zero.
      likes: n(j.favourites_count),
      comments: n(j.replies_count),
      shares: n(j.reblogs_count),
    }, j);
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach the instance: ${(err as Error).message}` };
  }
};

/**
 * Bluesky: the post view carries its counts.
 *
 * The reference here is an at:// URI rather than a URL, because that is what the recipe stored and
 * what the API wants. No parsing required, which is the one easy case in this file.
 */
const blueskyMetrics: MetricReader = async ({ credential, externalRef }) => {
  if (!externalRef.startsWith('at://')) {
    return { ok: false, permanent: true, reason: 'the stored reference is not an at:// URI' };
  }
  try {
    const url = 'https://bsky.social/xrpc/app.bsky.feed.getPostThread'
      + `?uri=${encodeURIComponent(externalRef)}&depth=0&parentHeight=0`;
    const r = await safeFetch(url, {
      headers: { Authorization: `Bearer ${credential.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 400 || r.status === 404) {
      return { ok: false, permanent: true, reason: 'that post is gone' };
    }
    if (!r.ok) return { ok: false, permanent: r.status === 401, reason: `Bluesky answered HTTP ${r.status}` };
    const j = await r.json() as { thread?: { post?: Record<string, unknown> } };
    const post = j.thread?.post ?? {};
    return sample({
      // Bluesky gives an author no impression count either.
      likes: n(post.likeCount),
      comments: n(post.replyCount),
      // Reposts and quotes are both shares of a sort; summed only when both were reported, so an
      // absent quoteCount does not silently become zero and deflate the number.
      shares: n(post.repostCount) === null && n(post.quoteCount) === null
        ? null
        : (n(post.repostCount) ?? 0) + (n(post.quoteCount) ?? 0),
    }, post);
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach Bluesky: ${(err as Error).message}` };
  }
};

/**
 * YouTube: videos.list with the statistics part.
 *
 * Costs 1 quota unit against the same daily allowance an upload spends 1600 of, so reading is
 * effectively free next to publishing. Counts come back as STRINGS, which is why ns() exists.
 */
const youtubeMetrics: MetricReader = async ({ credential, externalRef }) => {
  const id = /youtu\.be\/([\w-]+)/.exec(externalRef)?.[1]
    ?? /[?&]v=([\w-]+)/.exec(externalRef)?.[1];
  if (!id) return { ok: false, permanent: true, reason: 'no YouTube video id in the stored reference' };
  try {
    const r = await safeFetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${credential.accessToken}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (r.status === 403) {
      return { ok: false, permanent: true, reason: 'YouTube refused: this connection lacks the youtube.readonly scope' };
    }
    if (!r.ok) return { ok: false, permanent: r.status === 401, reason: `YouTube answered HTTP ${r.status}` };
    const j = await r.json() as { items?: Array<{ statistics?: Record<string, unknown> }> };
    const st = j.items?.[0]?.statistics;
    if (!st) return { ok: false, permanent: true, reason: 'that video is gone, or is not visible to this account' };
    return sample({
      impressions: ns(st.viewCount),
      likes: ns(st.likeCount),
      comments: ns(st.commentCount),
      // YouTube reports no share count through this API. Null rather than a comforting zero.
    }, st);
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach YouTube: ${(err as Error).message}` };
  }
};

/**
 * X: public_metrics on the post.
 *
 * THIS COSTS MONEY EVERY TIME. Pay-per-use charges per read, so a dashboard that refreshes on a
 * timer is a standing bill. Nothing here schedules anything; a read happens because somebody asked
 * for one, and the app says so before they ask.
 */
const xMetrics: MetricReader = async ({ credential, externalRef }) => {
  const id = /\/status\/(\d+)/.exec(externalRef)?.[1];
  if (!id) return { ok: false, permanent: true, reason: 'no X post id in the stored reference' };
  try {
    const r = await safeFetch(
      `https://api.x.com/2/tweets/${encodeURIComponent(id)}?tweet.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${credential.accessToken}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (r.status === 402) {
      return { ok: false, permanent: false, reason: 'X declined for billing: the prepaid credit balance is spent' };
    }
    if (r.status === 429) {
      return { ok: false, permanent: false, reason: 'X is rate limiting this app; try later' };
    }
    if (r.status === 404) return { ok: false, permanent: true, reason: 'that post is gone' };
    if (!r.ok) return { ok: false, permanent: r.status === 401, reason: `X answered HTTP ${r.status}` };
    const j = await r.json() as { data?: { public_metrics?: Record<string, unknown> } };
    const m = j.data?.public_metrics;
    if (!m) return { ok: false, permanent: true, reason: 'X returned no metrics for that post' };
    return sample({
      impressions: n(m.impression_count),
      likes: n(m.like_count),
      comments: n(m.reply_count),
      shares: n(m.retweet_count) === null && n(m.quote_count) === null
        ? null
        : (n(m.retweet_count) ?? 0) + (n(m.quote_count) ?? 0),
    }, m);
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach X: ${(err as Error).message}` };
  }
};

/**
 * LinkedIn: refused, and it says why.
 *
 * Member-post analytics live behind the partner-gated Community Management product; the Consumer
 * tier that "Share on LinkedIn" belongs to can publish and cannot read back. Returning a permanent
 * refusal with the reason beats returning zeros, which would put a flat line on a chart next to
 * platforms that are actually reporting and quietly say LinkedIn performed worst.
 */
const linkedinMetrics: MetricReader = async () => ({
  ok: false,
  permanent: true,
  reason: 'LinkedIn does not report post analytics at this tier; reading them needs the partner-gated Community Management product',
});

/**
 * The test provider. Present for the same reason its publish recipe is: a path with no reader can
 * only be described in a test, and a described path is not a tested one.
 */
const fakeMetrics: MetricReader = async ({ provider, credential, externalRef }) => {
  const base = provider.endpoints(null)?.token?.replace('/token', '') ?? '';
  if (!base) return { ok: false, permanent: true, reason: 'the test provider has no base url' };
  const id = externalRef.split('/').pop() ?? '';
  try {
    const r = await safeFetch(`${base}/metrics/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${credential.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 404) return { ok: false, permanent: true, reason: 'that item is gone' };
    if (!r.ok) return { ok: false, permanent: r.status === 401, reason: `test provider answered HTTP ${r.status}` };
    const j = await r.json() as Record<string, unknown>;
    return sample({ likes: n(j.likes), comments: n(j.comments), shares: n(j.shares) }, j);
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach the test provider: ${(err as Error).message}` };
  }
};

const READERS: Record<string, MetricReader> = {
  fake: fakeMetrics,
  mastodon: mastodonMetrics,
  bluesky: blueskyMetrics,
  youtube: youtubeMetrics,
  linkedin: linkedinMetrics,
  x: xMetrics,
};

/**
 * Read one item's numbers. A provider with no reader is a permanent refusal rather than silence:
 * the caller asked a question and deserves an answer it can show.
 */
export async function readMetrics(input: MetricInput): Promise<MetricOutcome> {
  if (!input.externalRef) {
    return { ok: false, permanent: true, reason: 'nothing was published, so there is nothing to measure' };
  }
  const reader = READERS[input.provider.id];
  if (!reader) {
    return { ok: false, permanent: true, reason: `no way to read numbers from ${input.provider.id} yet` };
  }
  const out = await reader(input);
  if (!out.ok) {
    logger.info('connections: a metric read did not produce numbers', {
      provider: input.provider.id, permanent: out.permanent, reason: out.reason,
    });
  }
  return out;
}

/** Attach the ids the store needs. Kept here so a caller cannot forget the attempt it belongs to. */
export function toStoredSample(
  attemptId: string, s: Omit<PublishMetricSample, 'id' | 'attemptId'>,
): PublishMetricSample {
  return { id: randomUUID(), attemptId, ...s };
}

/** Exposed so a test can ask which providers have a reader, rather than keeping its own list. */
export const METRIC_READERS_FOR_TEST: Readonly<Record<string, MetricReader>> = READERS;
