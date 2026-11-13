/**
 * @file test/fixtures/legacy-keys/mint-legacy-keys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Mints one of every token the node signs and seals one of every secret it stores, with
 *   the node's own functions, and writes them to minted-0c741df55.json beside this file.
 *
 *   WHY. Commit 0c741df55 is the last code before the key ring and the per-purpose signer (codebase
 *   analysis 2026-11-03, item B9). Everything that code issued or sealed must keep verifying or
 *   opening under the new code until its own expiry: sessions, agent and app tokens, share links,
 *   download and upload addresses, the short purpose tokens, stored secrets, the node key at rest
 *   and in its file. This script was run ONCE, on 0c741df55, and its output is committed as data;
 *   test/unit/legacy-keys-still-open.test.ts reads it with the current code. Running it again on
 *   later code mints the later forms and proves nothing about the old ones, so do not regenerate the
 *   committed file.
 *
 *   THE KEYS are derived from fixed labels (SHA-256), so the test rebuilds them without any key
 *   material in the repository. The one random key is the key file's, which initializeNode
 *   generates: only its public key is written here, and the test opens the file to it.
 * @usage cd aimeat && pnpm exec tsx test/fixtures/legacy-keys/mint-legacy-keys.ts   (on 0c741df55 only)
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial, run on 0c741df55 (codebase analysis 2026-11-03, item B9).
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ed from '@noble/ed25519';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'minted-0c741df55.json');

/** 32 bytes from a fixed label: the same in this script and in the test. */
export const fixedBytes = (label: string): Buffer => createHash('sha256').update(`aimeat legacy-keys fixture: ${label}`).digest();

export const NODE = 'aimeat-fixture-001-legacy';
export const OWNER = 'alice';
export const DATA_KEY_HEX = fixedBytes('data key').toString('hex');
export const TOTP_KEY_HEX = fixedBytes('totp key').toString('hex');
export const PASSPHRASE = 'aimeat legacy-keys fixture passphrase';

async function main(): Promise<void> {
  // The legacy shared key file lives under the home directory; a temporary home keeps the run off
  // this machine's real one.
  const home = mkdtempSync(join(tmpdir(), 'aimeat-legacy-keys-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  const nodeSeed = fixedBytes('node key');
  const nodePublic = Buffer.from(await ed.getPublicKeyAsync(nodeSeed));
  const nodeKey = { publicKey: nodePublic.toString('base64'), privateKey: nodeSeed.toString('base64') };

  const out: Record<string, unknown> = { mintedAtCommit: '0c741df55', node: NODE, owner: OWNER, mintedAtMs: Date.now() };

  // ── The key file, written by initializeNode with a passphrase (P3-8) ─────────────────────────────
  {
    const { initializeNode } = await import('../../../src/auth/node-keys.js');
    const keyPath = join(home, 'node-key.json');
    let stored: { publicKey: string } | null = null;
    const storage = {
      getNodeKey: async () => null,
      setNodeKey: async (publicKey: string) => { stored = { publicKey }; },
    };
    process.env.AIMEAT_KEY_PASSPHRASE = PASSPHRASE;
    await initializeNode({ nodeId: NODE, nodeKeyPath: keyPath, keyPassphrase: PASSPHRASE, encryptionKey: null } as never, storage as never);
    delete process.env.AIMEAT_KEY_PASSPHRASE;
    out.keyFile = { content: JSON.parse(readFileSync(keyPath, 'utf8')), publicKey: (stored as { publicKey: string } | null)?.publicKey };
  }

  // ── The node's signing keys, as initializeNode wires them ───────────────────────────────────────
  const jwt = await import('../../../src/auth/jwt.js');
  await jwt.initNodeKeys(nodeKey.publicKey, nodeKey.privateKey);
  const { privateKey, publicKey } = jwt.getNodeCryptoKeys();
  const download = await import('../../../src/services/download-token.js');
  const upload = await import('../../../src/services/upload-token.js');
  const share = await import('../../../src/services/share-token.js');
  const draft = await import('../../../src/services/draft-token.js');
  const confirm = await import('../../../src/services/operator-confirm.js');
  const party = await import('../../../src/services/parties/token.js');
  const pageFrame = await import('../../../src/services/page-frame-token.js');
  const preview = await import('../../../src/services/design-book/preview-token.js');
  const appAccess = await import('../../../src/services/app-access-token.js');
  const external = await import('../../../src/services/external-login.js');
  download.initDownloadTokenKeys(privateKey, publicKey);
  upload.initUploadTokenKeys(privateKey, publicKey);
  share.initShareTokenKeys(privateKey, publicKey);
  draft.initDraftTokenKeys(privateKey, publicKey);
  confirm.initConfirmTokenKeys(privateKey, publicKey);
  party.initPartyTokenKeys(privateKey, publicKey);
  pageFrame.initPageFrameTokenKeys(privateKey, publicKey);
  preview.initDesignBookPreviewTokenKeys(privateKey, publicKey);

  // A storage that keeps the short-lived rows ephemeral-claims writes (the upload address).
  const claims: Array<{ kind: string; id: string; payload: string; expiresAt: number }> = [];
  const { registerSessionAuth } = await import('../../../src/auth/node-auth.js');
  registerSessionAuth({
    putEphemeralClaim: async (kind: string, id: string, payload: string, expiresAt: number) => { claims.push({ kind, id, payload, expiresAt }); },
    sweepEphemeralClaims: async () => 0,
    getAgent: async () => null,
  } as never, { nodeId: NODE } as never);

  const ghii = `${OWNER}@${NODE}`;
  const agent = `claude#${ghii}`;
  const year = 365 * 24 * 3600;
  const tokens: Record<string, string> = {};

  // Sessions and the other credentials issueJWT mints.
  tokens.ownerSession = await jwt.issueJWT({ sub: OWNER, owner: OWNER, node: NODE, roles: ['owner'], scopes: [] }, year, 'sid-legacy-fixture');
  tokens.operatorSession = await jwt.issueJWT({ sub: OWNER, owner: OWNER, node: NODE, roles: ['owner', 'operator'], scopes: [] }, year, 'sid-legacy-operator');
  tokens.agentToken = await jwt.issueJWT({ sub: agent, owner: OWNER, node: NODE, roles: ['agent'], scopes: ['memory:read', 'memory:write'] }, year);
  tokens.mcpOauthToken = await jwt.issueJWT({ sub: agent, owner: OWNER, node: NODE, roles: ['agent'], scopes: ['memory:read'], mcp_client: 'Claude', aud: 'http://localhost/mcp' }, year);
  tokens.appGrantToken = await jwt.issueJWT({ sub: OWNER, owner: OWNER, node: NODE, roles: ['app'], scopes: ['memory:read'], app_grant: 'grant-legacy-fixture', app: `${OWNER}/notes.html` }, year);
  tokens.patExchangeToken = await jwt.issueJWT({ sub: OWNER, owner: OWNER, node: NODE, roles: ['owner'], scopes: [], via: 'pat', pat: 'pat-legacy-fixture' }, year);
  tokens.ecosystemToken = await jwt.issueJWT({ sub: `eco:drum-news#${ghii}`, owner: OWNER, node: NODE, roles: ['ecosystem'], scopes: ['memory:read'], eco_app: 'drum-news', auth_time: 1_700_000_000 }, year);
  tokens.federatedToken = await jwt.issueJWT({ sub: 'bob', owner: 'bob', node: NODE, roles: ['owner'], scopes: [], federated: true, homeNode: 'aimeat-fixture-002-home', homeUrl: 'https://home.example' }, year);

  // Share links and signed addresses.
  tokens.shareToken = await share.generateShareToken({ org: 'org-legacy', ws: 'ws-legacy', pwv: 'pwv-legacy' }, year);
  tokens.downloadToken = await download.generateDownloadToken({ sub: ghii, key: 'files/report.pdf', mimeType: 'application/pdf', size: 1234, version: '2026-11-04T00:00:00.000Z', filename: 'report.pdf' }, year);
  tokens.uploadHandle = await upload.generateUploadToken({ sub: ghii, utype: 'storage', meta: { key: 'files/new.txt' }, maxBytes: 100, contentType: 'text/plain' } as never, year);

  // The short purpose tokens.
  tokens.draftPreview = await draft.generateDraftToken({ sub: OWNER, filename: 'notes.html' }, year);
  tokens.frameGrant = await draft.generateFrameToken({ sub: OWNER, filename: 'notes.html', origin: 'https://notes.apps.example' }, year);
  tokens.operatorConfirm = await confirm.mintConfirmToken(OWNER, 'config.set', { path: 'node.name', value: 'x' });
  tokens.partyToken = await party.mintPartyToken({ owner: OWNER, uid: 'party-1', kid: 'pk-1' }, year);
  tokens.appPartyToken = await party.mintPartyToken({ owner: OWNER, uid: 'party-2', kid: 'pk-2', app: `${OWNER}/notes.html`, ep: 3 }, year);
  tokens.pageFrame = await pageFrame.generatePageFrameToken({ org: 'org-legacy', ws: 'ws-legacy', sp: 'docs', ns: 'docs', id: 'page-1', r: 'latest', k: 'pub' }, year);
  tokens.designBookPreview = await preview.designBookPreviewToken('part-legacy');
  tokens.appAccess = await appAccess.generateAppAccessToken({ sub: ghii, filename: 'notes.html', viewer: `bob@${NODE}` }, year);
  tokens.appShot = await appAccess.generateAppShotToken(OWNER, 'notes.html');
  tokens.pageAccess = await appAccess.generatePageAccessToken({ kind: 'portfolio', owner: OWNER }, year, `bob@${NODE}`);
  tokens.pendingSignup = await external.signPendingToken({
    provider: 'google', providerSub: 'g-legacy', email: 'alice@example.com', emailVerified: true,
    displayName: 'Alice', suggested: OWNER, redirect: '/', mode: 'new', existingHint: null,
  } as never);
  out.tokens = tokens;
  out.ephemeralClaims = claims;

  // Random credentials kept as hashes: a personal access token and a refresh token.
  const { hashToken } = await import('../../../src/services/owner-session.js');
  const { PAT_PREFIX } = await import('../../../src/services/access-token.js');
  const pat = `${PAT_PREFIX}legacyfixture0000000000000000000000`;
  out.hashed = { pat, patHash: hashToken(pat), refresh: 'rt-legacy-fixture', refreshHash: hashToken('rt-legacy-fixture') };

  // ── Stored secrets ───────────────────────────────────────────────────────────────────────────────
  const enc = await import('../../../src/services/encryption.js');
  const dataKey = Buffer.from(DATA_KEY_HEX, 'hex');
  const totpKey = Buffer.from(TOTP_KEY_HEX, 'hex');
  const totp = await import('../../../src/services/totp.js');
  const totpBoth = totp.totpConfigOf({ totpIssuer: 'AIMEAT', totpPeriod: 30, totpWindow: 1, totpBackupCodeCount: 2, totpSecretEncryptionKey: TOTP_KEY_HEX, encryptionKey: DATA_KEY_HEX });
  const totpOnly = totp.totpConfigOf({ totpIssuer: 'AIMEAT', totpPeriod: 30, totpWindow: 1, totpBackupCodeCount: 2, totpSecretEncryptionKey: TOTP_KEY_HEX, encryptionKey: null });
  const setupBoth = await totp.setupTotp(OWNER, totpBoth);
  const setupOnly = await totp.setupTotp(OWNER, totpOnly);
  const atRest = await import('../../../src/services/config/at-rest.js');
  const transport = await import('../../../src/services/mcp-client/transport-secrets.js');
  const ext = await import('../../../src/services/extension-secrets.js');
  const protect = await import('../../../src/utils/app-protect.js');
  const nodeAtRest = await import('../../../src/storage/node-key-at-rest.js');
  const keyConfig = { encryptionKey: DATA_KEY_HEX, totpSecretEncryptionKey: TOTP_KEY_HEX };
  out.secrets = {
    plain: 'sk-legacy-fixture-secret ✓ äö',
    unbound: enc.encrypt('sk-legacy-fixture-secret ✓ äö', dataKey),
    bound: enc.encryptBound('sk-legacy-fixture-secret ✓ äö', dataKey, 'owner-secret:alice:openrouter'),
    boundContext: 'owner-secret:alice:openrouter',
    // Written under the TOTP key before the data key was added (services/encryption.ts v1.2.0).
    unboundUnderTotpKey: enc.encrypt('sk-legacy-fixture-secret ✓ äö', totpKey),
    boundUnderTotpKey: enc.encryptBound('sk-legacy-fixture-secret ✓ äö', totpKey, 'owner-secret:alice:openrouter'),
    totp: { secret: setupBoth.secret, stored: setupBoth.encryptedSecret, secretTotpOnly: setupOnly.secret, storedTotpOnly: setupOnly.encryptedSecret },
    sealedSetting: { path: 'smtp.password', serialized: '"hunter2"', stored: atRest.sealSettingValue('smtp.password', '"hunter2"', keyConfig) },
    mcpTransport: { serverId: 'mcp-legacy', sealed: transport.sealTransportSecrets({ kind: 'http', url: 'https://mcp.example', headers: { Authorization: 'Bearer legacy' } }, dataKey, 'mcp-legacy') },
    extensionSecret: { bind: { extension: 'weather' }, sealed: ext.encryptSecretFields({ apiKey: 'wk-legacy' }, ['apiKey'], dataKey, { extension: 'weather' }) },
    watermark: protect.makeWatermark({ protection: { watermark: true }, config: keyConfig as never, viewer: `bob@${NODE}`, appOwner: OWNER, appFilename: 'notes.html', version: 7, servedAt: '2026-11-04T00:00:00.000Z' } as never),
    nodeKeyAtRest: {
      publicKey: nodeKey.publicKey,
      sealedWithPassphrase: nodeAtRest.sealNodePrivateKey(nodeKey.privateKey, nodeKey.publicKey, { passphrase: PASSPHRASE }),
      sealedWithDataKey: nodeAtRest.sealNodePrivateKey(nodeKey.privateKey, nodeKey.publicKey, { dataKeyHex: DATA_KEY_HEX }),
    },
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${OUT}`);
  process.exit(0);
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
