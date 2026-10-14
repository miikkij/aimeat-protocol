/**
 * @file publish-social.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish recipes for a Facebook Page, an Instagram professional account and
 *   Reddit (2026-10-15). Same interface as publish.ts, which registers them; a separate file because
 *   that one sits near the max-file-lines boundary.
 *
 *   THE REFERENCE EACH ONE STORES. A recipe stores a link a person can open, and the metric and
 *   replies readers recover the provider's own id from it (metrics.ts, replies.ts). Instagram's
 *   permalink carries a shortcode, not the media id the API takes, so its reference keeps the id in
 *   the fragment: `https://www.instagram.com/p/<code>/#media=<id>`. The link still opens the post.
 *
 *   PERMANENT AND TEMPORARY, AS EVERYWHERE. Meta answers most refusals with 400 and an error object;
 *   `is_transient: true` and the rate-limit codes are the temporary ones, an invalid token (190) and
 *   everything else about the content are final.
 * @structure facebookPublish · instagramPublish · redditPublish · SOCIAL_RECIPES · igMediaIdOf
 * @usage import { SOCIAL_RECIPES } from './publish-social.js';
 * @version-history
 *   v1.0.0 — 2026-10-15 — Facebook Page text, photo and video; Instagram picture and Reel; Reddit
 *     text and link posts to a named subreddit.
 */

import { safeFetch } from '../../utils/url-validator.js';
import { readJson } from '../../utils/read-capped.js';
import { logger } from '../../utils/logger.js';
import type { PublishOutcome, PublishRecipe } from './publish-types.js';
import { FACEBOOK_GRAPH, FACEBOOK_GRAPH_VIDEO, INSTAGRAM_GRAPH, REDDIT_USER_AGENT } from './providers-social.js';
import { handOff } from './media-handoff.js';

/** A provider's answer here is a few kilobytes; a reply list is the largest, well under this (C6). */
const ANSWER_MAX_BYTES = 4 * 1024 * 1024;

const str = (params: Record<string, unknown>, key: string, fallback = ''): string => {
  const v = params[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
};

/** Meta's refusal, read once: the outcome and the sentence to show. */
async function metaRefusal(res: Response, what: string): Promise<PublishOutcome> {
  let body: { error?: { message?: unknown; code?: unknown; is_transient?: unknown } } = {};
  try {
    body = await readJson(res, ANSWER_MAX_BYTES) as typeof body;
  } catch (err) {
    // The status alone still decides permanent or temporary below; only Meta's sentence is lost.
    logger.warn('connections: a Meta refusal carried no readable body', { status: res.status, error: String(err) });
  }
  const e = body.error ?? {};
  const msg = typeof e.message === 'string' ? e.message.slice(0, 300) : '';
  const code = typeof e.code === 'number' ? e.code : 0;
  // 4, 17, 32 and 613 are the rate limits; 1 and 2 are Meta's own "try again". 190 is a token Meta
  // no longer accepts, which only reconnecting fixes.
  const transient = e.is_transient === true || [1, 2, 4, 17, 32, 613].includes(code) || res.status >= 500;
  if (code === 190) {
    return { ok: false, permanent: true, reason: `${what}: Meta no longer accepts this connection; connect the account again` };
  }
  return { ok: false, permanent: !transient, reason: `${what} (HTTP ${res.status}${code ? `, code ${code}` : ''})${msg ? `: ${msg}` : ''}` };
}

/**
 * A Facebook Page: text (with an optional link), a photo, or a video.
 *
 * The page token goes in the Authorization header rather than the query, so it never lands in a
 * log line that records an address.
 */
const facebookPublish: PublishRecipe = async ({ connection, credential, caption, params, file }) => {
  const pageId = credential.extra?.pageId || connection.externalId;
  if (!pageId) return { ok: false, permanent: true, reason: 'this Facebook connection names no page' };
  const auth = { Authorization: `Bearer ${credential.accessToken}` };
  const link = str(params, 'link');

  try {
    if (!file) {
      if (!caption.trim() && !link) return { ok: false, permanent: true, reason: 'Facebook will not take an empty post' };
      const body = new URLSearchParams({ message: caption });
      if (link) body.set('link', link);
      const res = await safeFetch(`${FACEBOOK_GRAPH}/${encodeURIComponent(pageId)}/feed`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(), signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return metaRefusal(res, 'Facebook refused the post');
      const j = await readJson(res, ANSWER_MAX_BYTES) as { id?: unknown };
      const id = typeof j.id === 'string' ? j.id : '';
      return { ok: true, externalRef: id ? `https://www.facebook.com/${id}` : '' };
    }

    const form = new FormData();
    form.append('source', new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.name);
    if (file.mimeType.startsWith('image/')) {
      // `caption`: Meta deprecated `message` on this edge.
      form.append('caption', caption);
      const res = await safeFetch(`${FACEBOOK_GRAPH}/${encodeURIComponent(pageId)}/photos`, {
        method: 'POST', headers: auth, body: form, signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) return metaRefusal(res, 'Facebook refused the photo');
      const j = await readJson(res, ANSWER_MAX_BYTES) as { id?: unknown; post_id?: unknown };
      const id = typeof j.post_id === 'string' ? j.post_id : typeof j.id === 'string' ? j.id : '';
      return { ok: true, externalRef: id ? `https://www.facebook.com/${id}` : '' };
    }
    if (file.mimeType.startsWith('video/')) {
      form.append('description', caption);
      const title = str(params, 'title');
      if (title) form.append('title', title.slice(0, 255));
      // Videos go to the graph-video host: the ordinary one refuses a large upload part way.
      const res = await safeFetch(`${FACEBOOK_GRAPH_VIDEO}/${encodeURIComponent(pageId)}/videos`, {
        method: 'POST', headers: auth, body: form, signal: AbortSignal.timeout(600_000),
      });
      if (!res.ok) return metaRefusal(res, 'Facebook refused the video');
      const j = await readJson(res, ANSWER_MAX_BYTES) as { id?: unknown };
      const id = typeof j.id === 'string' ? j.id : '';
      return { ok: true, externalRef: id ? `https://www.facebook.com/${pageId}/videos/${id}` : '' };
    }
    return { ok: false, permanent: true, reason: `Facebook takes a picture or a video here; ${file.mimeType} is neither` };
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach Facebook: ${(err as Error).message}` };
  }
};

/** The media id an Instagram reference carries in its fragment, or '' when it carries none. */
export function igMediaIdOf(externalRef: string): string {
  return /#media=(\d+)$/.exec(externalRef)?.[1] ?? '';
}

/** How long a container may take to be ready before the publish gives up and says so. */
const IG_CONTAINER_WAIT_MS = 5 * 60 * 1000;

/**
 * Instagram: a picture, or a video as a Reel.
 *
 * Three calls and a wait: make a container from a public address, wait until Instagram says it is
 * FINISHED, publish it. Publishing a container that is still IN_PROGRESS is refused with an error
 * that does not say "wait", which is why the wait is here rather than a retry.
 */
const instagramPublish: PublishRecipe = async ({ connection, credential, caption, params, file, publicBase }) => {
  const igUserId = credential.extra?.igUserId || connection.externalId;
  if (!igUserId) return { ok: false, permanent: true, reason: 'this Instagram connection names no account' };
  if (!file) {
    return { ok: false, permanent: true, reason: 'Instagram publishes a picture or a video; text alone is not a post there' };
  }
  // JPEG only: Instagram's container refuses any other picture format, after the fetch, with an
  // error that names the format only sometimes. Refused here with the fix in the sentence.
  const isImage = file.mimeType === 'image/jpeg';
  const isVideo = file.mimeType.startsWith('video/');
  if (!isImage && !isVideo) {
    return {
      ok: false, permanent: true,
      reason: file.mimeType.startsWith('image/')
        ? `Instagram takes a picture as JPEG only; save this ${file.mimeType} as JPEG and attach it again`
        : `Instagram takes a JPEG picture or a video; ${file.mimeType} is neither`,
    };
  }
  if (caption.length > 2200) {
    return { ok: false, permanent: true, reason: `Instagram allows 2,200 characters in a caption; this one has ${caption.length}` };
  }
  if (!publicBase) return { ok: false, permanent: true, reason: 'this node has no public address for Instagram to fetch the file from' };

  const held = handOff(file, publicBase);
  if ('error' in held) return { ok: false, permanent: false, reason: held.error };
  const headers = { Authorization: `Bearer ${credential.accessToken}`, 'Content-Type': 'application/json' };
  try {
    const alt = str(params, 'alt');
    const container: Record<string, unknown> = isImage
      ? { image_url: held.url, caption, ...(alt ? { alt_text: alt.slice(0, 1000) } : {}) }
      : { media_type: 'REELS', video_url: held.url, caption, share_to_feed: true };
    const made = await safeFetch(`${INSTAGRAM_GRAPH}/${encodeURIComponent(igUserId)}/media`, {
      method: 'POST', headers, body: JSON.stringify(container), signal: AbortSignal.timeout(120_000),
    });
    if (!made.ok) return metaRefusal(made, 'Instagram would not take the file');
    const mj = await readJson(made, ANSWER_MAX_BYTES) as { id?: unknown };
    const containerId = typeof mj.id === 'string' ? mj.id : '';
    if (!containerId) return { ok: false, permanent: false, reason: 'Instagram made no container for the file' };

    const deadline = Date.now() + IG_CONTAINER_WAIT_MS;
    for (;;) {
      const poll = await safeFetch(`${INSTAGRAM_GRAPH}/${encodeURIComponent(containerId)}?fields=status_code,status`, {
        headers, signal: AbortSignal.timeout(30_000),
      });
      if (!poll.ok) return metaRefusal(poll, 'Instagram would not say whether the file is ready');
      const pj = await readJson(poll, ANSWER_MAX_BYTES) as { status_code?: unknown; status?: unknown };
      const code = typeof pj.status_code === 'string' ? pj.status_code : '';
      if (code === 'FINISHED' || code === 'PUBLISHED') break;
      if (code === 'ERROR' || code === 'EXPIRED') {
        return { ok: false, permanent: true, reason: `Instagram could not use the file: ${typeof pj.status === 'string' ? pj.status : code}` };
      }
      if (Date.now() > deadline) {
        return { ok: false, permanent: false, reason: 'Instagram was still processing the file after five minutes' };
      }
      await new Promise((r) => setTimeout(r, isImage ? 1500 : 4000));
    }

    const pub = await safeFetch(`${INSTAGRAM_GRAPH}/${encodeURIComponent(igUserId)}/media_publish`, {
      method: 'POST', headers, body: JSON.stringify({ creation_id: containerId }), signal: AbortSignal.timeout(60_000),
    });
    if (!pub.ok) return metaRefusal(pub, 'Instagram would not publish the post');
    const pubj = await readJson(pub, ANSWER_MAX_BYTES) as { id?: unknown };
    const mediaId = typeof pubj.id === 'string' ? pubj.id : '';
    if (!mediaId) {
      // It went out; losing the reference is a loss, calling it a failure would invite a duplicate.
      logger.warn('connections: Instagram published but named no media id', { connectionId: connection.id });
      return { ok: true, externalRef: '' };
    }
    let permalink = '';
    try {
      const pl = await safeFetch(`${INSTAGRAM_GRAPH}/${encodeURIComponent(mediaId)}?fields=permalink`, {
        headers, signal: AbortSignal.timeout(20_000),
      });
      if (pl.ok) {
        const plj = await readJson(pl, ANSWER_MAX_BYTES) as { permalink?: unknown };
        permalink = typeof plj.permalink === 'string' ? plj.permalink : '';
      }
    } catch (err) {
      logger.warn('connections: Instagram published; the permalink could not be read', { error: String(err) });
    }
    const base = permalink || `https://www.instagram.com/${connection.accountLabel.replace(/^@/, '')}/`;
    return { ok: true, externalRef: `${base.replace(/#.*$/, '')}#media=${mediaId}` };
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach Instagram: ${(err as Error).message}` };
  } finally {
    held.release();
  }
};

/**
 * Reddit: a text post, or a link post when `params.url` is given, to the subreddit named in
 * `params.subreddit`. The title is `params.title`, or the first line of the caption.
 */
const redditPublish: PublishRecipe = async ({ credential, caption, params, file }) => {
  if (file) {
    return { ok: false, permanent: true, reason: 'Reddit posts text or a link through this connection; an attached file is not sent' };
  }
  const sr = str(params, 'subreddit').replace(/^\/?r\//i, '').trim();
  if (!/^[A-Za-z0-9_]{2,21}$/.test(sr)) {
    return { ok: false, permanent: true, reason: 'Reddit needs the subreddit to post to (params.subreddit, for example "aimeat")' };
  }
  const url = str(params, 'url');
  const title = (str(params, 'title') || caption.split('\n')[0] || '').trim().slice(0, 300);
  if (!title) return { ok: false, permanent: true, reason: 'a Reddit post needs a title' };
  const form = new URLSearchParams({
    api_type: 'json', sr, title, kind: url ? 'link' : 'self', resubmit: 'true', sendreplies: 'true',
  });
  if (url) form.set('url', url);
  else form.set('text', caption);

  try {
    const res = await safeFetch('https://oauth.reddit.com/api/submit', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential.accessToken}`, 'User-Agent': REDDIT_USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(), signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401) return { ok: false, permanent: true, reason: 'Reddit no longer accepts this token; connect the account again' };
    if (res.status === 403) return { ok: false, permanent: true, reason: `Reddit refused: this account may not post in r/${sr}` };
    if (res.status === 429) return { ok: false, permanent: false, reason: 'Reddit is rate limiting this app; the same post can be tried later' };
    if (!res.ok) return { ok: false, permanent: res.status < 500, reason: `Reddit refused the post (HTTP ${res.status})` };
    const j = await readJson(res, ANSWER_MAX_BYTES) as { json?: { errors?: unknown[]; data?: { url?: unknown; id?: unknown } } };
    const errors = Array.isArray(j.json?.errors) ? j.json!.errors : [];
    if (errors.length) {
      const said = errors.map((e) => (Array.isArray(e) ? e.slice(0, 2).join(': ') : String(e))).join('; ');
      // RATELIMIT is Reddit's "you are posting too fast", the one refusal here that waiting fixes.
      const temporary = errors.some((e) => Array.isArray(e) && e[0] === 'RATELIMIT');
      return { ok: false, permanent: !temporary, reason: `Reddit refused the post: ${said.slice(0, 300)}` };
    }
    const link = typeof j.json?.data?.url === 'string' ? j.json.data.url : '';
    const id = typeof j.json?.data?.id === 'string' ? j.json.data.id : '';
    return { ok: true, externalRef: link || (id ? `https://www.reddit.com/r/${sr}/comments/${id}/` : '') };
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach Reddit: ${(err as Error).message}` };
  }
};

export const SOCIAL_RECIPES: Readonly<Record<string, PublishRecipe>> = {
  facebook: facebookPublish,
  instagram: instagramPublish,
  reddit: redditPublish,
};
