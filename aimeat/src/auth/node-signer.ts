/**
 * @file src/auth/node-signer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node signs each kind of token with a key of that kind's own, derived from the node
 *   key, and names the key in the token's header (`kid`). A token signed for one purpose does not
 *   verify as another purpose, whatever its claims say.
 *
 *   WHY. One Ed25519 node key signed the session JWT and thirteen other token kinds, told apart only
 *   by a `typ` claim and the denylist of purpose claims in auth/jwt.ts. The S-1 finding of 2026-10-09
 *   (a purpose token accepted as a session) was that design, and a new token kind had to remember to
 *   join the denylist (codebase analysis 2026-11-03, security-architecture finding 10).
 *
 *   THE KEYS. For each purpose, HKDF-SHA256 over the node key's 32-byte Ed25519 seed, with the salt
 *   `aimeat-node-signer-v1` and the purpose as label, gives the seed of that purpose's Ed25519 key.
 *   The kid is `<purpose>.<8 base64url characters of the SHA-256 of its public key>`, so a kid also
 *   says which node key it came from. The keys are derived once per node key and kept in this
 *   process; every process of a node derives the same ones from the same node key.
 *
 *   A TOKEN FROM BEFORE. Every token the node signed before 2026-11-04 carries no kid and was signed
 *   with the node key itself. verify() reads such a token, and any token whose kid is not one of this
 *   node key's purpose keys, with the node key, exactly as before, so a session, a share link or a
 *   download address handed out before keeps working until its own expiry
 *   (test/unit/legacy-keys-still-open.test.ts). The checks each service makes after the signature
 *   (`typ`, the purpose claims of auth/jwt.ts) stay for those tokens.
 *
 *   WHAT IS NOT HERE. Tokens that someone outside the node verifies with the node's published key keep
 *   the node key: a verifiable credential (services/vc-issuer.ts), the dataspace identity token
 *   (services/dataspace/identity.ts) and its published JWK (routes/dsp/index.ts), and the signed agent
 *   card (routes/agents-v2/card.ts). A derived key would not verify there. Federation messages are
 *   signed with the node key through auth/keypair.ts, for the same reason.
 * @structure TokenPurpose · TOKEN_PURPOSES · TokenPurposeError · derive / derivedFor (the keys of one
 *   node key) · signFor(purpose, jwt, privateKey) · kidOf(token) · verifyFor(purpose, token, keys, options)
 * @usage
 *   const token = await signFor('download', new SignJWT(claims).setSubject(sub).setExpirationTime('1h'), privateKey);
 *   const { payload } = await verifyFor('download', token, { privateKey, publicKey }, { algorithms: ['EdDSA'] });
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item B9).
 */
import { createHash, hkdfSync } from 'node:crypto';
import { decodeProtectedHeader, jwtVerify, type JWTVerifyOptions, type JWTVerifyResult, type SignJWT } from 'jose';
import * as ed from '@noble/ed25519';

/** The token kinds the node signs and verifies itself, each with a key of its own. */
export const TOKEN_PURPOSES = [
  'session', 'download', 'upload', 'share', 'draft-preview', 'frame-grant', 'confirm', 'party',
  'pageframe', 'dbpreview', 'app-access', 'app-shot', 'page-access', 'external-login-pending',
] as const;

export type TokenPurpose = typeof TOKEN_PURPOSES[number];

/**
 * A token this node signed for another purpose than the one asked. Each service answers it with the
 * refusal it gives a token of another kind, so the caller sees the same answer as before.
 */
export class TokenPurposeError extends Error {
  constructor(readonly signedFor: TokenPurpose, readonly wanted: TokenPurpose) {
    super(`The token was signed for ${signedFor}, not for ${wanted}.`);
    this.name = 'TokenPurposeError';
  }
}

interface PurposeKey { purpose: TokenPurpose; kid: string; privateKey: CryptoKey; publicKey: CryptoKey }
interface Derived { byPurpose: Map<TokenPurpose, PurposeKey>; byKid: Map<string, PurposeKey> }

const SALT = 'aimeat-node-signer-v1';

/**
 * The purpose keys of each node key, by the node key's private CryptoKey. Derived on first use and
 * kept for the life of that key object; another process derives the same keys from the same node key.
 */
const derivedOf = new WeakMap<CryptoKey, Promise<Derived | null>>();

async function derive(nodePrivateKey: CryptoKey): Promise<Derived | null> {
  let seed: Buffer;
  try {
    const jwk = await crypto.subtle.exportKey('jwk', nodePrivateKey);
    if (!jwk.d) return null;
    seed = Buffer.from(jwk.d, 'base64url');
  } catch {
    // A key that cannot be exported has no purpose keys: such a node signs nothing new, and verify()
    // reads every token with the node key, as before this module existed.
    // eslint-disable-next-line aimeat/no-silent-catch -- null is the answer: no derived keys for this key object
    return null;
  }
  const byPurpose = new Map<TokenPurpose, PurposeKey>();
  const byKid = new Map<string, PurposeKey>();
  for (const purpose of TOKEN_PURPOSES) {
    const d = Buffer.from(hkdfSync('sha256', seed, SALT, `aimeat token purpose: ${purpose}`, 32));
    const x = Buffer.from(await ed.getPublicKeyAsync(d));
    const kid = `${purpose}.${createHash('sha256').update(x).digest('base64url').slice(0, 8)}`;
    const publicKey = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: x.toString('base64url') }, { name: 'Ed25519' }, false, ['verify']);
    const privateKey = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: x.toString('base64url'), d: d.toString('base64url') }, { name: 'Ed25519' }, false, ['sign']);
    const key = { purpose, kid, privateKey, publicKey };
    byPurpose.set(purpose, key);
    byKid.set(kid, key);
  }
  return { byPurpose, byKid };
}

function derivedFor(nodePrivateKey: CryptoKey): Promise<Derived | null> {
  let hit = derivedOf.get(nodePrivateKey);
  if (!hit) {
    hit = derive(nodePrivateKey);
    derivedOf.set(nodePrivateKey, hit);
  }
  return hit;
}

/**
 * Sign `jwt` with the key of `purpose`, under the header `{ alg: 'EdDSA', typ: 'JWT', kid }`. The
 * builder carries the claims and the times; this sets the header and signs. Throws when the node key
 * cannot give purpose keys (a key object that cannot be exported), rather than sign without one.
 */
export async function signFor(purpose: TokenPurpose, jwt: SignJWT, nodePrivateKey: CryptoKey): Promise<string> {
  const key = (await derivedFor(nodePrivateKey))?.byPurpose.get(purpose);
  if (!key) throw new Error(`The node key gives no ${purpose} signing key: it cannot be exported.`);
  return jwt.setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', kid: key.kid }).sign(key.privateKey);
}

/** The `kid` of a token's header, or undefined when there is none or the header does not read. */
function kidOf(token: string): unknown {
  try {
    return decodeProtectedHeader(token).kid;
  } catch {
    // Not a readable JWS header: verifyFor hands it to jwtVerify, which refuses it with the error it always gave.
    // eslint-disable-next-line aimeat/no-silent-catch -- undefined is the answer: no kid to read
    return undefined;
  }
}

/**
 * Verify `token` for `purpose`. A token whose kid names one of this node key's purpose keys is
 * verified with that key, and refused with TokenPurposeError when the purpose is another one; the
 * signature and the times are checked first, so an expired token of another purpose is refused as
 * expired, as before. Any other token (no kid: a token from before 2026-11-04) is verified with the
 * node key, as before. jose's own errors pass through unchanged.
 */
export async function verifyFor(
  purpose: TokenPurpose,
  token: string,
  node: { privateKey: CryptoKey; publicKey: CryptoKey },
  options: JWTVerifyOptions,
): Promise<JWTVerifyResult> {
  const kid = kidOf(token);
  const signedWith = typeof kid === 'string' ? (await derivedFor(node.privateKey))?.byKid.get(kid) : undefined;
  if (!signedWith) return jwtVerify(token, node.publicKey, options);
  const result = await jwtVerify(token, signedWith.publicKey, options);
  if (signedWith.purpose !== purpose) throw new TokenPurposeError(signedWith.purpose, purpose);
  return result;
}
