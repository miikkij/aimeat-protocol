/**
 * @file test/unit/logger-redaction.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node logger keeps credentials out of every line it writes. A canary is logged
 *   under each field name a credential arrives under (any case, nested, inside an array), inside the
 *   message text and inside an error string, and the captured transport output must not contain it.
 *   Secrets audit 2026-10-09 (07-side-channels d1): the logger masked eight exact lowercase names at
 *   the top level only, so `Authorization`, `apiKey`, `access_token`, a nested `headers.authorization`
 *   and a Bearer inside a message all reached the log.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit, finding d1).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PassThrough } from 'node:stream';
import winston from 'winston';
import { logger } from '../../src/utils/logger.js';

const C = 'CANARY7f3aQx9Lw2';
const lines: string[] = [];
const sink = new PassThrough();
sink.on('data', (chunk: Buffer) => { lines.push(chunk.toString('utf8')); });
const transport = new winston.transports.Stream({ stream: sink });

beforeAll(() => { logger.add(transport); });
afterAll(() => { logger.remove(transport); });

/** Log one entry and answer what the transport wrote for it. */
async function logged(message: string, meta?: Record<string, unknown>): Promise<string> {
  lines.length = 0;
  logger.info(message, meta);
  await new Promise((r) => setImmediate(r));
  return lines.join('');
}

describe('logger redaction: field names', () => {
  const names = ['token', 'Authorization', 'apiKey', 'api_key', 'x-api-key', 'access_token', 'accessToken',
    'refresh_token', 'refreshToken', 'client_secret', 'clientSecret', 'webhookSecret', 'PASSWORD', 'Cookie',
    'set-cookie', 'private_key', 'encryptionKey', 'scimToken', 'passphrase'];
  for (const name of names) {
    it(`masks a value under "${name}"`, async () => {
      const out = await logged('field probe', { [name]: `Bearer-less ${C}` });
      expect(out).toContain('field probe');
      expect(out).not.toContain(C);
    });
  }

  it('masks a nested headers.authorization and a secret in an array', async () => {
    const out = await logged('nested probe', {
      headers: { authorization: `Bearer ${C}`, 'content-type': 'application/json' },
      list: [{ client_secret: C }],
    });
    expect(out).not.toContain(C);
    expect(out).toContain('application/json');
  });

  it('does not change the object the caller passed', async () => {
    const headers = { authorization: `Bearer ${C}` };
    await logged('mutation probe', { headers });
    expect(headers.authorization).toBe(`Bearer ${C}`);
  });

  it('survives a cycle and a deep object', async () => {
    const a: Record<string, unknown> = { name: 'a', token: C };
    a.self = a;
    let deep: Record<string, unknown> = { password: C };
    for (let i = 0; i < 30; i++) deep = { next: deep };
    const out = await logged('cycle probe', { a, deep });
    expect(out).toContain('cycle probe');
    expect(out).not.toContain(C);
  });

  it('leaves counts and ordinary fields alone', async () => {
    const out = await logged('usage probe', { max_tokens: 4096, prompt_tokens: 12, key: 'organism.x.meta', code: 'NOT_FOUND' });
    expect(out).toContain('4096');
    expect(out).toContain('organism.x.meta');
    expect(out).toContain('NOT_FOUND');
  });
});

describe('logger redaction: key-shaped text in strings', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.c2lnbmF0dXJlc2lnbmF0dXJl';
  const cases: Array<[string, string]> = [
    ['an inline Bearer in the message', `t5 inline Bearer ${C}`],
    ['an sk_live_ key', `stripe said sk_live_${C}`],
    ['an sk_test_ key', `stripe said sk_test_${C}`],
    ['a whsec_ secret', `webhook whsec_${C}`],
    ['an rk_ key', `restricted rk_live_${C}`],
    ['an sk- key', `openai sk-proj-${C}`],
    ['a token= query value', `GET /v1/invite?token=${C}&x=1`],
    ['a code= query value', `GET /cb?state=s&code=${C}`],
    ['an access_token= query value', `GET /cb?access_token=${C}`],
    ['a key= query value', `GET /maps?key=${C}`],
  ];
  for (const [label, text] of cases) {
    it(`masks ${label}`, async () => {
      expect(await logged(text)).not.toContain(C);
    });
  }

  it('masks a JWT', async () => {
    expect(await logged(`session ${jwt} refused`)).not.toContain('c2lnbmF0dXJlc2lnbmF0dXJl');
  });

  it('masks AES-GCM ciphertext', async () => {
    const ct = `${'a1'.repeat(12)}:${'b2'.repeat(16)}:${'c3'.repeat(20)}`;
    const out = await logged('stored value', { value: `{"encrypted":"${ct}"}` });
    expect(out).not.toContain('b2b2b2b2');
    expect(out).not.toContain('c3c3c3c3');
  });

  it('masks a Bearer in an error string under an ordinary field', async () => {
    const out = await logged('t6', { error: `Request failed: Bearer ${C}` });
    expect(out).not.toContain(C);
    expect(out).toContain('Request failed');
  });

  it('keeps ids and digests readable', async () => {
    const uuid = 'fbb51de5-609b-41e5-ad9f-8dd2cc76cbe1';
    const out = await logged(`organism ${uuid} read`, { gaii: 'claude#alice@aimeat-local-001-dev' });
    expect(out).toContain(uuid);
    expect(out).toContain('claude#alice@aimeat-local-001-dev');
  });
});
