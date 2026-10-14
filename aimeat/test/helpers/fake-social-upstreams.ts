/**
 * @file test/helpers/fake-social-upstreams.ts
 * @description Answers, inside the test process, every outside service the LÄHETIN social desk work
 *   of 2026-10-15 talks to: Meta's Graph API for a Facebook Page and for Instagram, Reddit, X's
 *   articles and threads, and the replies endpoints of Mastodon, Bluesky, YouTube and X. It replaces
 *   `globalThis.fetch`, which is safeFetch's last step before the wire, so the real service code runs
 *   and no request leaves the machine. Requests to 127.0.0.1 go to the real fetch: the node under
 *   test is there, and Instagram's container step FETCHES the file from the node's own short-lived
 *   address exactly as Instagram would.
 *
 *   A host this router was not taught about THROWS. Answering 404 would look like the provider
 *   refusing, and a test would assert a refusal the code never produced.
 * @structure installSocialUpstreams() → { up, restore } · SocialUpstreams (knobs and records)
 * @usage const { up, restore } = installSocialUpstreams();
 * @version-history
 *   v1.0.0 — 2026-10-15 — Initial.
 */

type FetchInput = string | URL | Request;

export interface Recorded {
  method: string;
  url: string;
  host: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  form?: FormData;
}

export interface SocialUpstreams {
  calls: Recorded[];
  /** Pages /me/accounts answers. */
  pages: Array<{ id: string; name: string; access_token: string }>;
  /** Instagram's /me account type; 'PERSONAL' makes the connection refuse. */
  igAccountType: string;
  /** How many polls answer IN_PROGRESS before a container is FINISHED. */
  igPollsInProgress: number;
  /** The bytes Instagram fetched from the node's media address on the last container. */
  igFetched: { status: number; bytes: number; type: string } | null;
  igRefreshes: number;
  /** One Meta error to answer on the next Graph write: `{status, code}`. */
  metaError: { status: number; code: number; transient?: boolean } | null;
  /** Reddit's next submit errors (`[['RATELIMIT','...','ratelimit']]`). */
  redditErrors: unknown[] | null;
  /** X: fail the thread at this part number (1-based), with this status. */
  xFailAtPart: { part: number; status: number } | null;
  xTweets: Array<Record<string, unknown>>;
  xArticle: Record<string, unknown> | null;
  /** YouTube commentThreads answers 403 with this reason ('insufficientPermissions' | 'commentsDisabled'). */
  youtubeCommentsRefusal: string | null;
  mark(): number;
  since(mark: number): Recorded[];
  last(pred: (c: Recorded) => boolean): Recorded;
}

let seq = 0;
const nextId = (p: string): string => `${p}${Date.now()}${++seq}`;
const json = (v: unknown, status = 200): Response =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

function headerMap(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  new Headers(h).forEach((v, k) => { out[k.toLowerCase()] = v; });
  return out;
}
function bodyText(b: unknown): string {
  if (typeof b === 'string') return b;
  if (b instanceof URLSearchParams) return b.toString();
  return '';
}

export function installSocialUpstreams(): { up: SocialUpstreams; restore: () => void } {
  const original = globalThis.fetch;
  const up: SocialUpstreams = {
    calls: [],
    pages: [{ id: '1001', name: 'AIMEAT Test Page', access_token: 'page-token-1001' }],
    igAccountType: 'BUSINESS',
    igPollsInProgress: 1,
    igFetched: null,
    igRefreshes: 0,
    metaError: null,
    redditErrors: null,
    xFailAtPart: null,
    xTweets: [],
    xArticle: null,
    youtubeCommentsRefusal: null,
    mark() { return up.calls.length; },
    since(m) { return up.calls.slice(m); },
    last(pred) {
      for (let i = up.calls.length - 1; i >= 0; i--) if (pred(up.calls[i]!)) return up.calls[i]!;
      throw new Error('no upstream call matched');
    },
  };

  const metaFail = (): Response | null => {
    const e = up.metaError;
    if (!e) return null;
    up.metaError = null;
    return json({ error: { message: 'refused by the test', code: e.code, is_transient: e.transient ?? false } }, e.status);
  };

  async function route(url: URL, call: Recorded): Promise<Response | null> {
    const host = url.hostname;
    const path = url.pathname;
    const q = url.searchParams;

    // ── Facebook ──
    if (host === 'graph.facebook.com' || host === 'graph-video.facebook.com') {
      const p = path.replace(/^\/v\d+\.\d+/, '');
      if (p === '/oauth/access_token') {
        if (q.get('grant_type') === 'fb_exchange_token') return json({ access_token: 'fb-long-user', token_type: 'bearer', expires_in: 5184000 });
        return json({ access_token: 'fb-short-user', token_type: 'bearer', expires_in: 3600 });
      }
      if (p === '/me/accounts') return json({ data: up.pages.map((x) => ({ ...x, tasks: ['CREATE_CONTENT', 'MODERATE'] })) });
      const feed = /^\/(\d+)\/(feed|photos|videos)$/.exec(p);
      if (feed && call.method === 'POST') {
        const fail = metaFail(); if (fail) return fail;
        if (feed[2] === 'feed') return json({ id: `${feed[1]}_${nextId('')}` });
        if (feed[2] === 'photos') return json({ id: nextId('77'), post_id: `${feed[1]}_${nextId('')}` });
        return json({ id: nextId('88') });
      }
      const comments = /^\/([\d_]+)\/comments$/.exec(p);
      if (comments) {
        return json({ data: [
          { id: 'c1', message: 'Tämä näyttää hyvältä', from: { name: 'Maija', id: '9' }, created_time: '2026-10-15T08:00:00+0000', like_count: 3, permalink_url: 'https://www.facebook.com/c1' },
          { id: 'c2', message: 'Mitä tämä maksaa?', created_time: '2026-10-15T09:00:00+0000', like_count: 0, parent: { id: 'c1' } },
        ] });
      }
      const obj = /^\/([\d_]+)$/.exec(p);
      if (obj) return json({ id: obj[1], shares: { count: 2 }, reactions: { summary: { total_count: 14 } }, comments: { summary: { total_count: 5 } } });
      return null;
    }

    // ── Instagram ──
    if (host === 'api.instagram.com' && path === '/oauth/access_token') {
      // Wrapped in `data`, as Meta documents it; the node must read both shapes.
      return json({ data: [{ access_token: 'ig-short', user_id: '17840000001', permissions: 'instagram_business_basic,instagram_business_content_publish' }] });
    }
    if (host === 'graph.instagram.com') {
      if (path === '/access_token') return json({ access_token: 'ig-long', token_type: 'bearer', expires_in: 5184000 });
      if (path === '/refresh_access_token') {
        up.igRefreshes++;
        return json({ access_token: `ig-renewed-${up.igRefreshes}`, token_type: 'bearer', expires_in: 5184000 });
      }
      const p = path.replace(/^\/v\d+\.\d+/, '');
      if (p === '/me') return json({ id: 'app-scoped-1', user_id: '17840000001', username: 'aimeat_test', account_type: up.igAccountType });
      if (/^\/\d+\/media$/.test(p) && call.method === 'POST') {
        const fail = metaFail(); if (fail) return fail;
        const b = JSON.parse(call.body || '{}') as Record<string, unknown>;
        const mediaUrl = String(b.image_url ?? b.video_url ?? '');
        // Instagram FETCHES the file. So does this fake, from the node's own address.
        const got = await original(mediaUrl);
        const buf = Buffer.from(await got.arrayBuffer());
        up.igFetched = { status: got.status, bytes: buf.length, type: got.headers.get('content-type') ?? '' };
        if (got.status !== 200) return json({ error: { message: 'Media download has failed.', code: 9004 } }, 400);
        return json({ id: nextId('cont') });
      }
      const container = /^\/(cont\d+)$/.exec(p);
      if (container) {
        if (up.igPollsInProgress > 0) { up.igPollsInProgress--; return json({ status_code: 'IN_PROGRESS', id: container[1] }); }
        return json({ status_code: 'FINISHED', id: container[1] });
      }
      if (/^\/\d+\/media_publish$/.test(p)) return json({ id: '17900000000000001' });
      const media = /^\/(\d+)$/.exec(p);
      if (media && q.get('fields') === 'permalink') return json({ permalink: 'https://www.instagram.com/p/TESTCODE/' });
      if (media) return json({ id: media[1], like_count: 21, comments_count: 4 });
      if (/^\/\d+\/insights$/.test(p)) return json({ data: [{ name: 'shares', values: [{ value: 3 }] }, { name: 'saved', values: [{ value: 1 }] }] });
      if (/^\/\d+\/comments$/.test(p)) {
        return json({ data: [{
          id: 'ig1', text: 'Upea!', username: 'fan_one', timestamp: '2026-10-15T10:00:00+0000', like_count: 2,
          replies: { data: [{ id: 'ig2', text: 'Kiitos!', username: 'aimeat_test', timestamp: '2026-10-15T10:05:00+0000', like_count: 0 }] },
        }] });
      }
      return null;
    }

    // ── Reddit ──
    if (host === 'www.reddit.com') {
      if (path === '/api/v1/access_token') {
        return json({ access_token: nextId('rd-at'), refresh_token: nextId('rd-rt'), expires_in: 3600, scope: 'identity submit read', token_type: 'bearer' });
      }
      if (path === '/api/v1/revoke_token') return new Response(null, { status: 204 });
      return null;
    }
    if (host === 'oauth.reddit.com') {
      if (path === '/api/v1/me') return json({ id: 'rd1', name: 'aimeat_official' });
      if (path === '/api/submit') {
        if (up.redditErrors) { const e = up.redditErrors; up.redditErrors = null; return json({ json: { errors: e } }); }
        const sr = new URLSearchParams(call.body).get('sr');
        return json({ json: { errors: [], data: { id: 'abc123', name: 't3_abc123', url: `https://www.reddit.com/r/${sr}/comments/abc123/hello/` } } });
      }
      if (path === '/by_id/t3_abc123') return json({ data: { children: [{ kind: 't3', data: { id: 'abc123', score: 42, num_comments: 3, num_crossposts: 1, upvote_ratio: 0.97 } }] } });
      if (path === '/comments/abc123') {
        return json([
          { kind: 'Listing', data: { children: [{ kind: 't3', data: { id: 'abc123' } }] } },
          { kind: 'Listing', data: { children: [
            { kind: 't1', data: { id: 'k1', name: 't1_k1', author: 'curious', body: 'How is this different from mem0?', created_utc: 1792050000, permalink: '/r/aimeat/comments/abc123/hello/k1/', score: 5, parent_id: 't3_abc123',
              replies: { kind: 'Listing', data: { children: [
                { kind: 't1', data: { id: 'k2', name: 't1_k2', author: 'aimeat_official', body: 'Ownership and consent.', created_utc: 1792050600, permalink: '/r/aimeat/comments/abc123/hello/k2/', score: 2, parent_id: 't1_k1', replies: '' } },
              ] } } } },
            { kind: 'more', data: { count: 4, children: ['k3'] } },
          ] } },
        ]);
      }
      return null;
    }

    // ── X ──
    if (host === 'api.x.com') {
      if (path === '/2/oauth2/token') return json({ access_token: nextId('x-at'), refresh_token: nextId('x-rt'), expires_in: 7200, token_type: 'bearer' });
      if (path === '/2/users/me') return json({ data: { id: 'x-user-1', username: 'aimeat' } });
      if (path === '/2/tweets' && call.method === 'POST') {
        const b = JSON.parse(call.body || '{}') as Record<string, unknown>;
        up.xTweets.push(b);
        if (up.xFailAtPart && up.xTweets.length === up.xFailAtPart.part) {
          return json({ title: 'refused', detail: 'refused by the test' }, up.xFailAtPart.status);
        }
        return json({ data: { id: `19000000000000${String(up.xTweets.length).padStart(5, '0')}`, text: b.text } });
      }
      if (path === '/2/articles/draft') {
        up.xArticle = JSON.parse(call.body || '{}') as Record<string, unknown>;
        return json({ data: { id: 'art-1', title: up.xArticle.title } });
      }
      if (path === '/2/articles/art-1/publish') return json({ data: { post_id: '1999999999999999999' } });
      if (path === '/2/tweets/search/recent') {
        return json({
          data: [
            { id: '2001', text: '@aimeat interesting', author_id: 'u1', created_at: '2026-10-15T11:00:00Z', public_metrics: { like_count: 4 }, referenced_tweets: [{ type: 'replied_to', id: q.get('query')!.split(':')[1] }] },
            { id: '2002', text: 'agree', author_id: 'u2', created_at: '2026-10-15T11:05:00Z', public_metrics: { like_count: 0 }, referenced_tweets: [{ type: 'replied_to', id: '2001' }] },
          ],
          includes: { users: [{ id: 'u1', username: 'dev_one', name: 'Dev One' }, { id: 'u2', username: 'dev_two', name: 'Dev Two' }] },
        });
      }
      return null;
    }

    // ── Mastodon, Bluesky, YouTube, LinkedIn: what this suite needs of them ──
    if (host === 'mastodon.social') {
      if (path === '/api/v1/apps') return json({ id: '1', client_id: 'mastodon-client', client_secret: 'mastodon-secret' });
      if (path === '/oauth/token') return json({ access_token: nextId('m-at'), token_type: 'Bearer', scope: 'read:accounts read:statuses write:statuses write:media' });
      if (path === '/api/v1/accounts/verify_credentials') return json({ id: '110001', acct: 'aimeat' });
      if (path === '/api/v1/statuses' && call.method === 'POST') return json({ id: '1130001', url: 'https://mastodon.social/@aimeat/1130001' });
      if (/^\/api\/v1\/statuses\/\d+\/context$/.test(path)) {
        return json({ ancestors: [], descendants: [
          { id: '1130002', in_reply_to_id: '1130001', content: '<p>Hyvä &amp; <a href="x">selkeä</a></p>', created_at: '2026-10-15T07:00:00Z', url: 'https://mastodon.social/@reader/1130002', favourites_count: 1, account: { acct: 'reader@example.social', display_name: 'Reader' } },
          { id: '1130003', in_reply_to_id: '1130002', content: '<p>Samaa mieltä</p>', created_at: '2026-10-15T07:30:00Z', url: 'https://mastodon.social/@other/1130003', favourites_count: 0, account: { acct: 'other', display_name: '' } },
        ] });
      }
      return null;
    }
    if (host === 'bsky.social') {
      if (path === '/xrpc/com.atproto.server.createSession') {
        return json({ accessJwt: nextId('b-at'), refreshJwt: nextId('b-rt'), did: 'did:plc:aimeat', handle: 'aimeat.bsky.social' });
      }
      if (path === '/xrpc/com.atproto.repo.createRecord') return json({ uri: 'at://did:plc:aimeat/app.bsky.feed.post/3kpost', cid: 'c' });
      if (path === '/xrpc/app.bsky.feed.getPostThread') {
        return json({ thread: { post: { uri: q.get('uri'), likeCount: 1, replyCount: 2 }, replies: [
          { post: { uri: 'at://did:plc:r1/app.bsky.feed.post/r1', author: { handle: 'r1.bsky.social', displayName: 'R One' }, record: { text: 'nice', createdAt: '2026-10-15T06:00:00Z' }, likeCount: 2 },
            replies: [{ post: { uri: 'at://did:plc:r2/app.bsky.feed.post/r2', author: { handle: 'r2.bsky.social' }, record: { text: 'yes', createdAt: '2026-10-15T06:10:00Z' } }, replies: [] }] },
          { $type: 'app.bsky.feed.defs#blockedPost', uri: 'at://blocked' },
        ] } });
      }
      return null;
    }
    if (host === 'oauth2.googleapis.com' && path === '/token') {
      return json({ access_token: nextId('g-at'), refresh_token: nextId('g-rt'), expires_in: 3600, token_type: 'Bearer' });
    }
    if (host === 'www.googleapis.com') {
      if (path === '/youtube/v3/channels') return json({ items: [{ id: 'UCaimeat', snippet: { title: 'AIMEAT' } }] });
      if (path === '/youtube/v3/commentThreads') {
        if (up.youtubeCommentsRefusal) {
          const why = up.youtubeCommentsRefusal; up.youtubeCommentsRefusal = null;
          return json({ error: { code: 403, errors: [{ reason: why }] } }, 403);
        }
        return json({ items: [{
          id: 'th1',
          snippet: { topLevelComment: { id: 'yc1', snippet: { authorDisplayName: '@viewer', textOriginal: 'Great demo', publishedAt: '2026-10-15T05:00:00Z', likeCount: 7 } } },
          replies: { comments: [{ id: 'yc2', snippet: { authorDisplayName: 'AIMEAT', textOriginal: 'Thanks!', publishedAt: '2026-10-15T05:30:00Z', likeCount: 1 } }] },
        }] });
      }
      return null;
    }
    if (host === 'www.linkedin.com' && path === '/oauth/v2/accessToken') {
      return json({ access_token: nextId('li-at'), expires_in: 5184000 });
    }
    if (host === 'api.linkedin.com') {
      if (path === '/v2/userinfo') return json({ sub: 'li-1', name: 'A Member' });
      if (path === '/rest/posts') return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:9' } });
      return null;
    }
    return null;
  }

  const fake = async (input: FetchInput, init: RequestInit = {}): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1') return original(input, init);
    const call: Recorded = {
      method: (init.method ?? 'GET').toUpperCase(), url: raw, host: url.hostname, path: url.pathname,
      headers: headerMap(init.headers), body: bodyText(init.body),
      ...(init.body instanceof FormData ? { form: init.body } : {}),
    };
    up.calls.push(call);
    const answer = await route(url, call);
    if (answer) return answer;
    throw new Error(`fake-social-upstreams: nothing answers ${call.method} ${raw}`);
  };
  globalThis.fetch = fake as typeof globalThis.fetch;
  return { up, restore: () => { globalThis.fetch = original; } };
}
