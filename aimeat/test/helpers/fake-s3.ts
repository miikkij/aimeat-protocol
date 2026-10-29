/**
 * @file test/helpers/fake-s3.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An S3 service inside the test process, for the file-store suites: one or more buckets in
 *   memory, the five operations a stored file uses (PUT, GET with Range, DELETE, ListObjectsV2), and a
 *   signature check on every request. The check recomputes AWS Signature Version 4 from the request as
 *   it arrived with s3SignatureFor, which test/unit/file-store-s3.test.ts holds to AWS's own published
 *   example, so a node that signs a different path, query or header set than it sends is refused here
 *   as it would be by S3. A wrong key answers 403 SignatureDoesNotMatch, an unknown key id 403
 *   InvalidAccessKeyId, an unknown bucket 404 NoSuchBucket.
 * @structure FakeS3 · startFakeS3
 * @usage const s3 = await startFakeS3({ port, buckets: ['files'], accessKeyId, secretAccessKey });
 *   s3.objects('files');  s3.backdate('files', key, days);  await s3.close();
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { s3SignatureFor } from '../../src/storage/blob/s3-client.js';

interface StoredObject { body: Buffer; type: string; modified: Date }

export interface FakeS3 {
  url: string;
  /** The keys in a bucket, in order. */
  objects(bucket: string): string[];
  get(bucket: string, key: string): StoredObject | undefined;
  /** Make an object look `days` old, for the sweep's age rule. */
  backdate(bucket: string, key: string, days: number): void;
  /** Put an object straight in, as something other than the node would. */
  plant(bucket: string, key: string, body: string, ageDays?: number): void;
  /** How many requests were refused for their signature. */
  refused(): number;
  close(): Promise<void>;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sendXml(res: ServerResponse, status: number, xml: string): void {
  res.writeHead(status, { 'content-type': 'application/xml' });
  res.end(`<?xml version="1.0" encoding="UTF-8"?>${xml}`);
}

function fail(res: ServerResponse, status: number, code: string, message: string): void {
  sendXml(res, status, `<Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message></Error>`);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of req) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

export async function startFakeS3(opts: { port: number; buckets: string[]; accessKeyId: string; secretAccessKey: string; region?: string }): Promise<FakeS3> {
  const region = opts.region ?? 'us-east-1';
  const buckets = new Map<string, Map<string, StoredObject>>(opts.buckets.map(b => [b, new Map()]));
  let refused = 0;

  /** Recompute the signature from what arrived. True when it matches. */
  function signed(req: IncomingMessage, path: string, query: string): boolean {
    const auth = req.headers.authorization ?? '';
    const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]+)$/.exec(auth);
    if (!m || m[1] !== opts.accessKeyId || m[3] !== region) return false;
    const names = m[4].split(';');
    const extra: Record<string, string> = {};
    for (const n of names) {
      if (n === 'host' || n === 'x-amz-date' || n === 'x-amz-content-sha256' || n === 'x-amz-security-token') continue;
      extra[n] = String(req.headers[n] ?? '');
    }
    const amzDate = String(req.headers['x-amz-date'] ?? '');
    const now = new Date(`${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`);
    const expected = s3SignatureFor({
      method: req.method ?? 'GET', host: String(req.headers.host), path, query,
      payloadHash: String(req.headers['x-amz-content-sha256'] ?? ''), region,
      accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey,
      extraHeaders: extra, now,
    });
    return expected.authorization === auth;
  }

  const server = createServer(async (req, res) => {
    const raw = req.url ?? '/';
    const qAt = raw.indexOf('?');
    const path = qAt >= 0 ? raw.slice(0, qAt) : raw;
    const query = qAt >= 0 ? raw.slice(qAt + 1) : '';
    const body = await readBody(req);
    if (!req.headers.authorization?.includes(`Credential=${opts.accessKeyId}/`)) {
      refused++;
      fail(res, 403, 'InvalidAccessKeyId', 'The AWS access key Id you provided does not exist in our records.');
      return;
    }
    if (!signed(req, path, query)) {
      refused++;
      fail(res, 403, 'SignatureDoesNotMatch', 'The request signature we calculated does not match the signature you provided.');
      return;
    }
    const segments = path.split('/').filter(Boolean);
    const bucket = decodeURIComponent(segments.shift() ?? '');
    const objects = buckets.get(bucket);
    if (!objects) { fail(res, 404, 'NoSuchBucket', 'The specified bucket does not exist'); return; }
    const key = segments.map(decodeURIComponent).join('/');

    if (!key && req.method === 'GET') {
      const params = new URLSearchParams(query);
      const prefix = params.get('prefix') ?? '';
      const max = Number(params.get('max-keys') ?? 1000);
      const start = Number(params.get('continuation-token') ?? 0);
      const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort();
      const page = keys.slice(start, start + max);
      const truncated = start + max < keys.length;
      sendXml(res, 200, `<ListBucketResult><Name>${xmlEscape(bucket)}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${page.length}</KeyCount>`
        + `<IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${start + max}</NextContinuationToken>` : ''}`
        + page.map(k => `<Contents><Key>${xmlEscape(k)}</Key><LastModified>${objects.get(k)!.modified.toISOString()}</LastModified><Size>${objects.get(k)!.body.length}</Size></Contents>`).join('')
        + '</ListBucketResult>');
      return;
    }
    if (req.method === 'PUT') {
      objects.set(key, { body, type: String(req.headers['content-type'] ?? 'application/octet-stream'), modified: new Date() });
      res.writeHead(200, { etag: '"fake"' });
      res.end();
      return;
    }
    const obj = objects.get(key);
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'GET') { fail(res, 405, 'MethodNotAllowed', 'Not supported here'); return; }
    if (!obj) { fail(res, 404, 'NoSuchKey', 'The specified key does not exist.'); return; }
    const range = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ''));
    if (range) {
      const from = Number(range[1]);
      if (from >= obj.body.length) { fail(res, 416, 'InvalidRange', 'The requested range is not satisfiable'); return; }
      const to = Math.min(Number(range[2]), obj.body.length - 1);
      res.writeHead(206, { 'content-type': obj.type, 'content-range': `bytes ${from}-${to}/${obj.body.length}` });
      res.end(obj.body.subarray(from, to + 1));
      return;
    }
    res.writeHead(200, { 'content-type': obj.type });
    res.end(obj.body);
  });
  await new Promise<void>(resolve => server.listen(opts.port, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${opts.port}`,
    objects: b => [...(buckets.get(b)?.keys() ?? [])].sort(),
    get: (b, k) => buckets.get(b)?.get(k),
    backdate: (b, k, days) => {
      const o = buckets.get(b)?.get(k);
      if (o) o.modified = new Date(Date.now() - days * 86_400_000);
    },
    plant: (b, k, text, ageDays = 0) => {
      buckets.get(b)?.set(k, { body: Buffer.from(text), type: 'text/plain', modified: new Date(Date.now() - ageDays * 86_400_000) });
    },
    refused: () => refused,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
