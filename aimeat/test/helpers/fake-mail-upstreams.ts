/**
 * @file test/helpers/fake-mail-upstreams.ts
 * @description The Google, Microsoft, Mastodon, YouTube, LinkedIn, X and Bluesky upstreams, answered
 *   in this process by a replacement for `globalThis.fetch`.
 *
 *   WHY THE GLOBAL AND NOT A BASE-URL KNOB. The mail providers address their upstreams with module
 *   constants — `https://gmail.googleapis.com/gmail/v1/users/me` and
 *   `https://graph.microsoft.com/v1.0/me` — and the OAuth endpoints are literals inside each
 *   provider's `endpoints()` closure. There is nothing to point somewhere else, which is exactly why
 *   no test had ever reached that code. safeFetch calls the global as its last act, so replacing the
 *   global is the one seam that lets the real service code run end to end.
 *
 *   WHAT STILL LEAVES THIS MACHINE: a DNS lookup, and nothing else. safeFetch validates every
 *   address through `validateOutboundUrl`, which resolves the hostname before the call it never
 *   makes. Real names are therefore used throughout (mastodon.social, bsky.social) rather than
 *   invented ones, which would fail validation rather than reach the router below.
 *
 *   IT ROTATES REFRESH TOKENS AND RETIRES THE OLD ONE, the same reason test/helpers/
 *   fake-oauth-provider.ts does: single-flight refresh is only provable against a provider that
 *   behaves this way, and it counts what it was asked for so a test can assert ONCE rather than
 *   infer it from the absence of an error.
 * @structure FakeUpstreams (the recorder and its knobs) · installFakeUpstreams() · tokenEndpoint ·
 *   gmail · graph · mastodonPublishing · youtubeResumable · route() and one branch per host
 * @usage const { up, restore } = installFakeUpstreams(); try { ... } finally { restore(); }
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial, for test/e2e-mail-connections.ts.
 *   v1.1.0 — 2026-09-08 — The publishing and metric surfaces, for test/e2e-publish-upstreams.ts:
 *     Mastodon media with its transcode wait, YouTube's stateful resumable session and its resume
 *     probe, Bluesky createRecord and getPostThread, the LinkedIn image pair, and the metric reads
 *     of all four. A recorded call now carries its byte count and its multipart form, because a
 *     chunked upload is proven by the size of each chunk rather than by its text.
 */

/** One request the node made, as the upstream saw it. */
export interface RecordedCall {
  method: string;
  url: string;
  path: string;
  host: string;
  headers: Record<string, string>;
  body: string;
  /**
   * How many bytes the body carried, whatever its shape. `body` is the text of it and is empty for
   * a multipart form or a chunk of binary, which is exactly where the interesting assertion is: a
   * resumable upload is proven by the SIZE of each chunk and the range that announced it.
   */
  bodyBytes: number;
  /**
   * The multipart form itself, when one was sent. `body` cannot carry it: reading a Blob is async
   * and the recorder is not, so the form is kept and each handler reads what it needs.
   */
  form?: FormData;
}

/** What Graph was handed on a send, already parsed. */
export interface GraphSend {
  message: {
    subject?: string;
    body?: { contentType?: string; content?: string };
    toRecipients?: Array<{ emailAddress?: { address?: string } }>;
    replyTo?: Array<{ emailAddress?: { address?: string } }>;
    internetMessageHeaders?: Array<{ name: string; value: string }>;
    attachments?: Array<{ name?: string; contentType?: string; contentBytes?: string }>;
  };
  saveToSentItems?: boolean;
}

export interface FakeUpstreams {
  calls: RecordedCall[];
  stats: {
    tokenExchanges: number;
    refreshes: number;
    /** Refreshes that presented an already-rotated token. Stays 0 under single flight. */
    staleRefreshAttempts: number;
    gmailSends: number;
    graphSends: number;
    revocations: number;
    instanceRegistrations: number;
    /** Media uploads offered to a Mastodon instance. */
    mastodonMediaUploads: number;
    /** GETs of an uploaded Mastodon medium, which is how a transcode is waited out. */
    mastodonMediaPolls: number;
    /** Resumable upload sessions YouTube handed out. */
    youtubeSessions: number;
  };
  /** The mailbox every identity lookup reports. Change it to connect a SECOND account. */
  mailbox: string;
  /** What settings/sendAs answers. `verified: false` is what Gmail refuses at send time. */
  aliases: Array<{ address: string; verified: boolean; primary: boolean }>;
  /** Force the next send (both providers) to this status. Cleared after one call. */
  nextSendStatus: number | null;
  /** Force settings/sendAs to this status, so the alias read can be made to fail. */
  sendAsStatus: number | null;
  /** Every refresh answers 400 — the grant-is-gone case. */
  breakRefresh: boolean;
  /** Hold a refresh open, so two callers genuinely overlap. */
  refreshDelayMs: number;
  /** Granted scopes to declare on the next code exchange, or null to let the provider's list stand. */
  nextGrantedScope: string | null;
  /** The raw RFC 5322 message Gmail was handed, decoded. */
  lastGmailRaw: string;
  lastGraphSend: GraphSend | null;
  lastLinkedinPost: Record<string, unknown> | null;
  lastXPost: Record<string, unknown> | null;

  // ── Publishing and metrics ────────────────────────────────────────────────────
  // Every `…Status` below forces ONE answer and then clears itself, so a failure knob cannot leak
  // into the next test and be diagnosed as a defect in whatever ran after it.

  /** Force POST /api/v2/media to this status. 422 is the instance refusing the FILE. */
  mastodonMediaStatus: number | null;
  /** Answer the media upload with no id at all, which is the temporary refusal. */
  mastodonMediaNoId: boolean;
  /**
   * How many GETs of the medium a transcode costs. 0 answers the upload 200 and there is no wait;
   * 2 answers it 202 and then 206, 200 — the case a status posted too early loses its video to.
   */
  mastodonTranscodePolls: number;
  /** Counts down from mastodonTranscodePolls as the polls arrive. Set by the media upload. */
  mastodonPollsRemaining: number;
  /** Force the next transcode poll to this status. */
  mastodonPollStatus: number | null;
  /** Force POST /api/v1/statuses to this status. */
  mastodonStatusStatus: number | null;
  /** Force GET /api/v1/statuses/{id}, the metric read, to this status. */
  mastodonMetricsStatus: number | null;
  /** What the multipart media upload carried. */
  lastMastodonMedia: { name: string; size: number; type: string; description: string | null } | null;

  /** Force the resumable-upload start to this status. */
  youtubeStartStatus: number | null;
  /** Start the upload without naming a session, which leaves the client with nowhere to PUT. */
  youtubeNoLocation: boolean;
  /** How the NEXT session behaves: accept the chunks, fail one and be resumed, or be expired. */
  youtubeSessionMode: 'ok' | 'fail-once' | 'expired';
  /** What the resume probe claims arrived. The client's next offset can only come from here. */
  youtubeResumeOffset: number;
  /** The sessions handed out, by id, so a test can see which mode each one carried. */
  youtubeSessionsById: Map<string, { mode: 'ok' | 'fail-once' | 'expired'; total: number; failed: boolean }>;
  /** Force GET /youtube/v3/videos, the metric read, to this status. */
  youtubeVideosStatus: number | null;
  /** Answer the metric read with a video that carries no statistics block. */
  youtubeNoStatistics: boolean;

  /** Force com.atproto.repo.createRecord to this status. */
  blueskyPostStatus: number | null;
  /** Force app.bsky.feed.getPostThread to this status. */
  blueskyThreadStatus: number | null;
  /** Report the thread with neither repostCount nor quoteCount, which must read as null not zero. */
  blueskyOmitShareCounts: boolean;

  /** Force POST /2/tweets to this status. */
  xPostStatus: number | null;
  /** Accept the post and name no id, which costs the permalink and not the post. */
  xPostNoId: boolean;
  /** Force GET /2/tweets/{id}, the metric read, to this status. */
  xMetricsStatus: number | null;
  /** Answer the metric read with a post carrying no public_metrics. */
  xMetricsEmpty: boolean;

  /** Force the image upload's initialisation to this status. */
  linkedinImageInitStatus: number | null;
  /** Initialise an image upload without saying where to put the bytes. */
  linkedinImageInitEmpty: boolean;
  /** Force the PUT of the image bytes to this status. */
  linkedinImagePutStatus: number | null;
  /** Force POST /rest/posts to this status. */
  linkedinPostStatus: number | null;
  /** Publish the post and return no urn header, which is a success with no link. */
  linkedinPostNoUrn: boolean;
  /** What the image PUT carried. */
  lastLinkedinImage: { contentType: string; bytes: number } | null;
  /** Refresh tokens this fake has retired. Presenting one is the failure single-flight prevents. */
  retired: Set<string>;
  /** A marker into `calls`, so a test can ask what happened since a point. */
  mark(): number;
  since(mark: number): RecordedCall[];
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

/**
 * The shapes the global fetch accepts, taken from the global itself rather than named.
 *
 * `RequestInfo`, `BodyInit` and `HeadersInit` are DOM names, and this project compiles against
 * `lib: ES2022` plus Node's own types, where they do not exist.
 */
type FetchInput = Parameters<typeof globalThis.fetch>[0];

/** Whatever a caller passed as a body, as text. Enough for form bodies, JSON and raw bytes. */
function bodyText(body: RequestInit['body']): string {
  if (body === null || body === undefined) return '';
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  return '';
}

/** How many bytes the body was, whatever its shape. A multipart form reports 0: it is kept whole. */
function bodySize(body: RequestInit['body']): number {
  if (body === null || body === undefined) return 0;
  if (typeof body === 'string') return Buffer.byteLength(body);
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString());
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  return 0;
}

/** Header names lowercased, so an assertion does not depend on how the caller spelled one. */
function headerMap(init: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  const h = init instanceof Headers ? init : new Headers(init);
  h.forEach((value, name) => { out[name.toLowerCase()] = value; });
  return out;
}

let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${++counter}`;

/**
 * Install the router. Everything on 127.0.0.1 / localhost still goes to the real fetch, because the
 * node under test is there and the suite talks to it through the same global.
 */
export function installFakeUpstreams(): { up: FakeUpstreams; restore: () => void } {
  const original = globalThis.fetch;

  const up: FakeUpstreams = {
    calls: [],
    stats: {
      tokenExchanges: 0, refreshes: 0, staleRefreshAttempts: 0,
      gmailSends: 0, graphSends: 0, revocations: 0, instanceRegistrations: 0,
      mastodonMediaUploads: 0, mastodonMediaPolls: 0, youtubeSessions: 0,
    },
    mailbox: 'owner@mail.example.test',
    aliases: [
      { address: 'owner@mail.example.test', verified: true, primary: true },
      { address: 'billing@mail.example.test', verified: true, primary: false },
      { address: 'pending@mail.example.test', verified: false, primary: false },
    ],
    nextSendStatus: null,
    sendAsStatus: null,
    breakRefresh: false,
    refreshDelayMs: 0,
    nextGrantedScope: null,
    lastGmailRaw: '',
    lastGraphSend: null,
    lastLinkedinPost: null,
    lastXPost: null,

    mastodonMediaStatus: null,
    mastodonMediaNoId: false,
    mastodonTranscodePolls: 0,
    mastodonPollsRemaining: 0,
    mastodonPollStatus: null,
    mastodonStatusStatus: null,
    mastodonMetricsStatus: null,
    lastMastodonMedia: null,

    youtubeStartStatus: null,
    youtubeNoLocation: false,
    youtubeSessionMode: 'ok',
    youtubeResumeOffset: 1024 * 1024,
    youtubeSessionsById: new Map(),
    youtubeVideosStatus: null,
    youtubeNoStatistics: false,

    blueskyPostStatus: null,
    blueskyThreadStatus: null,
    blueskyOmitShareCounts: false,

    xPostStatus: null,
    xPostNoId: false,
    xMetricsStatus: null,
    xMetricsEmpty: false,

    linkedinImageInitStatus: null,
    linkedinImageInitEmpty: false,
    linkedinImagePutStatus: null,
    linkedinPostStatus: null,
    linkedinPostNoUrn: false,
    lastLinkedinImage: null,

    retired: new Set<string>(),
    mark() { return up.calls.length; },
    since(mark: number) { return up.calls.slice(mark); },
  };

  const fake = async (input: FetchInput, init: RequestInit = {}): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1') {
      return original(input, init);
    }
    const call: RecordedCall = {
      method: (init.method ?? 'GET').toUpperCase(),
      url: raw,
      path: url.pathname,
      host: url.hostname,
      headers: headerMap(init.headers),
      body: bodyText(init.body),
      bodyBytes: bodySize(init.body),
      ...(init.body instanceof FormData ? { form: init.body } : {}),
    };
    up.calls.push(call);
    const answer = await route(up, url, call);
    if (answer) return answer;
    // A host nobody taught this router about must be loud. Silently answering 404 would look like
    // the provider refusing, and the test would assert a refusal the code never produced.
    throw new Error(`fake-mail-upstreams: nothing answers ${call.method} ${raw}`);
  };

  globalThis.fetch = fake as typeof globalThis.fetch;
  return { up, restore: () => { globalThis.fetch = original; } };
}

/** The OAuth token endpoint, shared by every provider that has one. */
async function tokenEndpoint(up: FakeUpstreams, call: RecordedCall): Promise<Response> {
  const form = new URLSearchParams(call.body);
  const grant = form.get('grant_type');

  if (grant === 'authorization_code') {
    up.stats.tokenExchanges++;
    return json({
      access_token: nextId('at'),
      refresh_token: nextId('rt'),
      expires_in: 3600,
      token_type: 'Bearer',
      ...(up.nextGrantedScope ? { scope: up.nextGrantedScope } : {}),
    });
  }

  if (grant === 'refresh_token') {
    if (up.refreshDelayMs > 0) await new Promise((r) => setTimeout(r, up.refreshDelayMs));
    const presented = form.get('refresh_token') ?? '';
    // Counted BEFORE the break check: a stale token presented to a broken endpoint is still stale.
    if (up.retired.has(presented)) up.stats.staleRefreshAttempts++;
    if (up.breakRefresh) return json({ error: 'invalid_grant' }, 400);
    up.stats.refreshes++;
    up.retired.add(presented);
    return json({ access_token: nextId('at'), refresh_token: nextId('rt'), expires_in: 3600 });
  }

  return json({ error: 'unsupported_grant_type' }, 400);
}

/** Gmail's REST surface, under /gmail/v1/users/me. */
function gmail(up: FakeUpstreams, url: URL, call: RecordedCall): Response | null {
  const rest = url.pathname.replace('/gmail/v1/users/me', '');

  if (call.method === 'POST' && rest === '/messages/send') {
    up.stats.gmailSends++;
    const status = up.nextSendStatus;
    up.nextSendStatus = null;
    if (status) return new Response(`{"error":{"code":${status}}}`, { status, headers: JSON_HEADERS });
    const parsed = JSON.parse(call.body || '{}') as { raw?: string };
    up.lastGmailRaw = Buffer.from(parsed.raw ?? '', 'base64url').toString('utf8');
    return json({ id: nextId('gm'), threadId: nextId('th'), labelIds: ['SENT'] });
  }

  if (rest === '/profile') {
    return json({ emailAddress: up.mailbox, messagesTotal: 2413, threadsTotal: 1180, historyId: '99001' });
  }

  if (rest === '/settings/sendAs') {
    if (up.sendAsStatus) return json({ error: { message: 'sendAs unavailable' } }, up.sendAsStatus);
    return json({
      sendAs: up.aliases.map((a) => ({
        sendAsEmail: a.address,
        displayName: a.primary ? 'Owner' : a.address,
        isPrimary: a.primary,
        isDefault: a.primary,
        verificationStatus: a.verified ? 'accepted' : 'pending',
      })),
    });
  }

  const attachment = /^\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(rest);
  if (attachment) {
    const bytes = Buffer.from(`the invoice bytes of ${attachment[1]}`, 'utf8');
    return json({ attachmentId: attachment[2], size: bytes.length, data: bytes.toString('base64url') });
  }

  const message = /^\/messages\/([^/]+)$/.exec(rest);
  if (message) {
    const id = message[1];
    if (url.searchParams.get('format') === 'raw') {
      const mime = `From: sender@example.test\r\nSubject: Invoice ${id}\r\n\r\nbody of ${id}\r\n`;
      return json({ id, threadId: 'th-1', raw: Buffer.from(mime, 'utf8').toString('base64url') });
    }
    return json({
      id, threadId: 'th-1', labelIds: ['INBOX'], snippet: `snippet of ${id}`,
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'Subject', value: `Invoice ${id}` },
          { name: 'From', value: 'sender@example.test' },
          { name: 'To', value: up.mailbox },
        ],
        parts: [
          { partId: '0', mimeType: 'text/plain', filename: '', body: { size: 24 } },
          { partId: '1', mimeType: 'application/pdf', filename: 'invoice.pdf', body: { attachmentId: 'att-1', size: 4096 } },
        ],
      },
    });
  }

  if (rest === '/messages') {
    const max = Number(url.searchParams.get('maxResults') ?? '25');
    const messages = Array.from({ length: Math.min(max, 3) }, (_, i) => ({ id: `m${i + 1}`, threadId: 'th-1' }));
    return json({ messages, nextPageToken: 'page-2', resultSizeEstimate: 3 });
  }

  return null;
}

/** Microsoft Graph, under /v1.0/me. */
function graph(up: FakeUpstreams, url: URL, call: RecordedCall): Response | null {
  const rest = url.pathname.replace('/v1.0/me', '');

  if (call.method === 'POST' && rest === '/sendMail') {
    up.stats.graphSends++;
    const status = up.nextSendStatus;
    up.nextSendStatus = null;
    if (status) return new Response(`{"error":{"code":"${status}"}}`, { status, headers: JSON_HEADERS });
    up.lastGraphSend = JSON.parse(call.body || '{}') as GraphSend;
    return new Response(null, { status: 202 });
  }

  if (rest === '') {
    return json({
      id: 'graph-user-0001', displayName: 'Owner',
      mail: up.mailbox, userPrincipalName: up.mailbox,
    });
  }

  const attachment = /^\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(rest);
  if (attachment) {
    const bytes = Buffer.from(`the graph attachment of ${attachment[1]}`, 'utf8');
    return json({
      '@odata.type': '#microsoft.graph.fileAttachment',
      id: attachment[2], name: 'invoice.pdf', contentType: 'application/pdf',
      size: bytes.length, contentBytes: bytes.toString('base64'),
    });
  }

  const message = /^\/messages\/([^/]+)$/.exec(rest);
  if (message) {
    return json({
      id: message[1], subject: `Invoice ${message[1]}`,
      from: { emailAddress: { address: 'sender@example.test', name: 'Sender' } },
      toRecipients: [{ emailAddress: { address: up.mailbox } }],
      receivedDateTime: '2026-09-01T09:00:00Z',
      body: { contentType: 'html', content: '<p>the message</p>' },
      hasAttachments: true,
    });
  }

  if (rest === '/messages') {
    const top = Number(url.searchParams.get('$top') ?? '25');
    const value = Array.from({ length: Math.min(top, 2) }, (_, i) => ({
      id: `g${i + 1}`, subject: `Invoice g${i + 1}`,
      from: { emailAddress: { address: 'sender@example.test' } },
      receivedDateTime: '2026-09-01T09:00:00Z',
    }));
    return json({ '@odata.context': 'graph', value, '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=next' });
  }

  return null;
}

/**
 * A Mastodon instance's publishing and metric surface.
 *
 * THE 202 IS THE WHOLE REASON THIS IS NOT THREE LINES. An instance that is still transcoding
 * answers the upload 202 and the medium's GET 206, and a status posted with that id lands with no
 * video on it — successful to everyone including the node, and empty to a reader. The knobs make
 * that sequence reproducible instead of describable.
 */
function mastodonPublishing(up: FakeUpstreams, url: URL, call: RecordedCall): Response | null {
  const path = url.pathname;

  if (call.method === 'POST' && path === '/api/v2/media') {
    up.stats.mastodonMediaUploads++;
    const forced = up.mastodonMediaStatus;
    up.mastodonMediaStatus = null;
    if (forced) return json({ error: 'Validation failed: File content type is invalid' }, forced);
    const file = call.form?.get('file');
    const description = call.form?.get('description');
    up.lastMastodonMedia = {
      name: file instanceof Blob ? (file as File).name : '',
      size: file instanceof Blob ? file.size : 0,
      type: file instanceof Blob ? file.type : '',
      description: typeof description === 'string' ? description : null,
    };
    if (up.mastodonMediaNoId) return json({ type: 'video' });
    const id = nextId('mastomedia');
    if (up.mastodonTranscodePolls > 0) {
      up.mastodonPollsRemaining = up.mastodonTranscodePolls;
      // 202: accepted, not ready. The id is real and the file behind it is not there yet.
      return json({ id, type: 'video', url: null }, 202);
    }
    return json({ id, type: 'image', url: 'https://mastodon.social/media/ready' });
  }

  const medium = /^\/api\/v1\/media\/([^/]+)$/.exec(path);
  if (medium) {
    up.stats.mastodonMediaPolls++;
    const forced = up.mastodonPollStatus;
    up.mastodonPollStatus = null;
    if (forced) return json({ error: 'processing failed' }, forced);
    up.mastodonPollsRemaining = Math.max(0, up.mastodonPollsRemaining - 1);
    if (up.mastodonPollsRemaining > 0) return json({ id: medium[1], url: null }, 206);
    return json({ id: medium[1], url: 'https://mastodon.social/media/ready' });
  }

  if (call.method === 'POST' && path === '/api/v1/statuses') {
    const forced = up.mastodonStatusStatus;
    up.mastodonStatusStatus = null;
    if (forced) return json({ error: 'Validation failed: Text character limit exceeded' }, forced);
    const id = String(1100000000 + ++counter);
    return json({ id, url: `https://mastodon.social/@tester/${id}`, created_at: '2026-09-08T09:00:00Z' });
  }

  const status = /^\/api\/v1\/statuses\/(\d+)$/.exec(path);
  if (status) {
    const forced = up.mastodonMetricsStatus;
    up.mastodonMetricsStatus = null;
    if (forced) return json({ error: 'This action is not allowed' }, forced);
    return json({
      id: status[1], url: `https://mastodon.social/@tester/${status[1]}`,
      favourites_count: 9, replies_count: 4, reblogs_count: 3,
    });
  }

  return null;
}

/**
 * YouTube's resumable upload, which is a protocol rather than a request.
 *
 * The session is stateful on purpose: the client's next offset must come from the SERVER's account
 * of what arrived, and a fake that echoed the client's own numbers back would let a resume that
 * corrupts the file pass. `youtubeResumeOffset` is deliberately not a chunk boundary.
 */
function youtubeResumable(up: FakeUpstreams, url: URL, call: RecordedCall): Response | null {
  if (call.method === 'POST' && url.pathname === '/upload/youtube/v3/videos') {
    up.stats.youtubeSessions++;
    const forced = up.youtubeStartStatus;
    up.youtubeStartStatus = null;
    if (forced) return json({ error: { message: 'the upload was not started' } }, forced);
    if (up.youtubeNoLocation) return json({});
    const id = nextId('ytsession');
    up.youtubeSessionsById.set(id, {
      mode: up.youtubeSessionMode,
      total: Number(call.headers['x-upload-content-length'] ?? '0'),
      failed: false,
    });
    // 200 with a location, NOT a redirect: safeFetch follows a 3xx and would swallow the session.
    return json({}, 200, { location: `https://www.googleapis.com/upload/session/${id}` });
  }

  const session = /^\/upload\/session\/([^/]+)$/.exec(url.pathname);
  if (!session) return null;
  const state = up.youtubeSessionsById.get(session[1]);
  if (!state) return json({ error: { message: 'no such session' } }, 404);
  // An expired session answers every PUT the same way, the resume probe included: there is nothing
  // left to resume into.
  if (state.mode === 'expired') return json({ error: { message: 'session expired' } }, 404);

  const range = call.headers['content-range'] ?? '';
  if (/^bytes \*\/\d+$/.test(range)) {
    // THE RESUME QUERY. The answer is the server's own account, and the client must take it.
    return new Response(null, { status: 308, headers: { range: `bytes=0-${up.youtubeResumeOffset - 1}` } });
  }
  const chunk = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
  if (!chunk) return json({ error: { message: `unusable Content-Range: ${range}` } }, 400);
  if (state.mode === 'fail-once' && !state.failed) {
    state.failed = true;
    return json({ error: { message: 'backend error' } }, 500);
  }
  if (Number(chunk[2]) + 1 >= Number(chunk[3])) return json({ id: nextId('ytvideo'), kind: 'youtube#video' });
  return new Response(null, { status: 308, headers: { range: `bytes=0-${chunk[2]}` } });
}

/** Everything, dispatched by host. Returns null when this host has nothing at that path. */
async function route(up: FakeUpstreams, url: URL, call: RecordedCall): Promise<Response | null> {
  const host = url.hostname;
  const path = url.pathname;

  if (host === 'gmail.googleapis.com') return gmail(up, url, call);
  if (host === 'graph.microsoft.com') return graph(up, url, call);

  if (host === 'oauth2.googleapis.com') {
    if (path === '/token') return tokenEndpoint(up, call);
    if (path === '/revoke') { up.stats.revocations++; return json({}); }
    return null;
  }

  if (host === 'login.microsoftonline.com') {
    // The tenant is in the PATH here and nowhere else, which is the whole of what makes Microsoft
    // different. Matching it loosely would let a wrong tenant pass unnoticed.
    if (/^\/[A-Za-z0-9-]{1,64}\/oauth2\/v2\.0\/token$/.test(path)) return tokenEndpoint(up, call);
    return null;
  }

  if (host === 'www.googleapis.com') {
    if (path === '/oauth2/v3/userinfo') {
      return json({ sub: 'google-sub-0001', email: up.mailbox, email_verified: true });
    }
    if (path === '/youtube/v3/channels') {
      return json({ items: [{ id: 'UCfake0001', snippet: { title: 'The Test Channel' } }] });
    }
    if (path === '/youtube/v3/videos') {
      const forced = up.youtubeVideosStatus;
      up.youtubeVideosStatus = null;
      if (forced) return json({ error: { message: 'the video was not read' } }, forced);
      const id = url.searchParams.get('id') ?? '';
      if (up.youtubeNoStatistics) return json({ items: [{ id }] });
      // STRINGS, which is what YouTube actually answers and the reason ns() exists.
      return json({
        items: [{
          id,
          statistics: { viewCount: '4210', likeCount: '87', commentCount: '12', favoriteCount: '0' },
        }],
      });
    }
    return youtubeResumable(up, url, call);
  }

  if (host === 'www.linkedin.com') {
    if (path === '/oauth/v2/accessToken') return tokenEndpoint(up, call);
    if (path === '/oauth/v2/revoke') { up.stats.revocations++; return json({}); }
    // The bytes go to a host LinkedIn names in its own answer, not to a fixed endpoint.
    if (path.startsWith('/dms-uploads/')) {
      const forced = up.linkedinImagePutStatus;
      up.linkedinImagePutStatus = null;
      if (forced) return json({ message: 'the image was not stored' }, forced);
      up.lastLinkedinImage = { contentType: call.headers['content-type'] ?? '', bytes: call.bodyBytes };
      return new Response(null, { status: 201 });
    }
    return null;
  }

  if (host === 'api.linkedin.com') {
    if (path === '/v2/userinfo') return json({ sub: 'li-member-0001', name: 'A Member' });
    if (path === '/rest/images') {
      const forced = up.linkedinImageInitStatus;
      up.linkedinImageInitStatus = null;
      if (forced) return json({ message: 'the upload was not initialised' }, forced);
      if (up.linkedinImageInitEmpty) return json({ value: {} });
      const id = nextId('liimage');
      return json({ value: { uploadUrl: `https://www.linkedin.com/dms-uploads/${id}`, image: `urn:li:image:${id}` } });
    }
    if (path === '/rest/posts') {
      const forced = up.linkedinPostStatus;
      up.linkedinPostStatus = null;
      if (forced) return json({ message: 'the post was refused' }, forced);
      up.lastLinkedinPost = JSON.parse(call.body || '{}') as Record<string, unknown>;
      if (up.linkedinPostNoUrn) return new Response(null, { status: 201 });
      return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:777' } });
    }
    return null;
  }

  if (host === 'api.x.com') {
    if (path === '/2/oauth2/token') return tokenEndpoint(up, call);
    if (path === '/2/oauth2/revoke') { up.stats.revocations++; return json({}); }
    if (path === '/2/users/me') return json({ data: { id: 'x-user-0001', username: 'testhandle' } });
    if (path === '/2/tweets') {
      const forced = up.xPostStatus;
      up.xPostStatus = null;
      if (forced) return json({ title: 'refused', detail: 'X would not take that post' }, forced);
      up.lastXPost = JSON.parse(call.body || '{}') as Record<string, unknown>;
      if (up.xPostNoId) return json({ data: { text: 'ok' } });
      return json({ data: { id: '1900000000000000001', text: 'ok' } });
    }
    const tweet = /^\/2\/tweets\/(\d+)$/.exec(path);
    if (tweet) {
      const forced = up.xMetricsStatus;
      up.xMetricsStatus = null;
      if (forced) return json({ title: 'not read', detail: 'the numbers were not read' }, forced);
      if (up.xMetricsEmpty) return json({ data: { id: tweet[1] } });
      return json({
        data: {
          id: tweet[1],
          public_metrics: {
            impression_count: 1840, like_count: 23, reply_count: 5, retweet_count: 4, quote_count: 2,
          },
        },
      });
    }
    return null;
  }

  if (host === 'mastodon.social') {
    if (path === '/api/v1/apps') {
      up.stats.instanceRegistrations++;
      return json({ id: '1', client_id: 'mastodon-client', client_secret: 'mastodon-secret' });
    }
    if (path === '/oauth/token') return tokenEndpoint(up, call);
    if (path === '/oauth/revoke') { up.stats.revocations++; return json({}); }
    if (path === '/api/v1/accounts/verify_credentials') {
      return json({ id: '110001', acct: 'tester', username: 'tester' });
    }
    return mastodonPublishing(up, url, call);
  }

  if (host === 'bsky.social') {
    if (path === '/xrpc/com.atproto.server.createSession') {
      return json({
        accessJwt: nextId('bsky-access'), refreshJwt: nextId('bsky-refresh'),
        did: 'did:plc:faketester', handle: 'tester.bsky.social',
      });
    }
    if (path === '/xrpc/com.atproto.repo.createRecord') {
      const forced = up.blueskyPostStatus;
      up.blueskyPostStatus = null;
      if (forced) return json({ error: 'InvalidRequest', message: 'the record was refused' }, forced);
      const rkey = nextId('bskypost');
      return json({ uri: `at://did:plc:faketester/app.bsky.feed.post/${rkey}`, cid: 'bafyfakecid' });
    }
    if (path === '/xrpc/app.bsky.feed.getPostThread') {
      const forced = up.blueskyThreadStatus;
      up.blueskyThreadStatus = null;
      if (forced) return json({ error: 'NotFound', message: 'the post was not found' }, forced);
      return json({
        thread: {
          post: {
            uri: url.searchParams.get('uri'),
            likeCount: 12, replyCount: 3,
            // Absent on purpose under the knob: two missing share counts must read as null, and a
            // fake that always reports them cannot tell null from zero apart.
            ...(up.blueskyOmitShareCounts ? {} : { repostCount: 5, quoteCount: 2 }),
          },
        },
      });
    }
    return null;
  }

  return null;
}
