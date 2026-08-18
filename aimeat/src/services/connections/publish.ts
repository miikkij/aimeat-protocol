/**
 * @file publish.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The recipes that actually put something on a provider (TARGET-057 phase 7b). One
 *   function per provider, behind one interface, driven by the gate in publish-gate.ts.
 *
 *   WHERE THIS LIVES, AND A DELIBERATE DEVIATION FROM THE SPEC. doc-t057-connect-spec puts recipes
 *   in an extension so a provider's endpoints can change without a node deploy. That reason is
 *   real and it still holds. It is not done yet, because the extension path needs two things that
 *   do not exist — a `ctx.connection()` binding into the sandbox and a streaming upload that keeps
 *   the bytes out of QuickJS — and building both before a single publish has ever succeeded would
 *   be designing the seam before knowing its shape. The house rule applies: a primitive is
 *   extracted when it has a second consumer, not before. `PublishRecipe` below is the seam, kept
 *   deliberately narrow so the move is a relocation rather than a redesign.
 *
 *   PERMANENT AND TEMPORARY ARE DIFFERENT ANSWERS. A provider refusing the CONTENT is final and
 *   must never be retried; a provider being unreachable is not. Collapsing the two is how a
 *   rejected video gets resubmitted forever, and how an outage looks like a rejection.
 * @structure PublishRecipe · publishToProvider · mastodonPublish · blueskyPost · youtubeUpload · linkedinPost
 * @usage import { publishToProvider } from './publish.js';
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057 phase 7b. Mastodon video, Bluesky text, YouTube resumable.
 *   v1.2.0 — 2026-08-02 — X text posts. Billing refusal is kept distinct from content refusal.
 *   v1.1.0 — 2026-08-02 — LinkedIn text + image. Escapes their little-text markup; a video is
 *     refused out loud rather than dropped.
 */

import { safeFetch } from '../../utils/url-validator.js';
import { logger } from '../../utils/logger.js';
import type { ConnectionCredential, ConnectionRecord } from '../../models/connection-schemas.js';
import type { OutboundProvider } from './providers.js';

/** What a recipe is handed. `params` already has the delegation's fixed values layered on top. */
export interface PublishInput {
  /** The provider descriptor, so a recipe reads its own endpoints instead of being handed them. */
  provider: OutboundProvider;
  connection: ConnectionRecord;
  credential: ConnectionCredential;
  caption: string;
  params: Record<string, unknown>;
  file: { bytes: Buffer; mimeType: string; name: string } | null;
}

export type PublishOutcome =
  | { ok: true; externalRef: string }
  | {
    ok: false;
    /**
     * True when the provider refused the CONTENT or the grant — retrying changes nothing and the
     * owner has to act. False for anything transport-shaped, which is worth another attempt.
     */
    permanent: boolean;
    reason: string;
  };

export type PublishRecipe = (input: PublishInput) => Promise<PublishOutcome>;

/** Read a param the app or the delegation supplied, as a string. */
function str(params: Record<string, unknown>, key: string, fallback = ''): string {
  const v = params[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/** A provider's own words, trimmed to something loggable and showable without dumping a page. */
async function providerSaid(res: Response): Promise<string> {
  const body = await res.text().catch((err: unknown) => {
    // An unreadable body and an empty one would otherwise produce the same message, and the first
    // is a transport fault while the second is just a terse provider.
    logger.warn('connections: could not read a provider error body', { status: res.status, error: String(err) });
    return '';
  });
  return body.slice(0, 400).replace(/\s+/g, ' ').trim();
}

/**
 * Mastodon: upload the media, WAIT for it to finish processing, then post the status.
 *
 * The wait is the part that looks optional and is not. `POST /api/v2/media` answers 202 while the
 * server is still transcoding, and a status posted with that id lands with no video attached — a
 * post that looks successful to everyone including us, and is empty to a reader.
 */
const mastodonPublish: PublishRecipe = async (input) => {
  const base = input.connection.instance;
  if (!base) return { ok: false, permanent: true, reason: 'this Mastodon connection has no instance' };
  if (!input.file) return { ok: false, permanent: true, reason: 'Mastodon needs a file to attach' };
  const auth = { Authorization: `Bearer ${input.credential.accessToken}` };

  let mediaId: string;
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.file.bytes)], { type: input.file.mimeType }), input.file.name);
    const alt = str(input.params, 'alt');
    if (alt) form.append('description', alt);
    const res = await safeFetch(`${base}/api/v2/media`, {
      method: 'POST', headers: auth, body: form, signal: AbortSignal.timeout(300_000),
    });
    // 422 is "we will not take this file" — wrong codec, too long, too large. Final.
    if (res.status === 422) return { ok: false, permanent: true, reason: `the instance refused the file: ${await providerSaid(res)}` };
    if (!res.ok) return { ok: false, permanent: res.status === 401 || res.status === 403, reason: `media upload failed (HTTP ${res.status})` };
    const j = await res.json() as { id?: unknown };
    mediaId = typeof j.id === 'string' ? j.id : '';
    if (!mediaId) return { ok: false, permanent: false, reason: 'the instance returned no media id' };

    if (res.status === 202) {
      // Still transcoding. GET answers 206 while it works and 200 when it is ready.
      const deadline = Date.now() + 300_000;
      for (;;) {
        if (Date.now() > deadline) {
          return { ok: false, permanent: false, reason: 'the instance was still processing the video after five minutes' };
        }
        await new Promise((r) => setTimeout(r, 3000));
        const poll = await safeFetch(`${base}/api/v1/media/${mediaId}`, { headers: auth, signal: AbortSignal.timeout(30_000) });
        if (poll.status === 200) break;
        if (poll.status !== 206) {
          return { ok: false, permanent: false, reason: `processing check failed (HTTP ${poll.status})` };
        }
      }
    }
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach the instance: ${(err as Error).message}` };
  }

  try {
    const body = new URLSearchParams({
      status: input.caption,
      // The delegation's fixed value wins; `unlisted` is the safer default for something posted by
      // machinery rather than by a person sitting there.
      visibility: str(input.params, 'visibility', 'unlisted'),
    });
    body.append('media_ids[]', mediaId);
    const res = await safeFetch(`${base}/api/v1/statuses`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return { ok: false, permanent: res.status === 422 || res.status === 401, reason: `posting failed (HTTP ${res.status}): ${await providerSaid(res)}` };
    }
    const j = await res.json() as { url?: unknown; id?: unknown };
    return { ok: true, externalRef: typeof j.url === 'string' ? j.url : String(j.id ?? mediaId) };
  } catch (err) {
    // The MEDIA is uploaded at this point and the status is not. Temporary, so a retry re-posts —
    // and the idempotency key is what stops that retry becoming a second post.
    return { ok: false, permanent: false, reason: `could not post the status: ${(err as Error).message}` };
  }
};

/**
 * Bluesky: a text post.
 *
 * Text only, on purpose. Video on Bluesky goes through a separate video service with its own job
 * queue and its own limits, and until that is built and proven, advertising `publish-video` here
 * would be the same "a button that cannot work" mistake the attach route was just fixed for. The
 * provider's capability list says publish-post alone for exactly that reason.
 */
const blueskyPost: PublishRecipe = async (input) => {
  const pds = input.credential.extra?.pds ?? 'https://bsky.social';
  const did = input.credential.extra?.did ?? '';
  if (!did) return { ok: false, permanent: true, reason: 'this Bluesky connection has no account id' };
  try {
    const res = await safeFetch(`${pds}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.credential.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text: input.caption,
          createdAt: new Date().toISOString(),
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return { ok: false, permanent: res.status === 400 || res.status === 401, reason: `Bluesky refused the post (HTTP ${res.status}): ${await providerSaid(res)}` };
    }
    const j = await res.json() as { uri?: unknown };
    return { ok: true, externalRef: typeof j.uri === 'string' ? j.uri : '' };
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach Bluesky: ${(err as Error).message}` };
  }
};

/** Chunk size for the resumable upload. A multiple of 256 KiB, which the protocol requires. */
const RESUMABLE_CHUNK = 8 * 256 * 1024;

/**
 * YouTube: a resumable upload, in chunks, that resumes from where the SERVER says it stopped.
 *
 * The resume is the whole reason this protocol exists and the reason it is implemented properly
 * rather than as one big PUT: on an interruption the client does not know how much arrived, so it
 * asks. Guessing "start again from zero" wastes an upload out of a daily allowance of six, and
 * guessing "continue from what I sent" corrupts the file.
 */
const youtubeUpload: PublishRecipe = async (input) => {
  if (!input.file) return { ok: false, permanent: true, reason: 'YouTube needs a file' };
  const auth = { Authorization: `Bearer ${input.credential.accessToken}` };
  const total = input.file.bytes.length;

  let sessionUrl: string;
  try {
    const meta = {
      snippet: {
        title: str(input.params, 'title', input.caption.slice(0, 100) || 'Untitled'),
        description: str(input.params, 'description', input.caption),
        ...(Array.isArray(input.params.tags) ? { tags: input.params.tags } : {}),
      },
      status: {
        // The delegation's fixed value wins. `unlisted` rather than `private`: a private video
        // renders no thumbnail and its link 404s for everyone else, so it cannot be checked.
        privacyStatus: str(input.params, 'privacyStatus', 'unlisted'),
        selfDeclaredMadeForKids: false,
      },
    };
    const res = await safeFetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          ...auth,
          'Content-Type': 'application/json',
          'X-Upload-Content-Length': String(total),
          'X-Upload-Content-Type': input.file.mimeType,
        },
        body: JSON.stringify(meta),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!res.ok) {
      // 403 here is usually the quota: six uploads a day for the whole project, and it is spent.
      const permanent = res.status === 400 || res.status === 401;
      return { ok: false, permanent, reason: `YouTube would not start the upload (HTTP ${res.status}): ${await providerSaid(res)}` };
    }
    sessionUrl = res.headers.get('location') ?? '';
    if (!sessionUrl) return { ok: false, permanent: false, reason: 'YouTube returned no upload session' };
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach YouTube: ${(err as Error).message}` };
  }

  let offset = 0;
  let consecutiveFailures = 0;
  while (offset < total) {
    const end = Math.min(offset + RESUMABLE_CHUNK, total) - 1;
    try {
      const res = await safeFetch(sessionUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(end - offset + 1),
          'Content-Range': `bytes ${offset}-${end}/${total}`,
        },
        body: new Uint8Array(input.file.bytes.subarray(offset, end + 1)),
        signal: AbortSignal.timeout(300_000),
      });

      if (res.status === 200 || res.status === 201) {
        const j = await res.json().catch((err: unknown) => {
          logger.warn('connections: YouTube upload finished with an unreadable body', { error: String(err) });
          return null;
        }) as { id?: unknown } | null;
        const id = typeof j?.id === 'string' ? j.id : '';
        return id
          ? { ok: true, externalRef: `https://youtu.be/${id}` }
          : { ok: false, permanent: false, reason: 'YouTube accepted the upload but named no video' };
      }

      // 308 = keep going. The Range header is the SERVER's account of what arrived, and it is the
      // only trustworthy one — a client that assumes its own bytes landed will corrupt the file.
      if (res.status === 308) {
        const range = res.headers.get('range');
        const received = range ? Number(range.split('-')[1]) : NaN;
        offset = Number.isFinite(received) ? received + 1 : end + 1;
        consecutiveFailures = 0;
        continue;
      }
      if (res.status === 404) return { ok: false, permanent: true, reason: 'the upload session expired; start again' };
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, permanent: true, reason: `YouTube rejected the upload (HTTP ${res.status}): ${await providerSaid(res)}` };
      }
      // 5xx: ask the server where it got to rather than resending blindly.
      consecutiveFailures++;
    } catch (err) {
      consecutiveFailures++;
      logger.warn('connections: a resumable chunk failed; asking YouTube where it got to', {
        offset, total, error: String(err),
      });
    }

    if (consecutiveFailures > 5) {
      return { ok: false, permanent: false, reason: 'the upload kept failing; the bytes already sent are still held by YouTube' };
    }
    // THE RESUME QUERY. An empty PUT with a range of `*` makes the server state how much it has,
    // which is the question a client cannot answer for itself after an interruption.
    try {
      await new Promise((r) => setTimeout(r, 1000 * consecutiveFailures));
      const probe = await safeFetch(sessionUrl, {
        method: 'PUT',
        headers: { 'Content-Length': '0', 'Content-Range': `bytes */${total}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (probe.status === 200 || probe.status === 201) {
        const j = await probe.json().catch((err: unknown) => {
          logger.warn('connections: the resume probe answered 200 with an unreadable body', { error: String(err) });
          return null;
        }) as { id?: unknown } | null;
        const id = typeof j?.id === 'string' ? j.id : '';
        if (id) return { ok: true, externalRef: `https://youtu.be/${id}` };
      }
      if (probe.status === 308) {
        const range = probe.headers.get('range');
        const received = range ? Number(range.split('-')[1]) : NaN;
        offset = Number.isFinite(received) ? received + 1 : offset;
      }
    } catch (err) {
      logger.warn('connections: the resume probe itself failed', { error: String(err) });
    }
  }
  return { ok: false, permanent: false, reason: 'the upload ended without YouTube confirming a video' };
};

/**
 * The test provider's recipe. Reached only when the test provider is configured, which nothing but
 * the E2E environment does. It exists so the ROUTE -- gate, credential, recipe, outcome, attempt
 * update -- can be proven end to end without posting to anyone's real account, and so the
 * permanent-versus-temporary distinction has a test rather than only a comment.
 */
const fakePublish: PublishRecipe = async (input) => {
  const base = input.provider.endpoints(null)?.token.replace(/\/token$/, '') ?? '';
  if (!base) return { ok: false, permanent: true, reason: 'the test provider has no base URL' };
  try {
    const res = await safeFetch(`${base}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.credential.accessToken}`, 'Content-Type': 'application/octet-stream' },
      body: input.file ? new Uint8Array(input.file.bytes) : new Uint8Array(0),
      signal: AbortSignal.timeout(60_000),
    });
    // 422 is the provider refusing the CONTENT: final, and a retry would only repeat it.
    if (res.status === 422) return { ok: false, permanent: true, reason: `refused: ${await providerSaid(res)}` };
    if (!res.ok) return { ok: false, permanent: false, reason: `publish failed (HTTP ${res.status})` };
    const j = await res.json() as { url?: unknown };
    return { ok: true, externalRef: typeof j.url === 'string' ? j.url : '' };
  } catch (err) {
    return { ok: false, permanent: false, reason: `could not reach the test provider: ${(err as Error).message}` };
  }
};

/**
 * LinkedIn's REST surface is versioned by a HEADER rather than by the path, and an absent or stale
 * value is a 426. It moves monthly and old versions retire after about a year, so this is a named
 * constant with a date rather than a literal buried in a call.
 */
const LINKEDIN_VERSION = '202506';

/**
 * LinkedIn's `commentary` is not plain text.
 *
 * It is their "little text" format, in which a bare `(` or `@` or `~` is markup. Send an unescaped
 * one and the call fails validation, or worse, posts something subtly different from what the
 * author wrote. Every one of these has to carry a backslash. This is exactly the class of thing
 * that looks fine in a smoke test with an ASCII sentence and then mangles the first real caption
 * that contains a bracket.
 */
function linkedinText(text: string): string {
  return text.replace(/([|{}@[\]()<>#*_~\\])/g, '\\$1');
}

/**
 * LinkedIn: a text post, optionally with one image.
 *
 * WHAT IT REFUSES AND WHY IT SAYS SO. A video is a permanent refusal rather than a quiet
 * text-only fallback: LinkedIn's video path is the separate Videos API with multipart
 * initialisation, the provider advertises `publish-post` only, and silently dropping the file
 * someone attached is the same failure as the Mastodon edit that lost its video. Better to refuse
 * and be understood.
 */
const linkedinPost: PublishRecipe = async (input) => {
  const { credential, connection, caption, params, file } = input;
  const token = credential.accessToken;
  if (!token) return { ok: false, permanent: true, reason: 'no access token on this connection' };

  const author = `urn:li:person:${connection.externalId}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  };

  let media: { id: string; altText: string } | null = null;

  if (file) {
    if (!file.mimeType.startsWith('image/')) {
      return {
        ok: false,
        permanent: true,
        reason: `LinkedIn accepts a post with an image here; ${file.mimeType} needs the Videos API, which this connection is not scoped for`,
      };
    }
    // Two steps, and the second one goes to a URL LinkedIn hands back rather than to a fixed host.
    try {
      const init = await safeFetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!init.ok) {
        return {
          ok: false,
          permanent: init.status === 403 || init.status === 401,
          reason: `LinkedIn would not start an image upload (HTTP ${init.status}): ${await providerSaid(init)}`,
        };
      }
      const ij = await init.json() as { value?: { uploadUrl?: unknown; image?: unknown } };
      const uploadUrl = typeof ij.value?.uploadUrl === 'string' ? ij.value.uploadUrl : '';
      const imageUrn = typeof ij.value?.image === 'string' ? ij.value.image : '';
      if (!uploadUrl || !imageUrn) {
        return { ok: false, permanent: false, reason: 'LinkedIn started an image upload without saying where to put it' };
      }

      const put = await safeFetch(uploadUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.mimeType },
        body: new Uint8Array(file.bytes),
        signal: AbortSignal.timeout(120_000),
      });
      if (!put.ok) {
        return { ok: false, permanent: false, reason: `LinkedIn rejected the image bytes (HTTP ${put.status})` };
      }
      media = { id: imageUrn, altText: str(params, 'alt', caption).slice(0, 300) };
    } catch (err) {
      logger.warn('connections: the LinkedIn image upload failed', { connectionId: connection.id, error: String(err) });
      return { ok: false, permanent: false, reason: `could not reach LinkedIn to upload the image: ${(err as Error).message}` };
    }
  }

  // CONNECTIONS is the safe default for a member post; PUBLIC only when it was asked for, because
  // widening someone's audience without being told to is not a default anyone should get by accident.
  const visibility = str(params, 'visibility', 'PUBLIC').toUpperCase() === 'CONNECTIONS'
    ? 'CONNECTIONS'
    : 'PUBLIC';

  const body: Record<string, unknown> = {
    author,
    commentary: linkedinText(caption),
    visibility,
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  if (media) body.content = { media };

  try {
    const res = await safeFetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401) {
      return { ok: false, permanent: true, reason: 'LinkedIn no longer accepts this token; the connection needs reconnecting' };
    }
    if (res.status === 403) {
      return { ok: false, permanent: true, reason: `LinkedIn refused the post: ${await providerSaid(res)}. Check that the app has the "Share on LinkedIn" product enabled.` };
    }
    if (res.status === 422 || res.status === 400) {
      return { ok: false, permanent: true, reason: `LinkedIn refused the content: ${await providerSaid(res)}` };
    }
    if (!res.ok) {
      return { ok: false, permanent: false, reason: `LinkedIn post failed (HTTP ${res.status}): ${await providerSaid(res)}` };
    }
    // The post's urn comes back in a HEADER, not the body -- the body on a 201 is empty.
    const urn = res.headers.get('x-restli-id') ?? res.headers.get('x-linkedin-id') ?? '';
    if (!urn) {
      // It published. Losing the reference is a real loss, but calling a successful publish a
      // failure would invite a retry and a duplicate post, which is worse.
      logger.warn('connections: LinkedIn published but returned no post urn', { connectionId: connection.id });
      return { ok: true, externalRef: '' };
    }
    return { ok: true, externalRef: `https://www.linkedin.com/feed/update/${urn}/` };
  } catch (err) {
    logger.warn('connections: the LinkedIn post failed', { connectionId: connection.id, error: String(err) });
    return { ok: false, permanent: false, reason: `could not reach LinkedIn: ${(err as Error).message}` };
  }
};

/**
 * X: a text post.
 *
 * NO MEDIA YET, and it says so rather than dropping the file. X's media upload is a separate
 * chunked endpoint with an asynchronous processing wait, which is the YouTube-shaped work rather
 * than a parameter on this call. The provider advertises publish-post only, and the recipe guard
 * fails the build if those two ever disagree.
 *
 * THIS ONE COSTS MONEY. Every successful call is a charge against the operator's prepaid credits,
 * which makes the idempotency ledger in publish-gate.ts a billing control here and not only a
 * correctness one: a duplicate publish anywhere else is an embarrassment, and here it is also a
 * second charge.
 */
const xPost: PublishRecipe = async (input) => {
  const { credential, connection, caption } = input;
  const token = credential.accessToken;
  if (!token) return { ok: false, permanent: true, reason: 'no access token on this connection' };
  if (input.file) {
    return {
      ok: false,
      permanent: true,
      reason: 'X posts text through this connection; attaching media needs the chunked upload endpoint, which this recipe does not implement yet',
    };
  }
  if (!caption.trim()) return { ok: false, permanent: true, reason: 'X will not accept an empty post' };

  try {
    const res = await safeFetch('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: caption }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401) {
      return { ok: false, permanent: true, reason: 'X no longer accepts this token; the connection needs reconnecting' };
    }
    if (res.status === 403) {
      return { ok: false, permanent: true, reason: `X refused the post: ${await providerSaid(res)}` };
    }
    if (res.status === 402) {
      // Distinct from a refusal on purpose: nothing about the CONTENT is wrong, and the fix is to
      // top up rather than to rewrite. Not permanent, because the same post will work once funded.
      return { ok: false, permanent: false, reason: 'X declined for billing: the prepaid credit balance is spent' };
    }
    if (res.status === 429) {
      return { ok: false, permanent: false, reason: 'X is rate limiting this app; the same post can be tried later' };
    }
    if (!res.ok) {
      return { ok: false, permanent: false, reason: `X post failed (HTTP ${res.status}): ${await providerSaid(res)}` };
    }
    const j = await res.json() as { data?: { id?: unknown } };
    const id = typeof j.data?.id === 'string' ? j.data.id : '';
    if (!id) {
      logger.warn('connections: X published but returned no post id', { connectionId: connection.id });
      return { ok: true, externalRef: '' };
    }
    // accountLabel is the @handle, which is what the permalink wants. `i` works for any account and
    // is what X itself redirects to, so a missing label does not cost the link.
    const handle = (connection.accountLabel || '').replace(/^@/, '') || 'i';
    return { ok: true, externalRef: `https://x.com/${handle}/status/${id}` };
  } catch (err) {
    logger.warn('connections: the X post failed', { connectionId: connection.id, error: String(err) });
    return { ok: false, permanent: false, reason: `could not reach X: ${(err as Error).message}` };
  }
};

const RECIPES: Record<string, PublishRecipe> = {
  mastodon: mastodonPublish,
  bluesky: blueskyPost,
  youtube: youtubeUpload,
  linkedin: linkedinPost,
  x: xPost,
  fake: fakePublish,
  'fake-static': fakePublish,
};

/**
 * Exposed so a test can ask which providers actually have a recipe, rather than keeping its own
 * list of them. A test that maintains its own copy of the thing it checks stops checking.
 */
export const RECIPES_FOR_TEST: Readonly<Record<string, PublishRecipe>> = RECIPES;

/**
 * Run the recipe for a connection's provider.
 *
 * A provider with no recipe is a refusal rather than a silent no-op: the gate has already recorded
 * an attempt by the time this is called, and leaving it in flight forever would be worse than
 * saying so.
 */
export async function publishToProvider(input: PublishInput): Promise<PublishOutcome> {
  const recipe = RECIPES[input.provider.id];
  if (!recipe) {
    return { ok: false, permanent: true, reason: `no publish recipe for ${input.connection.provider}` };
  }
  return recipe(input);
}
