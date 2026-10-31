/**
 * @file src/storage/blob/s3-client.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A BlobStore on any S3-compatible service, signed with AWS Signature Version 4. Five
 *   operations are all a stored file needs (put, get, ranged get, delete, list), and each is one
 *   signed request, so this is written against the protocol rather than through the AWS SDK: the SDK
 *   sends through its own HTTP client, and a store a person connects must go through safeFetch so its
 *   address cannot reach the node's private network. The signature is the documented algorithm
 *   (docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html); s3SignatureFor is exported
 *   so a unit test holds it to AWS's published example.
 * @structure s3Target · s3SignatureFor · s3PresignedUrl · createS3Store
 * @usage const store = createS3Store({ kind: 's3', region: 'eu-north-1', bucket: 'b', … }, fetch);
 * @version-history
 *   v1.1.0 — 2026-10-31 — head() and signedUrl() (a presigned GET or PUT), so a large file is written and
 *     read straight from the bucket (wish-suuret-tiedostot-virtaavat-aimeat-io-n-l-pi-ilman-koko-tiedo).
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { createHash, createHmac } from 'node:crypto';
import { BlobStoreError, attachmentDisposition, type BlobFetch, type BlobListPage, type BlobStore, type S3Spec } from './blob-types.js';
import { bodyBuffer, bodyText, drain, failure, uriEncode, xmlValue, xmlValues } from './blob-http.js';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, text: string): Buffer {
  return createHmac('sha256', key).update(text).digest();
}

interface Target { url: string; host: string; path: string; query: string }

/**
 * The address of `key` in the bucket (or of the bucket itself when `key` is empty), with the query
 * already in the canonical order SigV4 signs: sorted by name, both sides RFC 3986 encoded.
 */
export function s3Target(spec: S3Spec, key: string, query: Record<string, string> = {}): Target {
  const endpoint = spec.endpoint?.trim().replace(/\/+$/, '') || `https://s3.${spec.region}.amazonaws.com`;
  const base = new URL(endpoint);
  const basePath = base.pathname.replace(/\/+$/, '');
  const pathStyle = spec.pathStyle ?? !!spec.endpoint?.trim();
  const keyPath = key ? `/${uriEncode(key, true)}` : '';
  const host = pathStyle ? base.host : `${spec.bucket}.${base.host}`;
  const path = pathStyle ? `${basePath}/${uriEncode(spec.bucket, false)}${keyPath}` : `${basePath}${keyPath || '/'}`;
  const q = Object.keys(query).sort().map(k => `${uriEncode(k, false)}=${uriEncode(query[k], false)}`).join('&');
  return { url: `${base.protocol}//${host}${path}${q ? `?${q}` : ''}`, host, path, query: q };
}

/** The Authorization header value for one request, and the headers it signed. */
export function s3SignatureFor(input: {
  method: string; host: string; path: string; query: string; payloadHash: string;
  region: string; accessKeyId: string; secretAccessKey: string; sessionToken?: string;
  extraHeaders?: Record<string, string>; now: Date; service?: string;
}): { authorization: string; headers: Record<string, string> } {
  const service = input.service ?? 's3';
  const amzDate = input.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const signed: Record<string, string> = {
    host: input.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amzDate,
    ...(input.sessionToken ? { 'x-amz-security-token': input.sessionToken } : {}),
  };
  for (const [k, v] of Object.entries(input.extraHeaders ?? {})) signed[k.toLowerCase()] = v;
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map(n => `${n}:${signed[n].trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [input.method, input.path, input.query, canonicalHeaders, signedHeaders, input.payloadHash].join('\n');
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  // `host` is signed but not sent by us: fetch derives it from the address, which is the same value.
  const send = { ...signed };
  delete send.host;
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    headers: send,
  };
}

/**
 * A presigned address for one object (SigV4 in the query string,
 * docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html): only `host` is signed and the
 * payload is UNSIGNED-PAYLOAD, so the client sends the bytes as they are. `query` adds parameters that
 * are signed with it, such as response-content-disposition on a read. The signature comes last, after
 * the canonical query, which is how test/helpers/fake-s3.ts recomputes it.
 */
export function s3PresignedUrl(spec: S3Spec, input: {
  method: 'GET' | 'PUT'; key: string; expiresInSec: number; now: Date; query?: Record<string, string>;
}): string {
  const amzDate = input.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${spec.region}/s3/aws4_request`;
  const t = s3Target(spec, input.key, {
    ...input.query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${spec.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(input.expiresInSec),
    'X-Amz-SignedHeaders': 'host',
    ...(spec.sessionToken ? { 'X-Amz-Security-Token': spec.sessionToken } : {}),
  });
  const canonicalRequest = [input.method, t.path, t.query, `host:${t.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${spec.secretAccessKey}`, day), spec.region), 's3'), 'aws4_request');
  return `${t.url}&X-Amz-Signature=${createHmac('sha256', kSigning).update(stringToSign).digest('hex')}`;
}

export function createS3Store(spec: S3Spec, send: BlobFetch): BlobStore {
  const where = spec.endpoint?.trim() ? new URL(spec.endpoint).host : `s3.${spec.region}.amazonaws.com`;
  const label = `s3 bucket "${spec.bucket}" at ${where}`;

  async function request(method: string, key: string, opts: {
    query?: Record<string, string>; body?: Buffer; headers?: Record<string, string>;
  } = {}): Promise<Response> {
    const t = s3Target(spec, key, opts.query);
    const payloadHash = opts.body ? sha256Hex(opts.body) : EMPTY_SHA256;
    const { authorization, headers } = s3SignatureFor({
      method, host: t.host, path: t.path, query: t.query, payloadHash, region: spec.region,
      accessKeyId: spec.accessKeyId, secretAccessKey: spec.secretAccessKey, sessionToken: spec.sessionToken,
      now: new Date(),
    });
    try {
      return await send(t.url, { method, headers: { ...headers, ...opts.headers, authorization }, body: opts.body });
    } catch (err) {
      throw new BlobStoreError(`${method} could not reach ${label}: ${err instanceof Error ? err.message : String(err)}`, 0, 'UNREACHABLE');
    }
  }

  return {
    kind: 's3',
    describe: () => label,

    async put(key, data, contentType) {
      const res = await request('PUT', key, { body: data, headers: { 'content-type': contentType || 'application/octet-stream' } });
      if (!res.ok) throw await failure(res, 'Storing an object', label);
      await drain(res);
    },

    async get(key) {
      const res = await request('GET', key);
      if (res.status === 404) { await drain(res); return null; }
      if (!res.ok) throw await failure(res, 'Reading an object', label);
      return bodyBuffer(res, label);
    },

    async getRange(key, start, length) {
      if (length <= 0) return Buffer.alloc(0);
      const res = await request('GET', key, { headers: { range: `bytes=${start}-${start + length - 1}` } });
      if (res.status === 404) { await drain(res); return null; }
      // 416: the range starts past the end of an object that exists, which reads as no bytes.
      if (res.status === 416) { await drain(res); return Buffer.alloc(0); }
      if (!res.ok) throw await failure(res, 'Reading part of an object', label);
      const buf = await bodyBuffer(res, label);
      // A server that ignores Range answers 200 with the whole object.
      return res.status === 200 ? buf.subarray(start, start + length) : buf;
    },

    async delete(key) {
      const res = await request('DELETE', key);
      if (!res.ok && res.status !== 404) throw await failure(res, 'Removing an object', label);
      await drain(res);
    },

    async head(key) {
      const res = await request('HEAD', key);
      await drain(res);
      if (res.status === 404) return null;
      if (!res.ok) throw await failure(res, 'Reading an object\'s size', label);
      return { size: Number(res.headers.get('content-length') ?? 0), contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
    },

    signedUrl(key, op) {
      return s3PresignedUrl(spec, {
        method: op.kind === 'write' ? 'PUT' : 'GET', key, expiresInSec: op.expiresInSec, now: new Date(),
        ...(op.kind === 'read' ? { query: {
          ...(op.contentType ? { 'response-content-type': op.contentType } : {}),
          ...(op.filename ? { 'response-content-disposition': attachmentDisposition(op.filename) } : {}),
        } } : {}),
      });
    },

    async list(prefix, next): Promise<BlobListPage> {
      const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000', prefix };
      if (next) query['continuation-token'] = next;
      const res = await request('GET', '', { query });
      if (!res.ok) throw await failure(res, 'Listing objects', label);
      const xml = await bodyText(res, label);
      const objects = xmlValues(xml, 'Contents', true).map(c => ({
        key: xmlValue(c, 'Key') ?? '',
        lastModified: xmlValue(c, 'LastModified') ?? '',
        size: Number(xmlValue(c, 'Size') ?? 0),
      })).filter(o => o.key);
      const truncated = xmlValue(xml, 'IsTruncated') === 'true';
      const token = xmlValue(xml, 'NextContinuationToken');
      return truncated && token ? { objects, next: token } : { objects };
    },
  };
}
