/**
 * @file test/unit/token-purpose-keys.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Each token kind is signed with a key of its own purpose (auth/node-signer.ts), and the
 *   answers every verifier gives stay the ones it gave before.
 *
 *   WHAT THIS PINS (codebase analysis 2026-11-03, item B9, security-architecture finding 10).
 *   - Every service signs with its purpose's key and names it in the header (`kid`).
 *   - THE HOLE, BY CONSTRUCTION: before, a token signed with the node key carrying the session claims
 *     and no purpose marker was a session, whatever service signed it; the purpose-claim denylist was
 *     the only fence. Signed with a purpose key, the same claims are no session.
 *   - THE SAME ANSWERS: each verifier, shown a token of every other kind, answers exactly what it
 *     answers the same token signed the old way (with the node key and no kid): the same status code,
 *     the same message, the same null or false. A table of 14 verifiers by 14 kinds.
 *   - Two processes of one node derive the same keys from the same node key, so a token signed on
 *     one verifies on the other; a different node key gives different keys.
 * @usage cd aimeat && pnpm exec vitest run test/unit/token-purpose-keys.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item B9).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { SignJWT, decodeJwt, decodeProtectedHeader } from 'jose';
import { randomUUID } from 'node:crypto';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { generateKeyPair } from '../../src/auth/keypair.js';

const NODE = 'aimeat-unit-001-purpose';
const OWNER = 'alice';
const GHII = `${OWNER}@${NODE}`;
const CONFIRM_PAYLOAD = { path: 'node.name', value: 'x' };

type Jwt = typeof import('../../src/auth/jwt.js');
type Signer = typeof import('../../src/auth/node-signer.js');
let jwt: Jwt;
let signer: Signer;
let nodeKeys: { publicKey: string; privateKey: string };
let PARTY_PREFIX = '';

/** A token of each kind, signed as its service signs it now. */
const fresh: Record<string, string> = {};
/** The same claims, signed as every service signed them before: the node key, no kid. */
const legacy: Record<string, string> = {};
/** Each verifier, reduced to a comparable answer. */
const verifiers: Record<string, (token: string) => Promise<unknown>> = {};

/** What a verifier answered: its value, or the error's name, code and message. */
async function answer(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    const v = await fn();
    return { ok: v };
  } catch (err) {
    const e = err as Error & { code?: string };
    return { error: e.name, code: e.code, message: e.message };
  }
}

beforeAll(async () => {
  nodeKeys = await generateKeyPair();
  jwt = await import('../../src/auth/jwt.js');
  signer = await import('../../src/auth/node-signer.js');
  await jwt.initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
  const { privateKey, publicKey } = jwt.getNodeCryptoKeys();
  const download = await import('../../src/services/download-token.js');
  const upload = await import('../../src/services/upload-token.js');
  const share = await import('../../src/services/share-token.js');
  const draft = await import('../../src/services/draft-token.js');
  const confirm = await import('../../src/services/operator-confirm.js');
  const party = await import('../../src/services/parties/token.js');
  const pageFrame = await import('../../src/services/page-frame-token.js');
  const preview = await import('../../src/services/design-book/preview-token.js');
  const appAccess = await import('../../src/services/app/access-token.js');
  const external = await import('../../src/services/external-login.js');
  PARTY_PREFIX = (await import('../../src/services/parties/contract.js')).PARTY_TOKEN_PREFIX;
  download.initDownloadTokenKeys(privateKey, publicKey);
  upload.initUploadTokenKeys(privateKey, publicKey);
  share.initShareTokenKeys(privateKey, publicKey);
  draft.initDraftTokenKeys(privateKey, publicKey);
  confirm.initConfirmTokenKeys(privateKey, publicKey);
  party.initPartyTokenKeys(privateKey, publicKey);
  pageFrame.initPageFrameTokenKeys(privateKey, publicKey);
  preview.initDesignBookPreviewTokenKeys(privateKey, publicKey);

  fresh.session = await jwt.issueJWT({ sub: OWNER, owner: OWNER, node: NODE, roles: ['owner'], scopes: [] }, 3600, 'sid-purpose');
  fresh.download = await download.generateDownloadToken({ sub: GHII, key: 'files/a.txt', mimeType: 'text/plain', size: 1, version: '2026-11-04T00:00:00.000Z' });
  // As services/upload-token.ts signs one (its mint answers a handle, not the token).
  fresh.upload = await signer.signFor('upload', new SignJWT({ typ: 'upload', utype: 'storage', meta: {}, maxBytes: 1, contentType: 'text/plain', iat_ms: Date.now() })
    .setJti(randomUUID()).setSubject(GHII).setIssuedAt().setExpirationTime('3600s'), privateKey);
  fresh.share = await share.generateShareToken({ org: 'org-1', ws: 'ws-1', pwv: 'pwv-1' });
  fresh['draft-preview'] = await draft.generateDraftToken({ sub: OWNER, filename: 'a.html' });
  fresh['frame-grant'] = await draft.generateFrameToken({ sub: OWNER, filename: 'a.html', origin: 'https://a.apps.example' });
  fresh.confirm = await confirm.mintConfirmToken(OWNER, 'config.set', CONFIRM_PAYLOAD);
  fresh.party = (await party.mintPartyToken({ owner: OWNER, uid: 'p-1', kid: 'k-1' })).slice(PARTY_PREFIX.length);
  fresh.pageframe = await pageFrame.generatePageFrameToken({ org: 'org-1', ws: 'ws-1', sp: 'docs', ns: 'docs', id: 'page-1', r: 'latest', k: 'pub' });
  fresh.dbpreview = await preview.designBookPreviewToken('part-1');
  fresh['app-access'] = await appAccess.generateAppAccessToken({ sub: GHII, filename: 'a.html' });
  fresh['app-shot'] = await appAccess.generateAppShotToken(OWNER, 'a.html');
  fresh['page-access'] = await appAccess.generatePageAccessToken({ kind: 'portfolio', owner: OWNER });
  fresh['external-login-pending'] = await external.signPendingToken({
    provider: 'google', providerSub: 'g-1', email: 'alice@example.com', emailVerified: true,
    displayName: 'Alice', suggested: OWNER, redirect: '/', mode: 'new', existingHint: null,
  } as never);

  for (const [kind, token] of Object.entries(fresh)) {
    legacy[kind] = await new SignJWT(decodeJwt(token)).setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' }).sign(privateKey);
  }

  verifiers.session = async (t) => jwt.verifyJWT(t);
  verifiers.download = async (t) => download.verifyDownloadToken(t);
  verifiers.upload = async (t) => upload.verifyUploadToken(t, { revokeTokenIfAbsent: async () => true } as never);
  verifiers.share = async (t) => share.verifyShareToken(t);
  verifiers['draft-preview'] = async (t) => draft.verifyDraftToken(t);
  verifiers['frame-grant'] = async (t) => draft.verifyFrameToken(t);
  // Not spent: a refused confirm token is never marked used, and the own-kind row below is the only success.
  verifiers.confirm = async (t) => confirm.verifyConfirmToken(t, OWNER, 'config.set', CONFIRM_PAYLOAD);
  verifiers.party = async (t) => party.verifyPartyToken(`${PARTY_PREFIX}${t}`);
  verifiers.pageframe = async (t) => pageFrame.verifyPageFrameToken(t);
  verifiers.dbpreview = async (t) => preview.designBookPreviewTokenOpens(t, 'part-1');
  verifiers['app-access'] = async (t) => appAccess.appAccessGranted(t, OWNER, 'a.html');
  verifiers['app-shot'] = async (t) => appAccess.appShotGranted(t, OWNER, 'a.html');
  verifiers['page-access'] = async (t) => appAccess.pageAccessGranted(t, { kind: 'portfolio', owner: OWNER });
  verifiers['external-login-pending'] = async (t) => external.verifyPendingToken(t);
}, 120_000);

describe('each token kind is signed with its purpose key', () => {
  it('every kind names its purpose key in the header', () => {
    expect(Object.keys(fresh).sort()).toEqual([...signer.TOKEN_PURPOSES].sort());
    for (const [kind, token] of Object.entries(fresh)) {
      const h = decodeProtectedHeader(token);
      expect(h, kind).toMatchObject({ alg: 'EdDSA', typ: 'JWT' });
      expect(String(h.kid), kind).toMatch(new RegExp(`^${kind}\\.[A-Za-z0-9_-]{8}$`));
    }
  });

  it('each verifier accepts its own kind, signed now and signed before', async () => {
    for (const kind of Object.keys(fresh)) {
      if (kind === 'confirm') continue; // single use: covered by the legacy-keys test and the row below
      for (const token of [fresh[kind], legacy[kind]]) {
        const a = await answer(() => verifiers[kind](token)) as { ok?: unknown };
        expect(a.ok, kind).toBeTruthy();
      }
    }
    await expect(verifiers.confirm(fresh.confirm)).resolves.toBeUndefined();
  });
});

describe('a token signed for one purpose is not a session, by its key', () => {
  it('the session claims signed with a purpose key are refused; signed with the node key they were a session', async () => {
    const { privateKey } = jwt.getNodeCryptoKeys();
    const claims = () => new SignJWT({ owner: OWNER, node: NODE, roles: ['owner', 'operator'], scopes: [] })
      .setSubject(OWNER).setIssuedAt().setExpirationTime('1h');
    // The design before: any token the node key signed with these claims and no marker was a session.
    expect(await jwt.verifyJWT(await claims().setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' }).sign(privateKey))).toMatchObject({ sub: OWNER });
    // Now a service that forgets its marker still cannot mint a session: its key is not the session's.
    for (const purpose of signer.TOKEN_PURPOSES.filter((p) => p !== 'session')) {
      expect(await jwt.verifyJWT(await signer.signFor(purpose, claims(), privateKey)), purpose).toBeNull();
    }
    expect(await jwt.verifyJWT(await signer.signFor('session', claims(), privateKey))).toMatchObject({ sub: OWNER, roles: ['owner', 'operator'] });
  });

  it('a kid moved onto another purpose\'s token does not verify', async () => {
    const [h, p, s] = fresh.download.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as Record<string, unknown>;
    const sessionKid = String(decodeProtectedHeader(fresh.session).kid);
    const moved = `${Buffer.from(JSON.stringify({ ...header, kid: sessionKid })).toString('base64url')}.${p}.${s}`;
    expect(await jwt.verifyJWT(moved)).toBeNull();
  });
});

describe('every verifier answers a token of another kind exactly as it did before', () => {
  it('14 verifiers by 13 other kinds: the answer to the new token equals the answer to the old one', async () => {
    let compared = 0;
    for (const [vKind, verify] of Object.entries(verifiers)) {
      for (const kind of Object.keys(fresh)) {
        if (kind === vKind) continue;
        const now = await answer(() => verify(fresh[kind]));
        const before = await answer(() => verify(legacy[kind]));
        expect(now, `${vKind} shown a ${kind} token`).toEqual(before);
        expect((now as { ok?: unknown }).ok ?? null, `${vKind} shown a ${kind} token opens nothing`).toBeFalsy();
        compared++;
      }
    }
    expect(compared).toBe(14 * 13);
  });
});

describe('the ratchets that keep it so (scripts/check-single-entry.ts)', () => {
  it('a hand-written AES-GCM cipher and a hand-signed or hand-verified JWT are counted', async () => {
    const { RULES, lineTexts } = await import('../../scripts/check-single-entry.js');
    const hits = (id: string, source: string) => lineTexts(source).some((l) => RULES.find((r) => r.id === id)!.pattern.test(l));
    expect(hits('aes-gcm', "const c = createCipheriv('aes-256-gcm', key, iv);")).toBe(true);
    expect(hits('aes-gcm', 'const d = crypto.createDecipheriv(alg, key, iv);')).toBe(true);
    expect(hits('token-key', "await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA' }).sign(k);")).toBe(true);
    expect(hits('token-key', 'const r = await jose.jwtVerify(t, k, {});')).toBe(true);
    expect(hits('token-key', "await signFor('download', builder, key);")).toBe(false);
  });
});

describe('the keys follow the node key', () => {
  it('a second process with the same node key verifies what the first signed', async () => {
    const token = await jwt.issueJWT({ sub: OWNER, owner: OWNER, node: NODE, roles: ['owner'], scopes: [] }, 3600);
    await jwt.initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey); // new key objects, derived again
    expect(await jwt.verifyJWT(token)).toMatchObject({ sub: OWNER });
    expect(decodeProtectedHeader(await jwt.issueJWT({ sub: OWNER, owner: OWNER, node: NODE, roles: ['owner'], scopes: [] }, 60)).kid)
      .toBe(decodeProtectedHeader(token).kid);
  });

  it('another node key gives other keys: its tokens do not verify here, and their kid differs', async () => {
    const other = await generateKeyPair();
    await jwt.initNodeKeys(other.publicKey, other.privateKey);
    const foreign = await jwt.issueJWT({ sub: OWNER, owner: OWNER, node: NODE, roles: ['owner'], scopes: [] }, 3600);
    await jwt.initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
    expect(await jwt.verifyJWT(foreign)).toBeNull();
    expect(decodeProtectedHeader(foreign).kid).not.toBe(decodeProtectedHeader(fresh.session).kid);
  });
});
