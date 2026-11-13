/**
 * @file test/unit/legacy-keys-still-open.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Everything the node issued or sealed at commit 0c741df55 still verifies or opens with
 *   the current code, until its own expiry.
 *
 *   WHAT THIS PINS (codebase analysis 2026-11-03, item B9). The key ring puts a key id on sealed
 *   values and the per-purpose signer signs each token kind with a key of its own. Neither may end a
 *   session, a share link, a download address or a stored secret that existed before: a person would
 *   be signed out, a link handed out would stop opening, an AI provider key would stop working. The
 *   values in test/fixtures/legacy-keys/minted-0c741df55.json were minted and sealed ONCE by the
 *   node's own functions at 0c741df55 (mint-legacy-keys.ts beside them) and are read here by the
 *   functions every route reads them with. The clock is set to just after the mint, so a token is
 *   judged inside its own lifetime, as it would have been on the day it was handed out.
 *
 *   This test passed on 0c741df55 before the change and passes after it, unchanged.
 * @usage cd aimeat && pnpm exec vitest run test/unit/legacy-keys-still-open.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item B9).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import * as ed from '@noble/ed25519';
import { TOTP, Secret } from 'otpauth';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a fixture file of mixed shapes, read field by field below
const F = require('../fixtures/legacy-keys/minted-0c741df55.json') as any;

const fixedBytes = (label: string): Buffer => createHash('sha256').update(`aimeat legacy-keys fixture: ${label}`).digest();
const NODE: string = F.node;
const OWNER: string = F.owner;
const GHII = `${OWNER}@${NODE}`;
const DATA_KEY_HEX = fixedBytes('data key').toString('hex');
const TOTP_KEY_HEX = fixedBytes('totp key').toString('hex');
const PASSPHRASE = 'aimeat legacy-keys fixture passphrase';
const KEY_CONFIG = { encryptionKey: DATA_KEY_HEX, totpSecretEncryptionKey: TOTP_KEY_HEX };
const T: Record<string, string> = F.tokens;
const S = F.secrets;

let keyFileOpened: { publicKey: string; privateKey: string } | null = null;

beforeAll(async () => {
  // The key file first: initializeNode reads it and wires its own key, which the node key below replaces.
  const home = mkdtempSync(join(tmpdir(), 'aimeat-legacy-open-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const keyPath = join(home, 'node-key.json');
  writeFileSync(keyPath, JSON.stringify(F.keyFile.content, null, 2));
  const { initializeNode } = await import('../../src/auth/node-keys.js');
  process.env.AIMEAT_KEY_PASSPHRASE = PASSPHRASE;
  await initializeNode({ nodeId: NODE, nodeKeyPath: keyPath, keyPassphrase: PASSPHRASE, encryptionKey: null } as never, {
    getNodeKey: async () => null,
    setNodeKey: async (publicKey: string, privateKey: string) => { keyFileOpened = { publicKey, privateKey }; },
  } as never);
  delete process.env.AIMEAT_KEY_PASSPHRASE;

  // The node key the tokens were signed with, wired as initializeNode wires it.
  const seed = fixedBytes('node key');
  const pub = Buffer.from(await ed.getPublicKeyAsync(seed));
  const jwt = await import('../../src/auth/jwt.js');
  await jwt.initNodeKeys(pub.toString('base64'), seed.toString('base64'));
  const { privateKey, publicKey } = jwt.getNodeCryptoKeys();
  (await import('../../src/services/download-token.js')).initDownloadTokenKeys(privateKey, publicKey);
  (await import('../../src/services/upload-token.js')).initUploadTokenKeys(privateKey, publicKey);
  (await import('../../src/services/share-token.js')).initShareTokenKeys(privateKey, publicKey);
  (await import('../../src/services/draft-token.js')).initDraftTokenKeys(privateKey, publicKey);
  (await import('../../src/services/operator-confirm.js')).initConfirmTokenKeys(privateKey, publicKey);
  (await import('../../src/services/parties/token.js')).initPartyTokenKeys(privateKey, publicKey);
  (await import('../../src/services/page-frame-token.js')).initPageFrameTokenKeys(privateKey, publicKey);
  (await import('../../src/services/design-book/preview-token.js')).initDesignBookPreviewTokenKeys(privateKey, publicKey);
  // Imported here for the cold start: these two pull in much of the node.
  await import('../../src/services/external-login.js');
  await import('../../src/services/app-access-token.js');

  // The short-lived rows as the storage held them (the upload address).
  const rows = F.ephemeralClaims as Array<{ kind: string; id: string; payload: string; expiresAt: number }>;
  const row = (kind: string, id: string) => rows.find(r => r.kind === kind && r.id === id) ?? null;
  (await import('../../src/auth/node-auth.js')).registerSessionAuth({
    getEphemeralClaim: async (kind: string, id: string) => row(kind, id),
    takeEphemeralClaim: async (kind: string, id: string) => row(kind, id),
    putEphemeralClaim: async () => undefined,
    sweepEphemeralClaims: async () => 0,
    isSessionRevoked: async () => false,
    getAgent: async () => null,
  } as never, { nodeId: NODE } as never);

  // Inside each token's lifetime: five seconds after the mint.
  vi.useFakeTimers({ toFake: ['Date'], now: F.mintedAtMs + 5_000 });
}, 120_000);

afterAll(() => { vi.useRealTimers(); });

describe('sessions and the credentials issueJWT minted at 0c741df55 still verify', () => {
  it('an owner session and an operator session', async () => {
    const { verifyJWT } = await import('../../src/auth/jwt.js');
    expect(await verifyJWT(T.ownerSession)).toMatchObject({ sub: OWNER, owner: OWNER, node: NODE, roles: ['owner'], sessionId: 'sid-legacy-fixture' });
    expect(await verifyJWT(T.operatorSession)).toMatchObject({ sub: OWNER, roles: ['owner', 'operator'], sessionId: 'sid-legacy-operator' });
  });

  it('an agent token, an MCP OAuth token, an app grant token and a PAT exchange', async () => {
    const { verifyJWT } = await import('../../src/auth/jwt.js');
    expect(await verifyJWT(T.agentToken)).toMatchObject({ sub: `claude#${GHII}`, roles: ['agent'], scopes: ['memory:read', 'memory:write'] });
    expect(await verifyJWT(T.mcpOauthToken)).toMatchObject({ mcp_client: 'Claude', aud: 'http://localhost/mcp', scopes: ['memory:read'] });
    expect(await verifyJWT(T.appGrantToken)).toMatchObject({ roles: ['app'], app_grant: 'grant-legacy-fixture', app: `${OWNER}/notes.html` });
    expect(await verifyJWT(T.patExchangeToken)).toMatchObject({ via: 'pat', pat: 'pat-legacy-fixture', roles: ['owner'] });
  });

  it('an ecosystem app token and a federated visitor', async () => {
    const { verifyJWT } = await import('../../src/auth/jwt.js');
    expect(await verifyJWT(T.ecosystemToken)).toMatchObject({ eco_app: 'drum-news', authTime: 1_700_000_000, roles: ['ecosystem'] });
    expect(await verifyJWT(T.federatedToken)).toMatchObject({ federated: true, roles: ['federated'], homeNode: 'aimeat-fixture-002-home' });
  });

  it('a personal access token and a refresh token, kept as hashes', async () => {
    const { hashToken } = await import('../../src/services/owner-session.js');
    expect(hashToken(F.hashed.pat)).toBe(F.hashed.patHash);
    expect(hashToken(F.hashed.refresh)).toBe(F.hashed.refreshHash);
  });
});

describe('share links and signed addresses still open', () => {
  it('a share link', async () => {
    const { verifyShareToken } = await import('../../src/services/share-token.js');
    expect(await verifyShareToken(T.shareToken)).toEqual({ org: 'org-legacy', ws: 'ws-legacy', pwv: 'pwv-legacy' });
  });

  it('a download address', async () => {
    const { verifyDownloadToken } = await import('../../src/services/download-token.js');
    expect(await verifyDownloadToken(T.downloadToken)).toMatchObject({ sub: GHII, key: 'files/report.pdf', version: '2026-11-04T00:00:00.000Z', filename: 'report.pdf' });
  });

  it('an upload address: the stored handle opens and the token behind it verifies', async () => {
    const { verifyUploadToken } = await import('../../src/services/upload-token.js');
    const v = await verifyUploadToken(T.uploadHandle, { revokeTokenIfAbsent: async () => true } as never);
    expect(v).toMatchObject({ sub: GHII, utype: 'storage', maxBytes: 100, contentType: 'text/plain' });
  });
});

describe('the short purpose tokens still verify', () => {
  it('a draft preview and a frame grant', async () => {
    const draft = await import('../../src/services/draft-token.js');
    expect(await draft.verifyDraftToken(T.draftPreview)).toEqual({ sub: OWNER, filename: 'notes.html' });
    expect(await draft.verifyFrameToken(T.frameGrant)).toEqual({ sub: OWNER, filename: 'notes.html', origin: 'https://notes.apps.example' });
  });

  it('an operator confirmation', async () => {
    const { verifyConfirmToken } = await import('../../src/services/operator-confirm.js');
    await expect(verifyConfirmToken(T.operatorConfirm, OWNER, 'config.set', { path: 'node.name', value: 'x' })).resolves.toBeUndefined();
  });

  it('an outside party token and an app party token', async () => {
    const { verifyPartyToken } = await import('../../src/services/parties/token.js');
    expect(await verifyPartyToken(T.partyToken)).toEqual({ owner: OWNER, uid: 'party-1', kid: 'pk-1' });
    expect(await verifyPartyToken(T.appPartyToken)).toEqual({ owner: OWNER, uid: 'party-2', kid: 'pk-2', app: `${OWNER}/notes.html`, ep: 3 });
  });

  it('a page frame and a Design Book preview', async () => {
    const { verifyPageFrameToken } = await import('../../src/services/page-frame-token.js');
    const { designBookPreviewTokenOpens } = await import('../../src/services/design-book/preview-token.js');
    expect(await verifyPageFrameToken(T.pageFrame)).toEqual({ org: 'org-legacy', ws: 'ws-legacy', sp: 'docs', ns: 'docs', id: 'page-1', r: 'latest', k: 'pub' });
    expect(await designBookPreviewTokenOpens(T.designBookPreview, 'part-legacy')).toBe(true);
  });

  it('an app grant, an app screenshot grant and a page grant', async () => {
    const a = await import('../../src/services/app-access-token.js');
    expect(await a.appAccessGranted(T.appAccess, OWNER, 'notes.html')).toBe(true);
    expect(await a.appShotGranted(T.appShot, OWNER, 'notes.html')).toBe(true);
    expect(await a.pageAccessGranted(T.pageAccess, { kind: 'portfolio', owner: OWNER })).toBe(true);
  });

  it('a pending sign-up of an external login', async () => {
    const { verifyPendingToken } = await import('../../src/services/external-login.js');
    expect(await verifyPendingToken(T.pendingSignup)).toMatchObject({ provider: 'google', providerSub: 'g-legacy', email: 'alice@example.com', mode: 'new' });
  });
});

describe('stored secrets sealed at 0c741df55 still open', () => {
  it('unbound and bound values under the data key, and under the TOTP key the data key was added after', async () => {
    const enc = await import('../../src/services/encryption.js');
    const key = enc.getEncryptionKey(KEY_CONFIG)!;
    expect(enc.decrypt(S.unbound, key)).toBe(S.plain);
    expect(enc.decryptBound(S.bound, key, S.boundContext)).toBe(S.plain);
    expect(enc.decrypt(S.unboundUnderTotpKey, key)).toBe(S.plain);
    expect(enc.decryptBound(S.boundUnderTotpKey, key, S.boundContext)).toBe(S.plain);
    expect(() => enc.decryptBound(S.bound, key, 'owner-secret:bob:openrouter')).toThrow();
  });

  it('a two-step sign-in secret, on a node with both keys and on one with the TOTP key only', async () => {
    const totp = await import('../../src/services/totp.js');
    const base = { totpIssuer: 'AIMEAT', totpPeriod: 30, totpWindow: 1, totpBackupCodeCount: 2 };
    const both = totp.totpConfigOf({ ...base, ...{ totpSecretEncryptionKey: TOTP_KEY_HEX, encryptionKey: DATA_KEY_HEX } });
    const totpOnly = totp.totpConfigOf({ ...base, totpSecretEncryptionKey: TOTP_KEY_HEX, encryptionKey: null });
    const codeOf = (b32: string) => new TOTP({ secret: Secret.fromBase32(b32), algorithm: 'SHA1', digits: 6, period: 30 }).generate();
    expect(totp.validateTotpCode(S.totp.stored, codeOf(S.totp.secret), both).valid).toBe(true);
    expect(totp.validateTotpCode(S.totp.storedTotpOnly, codeOf(S.totp.secretTotpOnly), both).valid).toBe(true);
    expect(totp.validateTotpCode(S.totp.storedTotpOnly, codeOf(S.totp.secretTotpOnly), totpOnly).valid).toBe(true);
  });

  it('a secret Config setting, an MCP server header and an extension secret', async () => {
    const { openStoredSetting } = await import('../../src/services/config/at-rest.js');
    const { openTransportSecrets } = await import('../../src/services/mcp-client/transport-secrets.js');
    const { decryptSecretFields } = await import('../../src/services/extension-secrets.js');
    const { getEncryptionKey } = await import('../../src/services/encryption.js');
    expect(openStoredSetting(S.sealedSetting.path, S.sealedSetting.stored, KEY_CONFIG)).toBe(S.sealedSetting.serialized);
    const open = openTransportSecrets(S.mcpTransport.sealed, KEY_CONFIG as never, S.mcpTransport.serverId) as { headers?: Record<string, string> };
    expect(open.headers).toEqual({ Authorization: 'Bearer legacy' });
    expect(decryptSecretFields(S.extensionSecret.sealed, ['apiKey'], getEncryptionKey(KEY_CONFIG), S.extensionSecret.bind)).toEqual({ apiKey: 'wk-legacy' });
  });

  it('an app watermark', async () => {
    const { decodeWatermark } = await import('../../src/utils/app-protect.js');
    expect(decodeWatermark(S.watermark, KEY_CONFIG as never)).toEqual({ viewer: `bob@${NODE}`, app: `${OWNER}/notes.html`, version: 7, servedAt: '2026-11-04T00:00:00.000Z' });
  });

  it('the node key in the database, sealed with the passphrase and with the data key', async () => {
    const { openNodePrivateKey } = await import('../../src/storage/node-key-at-rest.js');
    const seed = fixedBytes('node key').toString('base64');
    const pub = S.nodeKeyAtRest.publicKey;
    expect(openNodePrivateKey(S.nodeKeyAtRest.sealedWithPassphrase, pub, { passphrase: PASSPHRASE })).toBe(seed);
    expect(openNodePrivateKey(S.nodeKeyAtRest.sealedWithDataKey, pub, { dataKeyHex: DATA_KEY_HEX })).toBe(seed);
  });

  it('the node key file, encrypted with the passphrase', async () => {
    expect(keyFileOpened?.publicKey).toBe(F.keyFile.publicKey);
    const derived = Buffer.from(await ed.getPublicKeyAsync(Buffer.from(keyFileOpened!.privateKey, 'base64'))).toString('base64');
    expect(derived).toBe(F.keyFile.publicKey);
  });
});
