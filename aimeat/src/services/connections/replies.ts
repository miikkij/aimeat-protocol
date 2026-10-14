/**
 * @file replies.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading what people answered to an item this node published (2026-10-15): the
 *   comments on a Facebook post or a YouTube video, the replies to a Mastodon status, a Bluesky post
 *   or an X post, the comments on an Instagram post or a Reddit post. One reader per provider,
 *   behind one interface, mirroring metrics.ts, and one shape for every answer, so an agent that
 *   judges the replies reads them the same way whatever network they came from.
 *
 *   NOTHING IS STORED. A reply is somebody else's words on somebody else's service; the node reads
 *   them when a person or their agent asks, and whoever asked decides what is worth keeping (the
 *   LÄHETIN space keeps a judged summary, not the raw thread). Storing every reply here would make
 *   the node an archive of strangers' comments that nothing ever ages out of.
 *
 *   IT COSTS WHAT IT COSTS, AND ONLY WHEN ASKED. On X every reply read is billed at the pay-per-use
 *   read price, and search reaches back seven days only; on YouTube a page is one quota unit.
 *   Nothing schedules this: the route is a POST, like the metric read.
 *
 *   LINKEDIN SAYS NO. Reading comments on a member's own post needs a partner-gated permission
 *   (r_member_social_feed, "granted to select developers only"), so the answer is a permanent
 *   refusal with that reason rather than an empty list that would read as "nobody answered".
 * @structure Reply · RepliesOutcome · readReplies · REPLY_READERS_FOR_TEST
 * @usage const out = await readReplies({ provider, connection, credential, externalRef });
 * @version-history
 *   v1.0.0 — 2026-10-15 — Mastodon, Bluesky, YouTube, X, Facebook Page, Instagram, Reddit; LinkedIn
 *     refuses with the reason.
 */

import { safeFetch } from '../../utils/url-validator.js';
import { readJson } from '../../utils/read-capped.js';
import { logger } from '../../utils/logger.js';
import type { ConnectionCredential, ConnectionRecord } from '../../models/connection-schemas.js';
import type { OutboundProvider } from './providers.js';
import { FACEBOOK_GRAPH, INSTAGRAM_GRAPH, REDDIT_USER_AGENT } from './providers-social.js';
import { igMediaIdOf } from './publish-social.js';
import { facebookObjectIdOf, redditPostIdOf } from './metrics-social.js';

/** A provider's answer here is a few kilobytes; a reply list is the largest, well under this (C6). */
const ANSWER_MAX_BYTES = 4 * 1024 * 1024;

/** One answer somebody wrote, in the same shape whichever network it came from. */
export interface Reply {
  /** The provider's own id for the reply. */
  id: string;
  /** The name the writer shows. */
  author: string;
  /** Their handle where the network has one (`@name@instance`, `name.bsky.social`, `u/name`). */
  authorHandle: string | null;
  /** The text, as plain text: HTML is stripped, entities decoded. */
  text: string;
  createdAt: string | null;
  /** Where a person opens it. */
  url: string | null;
  /** The reply it answers, when it answers a reply rather than the post. Null for a top-level one. */
  parentId: string | null;
  /** Likes, favourites or score, as the network reports it. Null when it does not. */
  likes: number | null;
}

export interface RepliesInput {
  provider: OutboundProvider;
  connection: ConnectionRecord;
  credential: ConnectionCredential;
  externalRef: string;
  /** At most this many, newest first where the network can sort. Default 100, ceiling 200. */
  limit?: number;
}

export type RepliesOutcome =
  | { ok: true; replies: Reply[]; truncated: boolean; note?: string }
  | { ok: false; permanent: boolean; reason: string };

type Reader = (input: RepliesInput & { limit: number }) => Promise<RepliesOutcome>;

const s = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Mastodon sends HTML. A reader wants the words; links keep their text, paragraphs a line break. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

async function body(res: Response, provider: string): Promise<Record<string, unknown>> {
  try {
    return await readJson(res, ANSWER_MAX_BYTES) as Record<string, unknown>;
  } catch (err) {
    // An unreadable answer and an empty thread must not look alike: the caller turns this into a
    // refusal below, where `{}` would have read as "nobody answered".
    logger.warn('connections: a replies answer was not JSON', { provider, status: res.status, error: String(err) });
    return { __unreadable: true };
  }
}

const unreadable = (j: Record<string, unknown>, who: string): RepliesOutcome | null =>
  j.__unreadable ? { ok: false, permanent: false, reason: `${who} answered with something that is not a reply list` } : null;

function finish(all: Reply[], limit: number, note?: string): RepliesOutcome {
  return { ok: true, replies: all.slice(0, limit), truncated: all.length > limit, ...(note ? { note } : {}) };
}

// ── Mastodon ─────────────────────────────────────────────────────────────────────────────────

const mastodonReplies: Reader = async ({ connection, credential, externalRef, limit }) => {
  const id = /\/(\d+)\/?$/.exec(externalRef)?.[1];
  if (!id) return { ok: false, permanent: true, reason: 'no Mastodon status id in the stored reference' };
  if (!connection.instance) return { ok: false, permanent: true, reason: 'this connection has no instance' };
  const r = await safeFetch(`${connection.instance}/api/v1/statuses/${encodeURIComponent(id)}/context`, {
    headers: { Authorization: `Bearer ${credential.accessToken}` }, signal: AbortSignal.timeout(20_000),
  });
  if (r.status === 404) return { ok: false, permanent: true, reason: 'that post is gone from the instance' };
  if (r.status === 403) return { ok: false, permanent: true, reason: 'Mastodon refused: this connection lacks read:statuses. Connect the account again.' };
  if (!r.ok) return { ok: false, permanent: r.status === 401, reason: `Mastodon answered HTTP ${r.status}` };
  const j = await body(r, 'mastodon');
  const bad = unreadable(j, 'Mastodon'); if (bad) return bad;
  const items = Array.isArray(j.descendants) ? j.descendants as Array<Record<string, unknown>> : [];
  const replies = items.map((d): Reply => {
    const acct = (d.account ?? {}) as Record<string, unknown>;
    const parent = s(d.in_reply_to_id);
    return {
      id: s(d.id),
      author: s(acct.display_name) || s(acct.acct),
      authorHandle: s(acct.acct) ? `@${s(acct.acct)}` : null,
      text: htmlToText(s(d.content)),
      createdAt: s(d.created_at) || null,
      url: s(d.url) || null,
      parentId: parent && parent !== id ? parent : null,
      likes: num(d.favourites_count),
    };
  });
  // Mastodon answers in thread order; newest first is what a person reading replies wants.
  replies.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return finish(replies, limit);
};

// ── Bluesky ──────────────────────────────────────────────────────────────────────────────────

const blueskyReplies: Reader = async ({ credential, externalRef, limit }) => {
  if (!externalRef.startsWith('at://')) return { ok: false, permanent: true, reason: 'the stored reference is not an at:// URI' };
  const url = 'https://bsky.social/xrpc/app.bsky.feed.getPostThread'
    + `?uri=${encodeURIComponent(externalRef)}&depth=8&parentHeight=0`;
  const r = await safeFetch(url, { headers: { Authorization: `Bearer ${credential.accessToken}` }, signal: AbortSignal.timeout(20_000) });
  if (r.status === 400 || r.status === 404) return { ok: false, permanent: true, reason: 'that post is gone' };
  if (!r.ok) return { ok: false, permanent: r.status === 401, reason: `Bluesky answered HTTP ${r.status}` };
  const j = await body(r, 'bluesky');
  const bad = unreadable(j, 'Bluesky'); if (bad) return bad;
  const out: Reply[] = [];
  const walk = (node: Record<string, unknown> | undefined, parentUri: string | null): void => {
    const kids = Array.isArray(node?.replies) ? node!.replies as Array<Record<string, unknown>> : [];
    for (const k of kids) {
      const post = (k.post ?? {}) as Record<string, unknown>;
      const uri = s(post.uri);
      if (!uri) continue; // a blocked or deleted reply arrives without a post
      const author = (post.author ?? {}) as Record<string, unknown>;
      const record = (post.record ?? {}) as Record<string, unknown>;
      const handle = s(author.handle);
      const rkey = uri.split('/').pop() ?? '';
      out.push({
        id: uri,
        author: s(author.displayName) || handle,
        authorHandle: handle || null,
        text: s(record.text),
        createdAt: s(record.createdAt) || null,
        url: handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : null,
        parentId: parentUri,
        likes: num(post.likeCount),
      });
      walk(k, uri);
    }
  };
  walk(j.thread as Record<string, unknown> | undefined, null);
  out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return finish(out, limit);
};

// ── YouTube ──────────────────────────────────────────────────────────────────────────────────

const youtubeReplies: Reader = async ({ credential, externalRef, limit }) => {
  const id = /youtu\.be\/([\w-]+)/.exec(externalRef)?.[1] ?? /[?&]v=([\w-]+)/.exec(externalRef)?.[1];
  if (!id) return { ok: false, permanent: true, reason: 'no YouTube video id in the stored reference' };
  const q = new URLSearchParams({
    part: 'snippet,replies', videoId: id, maxResults: String(Math.min(limit, 100)),
    order: 'time', textFormat: 'plainText',
  });
  const r = await safeFetch(`https://www.googleapis.com/youtube/v3/commentThreads?${q.toString()}`, {
    headers: { Authorization: `Bearer ${credential.accessToken}` }, signal: AbortSignal.timeout(20_000),
  });
  const j = await body(r, 'youtube');
  if (r.status === 403) {
    const reason = JSON.stringify(j);
    if (/commentsDisabled/.test(reason)) return { ok: false, permanent: true, reason: 'comments are turned off on this video' };
    return { ok: false, permanent: true, reason: 'YouTube refused: this connection was made before reading comments was asked for. Connect the YouTube account again.' };
  }
  if (r.status === 404) return { ok: false, permanent: true, reason: 'that video is gone' };
  if (!r.ok) return { ok: false, permanent: r.status === 401, reason: `YouTube answered HTTP ${r.status}` };
  const bad = unreadable(j, 'YouTube'); if (bad) return bad;
  const out: Reply[] = [];
  const toReply = (c: Record<string, unknown>, parentId: string | null): Reply => {
    const sn = (c.snippet ?? {}) as Record<string, unknown>;
    const cid = s(c.id);
    return {
      id: cid,
      author: s(sn.authorDisplayName),
      authorHandle: s(sn.authorDisplayName).startsWith('@') ? s(sn.authorDisplayName) : null,
      text: s(sn.textOriginal) || s(sn.textDisplay),
      createdAt: s(sn.publishedAt) || null,
      url: `https://www.youtube.com/watch?v=${id}&lc=${encodeURIComponent(cid)}`,
      parentId,
      likes: num(sn.likeCount),
    };
  };
  for (const t of (Array.isArray(j.items) ? j.items : []) as Array<Record<string, unknown>>) {
    const top = ((t.snippet ?? {}) as Record<string, unknown>).topLevelComment as Record<string, unknown> | undefined;
    if (!top) continue;
    out.push(toReply(top, null));
    const rep = ((t.replies ?? {}) as Record<string, unknown>).comments;
    for (const c of (Array.isArray(rep) ? rep : []) as Array<Record<string, unknown>>) out.push(toReply(c, s(top.id)));
  }
  return finish(out, limit, typeof j.nextPageToken === 'string' ? 'YouTube has more threads than one page; the newest are here' : undefined);
};

// ── X ────────────────────────────────────────────────────────────────────────────────────────

const xReplies: Reader = async ({ credential, externalRef, limit }) => {
  const id = /\/status\/(\d+)/.exec(externalRef)?.[1];
  if (!id) return { ok: false, permanent: true, reason: 'no X post id in the stored reference' };
  const q = new URLSearchParams({
    query: `conversation_id:${id}`,
    max_results: String(Math.max(10, Math.min(limit, 100))),
    'tweet.fields': 'author_id,created_at,public_metrics,referenced_tweets',
    expansions: 'author_id',
    'user.fields': 'username,name',
  });
  const r = await safeFetch(`https://api.x.com/2/tweets/search/recent?${q.toString()}`, {
    headers: { Authorization: `Bearer ${credential.accessToken}` }, signal: AbortSignal.timeout(20_000),
  });
  if (r.status === 402) return { ok: false, permanent: false, reason: 'X declined for billing: the prepaid credit balance is spent' };
  if (r.status === 429) return { ok: false, permanent: false, reason: 'X is rate limiting this app; try later' };
  if (!r.ok) return { ok: false, permanent: r.status === 401 || r.status === 403, reason: `X answered HTTP ${r.status}` };
  const j = await body(r, 'x');
  const bad = unreadable(j, 'X'); if (bad) return bad;
  const users = new Map<string, { username: string; name: string }>();
  const inc = (j.includes ?? {}) as Record<string, unknown>;
  for (const u of (Array.isArray(inc.users) ? inc.users : []) as Array<Record<string, unknown>>) {
    users.set(s(u.id), { username: s(u.username), name: s(u.name) });
  }
  const out = ((Array.isArray(j.data) ? j.data : []) as Array<Record<string, unknown>>).map((t): Reply => {
    const u = users.get(s(t.author_id));
    const replied = ((Array.isArray(t.referenced_tweets) ? t.referenced_tweets : []) as Array<Record<string, unknown>>)
      .find((x) => x.type === 'replied_to');
    const parent = replied ? s(replied.id) : '';
    return {
      id: s(t.id),
      author: u?.name || u?.username || s(t.author_id),
      authorHandle: u?.username ? `@${u.username}` : null,
      text: s(t.text),
      createdAt: s(t.created_at) || null,
      url: u?.username ? `https://x.com/${u.username}/status/${s(t.id)}` : `https://x.com/i/status/${s(t.id)}`,
      parentId: parent && parent !== id ? parent : null,
      likes: num(((t.public_metrics ?? {}) as Record<string, unknown>).like_count),
    };
  });
  return finish(out, limit, 'X search reaches back seven days; older replies are not in this answer');
};

// ── Facebook Page ────────────────────────────────────────────────────────────────────────────

const facebookReplies: Reader = async ({ credential, externalRef, limit }) => {
  const id = facebookObjectIdOf(externalRef);
  if (!id) return { ok: false, permanent: true, reason: 'no Facebook post id in the stored reference' };
  const q = new URLSearchParams({
    fields: 'id,message,from,created_time,like_count,parent{id},permalink_url',
    filter: 'stream', order: 'reverse_chronological', limit: String(Math.min(limit, 100)),
  });
  const r = await safeFetch(`${FACEBOOK_GRAPH}/${encodeURIComponent(id)}/comments?${q.toString()}`, {
    headers: { Authorization: `Bearer ${credential.accessToken}` }, signal: AbortSignal.timeout(20_000),
  });
  const j = await body(r, 'facebook');
  if (!r.ok) {
    const code = num(((j.error ?? {}) as Record<string, unknown>).code);
    if (code === 190) return { ok: false, permanent: true, reason: 'Meta no longer accepts this connection; connect the page again' };
    if (code === 10 || code === 200) return { ok: false, permanent: true, reason: 'Facebook refused: this connection may not read comments. Connect the page again and allow reading them.' };
    return { ok: false, permanent: r.status < 500 && code !== 4 && code !== 17 && code !== 32, reason: `Facebook answered HTTP ${r.status}` };
  }
  const bad = unreadable(j, 'Facebook'); if (bad) return bad;
  const out = ((Array.isArray(j.data) ? j.data : []) as Array<Record<string, unknown>>).map((c): Reply => {
    const from = (c.from ?? {}) as Record<string, unknown>;
    const parent = s(((c.parent ?? {}) as Record<string, unknown>).id);
    return {
      id: s(c.id),
      // `from` is present only when Meta lets this page see the person; a comment without it is
      // still a comment, and "someone" is the honest name for its writer.
      author: s(from.name) || 'someone',
      authorHandle: null,
      text: s(c.message),
      createdAt: s(c.created_time) || null,
      url: s(c.permalink_url) || null,
      parentId: parent || null,
      likes: num(c.like_count),
    };
  });
  return finish(out, limit);
};

// ── Instagram ────────────────────────────────────────────────────────────────────────────────

const instagramReplies: Reader = async ({ credential, externalRef, limit }) => {
  const id = igMediaIdOf(externalRef);
  if (!id) return { ok: false, permanent: true, reason: 'no Instagram media id in the stored reference' };
  const q = new URLSearchParams({
    fields: 'id,text,username,timestamp,like_count,replies{id,text,username,timestamp,like_count}',
    limit: '50',
  });
  const r = await safeFetch(`${INSTAGRAM_GRAPH}/${encodeURIComponent(id)}/comments?${q.toString()}`, {
    headers: { Authorization: `Bearer ${credential.accessToken}` }, signal: AbortSignal.timeout(20_000),
  });
  const j = await body(r, 'instagram');
  if (!r.ok) {
    const code = num(((j.error ?? {}) as Record<string, unknown>).code);
    if (code === 190) return { ok: false, permanent: true, reason: 'Meta no longer accepts this connection; connect the Instagram account again' };
    return { ok: false, permanent: r.status < 500, reason: `Instagram answered HTTP ${r.status}` };
  }
  const bad = unreadable(j, 'Instagram'); if (bad) return bad;
  const base = externalRef.replace(/#.*$/, '');
  const toReply = (c: Record<string, unknown>, parentId: string | null): Reply => ({
    id: s(c.id),
    author: s(c.username) || 'someone',
    authorHandle: s(c.username) ? `@${s(c.username)}` : null,
    text: s(c.text),
    createdAt: s(c.timestamp) || null,
    url: base || null,
    parentId,
    likes: num(c.like_count),
  });
  const out: Reply[] = [];
  for (const c of (Array.isArray(j.data) ? j.data : []) as Array<Record<string, unknown>>) {
    out.push(toReply(c, null));
    const rep = ((c.replies ?? {}) as Record<string, unknown>).data;
    for (const x of (Array.isArray(rep) ? rep : []) as Array<Record<string, unknown>>) out.push(toReply(x, s(c.id)));
  }
  const more = Boolean(((j.paging ?? {}) as Record<string, unknown>).next);
  return finish(out, limit, more ? 'Instagram has more comments than one page; the newest are here' : undefined);
};

// ── Reddit ───────────────────────────────────────────────────────────────────────────────────

const redditReplies: Reader = async ({ credential, externalRef, limit }) => {
  const id = redditPostIdOf(externalRef);
  if (!id) return { ok: false, permanent: true, reason: 'no Reddit post id in the stored reference' };
  const r = await safeFetch(`https://oauth.reddit.com/comments/${encodeURIComponent(id)}?sort=new&limit=200&depth=8&raw_json=1`, {
    headers: { Authorization: `Bearer ${credential.accessToken}`, 'User-Agent': REDDIT_USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (r.status === 404) return { ok: false, permanent: true, reason: 'that post is gone' };
  if (r.status === 429) return { ok: false, permanent: false, reason: 'Reddit is rate limiting this app; try later' };
  if (!r.ok) return { ok: false, permanent: r.status === 401 || r.status === 403, reason: `Reddit answered HTTP ${r.status}` };
  let listing: unknown;
  try {
    listing = await readJson(r, ANSWER_MAX_BYTES);
  } catch (err) {
    logger.warn('connections: a Reddit comments answer was not JSON', { error: String(err) });
    return { ok: false, permanent: false, reason: 'Reddit answered with something that is not a comment list' };
  }
  const out: Reply[] = [];
  const walk = (children: unknown): void => {
    for (const ch of (Array.isArray(children) ? children : []) as Array<Record<string, unknown>>) {
      if (ch.kind !== 't1') continue; // 'more' stubs are the rest of a long thread, not a comment
      const d = (ch.data ?? {}) as Record<string, unknown>;
      const parent = s(d.parent_id);
      out.push({
        id: s(d.name) || s(d.id),
        author: s(d.author) || '[deleted]',
        authorHandle: s(d.author) ? `u/${s(d.author)}` : null,
        text: s(d.body),
        createdAt: typeof d.created_utc === 'number' ? new Date(d.created_utc * 1000).toISOString() : null,
        url: s(d.permalink) ? `https://www.reddit.com${s(d.permalink)}` : null,
        parentId: parent.startsWith('t1_') ? parent : null,
        likes: num(d.score),
      });
      const rep = d.replies as { data?: { children?: unknown } } | '' | undefined;
      if (rep && typeof rep === 'object') walk(rep.data?.children);
    }
  };
  const second = Array.isArray(listing) ? listing[1] as { data?: { children?: unknown } } | undefined : undefined;
  walk(second?.data?.children);
  out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return finish(out, limit);
};

// ── LinkedIn and the test provider ───────────────────────────────────────────────────────────

const linkedinReplies: Reader = async () => ({
  ok: false, permanent: true,
  reason: 'LinkedIn does not let an app read the comments on a member\'s post; that needs a permission LinkedIn grants to select partners only',
});

/** The stand-in provider, so the route and the shape have a test against a real HTTP round. */
const fakeReplies: Reader = async ({ provider, credential, externalRef, limit }) => {
  const base = provider.endpoints(null)?.token.replace(/\/token$/, '') ?? '';
  if (!base) return { ok: false, permanent: true, reason: 'the test provider has no base url' };
  const id = externalRef.split('/').pop() ?? '';
  const r = await safeFetch(`${base}/replies/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${credential.accessToken}` }, signal: AbortSignal.timeout(10_000),
  });
  if (r.status === 404) return { ok: false, permanent: true, reason: 'that item is gone' };
  if (!r.ok) return { ok: false, permanent: r.status === 401, reason: `test provider answered HTTP ${r.status}` };
  const j = await body(r, 'fake');
  const bad = unreadable(j, 'The test provider'); if (bad) return bad;
  const out = ((Array.isArray(j.replies) ? j.replies : []) as Array<Record<string, unknown>>).map((x): Reply => ({
    id: s(x.id), author: s(x.author), authorHandle: s(x.handle) || null, text: s(x.text),
    createdAt: s(x.createdAt) || null, url: s(x.url) || null, parentId: s(x.parentId) || null, likes: num(x.likes),
  }));
  return finish(out, limit);
};

const READERS: Record<string, Reader> = {
  mastodon: mastodonReplies,
  bluesky: blueskyReplies,
  youtube: youtubeReplies,
  x: xReplies,
  facebook: facebookReplies,
  instagram: instagramReplies,
  reddit: redditReplies,
  linkedin: linkedinReplies,
  fake: fakeReplies,
};

/** Exposed so a test asks which providers have a reader instead of keeping its own list. */
export const REPLY_READERS_FOR_TEST: Readonly<Record<string, Reader>> = READERS;

/** Read the replies to one published item. A provider with no reader is a permanent refusal. */
export async function readReplies(input: RepliesInput): Promise<RepliesOutcome> {
  if (!input.externalRef) {
    return { ok: false, permanent: true, reason: 'nothing was published, so nobody could answer it' };
  }
  const reader = READERS[input.provider.id];
  if (!reader) return { ok: false, permanent: true, reason: `no way to read replies from ${input.provider.id} yet` };
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 100), 200));
  try {
    return await reader({ ...input, limit });
  } catch (err) {
    // A transport failure, never a content answer: the same item may answer in a minute.
    return { ok: false, permanent: false, reason: `could not reach ${input.provider.label}: ${(err as Error).message}` };
  }
}
