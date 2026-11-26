/**
 * @file test/unit/sdk-storage-upload.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT.storage.upload(File|Blob) sends the raw bytes in ONE PUT to a presigned upload
 *   address and answers the fields the inline upload answered. It read the file into base64 and POSTed
 *   it as JSON, a body a third larger than the file, and on aimeat.io a file over about 3.1 MB answered
 *   500 (an app lost a 3.5 MB zip). The mint carries what the inline body carried (key, type,
 *   visibility, the group or workspace, the store); a base64 string still goes inline; a refusal
 *   throws the node's sentence.
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-aimeat-storage-upload-l-hett-tiedoston-yhdell-put-pyynn-ll-j).
 */
import { describe, it, expect, beforeEach } from 'vitest';

type Call = { path: string; body: any };
const calls: Call[] = [];
type Put = { url: string; method?: string; headers: Record<string, string>; body: unknown };
const puts: Put[] = [];
let mintAnswer: any;
let putStatus = 200;
let putAnswer: any;

const UPLOAD_URL = 'https://node.test/v1/upload/u_abc123';
const STORED = {
  success: true, type: 'storage', key: 'big.zip', store: 'database', owner_gaii: 'alice@node.test', size: 0,
  mime_type: 'application/zip', visibility: 'private', federate: false, created_at: '2026-11-26T20:00:00.000Z',
  embed_url: '/v1/pub/alice%40node.test/big.zip', embed_markdown: '![big.zip](/v1/pub/alice%40node.test/big.zip)',
  versioned_url: '/v1/pub/alice%40node.test/big.zip?v=x',
};

beforeEach(() => {
  calls.length = 0;
  puts.length = 0;
  putStatus = 200;
  putAnswer = { ...STORED };
  mintAnswer = { ok: true, data: { upload_url: UPLOAD_URL, upload_method: 'PUT', content_type: 'application/zip', max_size_bytes: 1073741824, expires_in_seconds: 3600 } };
  const session = {
    jwt: 'jwt-alice',
    fetch: async (path: string, opts: { body?: string } = {}) => {
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ path, body });
      if (path === '/v1/storage' && body?.mode === 'presigned') return mintAnswer;
      if (path === '/v1/storage') return { ok: true, data: { key: body.key, size: 3, federate: false } };
      return { ok: false, error: { message: 'unexpected ' + path } };
    },
  };
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, textContent: '', innerHTML: '' });
  (globalThis as any).document = (globalThis as any).document ?? {
    documentElement: { lang: 'en', ...el() }, head: el(), body: el(),
    getElementById: () => null, querySelector: () => null, createElement: el,
    addEventListener() {}, dispatchEvent() {},
  };
  (globalThis as any).location = (globalThis as any).location ?? { origin: 'https://app.apps.node.test', href: 'https://app.apps.node.test/', protocol: 'https:', hostname: 'app.apps.node.test', search: '', hash: '' };
  (globalThis as any).window = (globalThis as any).window ?? { addEventListener() {}, dispatchEvent() {}, location: (globalThis as any).location };
  (globalThis as any).window.AIMEAT = { ...((globalThis as any).window.AIMEAT ?? {}), auth: { getSession: () => session } };
  (globalThis as any).fetch = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) => {
    puts.push({ url, method: init.method, headers: init.headers ?? {}, body: init.body });
    return new Response(JSON.stringify(putAnswer), { status: putStatus, headers: { 'Content-Type': 'application/json' } });
  };
});

async function lib() {
  await import('../../src/static/sdk-libs/storage/index.js');
  return (globalThis as any).window.AIMEAT.storage;
}

/** A file over 4 MiB: past the size where the base64 JSON upload answered 500 on aimeat.io. */
const bigFile = () => new File([new Uint8Array(4.5 * 1024 * 1024)], 'big.zip', { type: 'application/zip' });

describe('AIMEAT.storage.upload with a File or a Blob', () => {
  it('mints an upload address and sends the raw bytes in one PUT', async () => {
    const storage = await lib();
    const file = bigFile();
    await storage.upload(file, { visibility: 'workspace', workspace_ref: 'org1/ws1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/v1/storage');
    expect(calls[0].body).toMatchObject({ key: 'big.zip', mime_type: 'application/zip', visibility: 'workspace', workspace_ref: 'org1/ws1', mode: 'presigned' });
    expect('data' in calls[0].body).toBe(false);
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe(UPLOAD_URL);
    expect(puts[0].method).toBe('PUT');
    expect(puts[0].headers['Content-Type']).toBe('application/zip');
    expect(puts[0].headers.Authorization).toBeUndefined();
    expect(puts[0].body).toBe(file);
  });

  it('answers the fields the inline upload answered', async () => {
    const storage = await lib();
    const out = await storage.upload(bigFile());
    expect(out).toEqual({
      key: 'big.zip', store: 'database', owner_gaii: 'alice@node.test', size: 0, mime_type: 'application/zip',
      visibility: 'private', federate: false, created_at: '2026-11-26T20:00:00.000Z',
      embed_url: STORED.embed_url, embed_markdown: STORED.embed_markdown, versioned_url: STORED.versioned_url,
    });
  });

  it('names a Blob with no name, sends nodeDefault and the store', async () => {
    const storage = await lib();
    await storage.upload(new Blob(['abc'], { type: 'text/plain' }), { nodeDefault: true, store: 'own:main' });
    expect(calls[0].body.key).toMatch(/^file-\d+$/);
    expect(calls[0].body).toMatchObject({ mime_type: 'text/plain', visibility: 'default', store: 'own:main', mode: 'presigned' });
  });

  it('carries the warnings of the mint and a publish request of the PUT', async () => {
    const storage = await lib();
    mintAnswer.data.warnings = [{ code: 'PUBLIC_IS_SIGNED_IN_HERE' }];
    putStatus = 202;
    putAnswer = { ...STORED, visibility: 'members', publish_request: { id: 'pr1' } };
    const out = await storage.upload(bigFile(), { visibility: 'public' });
    expect(out.warnings).toEqual([{ code: 'PUBLIC_IS_SIGNED_IN_HERE' }]);
    expect(out.publish_request).toEqual({ id: 'pr1' });
  });

  it('throws the sentence the node answered the PUT with', async () => {
    const storage = await lib();
    putStatus = 413;
    putAnswer = { success: false, error: 'FILE_TOO_LARGE', message: 'File size exceeds the 10 MB limit' };
    const err = await storage.upload(bigFile()).catch((e: unknown) => e);
    expect((err as Error).message).toBe('File size exceeds the 10 MB limit');
    expect((err as { code?: string }).code).toBe('FILE_TOO_LARGE');
    expect((err as { status?: number }).status).toBe(413);
  });

  it('throws the mint refusal and sends no bytes', async () => {
    const storage = await lib();
    mintAnswer = { ok: false, error: { code: 'INSUFFICIENT_SCOPE', message: 'This app may not write files.' } };
    await expect(storage.upload(bigFile())).rejects.toThrow('This app may not write files.');
    expect(puts).toHaveLength(0);
  });

  it('refuses a file over the address limit before sending it', async () => {
    const storage = await lib();
    mintAnswer.data.max_size_bytes = 1024;
    await expect(storage.upload(bigFile())).rejects.toThrow('Upload exceeds limit of 1024 bytes');
    expect(puts).toHaveLength(0);
  });
});

describe('AIMEAT.storage.upload with a base64 string', () => {
  it('still goes inline as JSON', async () => {
    const storage = await lib();
    const out = await storage.upload('QUJD', { key: 'abc.txt', mime_type: 'text/plain' });
    expect(calls[0].body).toMatchObject({ key: 'abc.txt', data: 'QUJD', mime_type: 'text/plain', visibility: 'private' });
    expect('mode' in calls[0].body).toBe(false);
    expect(puts).toHaveLength(0);
    expect(out.key).toBe('abc.txt');
  });

  it('refuses anything else', async () => {
    const storage = await lib();
    await expect(storage.upload(42)).rejects.toThrow('upload() expects a File, Blob, or base64 string');
  });
});
