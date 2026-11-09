/**
 * @file test/unit/living-gear-dialog-words.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Three things the living document's inward dialog showed wrong inside an app.
 *
 *   1. The memory road's own call ("Write the value with your own sign-in") went to the app's own
 *      origin, unquoted. It now goes to the node's own address, single-quoted for a POSIX shell and
 *      double-quoted on Windows, as the program road's call does since round 15b.
 *   2. The placeholders for the key and the token were English on a Finnish screen. They follow the
 *      dialog's language now, and each stays text for the shell inside the double-quoted header.
 *   3. The dialog read the owner's vault (/v1/secrets) on every opening, and inside an app whose
 *      grant does not carry secrets:manage the node answered 403 each time. The dialog now asks only
 *      when the sign-in can list the vault; otherwise the secret picker says the list is not
 *      available here, and no request is made.
 *
 *   FIRST FAIL: against hooks-shapes.js v0.7.5 and dialog-parts.js v0.7.2 the memory line holds the
 *   app's origin unquoted, the Finnish placeholder is `<your API key>`, and canListSecrets() and
 *   vaultNames() do not exist.
 * @usage cd aimeat && pnpm exec vitest run test/unit/living-gear-dialog-words.test.ts
 * @version-history
 *   2026-11-08 -- Initial (secaudit2026nov08b round 15c).
 */
import { describe, it, expect } from 'vitest';

(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { document: unknown }).document = {
  documentElement: { getAttribute: () => null },
  querySelector: () => null,
};
(globalThis as unknown as { location: unknown }).location = { protocol: 'file:', origin: '' };

const { inwardShape } = await import('../../src/static/sdk-libs/living/hooks-shapes.js');
const { WORDS } = await import('../../src/static/sdk-libs/living/hooks-words.js');
const parts = await import('../../src/static/sdk-libs/living/dialog-parts.js') as Record<string, unknown>;

/** The words a POSIX shell would pass, and the control operators it would act on (as `{op}`). */
function shellWords(line: string): Array<string | { op: string }> {
  const out: Array<string | { op: string }> = [];
  let word = '';
  let inWord = false;
  let i = 0;
  const flush = () => { if (inWord) out.push(word); word = ''; inWord = false; };
  while (i < line.length) {
    const c = line[i];
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error('unterminated single quote');
      word += line.slice(i + 1, end); inWord = true; i = end + 1;
    } else if (c === '"') {
      i += 1; inWord = true;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && '"\\$`'.includes(line[i + 1] ?? '')) { word += line[i + 1]; i += 2; }
        else { word += line[i]; i += 1; }
      }
      if (i >= line.length) throw new Error('unterminated double quote');
      i += 1;
    } else if (c === '\\') {
      word += line[i + 1] ?? ''; inWord = true; i += 2;
    } else if (/\s/.test(c)) {
      flush(); i += 1;
    } else if (';&|<>()'.includes(c)) {
      flush(); out.push({ op: c }); i += 1;
    } else {
      word += c; inWord = true; i += 1;
    }
  }
  flush();
  return out;
}

function posixWords(line: string): string[] {
  const words = shellWords(line);
  expect(words.filter((w) => typeof w !== 'string')).toEqual([]);
  return words as string[];
}

const APP_ORIGIN = 'https://room.apps.node.example';
const APEX = 'https://node.example';

function shapeFor(langs: string[], extra: Record<string, unknown> = {}) {
  const doc = {
    v: 1, key: 'living.room', title: { en: 'Room', fi: 'Huone' }, lang: 'en',
    model: { nodes: { temp: { type: 'value', label: { en: 'Room temperature', fi: 'Huoneen lämpötila' } } } },
  };
  return inwardShape(Object.assign({
    id: 'temp', node: doc.model.nodes.temp, doc, graph: { valueOf: () => 21 },
    langs: () => langs, base: APP_ORIGIN, apex: APEX, owner: 'alice',
  }, extra));
}

/** A token with these claims, as the auth library holds it (only the payload is read). */
function jwtWith(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b64({ alg: 'EdDSA' }) + '.' + b64(claims) + '.sig';
}

describe('the memory road\'s own call goes to the node\'s own address', () => {
  it('POSIX: the address is the apex, single-quoted, and the shell reads no operator', () => {
    const shape = shapeFor(['en']);
    const words = posixWords(shape.write.curl);
    expect(words.slice(0, 4)).toEqual(['curl', '-X', 'POST', APEX + '/v1/memory']);
    expect(shape.write.curl.startsWith("curl -X POST '" + APEX + "/v1/memory'")).toBe(true);
    expect(shape.write.request.url).toBe(APEX + '/v1/memory');
    expect(shape.write.curl).not.toContain(APP_ORIGIN);
  });

  it('Windows: the same address, double-quoted', () => {
    const shape = shapeFor(['en']);
    expect(shape.write.windows.curl.startsWith('curl.exe -X POST "' + APEX + '/v1/memory"')).toBe(true);
  });
});

describe('the placeholders follow the dialog\'s language', () => {
  it('Finnish: the API key and the token have Finnish placeholders, each one shell word in its header', () => {
    const shape = shapeFor(['fi']);
    expect(shape.receiver.keyPlaceholder).toBe('<API-avaimesi>');
    expect(posixWords(shape.receiver.curl)).toContain('Authorization: Bearer <API-avaimesi>');
    expect(shape.receiver.windows.curl).toContain('"Authorization: Bearer <API-avaimesi>"');
    expect(posixWords(shape.write.curl)).toContain('Authorization: Bearer <tokenisi>');
    expect(shape.write.windows.curl).toContain('"Authorization: Bearer <tokenisi>"');
  });

  it('English keeps the placeholders it had', () => {
    const shape = shapeFor(['en']);
    expect(shape.receiver.keyPlaceholder).toBe('<your API key>');
    expect(posixWords(shape.write.curl)).toContain('Authorization: Bearer <your token>');
  });

  it('each language carries both placeholders, and neither holds a character a shell reads in double quotes', () => {
    for (const lang of ['en', 'fi'] as const) {
      const words = WORDS[lang] as Record<string, string>;
      for (const key of ['inward.keyPlaceholder', 'inward.tokenPlaceholder']) {
        expect(words[key], `${lang} ${key}`).toMatch(/^<[^"$`\\%!']+>$/);
      }
    }
  });
});

describe('the vault is read only when the sign-in can list it', () => {
  const canListSecrets = parts.canListSecrets as ((s: unknown) => boolean) | undefined;
  const vaultNames = parts.vaultNames as (() => Promise<string[] | null>) | undefined;

  it('an app whose grant lacks secrets:manage cannot; one that carries it can; the owner in person can', () => {
    expect(typeof canListSecrets).toBe('function');
    const fetch = () => Promise.resolve({ ok: true, data: {} });
    expect(canListSecrets!(null)).toBe(false);
    expect(canListSecrets!({ _appOrigin: true, fetch, jwt: jwtWith({ owner: 'alice', app: 'alice/room.html', scopes: ['memory:read', 'memory:write'] }) })).toBe(false);
    expect(canListSecrets!({ _appOrigin: true, fetch, jwt: jwtWith({ owner: 'alice', app: 'alice/room.html', scopes: ['memory:read', 'secrets:manage'] }) })).toBe(true);
    expect(canListSecrets!({ fetch, jwt: jwtWith({ owner: 'alice', roles: ['owner'], scopes: [] }) })).toBe(true);
  });

  it('inside such an app the dialog makes no request and gets null, which the picker shows as not available here', async () => {
    expect(typeof vaultNames).toBe('function');
    let calls = 0;
    const session = {
      _appOrigin: true, owner: 'alice',
      jwt: jwtWith({ owner: 'alice', app: 'alice/room.html', scopes: ['memory:read'] }),
      fetch: () => { calls += 1; return Promise.resolve({ ok: false, status: 403 }); },
    };
    (globalThis as unknown as { AIMEAT: unknown }).AIMEAT = { auth: { getSession: () => session } };
    try {
      expect(await vaultNames!()).toBeNull();
      expect(calls).toBe(0);
    } finally {
      delete (globalThis as unknown as { AIMEAT?: unknown }).AIMEAT;
    }
    for (const lang of ['en', 'fi'] as const) {
      expect((WORDS[lang] as Record<string, string>)['secret.unavailable'], `${lang} secret.unavailable`).toBeTruthy();
    }
  });

  it('the owner in person still gets the names', async () => {
    let calls = 0;
    const session = {
      owner: 'alice',
      jwt: jwtWith({ owner: 'alice', roles: ['owner'], scopes: [] }),
      fetch: () => { calls += 1; return Promise.resolve({ ok: true, data: { secrets: [{ name: 'SPOT_KEY' }] } }); },
    };
    (globalThis as unknown as { AIMEAT: unknown }).AIMEAT = { auth: { getSession: () => session } };
    try {
      expect(await vaultNames!()).toEqual(['SPOT_KEY']);
      expect(calls).toBe(1);
    } finally {
      delete (globalThis as unknown as { AIMEAT?: unknown }).AIMEAT;
    }
  });
});
